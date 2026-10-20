import { afterEach, describe, expect, it, vi } from 'vitest'
import { OpenAICompatibleProvider, parseDecision, SYSTEM_PROMPT } from '../src/main/model/provider'
import { defaultModelConfig, type ModelConfig, type ModelDecision, type ModelInput } from '../src/shared/contracts'

const chatConfig: ModelConfig = { ...defaultModelConfig, provider: 'custom', protocol: 'chat_completions', tokenParameter: 'max_tokens', maxTokens: 4000, timeoutMs: 60000 }

const valid: ModelDecision = { summary: '可见课程页面', confidence: 0.9, pageType: 'courses', questions: [], action: { type: 'click', x: 500, y: 200 }, needsHuman: false, done: false }
const envelope = (content = JSON.stringify(valid)): Response => new Response(JSON.stringify({ choices: [{ message: { content }, finish_reason: 'stop' }] }), { headers: { 'Content-Type': 'application/json' } })
const input = (signal = new AbortController().signal): ModelInput => ({ goal: '分析可见题目', history: ['上次执行已完成'], signal,
  observation: { id: '1', capturedAt: 1, url: 'https://i.chaoxing.com/course?token=private-url-secret', title: '不可信网页标题', pageType: 'courses', confidence: 0.9, screenshot: 'data:image/png;base64,AAAA', viewport: { width: 1280, height: 800 }, fingerprint: 'abc', frames: [], videos: [], completion: { state: 'unknown', evidence: '' } },
})

