import { afterEach, describe, expect, it, vi } from 'vitest'
import { OpenAICompatibleProvider, parseDecision, SYSTEM_PROMPT } from '../src/main/model/provider'
import { defaultModelConfig, type ModelDecision, type ModelInput } from '../src/shared/contracts'

const valid: ModelDecision = { summary: '可见课程页面', confidence: 0.9, pageType: 'courses', questions: [], action: { type: 'click', x: 500, y: 200 }, needsHuman: false, done: false }
const envelope = (content = JSON.stringify(valid)): Response => new Response(JSON.stringify({ choices: [{ message: { content }, finish_reason: 'stop' }] }), { headers: { 'Content-Type': 'application/json' } })
const input = (signal = new AbortController().signal): ModelInput => ({ goal: '分析可见题目', history: ['上次执行已完成'], signal,
  observation: { id: '1', capturedAt: 1, url: 'https://i.chaoxing.com/course?token=private-url-secret', title: '不可信网页标题', pageType: 'courses', confidence: 0.9, screenshot: 'data:image/png;base64,AAAA', viewport: { width: 1280, height: 800 }, fingerprint: 'abc', frames: [], videos: [], completion: { state: 'unknown', evidence: '' } },
})

afterEach(() => vi.useRealTimers())

describe('structured model decision boundary', () => {
  it('accepts exact JSON and a single JSON fence', () => {
    expect(parseDecision(JSON.stringify(valid))).toEqual(valid)
    expect(parseDecision(`\n\`\`\`json\n${JSON.stringify(valid)}\n\`\`\`\n`)).toEqual(valid)
  })
  it.each([
    { ...valid, action: { type: 'eval', code: 'process.exit()' } },
    { ...valid, action: { type: 'click', x: 1001, y: 10 } },
    { ...valid, action: { type: 'click', x: -1, y: 10 } },
    { ...valid, action: { type: 'type', text: 'hello', execute: true } },
    { ...valid, confidence: 1.2 }, { ...valid, extra: 'hidden instructions' },
    { ...valid, questions: [{ type: 'single', stem: 'x' }] },
  ])('rejects unknown fields, out-of-range actions, or malformed questions: %j', value => {
    expect(() => parseDecision(JSON.stringify(value))).toThrow('决策结构')
  })
  it('does not extract JSON hidden inside prose or execute code', () => {
    expect(() => parseDecision(`Run this first: ${JSON.stringify(valid)}`)).toThrow('合法 JSON')
    expect(() => parseDecision('```javascript\nprocess.exit()\n```')).toThrow('合法 JSON')
  })
  it('contains explicit page injection and answer submission boundaries', () => {
    expect(SYSTEM_PROMPT).toContain('UNTRUSTED DATA')
    expect(SYSTEM_PROMPT).toContain('Never click submit/save/hand-in')
    expect(SYSTEM_PROMPT).toContain('DIRECTLY from the attached screenshot')
    expect(SYSTEM_PROMPT).toContain('forge attendance or completion')
  })
})

