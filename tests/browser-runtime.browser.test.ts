import { createServer, type Server } from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { BrowserController } from '../src/main/browser/controller'

let server: Server
let origin: string
let profile: string
let browser: BrowserController
let moveButton = false
let replaceLabel = false
let typed = ''
let clicks = 0
let failNavigation = true
let navigationRequests = 0
const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms))

beforeAll(async () => {
  server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://localhost')
    if (url.pathname === '/state') {
      response.setHeader('Content-Type', 'application/json')
      response.end(JSON.stringify({ moveButton, replaceLabel })); return
    }
    if (url.pathname === '/clicked') { clicks++; response.end('ok'); return }
    if (url.pathname === '/typed') { typed = url.searchParams.get('value') ?? ''; response.end('ok'); return }
    response.setHeader('Content-Type', 'text/html; charset=utf-8')
    if (url.pathname === '/retry-navigation') {
      navigationRequests++
      response.writeHead(failNavigation ? 503 : 200)
      response.end('<!doctype html><title>Retry fixture</title><h1>Course</h1>'); return
    }
    if (url.pathname === '/animated-noop') {
      response.end(`<!doctype html><button style="position:absolute;left:20px;top:20px;width:140px;height:40px">普通按钮</button><canvas width="300" height="200" style="margin-top:100px"></canvas><script>const ctx=document.querySelector('canvas').getContext('2d');setInterval(()=>{ctx.clearRect(0,0,300,200);ctx.fillText(String(Date.now()),10,40)},20)</script>`); return
    }
    if (url.pathname === '/replace-video') {
      response.end(`<!doctype html><video style="width:300px;height:200px"></video><script>let changed=false;setInterval(async()=>{if(!changed&&(await fetch('/state').then(r=>r.json())).replaceLabel){document.querySelector('video').outerHTML='<video style="width:300px;height:200px"></video>';changed=true}},20)</script>`); return
    }
    if (url.pathname === '/scroll') {
      response.end('<!doctype html><main style="height:4000px">Scrollable fixture</main>'); return
    }
    if (url.pathname === '/redirect') { response.writeHead(302, { Location: '/stable-action' }); response.end(); return }
    if (url.pathname === '/stable-action') {
      response.end(`<!doctype html><button style="position:absolute;left:20px;top:20px;width:140px;height:40px" onclick="fetch('/clicked');this.textContent='已点击'">打开章节</button><p style="margin-top:100px" id="content">原始页面内容</p><script>setInterval(async()=>{const s=await fetch('/state').then(r=>r.json());if(s.replaceLabel)content.textContent='新的页面内容'},50)</script>`); return
    }
    if (url.pathname === '/mixed-exercise') {
      response.end('<!doctype html><div class="question"><label><input type="radio">截图中的题目选项</label></div><video style="width:400px;height:240px"></video>'); return
    }
    if (url.pathname === '/media') {
      response.end(`<!doctype html><style>body{margin:0}video{width:400px;height:240px}</style><video muted autoplay></video><canvas hidden width="160" height="90"></canvas><script>
        const canvas=document.querySelector('canvas'), video=document.querySelector('video'), context=canvas.getContext('2d');
        let count=0; setInterval(()=>{context.fillStyle=count++%2?'#444':'#888';context.fillRect(0,0,160,90)},50);
        video.srcObject=canvas.captureStream(10); video.play().catch(()=>{});
      </script>`); return
    }
    if (url.pathname === '/hidden-video') {
      response.end('<!doctype html><style>video{width:400px;height:240px}</style><div class="question" data-question-id="q"><p>可见练习</p><label><input type="radio">选项</label></div><video style="display:none"></video><video style="visibility:hidden"></video><div hidden style="display:block"><video></video></div><iframe src="/media" style="display:none"></iframe><div style="visibility:hidden"><iframe src="/media?hidden-ancestor=1" style="visibility:visible"></iframe></div><iframe src="/media?zero-size=1" style="width:0;height:0;border:0"></iframe>'); return
    }
    if (url.pathname === '/offscreen-video') {
      response.end('<!doctype html><video style="position:absolute;top:3000px;width:400px;height:240px"></video>'); return
    }
    if (url.pathname === '/multi') {
      response.end('<!doctype html><div class="ans-attach-ct ans-job-finished"><iframe src="/media"></iframe></div><div class="ans-attach-ct"><iframe src="/media?two=1"></iframe></div>'); return
    }
    if (url.pathname === '/input') {
      response.end(`<!doctype html><input autofocus style="width:250px;height:40px" oninput="fetch('/typed?value='+encodeURIComponent(this.value))">`); return
    }
    if (url.pathname === '/sensitive') {
      response.end(`<!doctype html><input type="password" autofocus style="width:250px;height:40px"><label style="position:absolute;left:20px;top:80px" for="file">文件上传</label><input id="file" type="file" hidden><button style="position:absolute;left:20px;top:140px">提交答案</button>`); return
    }
    if (url.pathname === '/press') {
      response.end(url.searchParams.has('button') ? '<!doctype html><button autofocus>提交答案</button>' : '<!doctype html><form><input autofocus><button type="submit">普通按钮</button></form>'); return
    }
    if (url.pathname === '/editor') {
      response.end(`<!doctype html><iframe src="/input" style="width:500px;height:200px"></iframe>`); return
    }
    response.end(`<!doctype html><title>Study Agent local browser fixture</title><style>body{margin:0}#action{position:absolute;left:20px;top:20px;width:140px;height:40px}iframe{position:absolute;left:20px;top:100px;width:600px;height:300px}</style>
      <button id="action" onclick="fetch('/clicked');this.textContent='已经点击';this.disabled=true">打开章节</button>
      <div class="ans-attach-ct ${url.searchParams.has('complete') ? 'ans-job-finished' : ''}"><iframe src="/media"></iframe></div>
      <script>setInterval(async()=>{const state=await fetch('/state').then(r=>r.json());if(state.moveButton)action.style.left='400px';if(state.replaceLabel)action.textContent='替换后的按钮'},100)</script>`)
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Fixture server did not start')
  origin = `http://127.0.0.1:${address.port}`
  profile = await mkdtemp(join(tmpdir(), 'study-agent-browser-'))
  browser = new BrowserController(profile, { headless: true, allowedOrigins: [origin] })
})

