import { afterEach, describe, expect, it, vi } from 'vitest'
import { AgentHarness, type HarnessLimits } from '../src/main/agent/harness'
import type { BrowserPort, ModelDecision, ModelInput, Observation, StudyTask, VideoSample } from '../src/shared/contracts'

const task: StudyTask = { id: 'task-1', name: '测试辅助任务', url: 'https://i.chaoxing.com', goal: '打开章节并分析当前练习', status: 'pending', createdAt: 1, updatedAt: 1, lastMessage: '' }
const observation = (): Observation => ({ id: 'shot-1', capturedAt: Date.now(), url: task.url, title: '课程', pageType: 'courses', confidence: 0.9, screenshot: 'data:image/png;base64,AAAA', viewport: { width: 1280, height: 800 }, fingerprint: 'page-a', frames: [], videos: [], completion: { state: 'unknown', evidence: '未发现平台标记' } })
const decision = (patch: Partial<ModelDecision> = {}): ModelDecision => ({ summary: '打开可见的章节入口', confidence: 0.95, pageType: 'courses', questions: [], action: { type: 'click', x: 500, y: 300 }, needsHuman: false, done: false, ...patch })
const video = (patch: Partial<VideoSample> = {}): VideoSample => ({ id: 'video-1', frameId: 'frame-1', currentTime: 1, duration: 10, paused: false, ended: false, readyState: 4, networkState: 1, playbackRate: 1, bufferedEnd: 10, error: null, sampledAt: Date.now(), ...patch })

const harnesses: AgentHarness[] = []
afterEach(() => { for (const harness of harnesses) harness.dispose(); harnesses.length = 0; vi.useRealTimers() })

function setup(limits?: Partial<HarnessLimits>) {
  const browser: BrowserPort = {
    open: vi.fn(async () => {}), close: vi.fn(async () => {}),
    observe: vi.fn(async () => observation()), sampleVideos: vi.fn(async () => []),
    execute: vi.fn(async () => ({ changed: true, message: '页面已变化', observation: { ...observation(), id: 'shot-after', fingerprint: 'page-b' } })),
  }
  const provider = { decide: vi.fn(async (_input: ModelInput): Promise<ModelDecision> => decision()) }
  const onUpdate = vi.fn()
  const log = vi.fn()
  const harness = new AgentHarness({ browser, provider, onUpdate, log, limits: { pollIntervalMs: 2, ...limits } })
  harnesses.push(harness)
  return { harness, browser, provider, onUpdate, log }
}

async function waitPhase(harness: AgentHarness, phase: string): Promise<void> {
  await vi.waitFor(() => expect(harness.snapshot.phase).toBe(phase), { timeout: 2000, interval: 5 })
}

