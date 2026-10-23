import { randomUUID } from 'node:crypto'
import {
  decisionSchema, initialAgent, type AgentPhase, type AgentSnapshot, type BrowserAction,
  type BrowserPort, type ModelProvider, type Observation, type StudyTask,
} from '../../shared/contracts'
import { VideoTracker } from '../browser/video-monitor'
import { redact } from '../security'

export interface HarnessLimits {
  maxSteps: number; maxModelCalls: number; maxRuntimeMs: number; maxWallTimeMs: number; pollIntervalMs: number; completionChecks: number
}
export interface HarnessOptions {
  browser: BrowserPort; provider: ModelProvider; onUpdate: (state: AgentSnapshot) => void;
  log: (level: 'info' | 'warn' | 'error', message: string) => void;
  limits?: Partial<HarnessLimits>
}

const DEFAULT_LIMITS: HarnessLimits = { maxSteps: 30, maxModelCalls: 12, maxRuntimeMs: 2 * 60 * 60 * 1000, pollIntervalMs: 2000, maxWallTimeMs: 24 * 60 * 60 * 1000, completionChecks: 6 }
const RUNNING = new Set<AgentPhase>(['observing', 'thinking', 'executing', 'verifying', 'monitoring'])
const TERMINAL = new Set<AgentPhase>(['idle', 'completed', 'stopped', 'error'])
const SAFE_AUTOMATIC = new Set<BrowserAction['type']>(['wait', 'scroll'])

/** One serialized driver owns browser actions. Generation tokens discard all stale async results. */
export class AgentHarness {
  private state: AgentSnapshot = structuredClone(initialAgent)
  private readonly limits: HarnessLimits
  private task: StudyTask | null = null
  private generation = 0
  private driver: Promise<void> | null = null
  private driveRequested = false
  private controller: AbortController | null = null
  private runtimeTimer: ReturnType<typeof setTimeout> | null = null
  private wallTimer: ReturnType<typeof setTimeout> | null = null
  private history: string[] = []
  private approved: { action: BrowserAction; observation: Observation } | null = null
  private repeats = new Map<string, number>()
  private noProgress = 0
  private readonly videoTracker = new VideoTracker()

  constructor(private readonly options: HarnessOptions) {
    this.limits = { ...DEFAULT_LIMITS, ...options.limits }
    if (Object.values(this.limits).some(n => !Number.isFinite(n) || n <= 0)) throw new Error('Agent 执行限制必须为正数。')
  }

  get snapshot(): AgentSnapshot { return structuredClone(this.state) }

  /** Starts background work and returns immediately so IPC remains responsive. */
  async start(task: StudyTask, mode: 'task' | 'analysis' = 'task'): Promise<void> {
    if (!TERMINAL.has(this.state.phase)) throw new Error('已有任务正在执行或等待接管，请先停止当前任务。')
    this.invalidate()
    this.clearRuntimeTimer()
    this.task = structuredClone(task)
    this.history = []
    this.repeats.clear()
    this.noProgress = 0
    this.videoTracker.reset()
    this.state = { ...structuredClone(initialAgent), mode, taskId: mode === 'analysis' ? null : task.id, startedAt: Date.now() }
    this.wallTimer = setTimeout(() => this.failBudget('任务已保留超过总时长上限，请重新开始。'), this.limits.maxWallTimeMs)
    this.wallTimer.unref?.()
    this.patch({ phase: 'observing', message: mode === 'analysis' ? '正在截取当前页面，仅分析图片，不操作浏览器…' : '正在观察当前浏览器页面…' })
    this.log('info', `开始任务：${task.name}`)
    this.requestDrive()
  }

  pause(): void {
    if (TERMINAL.has(this.state.phase) || this.state.phase === 'paused') return
    this.invalidate()
    this.patch({ phase: 'paused', pending: null, message: 'Agent 已暂停。浏览器由你接管；恢复时将重新观察页面。' })
    this.log('info', '用户暂停 Agent；待确认操作已失效。')
  }

  resume(): void {
    if (!['paused', 'needs_user'].includes(this.state.phase)) throw new Error('只有暂停或等待接管的任务可以恢复。')
    if (!this.task) throw new Error('没有可恢复的任务。')
    if (!this.withinBudget()) return
    this.invalidate()
    this.videoTracker.reset()
    this.patch({ phase: 'observing', pending: null, decision: null, message: '正在重新观察，之前的操作确认已失效。' })
    this.log('info', '用户恢复 Agent。')
    this.requestDrive()
  }

