import { createHash, randomUUID } from 'node:crypto'
import { mkdir } from 'node:fs/promises'
import { setTimeout as delay } from 'node:timers/promises'
import { chromium, type BrowserContext, type Frame, type Page } from 'playwright'
import { actionSchema, type ActionResult, type BrowserAction, type BrowserPort, type CompletionEvidence, type Observation, type PageType, type VideoSample } from '../../shared/contracts'
import { mapPoint, urlAllowed } from './policy'

export interface BrowserOptions {
  headless?: boolean
  /** Explicit opt-in origins, intended for local integration fixtures. Never model controlled. */
  allowedOrigins?: string[]
  executablePath?: string
  observationMaxAgeMs?: number
  onClose?: () => void
}

interface PageHints { password: boolean; exercise: boolean; chapterLinks: number; courseLinks: number; headingKind: string }

export function detectPageType(url: string, hints: PageHints, videos: number): { pageType: PageType; confidence: number } {
  if (hints.password || /passport2\.chaoxing\.com|\/login(?:\b|\/)/i.test(url)) return { pageType: 'login', confidence: 0.96 }
  if (hints.exercise || /\/(?:work|exam)\/(?:do|answer|phone|test)/i.test(url)) return { pageType: 'exercise', confidence: hints.exercise ? 0.9 : 0.72 }
  if (videos > 0) return { pageType: 'video', confidence: 0.98 }
  if (hints.chapterLinks > 0 || hints.headingKind === 'chapters' || /\/mycourse\/(?:studentstudy|studentcourse)/i.test(url)) return { pageType: 'chapters', confidence: 0.8 }
  if (hints.courseLinks > 1 || hints.headingKind === 'courses' || /\/visit\/courses(?:\/|\b)/i.test(url)) return { pageType: 'courses', confidence: 0.8 }
  return { pageType: 'unknown', confidence: 0.1 }
}

/** Browser-only capabilities. Model output is validated data and never executable source. */
export class BrowserController implements BrowserPort {
  private context: BrowserContext | null = null
  private currentPage: Page | null = null
  private frameIds = new WeakMap<Frame, string>()
  private pending: Promise<unknown> = Promise.resolve()
  private lastObservation: Observation | null = null
  private navigationFailed = false

  constructor(private readonly profileDir: string, private readonly options: BrowserOptions = {}) {}

  get isOpen(): boolean { return !!this.context && !!this.currentPage && !this.currentPage.isClosed() }