describe('AgentHarness execution boundary', () => {
  it('requires approval, consumes it once, verifies results and takes a new screenshot', async () => {
    const { harness, browser, provider } = setup()
    provider.decide.mockResolvedValueOnce(decision()).mockResolvedValueOnce(decision({ action: null, done: true }))
    await harness.start(task)
    await waitPhase(harness, 'awaiting_confirmation')
    expect(browser.execute).not.toHaveBeenCalled()
    const id = harness.snapshot.pending!.id
    await harness.confirm(id, true)
    await expect(harness.confirm(id, true)).rejects.toThrow('已失效')
    await waitPhase(harness, 'completed')
    expect(browser.execute).toHaveBeenCalledTimes(1)
    expect(browser.observe).toHaveBeenCalledTimes(2)
    expect(harness.snapshot.observation?.id).toBe('shot-1')
    expect(harness.snapshot.message).toContain('不代表平台任务点完成')
  })

  it('rejects confirmation after pause and reobserves on resume', async () => {
    const { harness, browser } = setup()
    await harness.start(task)
    await waitPhase(harness, 'awaiting_confirmation')
    const old = harness.snapshot.pending!.id
    harness.pause()
    await expect(harness.confirm(old, true)).rejects.toThrow('已失效')
    harness.resume()
    await waitPhase(harness, 'awaiting_confirmation')
    expect(harness.snapshot.pending!.id).not.toBe(old)
    expect(browser.execute).not.toHaveBeenCalled()
    expect(browser.observe).toHaveBeenCalledTimes(2)
  })

  it('discards an in-flight model result after pause and propagates abort', async () => {
    const { harness, browser, provider } = setup()
    let resolve!: (d: ModelDecision) => void
    provider.decide.mockImplementationOnce(async input => {
      expect(input.signal.aborted).toBe(false)
      return new Promise<ModelDecision>(done => { resolve = done })
    })
    await harness.start(task)
    await waitPhase(harness, 'thinking')
    const signal = provider.decide.mock.calls[0][0].signal
    harness.pause()
    expect(signal.aborted).toBe(true)
    resolve(decision())
    await new Promise(done => setTimeout(done, 5))
    expect(harness.snapshot.phase).toBe('paused')
    expect(harness.snapshot.pending).toBeNull()
    expect(browser.execute).not.toHaveBeenCalled()
  })

  it('does not apply a stale observation after stop', async () => {
    const { harness, browser, provider } = setup()
    let resolve!: (o: Observation) => void
    vi.mocked(browser.observe).mockImplementationOnce(async () => new Promise<Observation>(done => { resolve = done }))
    await harness.start(task)
    harness.stop()
    resolve(observation())
    await new Promise(done => setTimeout(done, 5))
    expect(harness.snapshot.phase).toBe('stopped')
    expect(provider.decide).not.toHaveBeenCalled()
  })

  it('rejecting an operation leaves the browser under user control', async () => {
    const { harness, browser } = setup()
    await harness.start(task)
    await waitPhase(harness, 'awaiting_confirmation')
    await harness.confirm(harness.snapshot.pending!.id, false)
    expect(harness.snapshot.phase).toBe('needs_user')
    expect(browser.execute).not.toHaveBeenCalled()
  })

  it('always requires answer review and never fills or submits model answers', async () => {
    const { harness, browser, provider } = setup()
    provider.decide.mockResolvedValueOnce(decision({ pageType: 'exercise', action: { type: 'type', text: '答案' }, questions: [{ type: 'single', stem: '1+1=?', options: ['2', '3'], suggestedAnswer: ['2'], explanation: '基础加法', confidence: 0.98, needsReview: false }] }))
    await harness.start(task)
    await waitPhase(harness, 'awaiting_confirmation')
    expect(harness.snapshot.pending?.kind).toBe('answers')
    await harness.confirm(harness.snapshot.pending!.id, true)
    expect(harness.snapshot.phase).toBe('completed')
    expect(browser.execute).not.toHaveBeenCalled()
    expect(harness.snapshot.message).toContain('提交由你')
  })

  it.each([
    { confidence: 0.2 }, { pageType: 'unknown' as const }, { pageType: 'login' as const }, { needsHuman: true },
  ])('asks for intervention when evidence is unreliable: %j', async patch => {
    const { harness, browser, provider } = setup()
    provider.decide.mockResolvedValueOnce(decision(patch))
    await harness.start(task)
    await waitPhase(harness, 'needs_user')
    expect(browser.execute).not.toHaveBeenCalled()
  })

  it('validates even a replaceable provider output before executing', async () => {
    const { harness, browser, provider } = setup()
    provider.decide.mockResolvedValueOnce({ ...decision(), action: { type: 'eval', code: 'evil()' } } as unknown as ModelDecision)
    await harness.start(task)
    await waitPhase(harness, 'needs_user')
    expect(browser.execute).not.toHaveBeenCalled()
    expect(harness.snapshot.message).toContain('结构')
  })

  it('does not automatically retry a failed mutating operation', async () => {
    const { harness, browser } = setup()
    vi.mocked(browser.execute).mockRejectedValueOnce(new Error('timeout may have succeeded'))
    await harness.start(task)
    await waitPhase(harness, 'awaiting_confirmation')
    await harness.confirm(harness.snapshot.pending!.id, true)
    await waitPhase(harness, 'needs_user')
    expect(browser.execute).toHaveBeenCalledTimes(1)
    expect(harness.snapshot.message).toContain('timeout may have succeeded')
  })

  it('surfaces the actual provider error with credentials redacted', async () => {
    const { harness, provider, log } = setup()
    provider.decide.mockRejectedValueOnce(new Error('HTTP 401 API Key 无效 token=very-private'))
    await harness.start(task)
    await waitPhase(harness, 'needs_user')
    expect(harness.snapshot.message).toContain('HTTP 401')
    expect(harness.snapshot.message).not.toContain('very-private')
    expect(JSON.stringify(log.mock.calls)).not.toContain('very-private')
  })
})

