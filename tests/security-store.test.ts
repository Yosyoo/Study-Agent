import { describe, expect, it } from 'vitest'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { isTrustedRendererUrl, redact, validateApiKey } from '../src/main/security'
import { credentialScope, emptyState, SecretStore, StateStore } from '../src/main/store'
import { defaultModelConfig } from '../src/shared/contracts'

describe('IPC boundary and diagnostics', () => {
  it('only accepts the precise local renderer, denying another path, remote origin or injected query', () => {
    expect(isTrustedRendererUrl('file:///app/index.html', 'file:///app/index.html')).toBe(true)
    expect(isTrustedRendererUrl('file:///app/other.html', 'file:///app/index.html')).toBe(false)
    expect(isTrustedRendererUrl('file://attacker/app/index.html', 'file:///app/index.html')).toBe(false)
    expect(isTrustedRendererUrl('https://evil.test/', 'file:///app/index.html')).toBe(false)
    expect(isTrustedRendererUrl('http://127.0.0.1:5173/?script=x', 'http://127.0.0.1:5173/')).toBe(false)
    expect(isTrustedRendererUrl('http://127.0.0.1:5174/', 'http://127.0.0.1:5173/')).toBe(false)
  })
  it('removes secrets and URL query tokens before persistence', () => {
    const message = redact('Authorization: Bearer sk-testVerySecret123 password=private https://a.test/path?token=secret')
    expect(message).not.toContain('testVerySecret'); expect(message).not.toContain('private'); expect(message).not.toContain('token=secret')
    expect(message).toContain('https://a.test/path?[REDACTED]')
  })
  it('rejects header injection or multi-line credential files', () => {
    expect(validateApiKey('  sk-example  \n')).toBe('sk-example')
    expect(() => validateApiKey('key\r\nx-injected: yes')).toThrow()
    expect(() => validateApiKey('')).toThrow()
  })
})

describe('durable state', () => {
  it('keeps credentials isolated by provider and endpoint, and restores them when switching back', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'study-credential-scopes-'))
    const encryption = {
      isEncryptionAvailable: () => true,
      encryptString: (text: string) => Buffer.from(Buffer.from(text).map(byte => byte ^ 137)),
      decryptString: (bytes: Buffer) => Buffer.from(bytes.map(byte => byte ^ 137)).toString(),
    }
    try {
      const original = credentialScope(defaultModelConfig)
      expect(credentialScope({ ...defaultModelConfig, baseUrl: defaultModelConfig.baseUrl + '/' })).toBe(original)
      const changedUrl = credentialScope({ ...defaultModelConfig, baseUrl: 'https://other.example/v1' })
      const changedProvider = credentialScope({ ...defaultModelConfig, provider: 'custom' })
      expect(new Set([original, changedUrl, changedProvider]).size).toBe(3)
      const first = new SecretStore(directory, encryption, original)
      await first.set('first-private-key')
      const second = new SecretStore(directory, encryption, changedUrl)
      await second.load(); expect(second.key).toBe('')
      await second.set('second-private-key')
      const restored = new SecretStore(directory, encryption, original)
      await restored.load(); expect(restored.key).toBe('first-private-key')
      await second.clear()
      await restored.load(); expect(restored.key).toBe('first-private-key')
      expect((await readFile(join(directory, 'keys', `${original}.bin`))).toString()).not.toContain('first-private-key')
    } finally { await rm(directory, { recursive: true, force: true }) }
  })

  it('persists separate provider choices without erasing tasks or selecting another provider on restart', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'study-model-profiles-'))
    try {
      const state = emptyState()
      state.modelProfiles = [state.model, { ...state.model, provider: 'kimi', model: 'chosen-kimi-model', baseUrl: 'https://api.moonshot.ai/v1' }]
      const store = new StateStore(directory)
      await store.save(state)
      const { state: restored } = await store.load()
      expect(restored.model).toEqual(state.model)
      expect(restored.modelProfiles).toEqual(state.modelProfiles)
    } finally { await rm(directory, { recursive: true, force: true }) }
  })
  it('migrates the removed temperature field without losing a saved provider or task', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'study-store-migration-'))
    try {
      const saved = emptyState()
      saved.model.baseUrl = 'https://configured.example/v1'
      saved.tasks.push({ id: randomUUID(), name: 'Keep this task', goal: 'Study', url: 'https://i.chaoxing.com/', status: 'pending', createdAt: 1, updatedAt: 1, lastMessage: '' })
      await writeFile(join(directory, 'state.json'), JSON.stringify({ ...saved, model: { ...saved.model, temperature: 0.2 } }))
      const loaded = await new StateStore(directory).load()
      expect(loaded.warning).toBeUndefined()
      expect(loaded.state.model.baseUrl).toBe('https://configured.example/v1')
      expect(loaded.state.model).not.toHaveProperty('temperature')
      expect(loaded.state.tasks[0].name).toBe('Keep this task')
    } finally { await rm(directory, { recursive: true, force: true }) }
  })
  it('serializes atomic writes and stops previously running jobs on restart', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'study-store-'))
    try {
      const store = new StateStore(directory)
      const saved = emptyState()
      saved.tasks.push({ id: randomUUID(), name: 'Example', goal: 'Read current page', url: 'https://i.chaoxing.com/', status: 'running', createdAt: 1, updatedAt: 2, lastMessage: '' })
      const first = store.save(saved)
      saved.tasks[0].name = 'Last write'
      await Promise.all([first, store.save(saved)])
      const loaded = await store.load()
      expect(loaded.state.tasks[0].name).toBe('Last write')
      expect(loaded.state.tasks[0].status).toBe('stopped')
      expect(await readdir(directory)).not.toContain('state.json.tmp')
    } finally { await rm(directory, { recursive: true, force: true }) }
  })
  it('preserves damaged or future-version state for diagnosis and reports recovery', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'study-store-'))
    try {
      await writeFile(join(directory, 'state.json'), '{"version":999}')
      const loaded = await new StateStore(directory).load()
      expect(loaded.warning).toContain('无法读取')
      expect(loaded.state.tasks).toEqual([])
      expect((await readdir(directory)).some(name => name.startsWith('state.invalid-'))).toBe(true)
    } finally { await rm(directory, { recursive: true, force: true }) }
  })
  it('never writes a plaintext credential and supports encryption-unavailable session mode', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'study-secret-'))
    try {
      const encrypted = Buffer.from([11, 23, 45])
      const encryption = { isEncryptionAvailable: () => true, encryptString: () => encrypted, decryptString: () => 'private-key' }
      const store = new SecretStore(directory, encryption)
      await store.set('private-key')
      expect((await readFile(join(directory, 'model-key.bin'))).equals(encrypted)).toBe(true)
      const restored = new SecretStore(directory, encryption)
      await restored.load(); expect(restored.key).toBe('private-key'); expect(restored.mode).toBe('encrypted')
      await restored.clear(); expect(restored.key).toBe('')
      const sessionOnly = new SecretStore(directory, { ...encryption, isEncryptionAvailable: () => false })
      await store.set('older-key')
      await sessionOnly.set('memory-only')
      expect(sessionOnly.mode).toBe('session'); expect(await readdir(directory)).toEqual([])
      const restarted = new SecretStore(directory, encryption)
      await restarted.load(); expect(restarted.key).toBe('')
    } finally { await rm(directory, { recursive: true, force: true }) }
  })
})