describe('native provider protocols', () => {
  const nativeEnvelope = (protocol: 'responses' | 'anthropic', text = JSON.stringify(valid)): Response => new Response(JSON.stringify(protocol === 'responses'
    ? { status: 'completed', output: [{ type: 'reasoning', summary: [{ type: 'summary_text', text: 'Do not parse reasoning as a decision' }] }, { type: 'message', role: 'assistant', content: [{ type: 'output_text', text }] }] }
    : { type: 'message', role: 'assistant', stop_reason: 'end_turn', content: [{ type: 'thinking', thinking: 'Do not parse this internal reasoning' }, { type: 'text', text }] }))

  it('uses Anthropic Messages native image blocks and authentication instead of OpenAI wire format', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => nativeEnvelope('anthropic'))
    const config: ModelConfig = { ...chatConfig, provider: 'claude', protocol: 'anthropic', baseUrl: 'https://api.anthropic.com/v1', model: 'claude-sonnet-5-5' }
    const provider = new OpenAICompatibleProvider(config, 'private-anthropic-key', { fetch: fetcher })
    expect(await provider.decide(input())).toEqual(valid)
    expect(fetcher.mock.calls[0][0]).toBe('https://api.anthropic.com/v1/messages')
    const init = fetcher.mock.calls[0][1]!
    expect(init.headers).toMatchObject({ 'x-api-key': 'private-anthropic-key', 'anthropic-version': '2023-06-01' })
    expect(init.headers).not.toHaveProperty('Authorization')
    const body = JSON.parse(init.body as string)
    expect(body.system).toBe(SYSTEM_PROMPT)
    expect(body.messages[0].content[0]).toEqual({ type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAAA' } })
    expect(body.max_tokens).toBe(config.maxTokens)
    for (const field of ['temperature', 'thinking', 'response_format', 'input']) expect(body).not.toHaveProperty(field)
    expect(init.body).not.toContain('private-anthropic-key')
  })

  it('uses OpenAI Responses native input, output tokens, nonstored requests and only final assistant output', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => nativeEnvelope('responses'))
    const config: ModelConfig = { ...chatConfig, provider: 'openai', protocol: 'responses', baseUrl: 'https://api.openai.com/v1' }
    const provider = new OpenAICompatibleProvider(config, 'private-openai-key', { fetch: fetcher })
    expect(await provider.decide(input())).toEqual(valid)
    expect(fetcher.mock.calls[0][0]).toBe('https://api.openai.com/v1/responses')
    const init = fetcher.mock.calls[0][1]!
    expect(init.headers).toMatchObject({ Authorization: 'Bearer private-openai-key' })
    const body = JSON.parse(init.body as string)
    expect(body.instructions).toBe(SYSTEM_PROMPT)
    expect(body.input[0].content[1]).toEqual({ type: 'input_image', image_url: input().observation.screenshot, detail: 'high' })
    expect(body).toMatchObject({ max_output_tokens: config.maxTokens, store: false, text: { format: { type: 'json_object' } } })
    for (const field of ['temperature', 'max_tokens', 'messages', 'response_format']) expect(body).not.toHaveProperty(field)
  })

  it('honors max_completion_tokens for current Chat Completions providers and ignores reasoning_content', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ choices: [{ message: { reasoning_content: 'untrusted reasoning', content: JSON.stringify(valid) }, finish_reason: 'stop' }] })))
    const config: ModelConfig = { ...chatConfig, provider: 'kimi', tokenParameter: 'max_completion_tokens' }
    expect(await new OpenAICompatibleProvider(config, 'key', { fetch: fetcher }).decide(input())).toEqual(valid)
    const body = JSON.parse(fetcher.mock.calls[0][1]!.body as string)
    expect(body.max_completion_tokens).toBe(config.maxTokens)
    for (const field of ['max_tokens', 'temperature', 'thinking']) expect(body).not.toHaveProperty(field)
  })

  it.each(['responses', 'anthropic'] as const)('%s protocol connection test sends a native image probe', async protocol => {
    const fetcher = vi.fn<typeof fetch>(async () => nativeEnvelope(protocol, '{"ok":true}'))
    const config: ModelConfig = { ...chatConfig, protocol }
    const result = await new OpenAICompatibleProvider(config, 'key', { fetch: fetcher }).testConnection()
    expect(result).toContain('协议和凭证')
    const body = JSON.parse(fetcher.mock.calls[0][1]!.body as string)
    if (protocol === 'responses') expect(body.input[0].content[1].image_url).toMatch(/^data:image\/png;base64,/)
    else expect(body.messages[0].content[0].source).toMatchObject({ type: 'base64', media_type: 'image/png' })
  })

  it.each([
    ['responses', { status: 'incomplete', output: [] }, '被截断'],
    ['responses', { status: 'failed', error: { message: 'must not leak private response' } }, '无效'],
    ['responses', { status: 'completed', output: [{ type: 'message', role: 'assistant', content: [{ type: 'refusal', refusal: 'private reason' }] }] }, '拒绝'],
    ['responses', { output_text: JSON.stringify(valid) }, '没有有效文本'],
    ['responses', { status: 'completed', output: [{ type: 'function_call', name: 'shell', arguments: '{}' }] }, '未授权'],
    ['anthropic', { stop_reason: 'max_tokens', content: [{ type: 'text', text: JSON.stringify(valid) }] }, '被截断'],
    ['anthropic', { stop_reason: 'refusal', content: [] }, '拒绝'],
    ['anthropic', { stop_reason: 'tool_use', content: [{ type: 'tool_use', name: 'shell' }] }, '未授权'],
    ['anthropic', { stop_reason: 'end_turn', content: [{ type: 'tool_use', name: 'shell' }, { type: 'text', text: JSON.stringify(valid) }] }, '未授权'],
  ] as const)('rejects invalid %s native outcomes without retrying', async (protocol, value, message) => {
    const fetcher = vi.fn<typeof fetch>(async () => new Response(JSON.stringify(value)))
    const config: ModelConfig = { ...chatConfig, protocol }
    await expect(new OpenAICompatibleProvider(config, 'key', { fetch: fetcher }).decide(input())).rejects.toThrow(message)
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('can disable Responses JSON formatting without weakening local decision validation', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => nativeEnvelope('responses', '{"action":"eval"}'))
    const config: ModelConfig = { ...chatConfig, protocol: 'responses', jsonMode: false }
    await expect(new OpenAICompatibleProvider(config, 'key', { fetch: fetcher }).decide(input())).rejects.toThrow('决策结构')
    expect(JSON.parse(fetcher.mock.calls[0][1]!.body as string)).not.toHaveProperty('text')
  })
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
    const provider = new OpenAICompatibleProvider({ ...chatConfig, baseUrl: 'https://example.com/openai/v1/' }, 'secret-key', { fetch: fetcher })
    expect(await provider.decide(input())).toEqual(valid)
    expect(fetcher.mock.calls[0][0]).toBe('https://example.com/openai/v1/chat/completions')
    const init = fetcher.mock.calls[0][1]!
    expect(init.redirect).toBe('error')
    expect(init.headers).toMatchObject({ Authorization: 'Bearer secret-key' })
    const body = JSON.parse(init.body as string)
    expect(body).toMatchObject({ model: chatConfig.model, max_tokens: 4000, response_format: { type: 'json_object' } })
    expect(body).not.toHaveProperty('temperature')
    expect(body.messages[1].content[1]).toEqual({ type: 'image_url', image_url: { url: input().observation.screenshot, detail: 'high' } })
    expect(init.body).not.toContain('private-url-secret')
    expect(init.body).not.toContain('secret-key')
  })

  it('supports disabling provider-specific JSON mode', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => envelope())
    const provider = new OpenAICompatibleProvider({ ...chatConfig, jsonMode: false }, '', { fetch: fetcher })
    await provider.decide(input())
    expect(JSON.parse(fetcher.mock.calls[0][1]!.body as string)).not.toHaveProperty('response_format')
    expect(fetcher.mock.calls[0][1]!.headers).not.toHaveProperty('Authorization')
  })

  it('retries only transient HTTP errors with a finite cap', async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response('busy', { status: 429 }))
      .mockResolvedValueOnce(new Response('failed', { status: 503 }))
      .mockResolvedValueOnce(envelope())
    const provider = new OpenAICompatibleProvider(chatConfig, 'key', { fetch: fetcher, retryDelayMs: 0 })
    await expect(provider.decide(input())).resolves.toEqual(valid)
    expect(fetcher).toHaveBeenCalledTimes(3)
  })

  it('never retries authorization errors or leaks provider body', async () => {
    const secret = 'super-secret-api-key'
    const fetcher = vi.fn<typeof fetch>(async () => new Response(`Echoed authorization ${secret}`, { status: 401 }))
    const provider = new OpenAICompatibleProvider(chatConfig, secret, { fetch: fetcher, retryDelayMs: 0 })
    const error = await provider.decide(input()).then(() => { throw new Error('应当拒绝 401 响应') }, e => e as Error)
    expect(error.message).toContain('HTTP 401')
    expect(error.message).not.toContain(secret)
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('bounds transport failure retries and redacts exception details', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => { throw new Error('https://provider/key?api_key=leak') })
    const provider = new OpenAICompatibleProvider(chatConfig, 'key', { fetch: fetcher, retryDelayMs: 0 })
    await expect(provider.decide(input())).rejects.toThrow('模型服务连接失败')
    expect(fetcher).toHaveBeenCalledTimes(3)
  })

  it('does not retry malformed decisions or truncated model responses', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => envelope('{"action":"evil"}'))
    const provider = new OpenAICompatibleProvider(chatConfig, 'key', { fetch: fetcher, retryDelayMs: 0 })
    await expect(provider.decide(input())).rejects.toThrow('决策结构')
    expect(fetcher).toHaveBeenCalledTimes(1)
    fetcher.mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ finish_reason: 'length', message: { content: '{}' } }] })))
    await expect(provider.decide(input())).rejects.toThrow('被截断')
  })

  it('rejects oversized response bodies before parsing', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => new Response('x', { headers: { 'content-length': '2000000' } }))
    const provider = new OpenAICompatibleProvider(chatConfig, 'key', { fetch: fetcher })
    await expect(provider.decide(input())).rejects.toThrow('响应过大')
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('cancels during retry backoff', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => new Response('busy', { status: 429 }))
    const controller = new AbortController()
    const provider = new OpenAICompatibleProvider(chatConfig, 'key', { fetch: fetcher, retryDelayMs: 2000 })
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
    const provider = new OpenAICompatibleProvider({ ...chatConfig, timeoutMs: 5000 }, 'key', { fetch: fetcher })
    const assertion = expect(provider.decide(input())).rejects.toThrow('超时')
    await vi.advanceTimersByTimeAsync(5001)
    await assertion
    expect(received?.aborted).toBe(true)
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('refuses remote non-TLS endpoints or URL-embedded secrets', () => {
    for (const baseUrl of ['http://example.com/v1', 'https://user:key@example.com/v1', 'https://example.com/v1?api_key=key', 'file:///tmp/v1']) {
      expect(() => new OpenAICompatibleProvider({ ...chatConfig, baseUrl }, 'key')).toThrow('Base URL')
    }
    expect(() => new OpenAICompatibleProvider({ ...chatConfig, baseUrl: 'http://127.0.0.1:8080/v1' }, '')).not.toThrow()
  })

  it('connection test sends an actual image and describes its scope accurately', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => envelope('{"ok":true}'))
    const provider = new OpenAICompatibleProvider(chatConfig, 'key', { fetch: fetcher })
    const result = await provider.testConnection()
    expect(result).toContain('协议和凭证')
    const body = JSON.parse(fetcher.mock.calls[0][1]!.body as string)
    expect(body.messages[1].content[1].image_url.url).toMatch(/^data:image\/png;base64,/)
  })
})