  stop(): void {
    // Closing the browser/app also invokes stop(); preserve an already recorded result.
    if (TERMINAL.has(this.state.phase)) return
    this.invalidate()
    this.clearRuntimeTimer()
    this.patch({ phase: 'stopped', endedAt: Date.now(), pending: null, message: '任务已停止。浏览器保留，便于你继续手动操作。' })
    this.log('info', '用户停止任务。')
  }

  async confirm(id: string, approved: boolean): Promise<void> {
    const pending = this.state.pending
    if (this.state.phase !== 'awaiting_confirmation' || !pending || pending.id !== id || pending.observationId !== this.state.observation?.id) {
      throw new Error('这项确认已失效，请重新观察页面。')
    }
    // Consume before any await; repeated clicks cannot enqueue the same action twice.
    this.patch({ pending: null })
    if (!approved) {
      this.intervene('用户拒绝了建议。请在浏览器中核对或操作，再点击恢复。')
      return
    }
    if (!this.withinBudget()) return
    if (pending.kind === 'answers') {
      this.complete('题目建议已由用户核对。本次截图分析完成；答案填写与提交由你在浏览器中完成。')
      return
    }
    if (!pending.action || !this.state.observation) { this.intervene('缺少待执行操作或观察结果，请重新观察。'); return }
    this.approved = { action: pending.action, observation: this.state.observation }
    this.patch({ phase: 'executing', message: '用户已确认，正在检查页面并执行单次操作…' })
    this.requestDrive()
  }

  dispose(): void { this.invalidate(); this.clearRuntimeTimer(); this.task = null }

  private requestDrive(): void {
    this.driveRequested = true
    if (this.driver) return
    this.driver = this.drain().finally(() => {
      this.driver = null
      if (this.driveRequested) this.requestDrive()
    })
  }

  private async drain(): Promise<void> {
    while (this.driveRequested) {
      this.driveRequested = false
      const generation = this.generation
      const controller = new AbortController()
      this.controller = controller
      try { await this.run(generation, controller.signal) }
      catch (error) {
        if (this.current(generation)) this.intervene(`任务已暂停：${redact(error instanceof Error ? error.message : '浏览器或模型调用失败。')} 修复后可恢复；修改模型配置前请先停止任务。`)
      } finally { if (this.controller === controller) this.controller = null }
    }
  }

  private async run(generation: number, signal: AbortSignal): Promise<void> {
    while (this.current(generation) && this.withinBudget()) {
      if (['paused', 'needs_user', 'awaiting_confirmation', ...TERMINAL].includes(this.state.phase)) return
      if (this.approved) {
        const operation = this.approved
        this.approved = null
        if (!await this.execute(operation.action, operation.observation, generation, signal)) return
        continue
      }
      if (this.state.step >= this.limits.maxSteps) { this.failBudget('已达到操作轮数上限，请人工核对进度。'); return }
      this.patch({ phase: 'observing', step: this.state.step + 1, message: '正在截取当前页面并检查播放器状态…' })
      const observation = await this.options.browser.observe()
      if (!this.current(generation) || !this.withinBudget()) return
      this.patch({ observation, videos: this.videoTracker.update(observation.videos), decision: null })
      if (observation.pageType === 'login') { this.intervene('页面需要登录或平台验证。请在浏览器中手动完成后恢复。'); return }
      if (this.state.mode !== 'analysis' && observation.videos.length > 0 && observation.pageType !== 'exercise') { await this.monitor(observation, generation, signal); return }
      if (this.state.modelCalls >= this.limits.maxModelCalls) { this.failBudget('已达到模型调用轮数上限，请人工核对进度。'); return }
      this.patch({ phase: 'thinking', modelCalls: this.state.modelCalls + 1, message: '模型正在直接阅读截图并生成受控建议…' })
      const rawDecision = await this.options.provider.decide({ goal: this.task!.goal, observation, history: [...this.history], signal, onProgress: progress => {
        if (!this.current(generation)) return
        if (progress.stage === 'requesting') this.patch({ requestCount: this.state.requestCount + 1, retryCount: this.state.retryCount + (progress.attempt > 1 ? 1 : 0), modelRequestStartedAt: Date.now(), message: progress.attempt > 1 ? `正在重试模型请求（第 ${progress.attempt} 次）…` : '截图已准备，正在请求模型分析…' })
        else this.patch({ message: progress.stage === 'reading' ? '服务已响应，正在接收并校验分析结果…' : '服务暂时不可用，稍后自动重试；可以随时停止。' })
      } })
      if (!this.current(generation) || !this.withinBudget()) return
      // Providers are replaceable; validate again at the execution boundary.
      const parsed = decisionSchema.safeParse(rawDecision)
      if (!parsed.success) { this.intervene('模型输出不符合决策结构，已拒绝执行。'); return }
      const decision = parsed.data
      this.patch({ decision })
      this.remember(decision.summary)
      if (decision.questions.length) {
        this.patch({ phase: 'awaiting_confirmation', message: '题目分析已完成，请逐题核对建议与解析。', pending: {
          id: randomUUID(), kind: 'answers', explanation: '模型直接读取截图生成建议，可能存在误读。核对后仅确认本次分析；请在浏览器中自行填写和提交。',
          questions: decision.questions, observationId: observation.id,
        } })
        this.log('info', `截图识别到 ${decision.questions.length} 道题目，等待用户核对。`)
        return
      }
      if (this.state.mode === 'analysis') {
        this.intervene(`当前截图没有可供核对的题目分析：${decision.summary} 请手动调整页面后重新分析；本模式不会执行浏览器操作。`)
        return
      }
      if (decision.needsHuman || decision.confidence < 0.75 || decision.pageType === 'unknown' || decision.pageType === 'login') {
        this.intervene(`需要人工核对：${decision.summary}`)
        return
      }
      if (decision.done) {
        if (decision.action) { this.intervene('模型同时返回完成与操作，状态不一致，已拒绝执行。'); return }
        this.complete(`辅助任务已完成：${decision.summary}（该状态不代表平台任务点完成。）`)
        return
      }
      if (!decision.action) { this.intervene(`没有可靠的下一步操作：${decision.summary}`); return }
      const action = decision.action
      const repeatKey = `${observation.fingerprint}:${JSON.stringify(action)}`
      const repeat = (this.repeats.get(repeatKey) ?? 0) + 1
      this.repeats.set(repeatKey, repeat)
      if (repeat > 2) { this.intervene('同一页面连续提出相同操作，已停止循环，请人工核对。'); return }
      if (SAFE_AUTOMATIC.has(action.type)) {
        if (!await this.execute(action, observation, generation, signal)) return
      } else {
        this.patch({ phase: 'awaiting_confirmation', message: '模型提出了浏览器操作，等待你确认。', pending: {
          id: randomUUID(), kind: 'action', action, observationId: observation.id,
          explanation: `${decision.summary}\n确认仅授权这一次操作。执行前会检查页面是否仍与截图一致。`,
        } })
        this.log('info', `等待用户确认操作：${action.type}`)
        return
      }
    }
  }