describe('OpenAICompatibleProvider transport', () => {
  it('sends native image_url data, configured parameters and keeps URL query secrets out of prompts', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => envelope())
    const provider = new OpenAICompatibleProvider({ ...defaultModelConfig, baseUrl: 'https://example.com/openai/v1/' }, 'secret-key', { fetch: fetcher })
    expect(await provider.decide(input())).toEqual(valid)
    expect(fetcher.mock.calls[0][0]).toBe('https://example.com/openai/v1/chat/completions')
    const init = fetcher.mock.calls[0][1]!
    expect(init.redirect).toBe('error')
    expect(init.headers).toMatchObject({ Authorization: 'Bearer secret-key' })
    const body = JSON.parse(init.body as string)
    expect(body).toMatchObject({ model: defaultModelConfig.model, max_tokens: 4000, response_format: { type: 'json_object' } })
    expect(body).not.toHaveProperty('temperature')
    expect(body.messages[1].content[1]).toEqual({ type: 'image_url', image_url: { url: input().observation.screenshot, detail: 'high' } })
    expect(init.body).not.toContain('private-url-secret')
    expect(init.body).not.toContain('secret-key')
  })

  it('supports disabling provider-specific JSON mode', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => envelope())
    const provider = new OpenAICompatibleProvider({ ...defaultModelConfig, jsonMode: false }, '', { fetch: fetcher })
    await provider.decide(input())
    expect(JSON.parse(fetcher.mock.calls[0][1]!.body as string)).not.toHaveProperty('response_format')
    expect(fetcher.mock.calls[0][1]!.headers).not.toHaveProperty('Authorization')
  })

  it('retries only transient HTTP errors with a finite cap', async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response('busy', { status: 429 }))
      .mockResolvedValueOnce(new Response('failed', { status: 503 }))
      .mockResolvedValueOnce(envelope())
    const provider = new OpenAICompatibleProvider(defaultModelConfig, 'key', { fetch: fetcher, retryDelayMs: 0 })
    await expect(provider.decide(input())).resolves.toEqual(valid)
    expect(fetcher).toHaveBeenCalledTimes(3)
  })

  it('never retries authorization errors or leaks provider body', async () => {
    const secret = 'super-secret-api-key'
    const fetcher = vi.fn<typeof fetch>(async () => new Response(`Echoed authorization ${secret}`, { status: 401 }))
    const provider = new OpenAICompatibleProvider(defaultModelConfig, secret, { fetch: fetcher, retryDelayMs: 0 })
    const error = await provider.decide(input()).then(() => { throw new Error('应当拒绝 401 响应') }, e => e as Error)
    expect(error.message).toContain('HTTP 401')
    expect(error.message).not.toContain(secret)
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('bounds transport failure retries and redacts exception details', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => { throw new Error('https://provider/key?api_key=leak') })
    const provider = new OpenAICompatibleProvider(defaultModelConfig, 'key', { fetch: fetcher, retryDelayMs: 0 })
    await expect(provider.decide(input())).rejects.toThrow('模型服务连接失败')
    expect(fetcher).toHaveBeenCalledTimes(3)
  })

  it('does not retry malformed decisions or truncated model responses', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => envelope('{"action":"evil"}'))
    const provider = new OpenAICompatibleProvider(defaultModelConfig, 'key', { fetch: fetcher, retryDelayMs: 0 })
    await expect(provider.decide(input())).rejects.toThrow('决策结构')
    expect(fetcher).toHaveBeenCalledTimes(1)
    fetcher.mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ finish_reason: 'length', message: { content: '{}' } }] })))
    await expect(provider.decide(input())).rejects.toThrow('被截断')
  })

  it('rejects oversized response bodies before parsing', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => new Response('x', { headers: { 'content-length': '2000000' } }))
    const provider = new OpenAICompatibleProvider(defaultModelConfig, 'key', { fetch: fetcher })
    await expect(provider.decide(input())).rejects.toThrow('响应过大')
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('cancels during retry backoff', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => new Response('busy', { status: 429 }))
    const controller = new AbortController()
    const provider = new OpenAICompatibleProvider(defaultModelConfig, 'key', { fetch: fetcher, retryDelayMs: 2000 })
    const promise = provider.decide(input(controller.signal))
    const assertion = expect(promise).rejects.toThrow('已取消')
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1))
    controller.abort()
    await assertion
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('enforces an overall timeout and aborts the underlying request', async () => {
    vi.useFakeTimers()
    let received: AbortSignal | undefined
    const fetcher = vi.fn<typeof fetch>(async (_url, options) => new Promise((_resolve, reject) => {
      received = options!.signal as AbortSignal
      received.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
    }))
    const provider = new OpenAICompatibleProvider({ ...defaultModelConfig, timeoutMs: 5000 }, 'key', { fetch: fetcher })
    const assertion = expect(provider.decide(input())).rejects.toThrow('超时')
    await vi.advanceTimersByTimeAsync(5001)
    await assertion
    expect(received?.aborted).toBe(true)
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('refuses remote non-TLS endpoints or URL-embedded secrets', () => {
    for (const baseUrl of ['http://example.com/v1', 'https://user:key@example.com/v1', 'https://example.com/v1?api_key=key', 'file:///tmp/v1']) {
      expect(() => new OpenAICompatibleProvider({ ...defaultModelConfig, baseUrl }, 'key')).toThrow('Base URL')
    }
    expect(() => new OpenAICompatibleProvider({ ...defaultModelConfig, baseUrl: 'http://127.0.0.1:8080/v1' }, '')).not.toThrow()
  })

  it('connection test sends an actual image and describes its scope accurately', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => envelope('{"ok":true}'))
    const provider = new OpenAICompatibleProvider(defaultModelConfig, 'key', { fetch: fetcher })
    const result = await provider.testConnection()
    expect(result).toContain('协议和凭证')
    const body = JSON.parse(fetcher.mock.calls[0][1]!.body as string)
    expect(body.messages[1].content[1].image_url.url).toMatch(/^data:image\/png;base64,/)
  })
})
