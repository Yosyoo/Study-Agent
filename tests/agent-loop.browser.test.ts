import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { BrowserController } from '../src/main/browser/controller'
import { AgentHarness } from '../src/main/agent/harness'
import { OpenAICompatibleProvider } from '../src/main/model/provider'
import { defaultModelConfig, type ModelDecision, type StudyTask } from '../src/shared/contracts'

// This is a real Chromium + real local HTTP transport test. The model service is
// deliberately scripted; it tests the closed loop, not any provider's visual reasoning.
const COURSE = `<!doctype html><html lang="zh"><head><meta charset="utf-8"><title>本地课程</title>
<style>body{margin:0;background:#fff;font:22px sans-serif}h1{margin:40px}button{position:absolute;left:80px;top:140px;width:240px;height:64px;font-size:22px}</style></head>
<body><h1>学习课程</h1><button id="chapter">打开章节练习</button><script>document.querySelector('#chapter').addEventListener('click',()=>location.href='/exercise')</script></body></html>`
const EXERCISE = `<!doctype html><html lang="zh"><head><meta charset="utf-8"><title>本地章节练习</title></head>
<body style="font:24px sans-serif;margin:50px"><h1>章节练习</h1><section class="question"><p>VISIBLE_QUESTION_CANARY_8bce：1 + 1 = ?</p>
<form action="/submit" method="post"><label><input type="radio" name="answer" value="2">2</label><label><input type="radio" name="answer" value="3">3</label><button type="submit">提交</button></form></section>
<span hidden>DOM_ONLY_CANARY_a8b341</span></body></html>`
const CLICK: ModelDecision = { summary: '打开截图中可见的章节练习入口', confidence: 0.99, pageType: 'courses', questions: [], action: { type: 'click', x: 150, y: 220 }, needsHuman: false, done: false }
const ANSWERS: ModelDecision = { summary: '识别到一题单选题，建议用户核对', confidence: 0.99, pageType: 'exercise', action: null, needsHuman: false, done: false,
  questions: [{ type: 'single', stem: '1 + 1 = ?', options: ['2', '3'], suggestedAnswer: ['2'], explanation: '整数加法，1 加 1 等于 2。', confidence: 0.99, needsReview: true }],
}

interface RequestPayload { messages: { role: string; content: string | { type: string; text?: string; image_url?: { url: string } }[] }[] }
const cleanup: (() => Promise<void> | void)[] = []
afterEach(async () => { for (const dispose of cleanup.splice(0).reverse()) await dispose() })

async function fixture(delayed = false) {
  const requests: RequestPayload[] = []
  let submissions = 0
  let release!: () => void
  const released = new Promise<void>(resolve => { release = resolve })
  async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    if (request.method === 'POST' && request.url === '/v1/chat/completions') {
      let body = ''
      for await (const chunk of request) body += chunk.toString()
      const payload = JSON.parse(body) as RequestPayload
      requests.push(payload)
      const index = requests.length
      if (delayed) await released
      if (!response.destroyed) {
        response.writeHead(200, { 'Content-Type': 'application/json' })
        response.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(index === 1 ? CLICK : ANSWERS) }, finish_reason: 'stop' }] }))
      }
      return
    }
    if (request.url === '/submit') { submissions++; response.writeHead(200); response.end('submitted'); return }
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
    response.end(request.url === '/exercise' ? EXERCISE : COURSE)
  }
  const server = createServer((request, response) => { void handle(request, response).catch(() => { if (!response.destroyed) { response.writeHead(500); response.end('fixture failed') } }) })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Local server did not bind')
  const origin = `http://127.0.0.1:${address.port}`
  cleanup.push(async () => { release(); server.closeAllConnections(); await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())) })
  const directory = await mkdtemp(join(tmpdir(), 'study-agent-loop-'))
  cleanup.push(async () => { await rm(directory, { recursive: true, force: true }) })
  const browser = new BrowserController(join(directory, 'profile'), { headless: true, allowedOrigins: [origin] })
  cleanup.push(() => browser.close())
  const execute = vi.spyOn(browser, 'execute')
  const provider = new OpenAICompatibleProvider({ ...defaultModelConfig, baseUrl: `${origin}/v1`, model: 'scripted-test-model' }, 'fixture-only-key', { maxRetries: 0 })
  const harness = new AgentHarness({ browser, provider, onUpdate: () => {}, log: () => {} })
  cleanup.push(() => harness.dispose())
  const task: StudyTask = { id: randomUUID(), name: '本地闭环集成测试', url: `${origin}/course`, goal: '打开章节练习并给出答案建议，等待我核对', status: 'pending', createdAt: Date.now(), updatedAt: Date.now(), lastMessage: '' }
  await browser.open(task.url)
  return { browser, harness, requests, execute, task, release, submissions: () => submissions }
}

