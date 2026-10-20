import { mkdir, readFile, rename, writeFile, chmod } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import { defaultModelConfig, modelConfigSchema, taskInputSchema, type LogEntry, type ModelConfig, type StudyTask } from '../shared/contracts'

const savedTaskSchema = taskInputSchema.extend({
  id: z.string().uuid(), status: z.enum(['pending', 'running', 'paused', 'needs_user', 'completed', 'stopped', 'error']),
  createdAt: z.number(), updatedAt: z.number(), lastMessage: z.string().max(4000),
})
const logSchema = z.object({ id: z.string().uuid(), at: z.number(), level: z.enum(['info', 'warn', 'error']), message: z.string().max(2000) })
const savedStateSchema = z.object({
  version: z.literal(1), model: modelConfigSchema, tasks: z.array(savedTaskSchema).max(500), logs: z.array(logSchema).max(200),
})
export interface SavedState { version: 1; model: ModelConfig; tasks: StudyTask[]; logs: LogEntry[] }
export const emptyState = (): SavedState => ({ version: 1, model: { ...defaultModelConfig }, tasks: [], logs: [] })

/** Atomic replacement and ordered writes protect the last valid state from partial saves. */
export class StateStore {
  private chain: Promise<void> = Promise.resolve()
  constructor(readonly directory: string) {}
  async load(): Promise<{ state: SavedState; warning?: string }> {
    await mkdir(this.directory, { recursive: true, mode: 0o700 })
    try {
      const data = await readFile(join(this.directory, 'state.json'), 'utf8')
      const raw = JSON.parse(data)
      // Narrow migration for the first local build: preserve endpoints, tasks and
      // keys while dropping the removed sampling control, rather than resetting state.
      if (raw?.version === 1 && raw.model && typeof raw.model === 'object' && 'temperature' in raw.model) {
        delete raw.model.temperature
      }
      const state = savedStateSchema.parse(raw)
      for (const task of state.tasks) {
        if (['running', 'paused', 'needs_user'].includes(task.status)) {
          task.status = 'stopped'; task.lastMessage = '应用已重新启动。请手动核对当前页面并重新开始。'
        }
      }
      return { state }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { state: emptyState() }
      // Preserve evidence instead of silently overwriting damaged/unknown-version data.
      try { await rename(join(this.directory, 'state.json'), join(this.directory, `state.invalid-${Date.now()}.json`)) } catch { /* load still reports recovery */ }
      return { state: emptyState(), warning: '本地状态文件无法读取，原文件已尝试保留为 state.invalid 文件，已使用空状态启动。' }
    }
  }
  save(state: SavedState): Promise<void> {
    const serialized = JSON.stringify(savedStateSchema.parse(state), null, 2)
    const operation = this.chain.catch(() => {}).then(async () => {
      await mkdir(this.directory, { recursive: true, mode: 0o700 })
      const temporary = join(this.directory, 'state.json.tmp')
      await writeFile(temporary, serialized, { mode: 0o600 })
      await rename(temporary, join(this.directory, 'state.json'))
    })
    this.chain = operation
    return operation
  }
  async flush(): Promise<void> { await this.chain }
}

export interface SecretEncryption {
  isEncryptionAvailable(): boolean;
  encryptString(text: string): Buffer;
  decryptString(encrypted: Buffer): string;
}

/** safeStorage uses the operating system credential protection; plaintext never reaches disk. */
export class SecretStore {
  private value = ''
  private storage: 'encrypted' | 'session' | 'none' = 'none'
  constructor(private readonly directory: string, private readonly encryption: SecretEncryption) {}
  get key(): string { return this.value }
  get mode(): 'encrypted' | 'session' | 'none' { return this.storage }
  async load(environmentKey?: string): Promise<void> {
    if (environmentKey) { this.value = environmentKey; this.storage = 'session'; return }
    if (!this.encryption.isEncryptionAvailable()) return
    try {
      const bytes = await readFile(join(this.directory, 'model-key.bin'))
      this.value = this.encryption.decryptString(bytes); this.storage = this.value ? 'encrypted' : 'none'
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error('已保存的 API Key 无法解密，请重新导入。') }
  }
  async set(key: string): Promise<void> {
    if (this.encryption.isEncryptionAvailable()) {
      await mkdir(this.directory, { recursive: true, mode: 0o700 })
      const path = join(this.directory, 'model-key.bin')
      await writeFile(`${path}.tmp`, this.encryption.encryptString(key), { mode: 0o600 })
      await rename(`${path}.tmp`, path)
      await chmod(path, 0o600)
      this.storage = 'encrypted'
    } else {
      // A new session credential must not resurrect an older saved credential on restart.
      await this.clear()
      this.storage = 'session'
    }
    this.value = key
  }
  async clear(): Promise<void> {
    const { unlink } = await import('node:fs/promises')
    try { await unlink(join(this.directory, 'model-key.bin')) } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
    this.value = ''; this.storage = 'none'
  }
}
