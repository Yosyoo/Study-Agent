import { describe, expect, it } from 'vitest'
import { defaultModelConfig, modelConfigSchema } from '../src/shared/contracts'
import { applyProviderPreset, getProviderPreset, providerPresets } from '../src/shared/providers'

describe('official multimodal provider presets', () => {
  it('provides all six requested vendors without obsolete text-only defaults', () => {
    expect(providerPresets.map(preset => preset.id)).toEqual(['deepseek', 'kimi', 'glm', 'openai', 'claude', 'gemini'])
    expect(new Set(providerPresets.map(preset => preset.id)).size).toBe(6)
    expect(providerPresets.every(preset => preset.vision && preset.verifiedAt === '2026-10-22')).toBe(true)
    expect(providerPresets.map(preset => preset.model)).toEqual([
      'deepseek-flash', 'kimi-k3', 'glm-5.3-flash', 'gpt-6.1-sol', 'claude-sonnet-5-5', 'gemini-3.8-flash',
    ])
    expect(JSON.stringify(providerPresets)).not.toContain('gpt-4.1-mini')
  })

  it.each(providerPresets)('produces a validated configuration for $label', preset => {
    const config = applyProviderPreset(defaultModelConfig, preset.id)
    expect(modelConfigSchema.parse(config)).toEqual(config)
    expect(config.model).toBe(preset.model)
    expect(config.baseUrl).toBe(preset.baseUrl)
    expect(new URL(preset.baseUrl).protocol).toBe('https:')
    expect(new URL(preset.documentationUrl).protocol).toBe('https:')
    expect(config).not.toHaveProperty('temperature')
    expect(config).not.toHaveProperty('apiKey')
    expect(config).not.toHaveProperty('hasKey')
  })

  it('keeps vendor protocol and output-token differences instead of pretending every API is Chat Completions', () => {
    expect(getProviderPreset('openai')?.protocol).toBe('responses')
    expect(getProviderPreset('claude')?.protocol).toBe('anthropic')
    expect(getProviderPreset('claude')?.jsonMode).toBe(false)
    expect(getProviderPreset('kimi')?.tokenParameter).toBe('max_completion_tokens')
    expect(getProviderPreset('deepseek')?.tokenParameter).toBe('max_tokens')
    expect(getProviderPreset('gemini')?.baseUrl).toBe('https://generativelanguage.googleapis.com/v1beta/openai')
  })

  it('preserves user limits and does not mutate a custom saved configuration', () => {
    const custom = { ...defaultModelConfig, provider: 'custom' as const, baseUrl: 'https://private.example/v1', model: 'my-visual-model', maxTokens: 12000, timeoutMs: 150000 }
    const before = { ...custom }
    const changed = applyProviderPreset(custom, 'glm')
    expect(changed.maxTokens).toBe(12000)
    expect(changed.timeoutMs).toBe(150000)
    expect(changed.provider).toBe('glm')
    expect(custom).toEqual(before)
  })

  it('does not silently select a provider for an unknown name', () => {
    expect(getProviderPreset('unknown')).toBeUndefined()
    expect(getProviderPreset('custom')).toBeUndefined()
  })
})

// These exercise the actual disk migration, including its boundary between the
// old factory choice and a user's deliberate custom configuration.
describe('provider preset migration', () => {
  it.each([
    { name: 'old official factory choice', baseUrl: 'https://api.openai.com/v1/', model: 'gpt-4.1-mini', expectedModel: 'gpt-6.1-sol', expectedProvider: 'openai', expectedProtocol: 'responses' },
    { name: 'custom endpoint using an old model name', baseUrl: 'https://private.example/v1', model: 'gpt-4.1-mini', expectedModel: 'gpt-4.1-mini', expectedProvider: 'custom', expectedProtocol: 'chat_completions' },
    { name: 'user-chosen model at the official endpoint', baseUrl: 'https://api.openai.com/v1', model: 'my-approved-visual-model', expectedModel: 'my-approved-visual-model', expectedProvider: 'custom', expectedProtocol: 'chat_completions' },
    { name: 'explicit provider configuration', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4.1-mini', provider: 'openai', expectedModel: 'gpt-4.1-mini', expectedProvider: 'openai', expectedProtocol: 'chat_completions' },
  ])('preserves user data while loading $name', async example => {
    const { mkdtemp, readFile, rm, writeFile } = await import('node:fs/promises')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    const { randomUUID } = await import('node:crypto')
    const { StateStore } = await import('../src/main/store')
    const directory = await mkdtemp(join(tmpdir(), 'study-provider-migration-'))
    try {
      const model = { baseUrl: example.baseUrl, model: example.model, maxTokens: 4000, timeoutMs: 60000, jsonMode: true,
        ...(example.provider ? { provider: example.provider } : {}) }
      const raw = { version: 1, model, tasks: [{ id: randomUUID(), name: 'Keep my task', goal: 'Read this page', url: 'https://i.chaoxing.com/', status: 'pending', createdAt: 1, updatedAt: 1, lastMessage: '' }], logs: [] }
      const ciphertext = Buffer.from([3, 5, 7, 11])
      await writeFile(join(directory, 'state.json'), JSON.stringify(raw))
      await writeFile(join(directory, 'model-key.bin'), ciphertext)
      const loaded = await new StateStore(directory).load()
      expect(loaded.warning).toBeUndefined()
      expect(loaded.state.model.model).toBe(example.expectedModel)
      expect(loaded.state.model.provider).toBe(example.expectedProvider)
      expect(loaded.state.model.protocol).toBe(example.expectedProtocol)
      expect(loaded.state.model.baseUrl).toBe(example.baseUrl)
      expect(loaded.state.model.maxTokens).toBe(4000)
      expect(loaded.state.tasks[0].name).toBe('Keep my task')
      expect((await readFile(join(directory, 'model-key.bin'))).equals(ciphertext)).toBe(true)
    } finally { await rm(directory, { recursive: true, force: true }) }
  })
})