async function waitPhase(harness: AgentHarness, phase: string): Promise<void> {
  await vi.waitFor(() => expect(harness.snapshot.phase).toBe(phase), { timeout: 10000, interval: 20 })
}

describe('real Chromium + local scripted multimodal HTTP + supervised harness', () => {
  it('captures -> sends native image -> waits for approval -> clicks -> verifies -> reviews answers without submission', async () => {
    const { browser, harness, requests, execute, task, submissions } = await fixture()
    await harness.start(task)
    await waitPhase(harness, 'awaiting_confirmation')
    expect(execute).not.toHaveBeenCalled()
    expect(harness.snapshot.pending?.kind).toBe('action')
    expect(harness.snapshot.observation?.url).toBe(task.url)
    const beforeScreenshot = harness.snapshot.observation!.screenshot
    expect(requests).toHaveLength(1)
    const content = requests[0].messages[1].content
    expect(Array.isArray(content)).toBe(true)
    const image = (content as Exclude<typeof content, string>).find(part => part.type === 'image_url')?.image_url?.url
    expect(image).toMatch(/^data:image\/jpeg;base64,/)
    expect(Buffer.from(image!.split(',')[1], 'base64').length).toBeGreaterThan(1000)

    await harness.confirm(harness.snapshot.pending!.id, true)
    await waitPhase(harness, 'awaiting_confirmation')
    expect(execute).toHaveBeenCalledTimes(1)
    expect(harness.snapshot.observation?.url).toBe(new URL('/exercise', task.url).href)
    expect(harness.snapshot.pending?.kind).toBe('answers')
    expect(harness.snapshot.pending?.questions?.[0].suggestedAnswer).toEqual(['2'])
    expect(requests).toHaveLength(2)
    // Visible/hidden question text does not become a DOM transcript in model messages.
    expect(JSON.stringify(requests)).not.toContain('VISIBLE_QUESTION_CANARY_8bce')
    expect(JSON.stringify(requests)).not.toContain('DOM_ONLY_CANARY_a8b341')
    const verified = await execute.mock.results[0].value
    expect(verified.changed).toBe(true)
    expect(verified.observation.url).toContain('/exercise')
    expect(verified.observation.screenshot).not.toBe(beforeScreenshot)

    await harness.confirm(harness.snapshot.pending!.id, true)
    expect(harness.snapshot.phase).toBe('completed')
    expect(submissions()).toBe(0)
    expect(execute).toHaveBeenCalledTimes(1)
    expect((await browser.observe()).url).toContain('/exercise')
  })

  it.each(['pause', 'stop'] as const)('%s cancels a delayed real HTTP model response before any browser action', async operation => {
    const { browser, harness, requests, execute, task, release } = await fixture(true)
    await harness.start(task)
    await vi.waitFor(() => expect(requests).toHaveLength(1), { timeout: 10000, interval: 20 })
    expect(harness.snapshot.phase).toBe('thinking')
    harness[operation]()
    release()
    await new Promise(resolve => setTimeout(resolve, 150))
    expect(harness.snapshot.phase).toBe(operation === 'pause' ? 'paused' : 'stopped')
    expect(harness.snapshot.pending).toBeNull()
    expect(execute).not.toHaveBeenCalled()
    expect((await browser.observe()).url).toBe(task.url)
  })
})