describe('AgentHarness finite execution', () => {
  it('preserves completed results when closing the browser or application invokes stop', async () => {
    const { harness, provider } = setup()
    provider.decide.mockResolvedValueOnce(decision({ action: null, done: true }))
    await harness.start(task)
    await waitPhase(harness, 'completed')
    const completed = harness.snapshot
    harness.stop()
    expect(harness.snapshot).toEqual(completed)
  })

  it('preserves error results when closing the browser or application invokes stop', async () => {
    const { harness, provider } = setup({ maxSteps: 1 })
    provider.decide.mockResolvedValueOnce(decision({ action: { type: 'scroll', deltaY: 300 } }))
    await harness.start(task)
    await waitPhase(harness, 'error')
    const failed = harness.snapshot
    harness.stop()
    expect(harness.snapshot).toEqual(failed)
  })

  it('stops after two operations with no verified progress', async () => {
    const { harness, browser, provider } = setup()
    provider.decide.mockResolvedValue(decision({ action: { type: 'wait', ms: 250 } }))
    vi.mocked(browser.execute).mockResolvedValue({ changed: false, message: '无变化', observation: observation() })
    await harness.start(task)
    await waitPhase(harness, 'needs_user')
    expect(browser.execute).toHaveBeenCalledTimes(2)
    expect(harness.snapshot.message).toContain('连续两次')
  })

  it('stops repeated identical decisions even when a port claims progress', async () => {
    const { harness, browser, provider } = setup()
    provider.decide.mockResolvedValue(decision({ action: { type: 'scroll', deltaY: 300 } }))
    await harness.start(task)
    await waitPhase(harness, 'needs_user')
    expect(browser.execute).toHaveBeenCalledTimes(2)
    expect(harness.snapshot.message).toContain('相同操作')
  })

  it('enforces the model-call budget', async () => {
    const { harness, provider } = setup({ maxModelCalls: 1 })
    provider.decide.mockResolvedValue(decision({ action: { type: 'scroll', deltaY: 300 } }))
    await harness.start(task)
    await waitPhase(harness, 'error')
    expect(provider.decide).toHaveBeenCalledTimes(1)
    expect(harness.snapshot.message).toContain('调用轮数上限')
  })

  it('enforces the step budget', async () => {
    const { harness, browser, provider } = setup({ maxSteps: 1 })
    provider.decide.mockResolvedValue(decision({ action: { type: 'scroll', deltaY: 300 } }))
    await harness.start(task)
    await waitPhase(harness, 'error')
    expect(browser.observe).toHaveBeenCalledTimes(1)
    expect(harness.snapshot.message).toContain('轮数上限')
  })

  it('runtime expiry disarms a pending approval', async () => {
    const { harness, browser } = setup({ maxRuntimeMs: 100 })
    await harness.start(task)
    await waitPhase(harness, 'awaiting_confirmation')
    const id = harness.snapshot.pending!.id
    await waitPhase(harness, 'error')
    await expect(harness.confirm(id, true)).rejects.toThrow('已失效')
    expect(browser.execute).not.toHaveBeenCalled()
  })
})

describe('AgentHarness deterministic video monitoring', () => {
  it('analyzes visible exercises even when the page retains a paused video', async () => {
    const { harness, browser, provider } = setup()
    vi.mocked(browser.observe).mockResolvedValue({ ...observation(), pageType: 'exercise', videos: [video({ paused: true })] })
    provider.decide.mockResolvedValueOnce(decision({ action: null, needsHuman: true, summary: '核对题目截图' }))
    await harness.start(task)
    await waitPhase(harness, 'needs_user')
    expect(provider.decide).toHaveBeenCalledTimes(1)
    expect(harness.snapshot.message).toContain('核对题目截图')
  })
  it('requests manual playback when paused without any model call', async () => {
    const { harness, browser, provider } = setup()
    vi.mocked(browser.observe).mockResolvedValue({ ...observation(), pageType: 'video', videos: [video({ paused: true })] })
    await harness.start(task)
    await waitPhase(harness, 'needs_user')
    expect(provider.decide).not.toHaveBeenCalled()
    expect(harness.snapshot.message).toContain('暂停')
  })

  it('does not equate ended with platform completion', async () => {
    const { harness, browser, provider } = setup()
    vi.mocked(browser.observe).mockResolvedValue({ ...observation(), pageType: 'video', videos: [video()] })
    vi.mocked(browser.sampleVideos).mockResolvedValue([video({ currentTime: 10, ended: true, paused: true })])
    await harness.start(task)
    await waitPhase(harness, 'needs_user')
    expect(provider.decide).not.toHaveBeenCalled()
    expect(harness.snapshot.message).toContain('尚未确认平台')
  })

  it('records completion only with explicit current-page platform evidence', async () => {
    const { harness, browser, provider } = setup()
    vi.mocked(browser.observe).mockResolvedValue({ ...observation(), pageType: 'video', videos: [video()], completion: { state: 'complete', evidence: '当前任务标记：已完成' } })
    vi.mocked(browser.sampleVideos).mockResolvedValue([video({ currentTime: 10, ended: true })])
    await harness.start(task)
    await waitPhase(harness, 'completed')
    expect(provider.decide).not.toHaveBeenCalled()
    expect(harness.snapshot.message).toContain('当前任务标记')
  })

  it('detects stalled playback without model calls or seeking', async () => {
    const { harness, browser, provider } = setup()
    const sampledAt = Date.now()
    vi.mocked(browser.observe).mockResolvedValue({ ...observation(), videos: [video({ sampledAt })] })
    vi.mocked(browser.sampleVideos).mockResolvedValue([video({ sampledAt: sampledAt + 16000 })])
    await harness.start(task)
    await waitPhase(harness, 'needs_user')
    expect(provider.decide).not.toHaveBeenCalled()
    expect(browser.execute).not.toHaveBeenCalled()
    expect(harness.snapshot.videos[0].status).toBe('stalled')
  })
})