afterAll(async () => {
  await browser?.close()
  await new Promise<void>(resolve => server?.close(() => resolve()))
  if (profile) await rm(profile, { recursive: true, force: true })
})

describe('real Chromium browser controller against local fixtures', () => {
  it('captures a real CSS screenshot, finds iframe media and samples advancing playback', async () => {
    await browser.open(origin)
    await sleep(800)
    const observation = await browser.observe()
    expect(browser.isOpen).toBe(true)
    expect(observation.screenshot).toMatch(/^data:image\/jpeg;base64,/)
    expect(observation.viewport).toEqual({ width: 1280, height: 800 })
    expect(observation.frames).toHaveLength(2)
    expect(observation.pageType).toBe('video')
    expect(observation.videos).toHaveLength(1)
    expect(observation.videos[0].frameId).not.toBe(observation.frames[0].id)
    expect(observation.videos[0].paused).toBe(false)
    expect(observation.completion.state).toBe('unknown')
    await sleep(650)
    const [next] = await browser.sampleVideos()
    expect(next.currentTime).toBeGreaterThan(observation.videos[0].currentTime)
  })

  it('executes one normalized coordinate click and verifies a new screenshot', async () => {
    const observation = await browser.observe()
    const result = await browser.execute({ type: 'click', x: 70, y: 50 }, observation)
    expect(result.changed).toBe(true)
    expect(result.observation.id).not.toBe(observation.id)
    expect(clicks).toBe(1)
    await expect(browser.execute({ type: 'click', x: 70, y: 50 }, observation)).rejects.toThrow(/过期/)
    expect(clicks).toBe(1)
  })

  it('rejects clicks after controls move or labels change at the same coordinates', async () => {
    await browser.open(origin)
    const original = await browser.observe()
    moveButton = true
    await sleep(350)
    await expect(browser.execute({ type: 'click', x: 70, y: 50 }, original)).rejects.toThrow(/变化/)
    moveButton = false
    await browser.open(origin)
    const unchangedLayout = await browser.observe()
    replaceLabel = true
    await sleep(350)
    await expect(browser.execute({ type: 'click', x: 70, y: 50 }, unchangedLayout)).rejects.toThrow(/变化/)
    replaceLabel = false
    expect(clicks).toBe(1)
  })

  it('refuses password input, native file selection and known submission controls', async () => {
    await browser.open(`${origin}/sensitive`)
    let observation = await browser.observe()
    await expect(browser.execute({ type: 'type', text: 'never-send' }, observation)).rejects.toThrow(/密码/)
    observation = await browser.observe()
    await expect(browser.execute({ type: 'click', x: 45, y: 112 }, observation)).rejects.toThrow(/文件选择/)
    observation = await browser.observe()
    await expect(browser.execute({ type: 'click', x: 50, y: 185 }, observation)).rejects.toThrow(/提交/)
  })

  it('blocks Enter and Space activation of sensitive buttons and implicit form submission', async () => {
    await browser.open(origin + '/press')
    let observation = await browser.observe()
    await expect(browser.execute({ type: 'press', key: 'Enter' }, observation)).rejects.toThrow(/提交/)
    await browser.open(origin + '/press?button=1')
    observation = await browser.observe()
    await expect(browser.execute({ type: 'press', key: 'Enter' }, observation)).rejects.toThrow(/提交/)
    observation = await browser.observe()
    await expect(browser.execute({ type: 'press', key: 'Space' }, observation)).rejects.toThrow(/提交/)
  })

  it('does not dispatch an operation after its driver signal is aborted', async () => {
    await browser.open(origin)
    const observation = await browser.observe()
    const controller = new AbortController()
    controller.abort()
    const previousClicks = clicks
    await expect(browser.execute({ type: 'click', x: 70, y: 50 }, observation, controller.signal)).rejects.toThrow()
    expect(clicks).toBe(previousClicks)
  })

  it('types in a focused iframe input using the normal keyboard path', async () => {
    await browser.open(`${origin}/editor`)
    await sleep(150)
    const observation = await browser.observe()
    const result = await browser.execute({ type: 'type', text: 'user-approved suggestion' }, observation)
    expect(result.changed).toBe(true)
    expect(typed).toBe('user-approved suggestion')
  })

  it('ignores retained hidden players and hidden or zero-size iframe ancestors on exercise pages', async () => {
    await browser.open(origin + '/hidden-video')
    const observation = await browser.observe()
    expect(observation.pageType).toBe('exercise')
    expect(observation.videos).toEqual([])
    expect(await browser.sampleVideos()).toEqual([])
  })

  it('keeps a player with visible layout eligible when it is below the screenshot viewport', async () => {
    await browser.open(origin + '/offscreen-video')
    const observation = await browser.observe()
    expect(observation.videos).toHaveLength(1)
    expect(observation.pageType).toBe('video')
  })

  it('rejects native video clicks and leaves seeking to the user', async () => {
    await browser.open(origin)
    const observation = await browser.observe()
    await expect(browser.execute({ type: 'click', x: 150, y: 200 }, observation)).rejects.toThrow(/视频进度/)
  })

  it('does not declare all task points complete when one corresponding marker is unknown', async () => {
    await browser.open(origin + '/multi')
    const observation = await browser.observe()
    expect(observation.videos).toHaveLength(2)
    expect(observation.completion.state).toBe('unknown')
  })

  it('keeps media ending separate from scoped platform completion evidence', async () => {
    await browser.open(`${origin}/?complete=1`)
    await sleep(300)
    const observation = await browser.observe()
    expect(observation.completion.state).toBe('complete')
    expect(observation.completion.evidence).toContain('实站校准')
  })

  it('blocks unapproved navigation origins and reports a closed browser', async () => {
    await expect(browser.open('https://example.com')).rejects.toThrow(/支持的平台/)
    await browser.close()
    expect(browser.isOpen).toBe(false)
    await expect(browser.observe()).rejects.toThrow(/未打开/)
  })

  it('renews an unchanged screenshot after slow model inference without dispatching duplicate clicks', async () => {
    await browser.open(origin + '/stable-action')
    const observation = await browser.observe()
    const clock = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 45_000)
    const previousClicks = clicks
    try {
      const result = await browser.execute({ type: 'click', x: 70, y: 50 }, observation)
      expect(result.changed).toBe(true)
      expect(clicks).toBe(previousClicks + 1)
    } finally { clock.mockRestore() }
  })

  it('rejects an old screenshot when pixels changed even though controls stayed in place', async () => {
    await browser.open(origin + '/stable-action')
    const observation = await browser.observe()
    replaceLabel = true
    await sleep(200)
    const clock = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 45_000)
    const previousClicks = clicks
    try {
      await expect(browser.execute({ type: 'click', x: 70, y: 50 }, observation)).rejects.toThrow('画面已变化')
      expect(clicks).toBe(previousClicks)
    } finally { clock.mockRestore(); replaceLabel = false }
  })

  it('prioritizes a visible exercise over a retained video on the same page', async () => {
    await browser.open(origin + '/mixed-exercise')
    const observation = await browser.observe()
    expect(observation.videos.length).toBe(1)
    expect(observation.pageType).toBe('exercise')
  })

  it('allows reopening a failed URL after bounded navigation retries were exhausted', async () => {
    await expect(browser.open(origin + '/retry-navigation')).rejects.toThrow('页面加载失败')
    expect(navigationRequests).toBe(2)
    failNavigation = false
    await browser.open(origin + '/retry-navigation')
    expect(navigationRequests).toBe(3)
    expect((await browser.observe()).title).toBe('Retry fixture')
  })
})

