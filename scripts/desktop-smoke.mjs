import { _electron as electron } from 'playwright'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const profile = await mkdtemp(resolve(tmpdir(), 'study-desktop-smoke-'))
await mkdir(resolve(root, '.local'), { recursive: true })
const environment = { ...process.env, STUDY_AGENT_DATA_DIR: profile, MODEL_API_KEY: '', MODEL_BASE_URL: '', MODEL_NAME: '', MODEL_PROVIDER: '', MODEL_PROTOCOL: '', MODEL_TOKEN_PARAMETER: '' }
delete environment.ELECTRON_RUN_AS_NODE
delete environment.ELECTRON_RENDERER_URL
delete environment.STUDY_AGENT_LOCAL_FIXTURE
let desktop
async function eventually(predicate, message) {
  const deadline = Date.now() + 5000
  while (Date.now() < deadline) {
    if (await predicate()) return
    await new Promise(resolve => setTimeout(resolve, 50))
  }
  assert.fail(message)
}
try {
  desktop = await electron.launch({
    ...(process.env.STUDY_AGENT_SMOKE_EXECUTABLE ? { executablePath: process.env.STUDY_AGENT_SMOKE_EXECUTABLE } : {}),
    args: process.env.STUDY_AGENT_SMOKE_EXECUTABLE ? [] : [root], cwd: root, env: environment, timeout: 30000,
  })
  const page = await desktop.firstWindow()
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.getByRole('heading', { name: '学习工作台', exact: true }).waitFor()
  await page.waitForFunction(() => window.study && document.fonts.status === 'loaded')
  const boundary = await page.evaluate(async () => ({
    node: typeof window.require, rawIPC: typeof window.ipcRenderer,
    state: await window.study.getState(),
  }))
  assert.equal(boundary.node, 'undefined')
  assert.equal(boundary.rawIPC, 'undefined')
  assert.equal(boundary.state.model.hasKey, false)
  assert.equal(boundary.state.model.model, 'gpt-6.1-sol')
  assert.equal(boundary.state.model.protocol, 'responses')
  assert.equal('apiKey' in boundary.state.model, false)
  assert.equal(boundary.state.tasks.length, 0)
  await page.screenshot({ path: resolve(root, '.local/desktop-dashboard.png'), fullPage: true, animations: 'disabled' })

  await page.getByRole('button', { name: '新建任务', exact: true }).click()
  const modal = page.getByRole('dialog', { name: '新建学习任务' })
  await modal.getByLabel('任务名称').fill('桌面回归测试')
  await modal.getByLabel('学习页面地址').fill('https://i.chaoxing.com/')
  await modal.getByLabel('本次学习目标').fill('分析当前练习截图并给出建议，由用户核对。')
  await modal.getByRole('button', { name: '创建任务', exact: true }).click()
  await modal.waitFor({ state: 'hidden' })
  const saved = await page.evaluate(() => window.study.getState())
  assert.equal(saved.tasks.length, 1)
  assert.equal(saved.tasks[0].name, '桌面回归测试')

  // Rejected URLs travel through the actual sandboxed preload and IPC validation.
  const rejected = await page.evaluate(async () => {
    try { await window.study.addTask({ name: 'Blocked', url: 'https://evil.invalid/', goal: 'test' }); return false }
    catch { return true }
  })
  assert.equal(rejected, true)
  await page.getByRole('button', { name: '模型与设置', exact: true }).click()
  await page.getByRole('heading', { name: '模型与设置', exact: true }).waitFor()
  const presets = [
    ['DeepSeek', 'deepseek', 'deepseek-flash', 'https://api.deepseek.com', 'chat_completions', 'max_tokens'],
    ['Kimi', 'kimi', 'kimi-k3', 'https://api.moonshot.ai/v1', 'chat_completions', 'max_completion_tokens'],
    ['GLM', 'glm', 'glm-5.3-flash', 'https://open.bigmodel.cn/api/paas/v4', 'chat_completions', 'max_tokens'],
    ['OpenAI', 'openai', 'gpt-6.1-sol', 'https://api.openai.com/v1', 'responses', 'max_completion_tokens'],
    ['Claude', 'claude', 'claude-sonnet-5-5', 'https://api.anthropic.com/v1', 'anthropic', 'max_tokens'],
    ['Gemini', 'gemini', 'gemini-3.8-flash', 'https://generativelanguage.googleapis.com/v1beta', 'gemini', 'max_tokens'],
  ]
  for (const [label, provider, model, baseUrl, protocol, tokenParameter] of presets) {
    const before = (await page.evaluate(() => window.study.getState())).model
    const button = page.getByRole('button', { name: label, exact: true })
    await button.click()
    assert.equal(await button.getAttribute('aria-pressed'), 'true')
    assert.equal(await page.getByLabel('API Base URL', { exact: false }).inputValue(), baseUrl)
    assert.equal(await page.getByLabel('Model Name', { exact: false }).inputValue(), model)
    assert.equal((await page.evaluate(() => window.study.getState())).model.model, before.model, 'Draft selection must not change the saved connection')
    await page.getByRole('button', { name: /^(保存并使用|使用此配置)$/ }).click()
    await page.locator('.busy-indicator').waitFor({ state: 'hidden' })
    const savedPreset = (await page.evaluate(() => window.study.getState())).model
    assert.equal(savedPreset.provider, provider)
    assert.equal(savedPreset.model, model)
    assert.equal(savedPreset.protocol, protocol)
    assert.equal(savedPreset.tokenParameter, tokenParameter)
  }
  await page.getByRole('button', { name: 'OpenAI', exact: true }).click()
  await page.getByRole('button', { name: /^(保存并使用|使用此配置)$/ }).click()
  await page.locator('.busy-indicator').waitFor({ state: 'hidden' })
  await page.screenshot({ path: resolve(root, '.local/desktop-provider-presets.png'), fullPage: true, animations: 'disabled' })
  await page.getByLabel('Model Name', { exact: false }).fill('vision-model-test')
  await page.getByRole('button', { name: /^(保存并使用|使用此配置)$/ }).click()
  await eventually(async () => (await page.evaluate(() => window.study.getState())).model.model === 'vision-model-test', 'Model configuration was not saved through the UI')
  assert.equal(await page.getByText('Temperature', { exact: true }).count(), 0)
  assert.equal(await page.getByLabel('最大输出 Token', { exact: false }).isVisible(), false)
  assert.equal(await page.getByLabel('接口协议', { exact: true }).count(), 0, 'Official presets must not expose wire protocols')
  await page.getByText('更多设置', { exact: true }).click()
  assert.equal(await page.getByLabel('最大输出 Token', { exact: false }).evaluate(element => element.checkValidity()), true)
  await page.getByText('更多设置', { exact: true }).click()
  assert.equal(JSON.parse(await readFile(resolve(profile, 'state.json'), 'utf8')).model.model, 'vision-model-test')

  // Stub only the native OS picker; the actual main-process file read, IPC,
  // safeStorage encryption and public-state filtering still run unchanged.
  const secret = 'desktop-regression-only-private-value'
  const importFile = resolve(profile, 'key-import.txt')
  await writeFile(importFile, secret, { mode: 0o600 })
  await desktop.evaluate(({ dialog }, file) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] })
  }, importFile)
  await page.getByText('更多设置', { exact: true }).click()
  await page.getByRole('button', { name: '从文件导入密钥', exact: true }).click()
  await eventually(async () => (await page.evaluate(() => window.study.getState())).model.hasKey, 'Key import did not finish')
  const protectedState = await page.evaluate(() => window.study.getState())
  assert.equal(JSON.stringify(protectedState).includes(secret), false)
  if (protectedState.model.keyStorage === 'encrypted') {
    const files = await readdir(resolve(profile, 'keys'))
    assert.equal(files.length, 1)
    assert.equal((await readFile(resolve(profile, 'keys', files[0]))).includes(Buffer.from(secret)), false)
  }
  await rm(importFile)
  await page.getByRole('button', { name: 'Kimi', exact: true }).click()
  await page.getByRole('button', { name: '使用此配置', exact: true }).click()
  await eventually(async () => (await page.evaluate(() => window.study.getState())).model.provider === 'kimi', 'Kimi was not activated')
  assert.equal((await page.evaluate(() => window.study.getState())).model.hasKey, false)
  await page.getByRole('button', { name: 'OpenAI', exact: true }).click()
  assert.equal(await page.getByLabel('Model Name', { exact: false }).inputValue(), 'vision-model-test', 'Switching must restore the previous model choice')
  await page.getByRole('button', { name: '使用此配置', exact: true }).click()
  await eventually(async () => (await page.evaluate(() => window.study.getState())).model.hasKey, 'Switching back lost the provider key')
  await page.getByText('更多设置', { exact: true }).click()
  const afterEndpointChange = await page.evaluate(async () => {
    const previous = (await window.study.getState()).model
    const { hasKey, keyStorage, ...config } = previous
    return window.study.saveModel({ ...config, baseUrl: 'http://127.0.0.1:7788/v1' })
  })
  assert.equal(afterEndpointChange.model.hasKey, false)
  await page.evaluate(async () => {
    const { hasKey, keyStorage, ...config } = (await window.study.getState()).model
    return window.study.saveModel({ ...config, baseUrl: 'https://api.openai.com/v1' })
  })
  assert.equal((await page.evaluate(() => window.study.getState())).model.hasKey, true, 'Restoring an endpoint must restore its own credential')
  await desktop.evaluate(({ clipboard }, value) => { clipboard.readText = () => value }, secret)
  await page.getByLabel('API Base URL', { exact: false }).fill('https://vision.example/v1')
  await page.getByRole('button', { name: '粘贴 API Key', exact: true }).click()
  await eventually(async () => (await page.evaluate(() => window.study.getState())).modelProfiles.some(profile => profile.baseUrl === 'https://vision.example/v1' && profile.hasKey), 'Main-process paste did not import the draft key')
  assert.equal((await page.evaluate(() => window.study.getState())).model.baseUrl, 'https://api.openai.com/v1', 'Importing a draft key must not activate its endpoint')
  const draftProfile = (await page.evaluate(() => window.study.getState())).modelProfiles.find(profile => profile.provider === 'openai')
  assert.equal(draftProfile.baseUrl, 'https://vision.example/v1')
  assert.equal(draftProfile.hasKey, true)
  assert.equal(JSON.stringify(await page.evaluate(() => window.study.getState())).includes(secret), false)
  await page.locator('.busy-indicator').waitFor({ state: 'hidden' })
  await page.evaluate(() => window.study.clearApiKey())
  await page.evaluate(async () => {
    const { hasKey, keyStorage, ...config } = (await window.study.getState()).model
    return window.study.saveModel({ ...config, baseUrl: 'https://api.openai.com/v1' })
  })
  await page.locator('.busy-indicator').waitFor({ state: 'hidden' })
  await page.screenshot({ path: resolve(root, '.local/desktop-settings.png'), fullPage: true, animations: 'disabled' })
  await page.getByRole('button', { name: '课程与任务', exact: true }).click()
  await page.getByRole('button', { name: '删除 桌面回归测试', exact: true }).click()
  await eventually(async () => (await page.evaluate(() => window.study.getState())).tasks.length === 0, 'Task was not deleted through the UI')
  await page.getByRole('button', { name: '撤销删除', exact: true }).click()
  await eventually(async () => (await page.evaluate(() => window.study.getState())).tasks.length === 1, 'Undo must restore the task')
  await page.getByRole('button', { name: '删除 桌面回归测试', exact: true }).click()
  await eventually(async () => (await page.evaluate(() => window.study.getState())).tasks.length === 0, 'Restored task must remain deletable')
  // Check the actual minimum supported desktop size, not just a full-size capture.
  await page.getByRole('button', { name: '模型与设置', exact: true }).click()
  await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1100, 720))
  await page.getByRole('button', { name: 'Kimi', exact: true }).click()
  await page.waitForFunction(() => document.querySelector('button.model-vendor[aria-label=Kimi]')?.getAttribute('aria-pressed') === 'true')
  await page.screenshot({ path: resolve(root, '.local/desktop-settings-compact.png'), animations: 'disabled' })
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)
  assert.equal(overflow, false, 'Settings must fit the minimum desktop width')
  const buttonBox = await page.getByRole('button', { name: '使用此配置', exact: true }).boundingBox()
  assert.ok(buttonBox && buttonBox.x >= 0 && buttonBox.x + buttonBox.width <= 1100, 'Primary action must remain reachable')
  assert.deepEqual(errors, [], `Renderer errors: ${errors.join('; ')}`)
  console.log('PASS Electron desktop: sandboxed preload, task CRUD, IPC rejection, actual settings persistence, native key import/main-process encryption, provider/endpoint key isolation and restoration, minimum-window layout, screenshots, no renderer exceptions.')
} finally {
  if (desktop) await desktop.close()
  await rm(profile, { recursive: true, force: true })
}