  private async execute(action: BrowserAction, observation: Observation, generation: number, signal: AbortSignal): Promise<boolean> {
    if (!this.current(generation) || !this.withinBudget()) return false
    this.patch({ phase: 'executing', message: `正在执行 ${action.type} 并获取结果…` })
    // No automatic retries of mutations: a timed-out click may already have succeeded.
    let result
    try { result = await this.options.browser.execute(action, observation, signal) }
    catch (error) {
      if (this.current(generation)) this.intervene(`操作未执行或未能验证：${redact(error instanceof Error ? error.message : '控件不可用。')} 请核对浏览器后恢复；不会自动重复这次操作。`)
      return false
    }
    if (!this.current(generation) || !this.withinBudget()) return false
    this.patch({ phase: 'verifying', observation: result.observation, videos: this.videoTracker.update(result.observation.videos), message: result.message })
    this.remember(`操作 ${action.type}：${result.message}`)
    this.log(result.changed ? 'info' : 'warn', `操作验证：${result.message}`)
    if (result.verification === 'unverified' && !SAFE_AUTOMATIC.has(action.type)) {
      this.intervene(`操作已发出，但结果仍待核对：${result.message} 请检查浏览器后恢复，不会自动重复操作。`)
      return false
    }
    this.noProgress = result.changed ? 0 : this.noProgress + 1
    if (this.noProgress >= 2) { this.intervene('连续两次操作没有可验证的页面变化，已停止重试。'); return false }
    return true
  }