describe('action-specific verification', () => {
  it('does not count unrelated animation as a successful click or scroll', async () => {
    await browser.open(origin + '/animated-noop')
    const before = await browser.observe()
    const result = await browser.execute({ type: 'click', x: 70, y: 50 }, before)
    expect(result.observation.screenshot).not.toBe(before.screenshot)
    expect(result.verification).toBe('unverified')
    expect(result.changed).toBe(false)
    const scroll = await browser.execute({ type: 'scroll', deltaY: 400 }, result.observation)
    expect(scroll.changed).toBe(false)
  })
  it('verifies actual scrolling and a known navigation destination', async () => {
    await browser.open(origin + '/scroll')
    const scrolled = await browser.execute({ type: 'scroll', deltaY: 400 }, await browser.observe())
    expect(scrolled.verification).toBe('verified')
    const navigated = await browser.execute({ type: 'navigate', url: origin + '/stable-action' }, scrolled.observation)
    expect(navigated.verification).toBe('verified')
  })
  it('marks an unexpected redirect for user review instead of declaring success', async () => {
    await browser.open(origin + '/scroll')
    const result = await browser.execute({ type: 'navigate', url: origin + '/redirect' }, await browser.observe())
    expect(result.observation.url).toBe(origin + '/stable-action')
    expect(result.verification).toBe('unverified')
  })
})


describe('stable media identity', () => {
  it('changes the video identity when a SPA replaces a player at the same index and URL', async () => {
    replaceLabel = false
    await browser.open(origin + '/replace-video')
    const before = await browser.sampleVideos()
    expect((await browser.sampleVideos())[0].id).toBe(before[0].id)
    replaceLabel = true
    try {
      await vi.waitFor(async () => expect((await browser.sampleVideos())[0].id).not.toBe(before[0].id))
    } finally { replaceLabel = false }
  })
})