  private serial<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.pending.then(operation, operation)
    this.pending = next.catch(() => undefined)
    return next
  }

  private assertUrl(url: string): void {
    if (!urlAllowed(url, this.options.allowedOrigins)) throw new Error('此地址不在支持的平台范围内。请使用 HTTPS 学习通 / 学银在线地址。')
  }

  private page(): Page {
    if (!this.context || !this.currentPage || this.currentPage.isClosed()) throw new Error('浏览器未打开或已被关闭。请重新打开浏览器。')
    return this.currentPage
  }

  private id(frame: Frame): string {
    let id = this.frameIds.get(frame)
    if (!id) { id = randomUUID(); this.frameIds.set(frame, id) }
    return id
  }

  private attach(page: Page): void {
    this.currentPage = page
    page.setDefaultTimeout(8000)
    page.setDefaultNavigationTimeout(25_000)
    page.on('dialog', dialog => { void dialog.dismiss().catch(() => undefined) })
    page.on('download', download => { void download.cancel().catch(() => undefined) })
    page.on('close', () => {
      if (this.currentPage === page) this.currentPage = this.context?.pages().filter(p => !p.isClosed()).at(-1) ?? null
      if (!this.currentPage) this.options.onClose?.()
    })
  }

  async open(url: string): Promise<void> {
    return this.serial(async () => {
      this.assertUrl(url)
      if (!this.context) {
        await mkdir(this.profileDir, { recursive: true, mode: 0o700 })
        try {
          this.context = await chromium.launchPersistentContext(this.profileDir, {
            headless: this.options.headless ?? false,
            executablePath: this.options.executablePath,
            viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1,
            acceptDownloads: false, permissions: [],
          })
        } catch {
          throw new Error('无法启动 Chromium。请关闭占用同一会话的窗口，并在项目中运行 npx playwright install chromium。')
        }
        this.context.on('page', page => this.attach(page))
        this.context.on('close', () => { this.context = null; this.currentPage = null; this.lastObservation = null; this.options.onClose?.() })
        await this.context.route('**/*', async route => {
          const request = route.request()
          if (request.isNavigationRequest() && request.frame().parentFrame() === null && !urlAllowed(request.url(), this.options.allowedOrigins)) {
            await route.abort('blockedbyclient')
          } else await route.continue()
        })
        this.attach(this.context.pages()[0] ?? await this.context.newPage())
      }
      if (this.currentPage?.isClosed() || !this.currentPage) {
        this.attach(this.context.pages().find(page => !page.isClosed()) ?? await this.context.newPage())
      }
      if (this.navigationFailed || this.currentPage?.url() !== new URL(url).href) await this.navigate(url)
      await this.page().bringToFront()
    })
  }

  private async navigate(url: string, signal?: AbortSignal): Promise<void> {
    this.assertUrl(url)
    const page = this.page()
    this.navigationFailed = true
    // GET navigation is idempotent; an interrupted attempt gets one bounded retry.
    for (let attempt = 0; attempt < 2; attempt++) {
      signal?.throwIfAborted()
      try {
        const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 25_000 })
        if (response && response.status() >= 400) throw new Error(`HTTP ${response.status()}`)
        this.assertUrl(page.url())
        this.lastObservation = null
        this.navigationFailed = false
        return
      } catch (error) {
        if (attempt === 1 || page.isClosed()) throw new Error(`页面加载失败：${error instanceof Error ? error.message.slice(0, 250) : '未知导航错误'}`)
      }
    }
  }

  async close(): Promise<void> {
    return this.serial(async () => {
      const context = this.context
      this.context = null; this.currentPage = null; this.lastObservation = null
      if (context) await context.close()
    })
  }

  private async fingerprint(page: Page): Promise<string> {
    const structure = []
    for (const frame of page.frames()) {
      try {
        if (!await this.frameHasVisibleLayout(frame)) continue
        const state = await frame.evaluate(() => {
          const visible = (node: Element): boolean => {
            const rect = node.getBoundingClientRect()
            const style = getComputedStyle(node)
            return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none'
          }
          const active = document.activeElement
          return {
            url: location.href, x: Math.round(scrollX), y: Math.round(scrollY), w: innerWidth, h: innerHeight,
            focus: active ? { tag: active.tagName, type: active.getAttribute('type'), id: active.id, x: Math.round(active.getBoundingClientRect().x), y: Math.round(active.getBoundingClientRect().y) } : null,
            controls: Array.from(document.querySelectorAll('button,a,input,textarea,select,video,iframe,[role="button"],[role="radio"],[role="checkbox"],[contenteditable="true"]'))
              .filter(visible).slice(0, 400).map(node => {
                const rect = node.getBoundingClientRect()
                return [node.tagName, node.getAttribute('type'), node.getAttribute('role'), Math.round(rect.x), Math.round(rect.y), Math.round(rect.width), Math.round(rect.height), node.hasAttribute('disabled'), node.getAttribute('href'), node.getAttribute('aria-label'), node.getAttribute('title'), node.getAttribute('name'), node.getAttribute('aria-checked'), node.matches('input[type="radio"],input[type="checkbox"]') ? (node as HTMLInputElement).checked : null, node.tagName === 'INPUT' || node.tagName === 'TEXTAREA' ? null : node.textContent?.slice(0, 300), document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)?.tagName]
              }),
          }
        })
        structure.push({ id: this.id(frame), state })
      } catch {
        if (!frame.isDetached()) throw new Error('页面正在变化，请重新观察后再操作。')
      }
    }
    return createHash('sha256').update(JSON.stringify(structure)).digest('hex')
  }

  /** Hidden retained players are not the active study content. Off-screen layout is still eligible. */
  private async frameHasVisibleLayout(frame: Frame): Promise<boolean> {
    let child = frame
    while (child.parentFrame()) {
      const element = await child.frameElement()
      try {
        const visible = await element.evaluate(node => {
          const elementNode = node as Element
          const rect = elementNode.getBoundingClientRect()
          if (rect.width <= 0 || rect.height <= 0) return false
          for (let current: Element | null = elementNode; current; current = current.parentElement) {
            const style = getComputedStyle(current)
            if (current.hasAttribute('hidden') || style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse' || style.contentVisibility === 'hidden' || style.opacity === '0') return false
          }
          return true
        })
        if (!visible) return false
      } finally { await element.dispose() }
      child = child.parentFrame()!
    }
    return true
  }

  async sampleVideos(): Promise<VideoSample[]> { return this.serial(() => this.samples(this.page())) }

  private async samples(page: Page): Promise<VideoSample[]> {
    const result: VideoSample[] = []
    for (const frame of page.frames()) {
      try {
        if (!await this.frameHasVisibleLayout(frame)) continue
        const videos = await frame.evaluate(() => {
          const visible = (video: HTMLVideoElement): boolean => {
            const rect = video.getBoundingClientRect()
            if (rect.width <= 0 || rect.height <= 0) return false
            for (let current: Element | null = video; current; current = current.parentElement) {
              const style = getComputedStyle(current)
              if (current.hasAttribute('hidden') || style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse' || style.contentVisibility === 'hidden' || style.opacity === '0') return false
            }
            return true
          }
          return Array.from(document.querySelectorAll('video')).map((video, index) => ({ video, index })).filter(({ video }) => visible(video)).map(({ video, index }) => ({
          index, currentTime: Number.isFinite(video.currentTime) ? video.currentTime : 0,
          duration: Number.isFinite(video.duration) && video.duration > 0 ? video.duration : null,
          paused: video.paused, ended: video.ended, readyState: video.readyState,
          networkState: video.networkState, playbackRate: video.playbackRate,
          bufferedEnd: video.buffered.length ? video.buffered.end(video.buffered.length - 1) : 0,
          error: video.error ? `MEDIA_ERR_${video.error.code}` : null,
        }))
        })
        const frameId = this.id(frame)
        for (const { index, ...sample } of videos) result.push({ ...sample, id: `${frameId}:${index}`, frameId, sampledAt: Date.now() })
      } catch {
        if (!frame.isDetached()) throw new Error('无法读取播放器状态，可能正在导航。请重新观察。')
      }
    }
    return result
  }

  private async hints(page: Page): Promise<PageHints> {
    const hints: PageHints = { password: false, exercise: false, chapterLinks: 0, courseLinks: 0, headingKind: '' }
    for (const frame of page.frames()) {
      try {
        if (!await this.frameHasVisibleLayout(frame)) continue
        const part = await frame.evaluate(() => {
          const visible = (selector: string): boolean => Array.from(document.querySelectorAll(selector)).some(node => {
            const rect = node.getBoundingClientRect()
            return rect.width > 0 && rect.height > 0 && getComputedStyle(node).visibility !== 'hidden'
          })
          // Inspect only navigation structure and form presence, never question/option text.
          const links = Array.from(document.querySelectorAll('a[href]')).map(node => node.getAttribute('href') ?? '')
          const headings = Array.from(document.querySelectorAll('header,nav,h1,h2')).slice(0, 20).map(node => node.textContent?.slice(0, 100) ?? '').join(' ')
          return {
            password: visible('input[type="password"]'),
            exercise: visible('[class*="TiMu"],[class*="question"],[data-question-id],.mark_title') && visible('input[type="radio"],input[type="checkbox"],textarea,[contenteditable="true"]'),
            chapterLinks: links.filter(link => /\/mycourse\/studentstudy/i.test(link)).length,
            courseLinks: links.filter(link => /\/mycourse\/studentcourse/i.test(link)).length,
            headingKind: /章节目录|章节学习/.test(headings) ? 'chapters' : /我的课程|课程列表|我学的课/.test(headings) ? 'courses' : '',
          }
        })
        hints.password ||= part.password; hints.exercise ||= part.exercise
        hints.chapterLinks += part.chapterLinks; hints.courseLinks += part.courseLinks
        if (part.headingKind) hints.headingKind = part.headingKind
      } catch { /* Detached frames are omitted; uncertain pages remain unknown. */ }
    }
    return hints
  }

  private async completion(page: Page, samples: VideoSample[]): Promise<CompletionEvidence> {
    if (!samples.length) return { state: 'unknown', evidence: '当前未发现可对应的播放器，未推断任务点完成。' }
    const videoFrames = new Set(samples.map(sample => sample.frameId))
    const frameUrls = new Set<string>()
    for (const frame of page.frames()) if (videoFrames.has(this.id(frame))) {
      let current: Frame | null = frame
      while (current) { frameUrls.add(current.url()); current = current.parentFrame() }
    }
    const states: (boolean | null)[] = []
    for (const frame of page.frames()) {
      try {
        states.push(...await frame.evaluate(urls => {
          const visible = (node: Element): boolean => {
            const rect = node.getBoundingClientRect()
            if (rect.width <= 0 || rect.height <= 0) return false
            for (let current: Element | null = node; current; current = current.parentElement) {
              const style = getComputedStyle(current)
              if (current.hasAttribute('hidden') || style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse' || style.contentVisibility === 'hidden' || style.opacity === '0') return false
            }
            return true
          }
          const relevant = Array.from(document.querySelectorAll('.ans-attach-ct')).filter(container => {
            if (Array.from(container.querySelectorAll('video')).some(visible)) return true
            return Array.from(container.querySelectorAll('iframe')).some(iframe => urls.includes(iframe.src) && visible(iframe))
          })
          return relevant.map(container => {
            if (container.matches('.ans-job-finished') || container.querySelector('.ans-job-finished')) return true
            const marker = container.querySelector('.ans-job-icon')
            const title = marker?.getAttribute('title') ?? marker?.getAttribute('aria-label') ?? ''
            if (/^(?:任务点)?已完成$/.test(title.trim())) return true
            if (/^(?:任务点)?未完成$/.test(title.trim())) return false
            return null
          })
        }, [...frameUrls]))
      } catch { /* Unknown remains unknown, never infer completion from playback time. */ }
    }
    if (states.length && states.every(state => state === true)) return { state: 'complete', evidence: '与当前播放器对应的任务点容器显示 ans-job-finished 或明确的已完成标记（需实站校准）。' }
    if (states.some(state => state === false)) return { state: 'incomplete', evidence: '当前播放器对应的任务点显示明确的未完成标记。' }
    return { state: 'unknown', evidence: '未找到可可靠对应的任务点完成标记；视频结束不会自动视作平台任务完成。' }
  }

  async observe(): Promise<Observation> { return this.serial(() => this.capture()) }

  private async capture(): Promise<Observation> {
    const page = this.page()
    this.assertUrl(page.url())
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const before = await this.fingerprint(page)
        const screenshot = await page.screenshot({ type: 'jpeg', quality: 80, fullPage: false, scale: 'css', timeout: 10_000 })
        const after = await this.fingerprint(page)
        if (before !== after) throw new Error('截图期间页面发生变化。')
        const videos = await this.samples(page)
        const kind = detectPageType(page.url(), await this.hints(page), videos.length)
        const observation: Observation = {
          id: randomUUID(), capturedAt: Date.now(), url: page.url(), title: await page.title(), ...kind,
          screenshot: `data:image/jpeg;base64,${screenshot.toString('base64')}`,
          viewport: page.viewportSize() ?? { width: 1280, height: 800 }, fingerprint: after,
          frames: page.frames().map(frame => ({ id: this.id(frame), url: frame.url() })),
          videos, completion: await this.completion(page, videos),
        }
        this.lastObservation = observation
        return observation
      } catch (error) {
        if (attempt === 1 || page.isClosed()) throw error
      }
    }
    throw new Error('无法获取稳定的页面截图，请稍后重试。')
  }

  private async guard(observation: Observation): Promise<Page> {
    const page = this.page()
    this.assertUrl(page.url())
    const age = Date.now() - observation.capturedAt
    if (!this.lastObservation || this.lastObservation.id !== observation.id || age < 0 || age > 5 * 60_000) throw new Error('观察结果已过期，请重新截图并确认操作。')
    if (page.url() !== observation.url || await this.fingerprint(page) !== observation.fingerprint) throw new Error('页面或控件位置已变化。操作已取消，请重新观察。')
    if (age > (this.options.observationMaxAgeMs ?? 30_000)) {
      // Slow model calls and human review can outlive the fresh-screenshot window.
      // Renew only if BOTH the controls and exact pixels still match the approved view.
      const refreshed = await this.capture()
      if (refreshed.fingerprint !== observation.fingerprint || refreshed.screenshot !== observation.screenshot) {
        throw new Error('确认期间页面画面已变化，已拒绝操作。请重新观察并确认。')
      }
    }
    return page
  }

  private async assertEditable(page: Page, typing: boolean): Promise<void> {
    let editable = false
    for (const frame of page.frames()) {
      const focus = await frame.evaluate(() => {
        const active = document.activeElement as HTMLElement | null
        if (!active || !document.hasFocus() || active.tagName === 'IFRAME' || active.tagName === 'BODY') return 'none'
        const input = active as HTMLInputElement
        if (active.matches('input[type="password"],input[type="file"],input[type="hidden"]') || active.getAttribute('autocomplete')?.includes('password')) return 'sensitive'
        const rect = active.getBoundingClientRect()
        if (!rect.width || !rect.height || input.disabled || input.readOnly) return 'blocked'
        return active.tagName === 'TEXTAREA' || active.isContentEditable || (active.tagName === 'INPUT' && ['text', 'search', 'email', 'url', 'tel', 'number'].includes(input.type)) ? 'editable' : 'other'
      }).catch(() => 'none')
      if (focus === 'sensitive') throw new Error('不会向密码、文件或隐藏输入框发送键盘操作，请手动处理。')
      if (focus === 'editable') editable = true
    }
    if (typing && !editable) throw new Error('当前没有可见、可编辑的输入框。请先定位输入框并重新观察。')
  }

  private async assertSafePress(page: Page, key: string): Promise<void> {
    if (key !== 'Enter' && key !== 'Space') return
    for (const frame of page.frames()) {
      const blocked = await frame.evaluate(key => {
        if (!document.hasFocus()) return false
        const active = document.activeElement
        if (!active || active.tagName === 'IFRAME') return false
        const control = active.closest('button,a,input,label,[role="button"]') ?? active
        const labelControl = control.tagName === 'LABEL' ? (control as HTMLLabelElement).control : null
        const input = (labelControl ?? control) as HTMLInputElement
        const button = control as HTMLButtonElement
        const label = [control.textContent?.slice(0, 200), control.getAttribute('aria-label'), control.getAttribute('title'), input.type === 'submit' ? input.value : ''].join(' ')
        if (key === 'Enter' && (active.closest('form') || input.form)) return true
        return !!active.closest('video,input[type="range"],[role="slider"],.vjs-progress-control,.vjs-playback-rate') || ['file', 'password', 'hidden'].includes(input.type) || (input.type === 'submit' && !!input.form) || (button.tagName === 'BUTTON' && button.type === 'submit' && !!button.form) || /提交|交卷|支付|购买|付款|验证码|人脸|开始考试|确认考试/.test(label)
      }, key).catch(() => true)
      if (blocked) throw new Error('此按键可能触发提交、支付或验证，请在浏览器中手动操作。')
    }
  }

  private async assertSafeClick(page: Page, point: { x: number; y: number }): Promise<void> {
    let frame = page.mainFrame()
    let local = point
    for (let depth = 0; depth < 10; depth++) {
      const hit = await frame.evaluateHandle(({ x, y }) => document.elementFromPoint(x, y), local)
      const element = hit.asElement()
      if (!element) { await hit.dispose(); throw new Error('点击位置没有可见元素，请重新观察。') }
      const information = await element.evaluate(node => {
        const control = node.closest('button,a,input,label,[role="button"]') ?? node
        const labelControl = control.tagName === 'LABEL' ? (control as HTMLLabelElement).control : null
        const input = (labelControl ?? control) as HTMLInputElement
        const button = control as HTMLButtonElement
        const label = [control.textContent?.slice(0, 200), control.getAttribute('aria-label'), control.getAttribute('title'), input.type === 'submit' ? input.value : ''].join(' ')
        const forbidden = !!node.closest('video,input[type="range"],[role="slider"],.vjs-progress-control,.vjs-playback-rate') || input.type === 'file' || (input.type === 'submit' && !!input.form) || (button.tagName === 'BUTTON' && button.type === 'submit' && !!button.form) || /提交|交卷|支付|购买|付款|验证码|人脸|开始考试|确认考试/.test(label)
        const rect = node.getBoundingClientRect()
        const html = node as HTMLElement
        return { forbidden, isFrame: node.tagName === 'IFRAME', x: rect.x, y: rect.y, borderX: html.clientLeft, borderY: html.clientTop, scaleX: rect.width / (html.offsetWidth || rect.width || 1), scaleY: rect.height / (html.offsetHeight || rect.height || 1) }
      })
      if (information.forbidden) { await hit.dispose(); throw new Error('检测到提交、支付、验证、文件选择或视频进度控件。此操作需要用户在浏览器中手动完成。') }
      if (!information.isFrame) { await hit.dispose(); return }
      const child = await element.contentFrame()
      await hit.dispose()
      if (!child) throw new Error('iframe 尚未加载，请重新观察。')
      local = { x: (local.x - information.x) / information.scaleX - information.borderX, y: (local.y - information.y) / information.scaleY - information.borderY }
      frame = child
    }
    throw new Error('iframe 嵌套过深，请手动接管。')
  }

  async execute(untrustedAction: BrowserAction, basedOn: Observation, signal?: AbortSignal): Promise<ActionResult> {
    return this.serial(async () => {
      signal?.throwIfAborted()
      const action = actionSchema.parse(untrustedAction)
      const page = await this.guard(basedOn)
      signal?.throwIfAborted()
      // Each mutation is dispatched exactly once. Failures require a fresh observation.
      if (action.type === 'click') {
        const point = mapPoint(action.x, action.y, basedOn.viewport)
        await this.assertSafeClick(page, point)
        if (await this.fingerprint(page) !== basedOn.fingerprint) throw new Error('操作前页面再次变化，请重新观察。')
        signal?.throwIfAborted()
        await page.mouse.click(point.x, point.y)
      } else if (action.type === 'type') {
        await this.assertEditable(page, true)
        signal?.throwIfAborted()
        await page.keyboard.insertText(action.text)
      } else if (action.type === 'press') {
        await this.assertEditable(page, false)
        await this.assertSafePress(page, action.key)
        signal?.throwIfAborted()
        await page.keyboard.press(action.key)
      } else if (action.type === 'scroll') {
        await page.mouse.move(basedOn.viewport.width / 2, basedOn.viewport.height / 2)
        signal?.throwIfAborted()
        await page.mouse.wheel(0, action.deltaY)
      } else if (action.type === 'navigate') {
        await this.navigate(action.url, signal)
      } else {
        await delay(action.ms, undefined, { signal })
      }
      signal?.throwIfAborted()
      await delay(350, undefined, { signal })
      signal?.throwIfAborted()
      const observation = await this.capture()
      const changed = observation.fingerprint !== basedOn.fingerprint || observation.screenshot !== basedOn.screenshot
      return { changed, observation, message: changed ? '操作后已重新截图，观察到页面变化；不代表平台已提交或任务已完成。' : '操作后未观察到可确认的页面变化，需要重新判断。' }
    })
  }
}