  private async monitor(initial: Observation, generation: number, signal: AbortSignal): Promise<void> {
    this.patch({ phase: 'monitoring', message: '正在监测真实视频播放状态；监测期间无需调用模型。' })
    let samples = initial.videos
    let emptySamples = 0
    while (this.current(generation) && this.withinBudget()) {
      const videos = this.videoTracker.update(samples)
      this.patch({ videos })
      if (!samples.length) {
        emptySamples++
        if (emptySamples >= 2) { this.intervene('播放器已离开页面或无法读取，请检查浏览器后恢复。'); return }
      } else {
        emptySamples = 0
        if (videos.some(v => v.status === 'error' || v.status === 'stalled' || (v.status === 'buffering' && v.stalledForMs >= 20_000))) {
          this.intervene('检测到视频播放卡顿或媒体/网络异常，请在浏览器中检查后恢复。'); return
        }
        if (videos.every(v => v.status === 'ended')) {
          const ids = new Set(samples.map(v => v.id))
          this.patch({ message: '视频已播放结束，正在等待平台确认任务点状态…' })
          for (let check = 0; check < this.limits.completionChecks; check++) {
            if (check > 0) await this.waitForPoll(signal)
            if (!this.current(generation) || !this.withinBudget()) return
            const observation = await this.options.browser.observe()
            if (!this.current(generation) || !this.withinBudget()) return
            this.patch({ observation })
            if (observation.url !== initial.url || observation.videos.length !== ids.size || observation.videos.some(v => !ids.has(v.id))) {
              this.intervene('等待确认期间课程页面或播放器发生变化，请核对当前任务后恢复。'); return
            }
            if (observation.completion.state === 'complete') {
              this.complete(`视频已结束，当前页面显示任务点完成：${observation.completion.evidence}`); return
            }
          }
          this.intervene(`视频已结束，但尚未确认平台任务点完成。${this.state.observation?.completion.evidence ?? ''} 请核对页面后恢复。`)
          return
        }
        if (videos.every(v => v.status === 'paused' || v.status === 'ended')) {
          this.intervene('视频当前暂停。请在浏览器中正常开始播放，然后恢复监测。'); return
        }
      }
      await this.waitForPoll(signal)
      if (!this.current(generation) || !this.withinBudget()) return
      samples = await this.options.browser.sampleVideos()
      if (!this.current(generation)) return
    }
  }

  private waitForPoll(signal: AbortSignal): Promise<void> {
    return new Promise(resolve => {
      const finish = (): void => { clearTimeout(timer); signal.removeEventListener('abort', finish); resolve() }
      const timer = setTimeout(finish, this.limits.pollIntervalMs)
      if (signal.aborted) finish()
      else signal.addEventListener('abort', finish, { once: true })
    })
  }

  private invalidate(): void { this.generation++; this.controller?.abort(); this.approved = null; this.driveRequested = false }
  private current(generation: number): boolean { return this.generation === generation }
  private patch(patch: Partial<AgentSnapshot>): void {
    const nextPhase = patch.phase ?? this.state.phase
    if (nextPhase !== this.state.phase) {
      if (this.state.activeSince !== null) this.state.activeMs += Math.max(0, Date.now() - this.state.activeSince)
      this.state.activeSince = RUNNING.has(nextPhase) ? Date.now() : null
      if (this.runtimeTimer) clearTimeout(this.runtimeTimer)
      this.runtimeTimer = null
      if (this.state.activeSince !== null) {
        this.runtimeTimer = setTimeout(() => this.failBudget('任务已达到实际运行时间上限，请检查进度后重新开始。'), Math.max(1, this.limits.maxRuntimeMs - this.state.activeMs))
        this.runtimeTimer.unref?.()
      }
      if (nextPhase !== 'thinking') patch.modelRequestStartedAt = null
    }
    this.state = { ...this.state, ...patch }; this.emit()
  }
  private emit(): void { this.options.onUpdate(this.snapshot) }
  private log(level: 'info' | 'warn' | 'error', message: string): void { this.options.log(level, message) }
  private remember(message: string): void { this.history.push(message.slice(0, 1000)); this.history = this.history.slice(-8) }
  private intervene(message: string): void { this.patch({ phase: 'needs_user', pending: null, message }); this.log('warn', message) }
  private complete(message: string): void { this.clearRuntimeTimer(); this.patch({ phase: 'completed', endedAt: Date.now(), pending: null, message }); this.log('info', message) }
  private clearRuntimeTimer(): void {
    if (this.runtimeTimer) clearTimeout(this.runtimeTimer)
    if (this.wallTimer) clearTimeout(this.wallTimer)
    this.runtimeTimer = null; this.wallTimer = null
  }
  private failBudget(message: string): void { this.invalidate(); this.clearRuntimeTimer(); this.patch({ phase: 'error', endedAt: Date.now(), pending: null, message }); this.log('warn', message) }
  private withinBudget(): boolean {
    if (this.state.startedAt !== null && Date.now() - this.state.startedAt >= this.limits.maxWallTimeMs) { this.failBudget('任务已保留超过总时长上限，请重新开始。'); return false }
    const runningMs = this.state.activeMs + (this.state.activeSince === null ? 0 : Math.max(0, Date.now() - this.state.activeSince))
    if (runningMs >= this.limits.maxRuntimeMs) { this.failBudget('任务已达到实际运行时间上限，请检查进度后重新开始。'); return false }
    return true
  }
}
