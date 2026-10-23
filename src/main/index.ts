import { app, BrowserWindow, clipboard, dialog, ipcMain, safeStorage, session, shell, type IpcMainInvokeEvent } from 'electron'
import { randomUUID } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { access, readFile, stat } from 'node:fs/promises'
import { dirname, isAbsolute, join, resolve, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { config as loadEnv } from 'dotenv'
import { z } from 'zod'
import { AgentHarness } from './agent/harness'
import { BrowserController } from './browser/controller'
import { urlAllowed } from './browser/policy'
import { MultimodalProvider } from './model/provider'
import { isTrustedRendererUrl, redact, validateApiKey } from './security'
import { credentialScope, SecretStore, StateStore, type SavedState } from './store'
import { initialAgent, defaultModelConfig, modelConfigSchema, taskInputSchema, type AgentSnapshot, type AppState, type ModelConfig, type StudyTask } from '../shared/contracts'
import { applyProviderPreset, providerPresets, normalizeProviderConfig } from '../shared/providers'

const directory = dirname(fileURLToPath(import.meta.url))
let window: BrowserWindow | null = null
let browser: BrowserController
let harness: AgentHarness | null = null
let agent: AgentSnapshot = structuredClone(initialAgent)
let store: StateStore
let secrets: SecretStore
const credentials = new Map<string, SecretStore>()
let saved: SavedState
let rendererUrl = ''
let closing = false
let shuttingDown = false
let busy = false
let keyDialogOpen = false
let controlGeneration = 0
let startingTask = false
let deletedTask: { task: StudyTask; index: number; expiresAt: number } | null = null
let persistTimer: ReturnType<typeof setTimeout> | null = null

if (!app.isPackaged) loadEnv({ quiet: true })
if (process.env.STUDY_AGENT_DATA_DIR && isAbsolute(process.env.STUDY_AGENT_DATA_DIR)) {
  mkdirSync(process.env.STUDY_AGENT_DATA_DIR, { recursive: true, mode: 0o700 })
  app.setPath('userData', process.env.STUDY_AGENT_DATA_DIR)
}
const primaryInstance = app.requestSingleInstanceLock()
if (!primaryInstance) app.quit()

const active = (): boolean => !['idle', 'completed', 'stopped', 'error'].includes(agent.phase)
const fixtureOrigins = (): string[] => !app.isPackaged && process.env.STUDY_AGENT_LOCAL_FIXTURE === '1'
  ? ['http://127.0.0.1:4178', 'http://localhost:4178'] : []
function state(): AppState {
  const publicConfig = (config: ModelConfig) => {
    const secret = credentials.get(credentialScope(config))
    return { ...config, hasKey: !!secret?.key, keyStorage: secret?.mode ?? 'none' as const }
  }
  const profiles = providerPresets.map(preset => applyProviderPreset(defaultModelConfig, preset.id))
  for (const config of [saved.model, ...saved.modelProfiles]) {
    const index = profiles.findIndex(profile => profile.provider === config.provider)
    if (index === -1) profiles.push(config)
    else profiles[index] = config
  }
  return { tasks: saved.tasks, logs: saved.logs, agent, browserOpen: browser?.isOpen ?? false,
    version: app.getVersion(), model: publicConfig(saved.model), modelProfiles: profiles.map(publicConfig) }
}
async function credentialsFor(config: ModelConfig): Promise<SecretStore> {
  const scope = credentialScope(config)
  const cached = credentials.get(scope)
  if (cached) return cached
  const secret = new SecretStore(store.directory, safeStorage, scope)
  await secret.load()
  credentials.set(scope, secret)
  return secret
}
function publish(): AppState {
  const value = state()
  if (window && !window.isDestroyed() && !window.webContents.isDestroyed()) window.webContents.send('study:state', value)
  return value
}
function log(level: 'info' | 'warn' | 'error', message: string): void {
  saved.logs.push({ id: randomUUID(), at: Date.now(), level, message: redact(message) })
  saved.logs = saved.logs.slice(-200)
  persistSoon(); publish()
}
function persistSoon(): void {
  if (persistTimer) clearTimeout(persistTimer)
  persistTimer = setTimeout(() => {
    persistTimer = null
    void store.save(saved).catch(() => {
      // Report once without recursively attempting to save a failed-save log.
      saved.logs.push({ id: randomUUID(), at: Date.now(), level: 'error', message: '本地状态保存失败，请检查数据目录空间和权限。' })
      saved.logs = saved.logs.slice(-200); publish()
    })
  }, 400)
}
function updateAgent(next: AgentSnapshot): void {
  const previous = agent
  agent = next
  if (next.taskId) {
    const task = saved.tasks.find(t => t.id === next.taskId)
    if (task) {
      const status: StudyTask['status'] = next.phase === 'completed' ? 'completed' : next.phase === 'stopped' ? 'stopped'
        : next.phase === 'error' ? 'error' : next.phase === 'paused' ? 'paused'
          : ['needs_user', 'awaiting_confirmation'].includes(next.phase) ? 'needs_user' : 'running'
      if (task.status !== status || previous.message !== next.message) {
        task.status = status; task.updatedAt = Date.now(); task.lastMessage = redact(next.message); persistSoon()
      }
    }
  }
  publish()
}
function trusted(event: IpcMainInvokeEvent): void {
  if (!window || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame
    || !event.senderFrame || !isTrustedRendererUrl(event.senderFrame.url, rendererUrl)) throw new Error('IPC 来源验证失败。')
}
function handle(channel: string, fn: (...args: unknown[]) => unknown): void {
  ipcMain.handle(channel, async (event, ...args: unknown[]) => {
    trusted(event)
    try { return await fn(...args) }
    catch (error) {
      const message = error instanceof z.ZodError ? '输入格式无效，请检查字段范围。'
        : redact(error instanceof Error ? error.message : '操作失败，请重试。')
      log('error', message)
      throw new Error(message)
    }
  })
}
async function exclusive<T>(operation: () => Promise<T>): Promise<T> {
  if (busy) throw new Error('另一个浏览器或配置操作正在执行，请稍后重试。')
  busy = true
  try { return await operation() } finally { busy = false }
}
function assertInactive(): void { if (active()) throw new Error('请先停止当前 Agent 任务，再修改浏览器入口或模型配置。') }
function provider(): MultimodalProvider { return new MultimodalProvider(saved.model, secrets.key) }
function makeHarness(): AgentHarness {
  return new AgentHarness({ browser, provider: { decide: input => {
    if (!secrets.key && new URL(saved.model.baseUrl).protocol !== 'http:') {
      throw new Error('需要分析截图，请先停止任务，在「模型与设置」中为当前厂商配置 API Key。视频监测不需要密钥。')
    }
    return provider().decide(input)
  } }, onUpdate: updateAgent, log })
}
async function saveProfile(raw: unknown, activate = false): Promise<{ config: ModelConfig; secret: SecretStore }> {
  const config = normalizeProviderConfig(modelConfigSchema.parse(raw ?? saved.model))
  new MultimodalProvider(config, '')
  const secret = await credentialsFor(config)
  const profiles = saved.modelProfiles.filter(profile => profile.provider !== config.provider)
  if (!profiles.some(profile => profile.provider === saved.model.provider) && saved.model.provider !== config.provider) profiles.push(saved.model)
  profiles.push(config)
  const next = { ...saved, model: activate ? config : saved.model, modelProfiles: profiles }
  await store.save(next)
  saved = next
  if (activate) secrets = secret
  return { config, secret }
}
const idSchema = z.string().uuid()

async function packagedBrowserExecutable(): Promise<string | undefined> {
  if (!app.isPackaged) return undefined
  const root = join(process.resourcesPath, 'browser-runtime')
  const manifest = z.object({ platform: z.string(), arch: z.string(), executable: z.string().min(1) })
    .parse(JSON.parse(await readFile(join(root, 'study-runtime.json'), 'utf8')))
  if (manifest.platform !== process.platform || manifest.arch !== process.arch) throw new Error('浏览器运行时与当前应用架构不一致，请安装对应平台的软件包。')
  const executable = resolve(root, manifest.executable)
  if (isAbsolute(manifest.executable) || !executable.startsWith(`${root}${sep}`)) throw new Error('浏览器运行时清单路径无效。')
  await access(executable)
  return executable
}

function registerIPC(): void {
  handle('study:get-state', () => state())
  handle('study:add-task', raw => exclusive(async () => {
    const input = taskInputSchema.parse(raw)
    if (!urlAllowed(input.url, fixtureOrigins())) throw new Error('课程地址必须为支持的平台 HTTPS 地址。')
    if (saved.tasks.length >= 500) throw new Error('已达到 500 条任务上限，请先删除不再需要的任务。')
    const now = Date.now()
    saved.tasks.unshift({ ...input, id: randomUUID(), createdAt: now, updatedAt: now, status: 'pending', lastMessage: '' })
    persistSoon(); return publish()
  }))
  handle('study:delete-task', raw => exclusive(async () => {
    const id = idSchema.parse(raw)
    if (agent.taskId === id && active()) throw new Error('请先停止该任务，再删除记录。')
    const index = saved.tasks.findIndex(task => task.id === id)
    if (index === -1) throw new Error('任务记录不存在。')
    deletedTask = { task: structuredClone(saved.tasks[index]), index, expiresAt: Date.now() + 10_000 }
    saved.tasks = saved.tasks.filter(task => task.id !== id)
    persistSoon(); return publish()
  }))
  handle('study:undo-delete-task', () => exclusive(async () => {
    if (!deletedTask || Date.now() >= deletedTask.expiresAt) throw new Error('撤销时间已过，无法恢复这次删除。')
    if (saved.tasks.length >= 500) throw new Error('任务数量已达上限，无法恢复。')
    saved.tasks.splice(deletedTask.index, 0, deletedTask.task)
    deletedTask = null
    persistSoon(); return publish()
  }))
  handle('study:analyze-page', () => exclusive(async () => {
    assertInactive()
    if (!browser.isOpen) throw new Error('请先打开学习浏览器并进入需要分析的页面。')
    if (!secrets.key && new URL(saved.model.baseUrl).protocol !== 'http:') throw new Error('请先在「模型与设置」配置并启用模型。')
    harness?.dispose()
    harness = makeHarness()
    await harness.start({ id: randomUUID(), name: '分析当前页面', url: 'https://i.chaoxing.com',
      goal: '仅根据当前截图分析可见题目并给出答案建议和解析。不要提出或执行任何浏览器操作；题目不完整时说明缺少什么，由用户手动调整页面。',
      status: 'pending', createdAt: Date.now(), updatedAt: Date.now(), lastMessage: '' }, 'analysis')
    return publish()
  }))
  handle('study:open-browser', raw => exclusive(async () => {
    if (active() && !['paused', 'needs_user'].includes(agent.phase)) throw new Error('请先暂停或停止 Agent，再打开学习页面。')
    if (active()) harness?.pause()
    await browser.open(z.string().url().max(2048).parse(raw))
    updateAgent({ ...agent, observation: null, videos: [], pending: null, decision: null })
    log('info', '浏览器已打开。请手动登录并进入需要辅助的课程页面。')
    return publish()
  }))
  handle('study:close-browser', () => exclusive(async () => {
    harness?.stop(); await browser.close(); log('info', '浏览器已关闭，会话保留在应用数据目录。'); return publish()
  }))
  handle('study:observe', () => exclusive(async () => {
    if (active() && !['paused', 'needs_user'].includes(agent.phase)) throw new Error('Agent 正在操作或等待确认，请先暂停后手动观察。')
    const observation = await browser.observe()
    updateAgent({ ...agent, observation, decision: null, pending: null,
      message: '当前页面已截图。点击“分析当前页面”可发送图片并获取解析。' })
    return publish()
  }))
  handle('study:start', raw => exclusive(async () => {
    assertInactive()
    const generation = ++controlGeneration
    const task = saved.tasks.find(t => t.id === idSchema.parse(raw))
    if (!task) throw new Error('任务记录不存在。')
    harness?.dispose()
    harness = null
    startingTask = true
    updateAgent({ ...structuredClone(initialAgent), taskId: task.id, phase: 'observing', startedAt: Date.now(), message: '正在打开任务地址…可随时停止启动。' })
    try {
      // Starting a saved task must honor its URL even if another course is already open.
      await browser.open(task.url)
      if (generation !== controlGeneration || shuttingDown) return publish()
      harness = makeHarness()
      await harness.start(task)
      return publish()
    } catch (error) {
      if (generation !== controlGeneration || shuttingDown) return publish()
      updateAgent({ ...agent, phase: 'error', endedAt: Date.now(), message: redact(error instanceof Error ? error.message : '无法打开任务地址。') })
      throw error
    } finally { startingTask = false }
  }))
  const cancelStart = (): void => {
    if (startingTask) updateAgent({ ...agent, phase: 'stopped', endedAt: Date.now(), pending: null, message: '已取消任务启动。已发出的页面加载可能仍会结束，Agent 不会继续执行。' })
  }
  handle('study:pause', () => { controlGeneration++; cancelStart(); harness?.pause(); return publish() })
  handle('study:resume', () => { if (!harness) throw new Error('没有可恢复的任务。'); harness.resume(); return publish() })
  handle('study:stop', () => { controlGeneration++; cancelStart(); harness?.stop(); return publish() })
  handle('study:confirm', async (rawId, rawApproved) => {
    if (!harness) throw new Error('没有待确认操作。')
    await harness.confirm(idSchema.parse(rawId), z.boolean().parse(rawApproved)); return publish()
  })
  handle('study:save-model', raw => exclusive(async () => {
    assertInactive()
    await saveProfile(raw, true)
    log('info', '模型配置已保存并启用。其他厂商的配置和密钥已保留。'); return publish()
  }))
  handle('study:paste-key', raw => exclusive(async () => {
    assertInactive()
    // Explicit user paste action; never return clipboard contents to the renderer.
    const key = validateApiKey(await clipboard.readText())
    const { secret } = await saveProfile(raw)
    await secret.set(key)
    log('info', secret.mode === 'encrypted' ? 'API Key 已由操作系统加密保存。' : '系统加密不可用，API Key 仅保留在当前进程内存。')
    return publish()
  }))
  handle('study:set-key', raw => exclusive(async () => {
    assertInactive()
    if (!window || keyDialogOpen) throw new Error('密钥导入窗口已打开。')
    keyDialogOpen = true
    try {
      const selected = await dialog.showOpenDialog(window, { title: '导入 API Key（仅一行 UTF-8 文本）', properties: ['openFile'], filters: [{ name: 'Key text', extensions: ['txt', 'key'] }] })
      if (selected.canceled || !selected.filePaths[0]) return state()
      const path = selected.filePaths[0]
      const info = await stat(path)
      if (!info.isFile() || info.size > 8192) throw new Error('密钥文件必须是小于 8 KB 的文本文件。')
      const key = validateApiKey(await readFile(path, 'utf8'))
      const { secret } = await saveProfile(raw)
      await secret.set(key)
      log('info', secret.mode === 'encrypted' ? 'API Key 已由操作系统加密保存。' : '系统加密不可用，API Key 仅保留在当前进程内存。')
      return publish()
    } finally { keyDialogOpen = false }
  }))
  handle('study:clear-key', raw => exclusive(async () => {
    assertInactive()
    const config = normalizeProviderConfig(modelConfigSchema.parse(raw ?? saved.model))
    const secret = await credentialsFor(config)
    await secret.clear(); log('info', '已清除所选服务的 API Key。'); return publish()
  }))
  handle('study:test-model', raw => exclusive(async () => {
    assertInactive()
    const config = normalizeProviderConfig(modelConfigSchema.parse(raw ?? saved.model))
    const secret = await credentialsFor(config)
    if (!secret.key && new URL(config.baseUrl).protocol !== 'http:') throw new Error('请先为所选厂商配置 API Key。')
    const message = await new MultimodalProvider(config, secret.key).testConnection()
    log('info', message); return message
  }))
  handle('study:open-data-folder', async () => {
    const error = await shell.openPath(store.directory)
    if (error) throw new Error('无法在文件管理器中打开数据目录。')
  })
}

async function createWindow(): Promise<void> {
  const rendererPath = join(directory, '../renderer/index.html')
  rendererUrl = !app.isPackaged && process.env.ELECTRON_RENDERER_URL
    ? process.env.ELECTRON_RENDERER_URL : pathToFileURL(rendererPath).href
  if (!rendererUrl.startsWith('file:')) {
    const url = new URL(rendererUrl)
    if (url.hostname !== '127.0.0.1' && url.hostname !== 'localhost') throw new Error('开发界面只允许从本机加载。')
  }
  window = new BrowserWindow({
    width: 1440, height: 940, minWidth: 1100, minHeight: 720, title: 'Study Agent', backgroundColor: '#f5f6f7', show: false,
    webPreferences: { preload: join(directory, '../preload/index.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true, spellcheck: false },
  })
  window.removeMenu()
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', (event, url) => { if (!isTrustedRendererUrl(url, rendererUrl)) event.preventDefault() })
  window.webContents.on('will-attach-webview', event => event.preventDefault())
  window.on('close', event => {
    if (active() && !closing) {
      event.preventDefault()
      closing = true
      void dialog.showMessageBox(window!, { type: 'question', message: '停止当前任务并退出？', detail: '退出会停止 Agent 并关闭其浏览器。登录会话将保留在本机。', buttons: ['继续使用', '停止并退出'], defaultId: 0, cancelId: 0 })
        .then(result => { if (result.response === 1) { harness?.stop(); app.quit() } else closing = false })
    }
  })
  window.on('closed', () => { window = null })
  window.once('ready-to-show', () => window?.show())
  await window.loadURL(rendererUrl)
}

app.on('second-instance', () => { if (window) { if (window.isMinimized()) window.restore(); window.focus() } })
app.whenReady().then(async () => {
  if (!primaryInstance) return
  store = new StateStore(app.getPath('userData'))
  const loaded = await store.load(); saved = loaded.state
  // Environment overrides stay main-process only, never copied into Vite variables.
  const envModel = { ...saved.model,
    ...(process.env.MODEL_BASE_URL ? { baseUrl: process.env.MODEL_BASE_URL } : {}),
    ...(process.env.MODEL_NAME ? { model: process.env.MODEL_NAME } : {}),
    ...(process.env.MODEL_PROVIDER ? { provider: process.env.MODEL_PROVIDER } : {}),
    ...(process.env.MODEL_PROTOCOL ? { protocol: process.env.MODEL_PROTOCOL } : {}),
    ...(process.env.MODEL_TOKEN_PARAMETER ? { tokenParameter: process.env.MODEL_TOKEN_PARAMETER } : {}),
  }
  const parsedConfig = modelConfigSchema.safeParse(envModel)
  const previousConfig = saved.model
  secrets = new SecretStore(store.directory, safeStorage, credentialScope(previousConfig))
  credentials.set(credentialScope(previousConfig), secrets)
  try {
    await secrets.load()
    // Migrate the original single credential only when its saved endpoint was recovered.
    if (loaded.hasSavedState) {
      const legacy = new SecretStore(store.directory, safeStorage)
      await legacy.load()
      if (legacy.key && !secrets.key) await secrets.set(legacy.key)
      if (legacy.key) await legacy.clear()
    }
    for (const profile of saved.modelProfiles) await credentialsFor(profile)
    if (parsedConfig.success) {
      if (credentialScope(previousConfig) !== credentialScope(parsedConfig.data)) {
        saved.modelProfiles = [...saved.modelProfiles.filter(profile => profile.provider !== previousConfig.provider), previousConfig]
      }
      saved.model = parsedConfig.data
      secrets = await credentialsFor(saved.model)
    }
    if (process.env.MODEL_API_KEY) await secrets.load(validateApiKey(process.env.MODEL_API_KEY))
  } catch (error) { log('warn', (error as Error).message) }
  browser = new BrowserController(join(store.directory, 'browser-profile'), {
    allowedOrigins: fixtureOrigins(),
    executablePath: await packagedBrowserExecutable(),
    onClose: () => { harness?.pause(); publish() },
  })
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
  session.defaultSession.setPermissionCheckHandler(() => false)
  registerIPC()
  await createWindow()
  if (loaded.warning) log('warn', loaded.warning)
}).catch(error => { dialog.showErrorBox('Study Agent 启动失败', redact(error instanceof Error ? error.message : '未知错误')); app.exit(1) })

app.on('window-all-closed', () => app.quit())
process.on('SIGINT', () => app.quit())
process.on('SIGTERM', () => app.quit())
app.on('before-quit', event => {
  if (shuttingDown || !store || !saved) return
  event.preventDefault(); shuttingDown = true
  harness?.stop(); harness?.dispose()
  if (persistTimer) clearTimeout(persistTimer)
  void Promise.allSettled([browser?.close(), store.save(saved).then(() => store.flush())]).then(() => app.quit())
})
