import { _electron as electron } from 'playwright'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { inflateSync } from 'node:zlib'
import { mkdtemp, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const profile = await mkdtemp(resolve(tmpdir(), 'study-workflow-'))
const packaged = !!process.env.STUDY_AGENT_SMOKE_EXECUTABLE
const environment = { ...process.env, STUDY_AGENT_DATA_DIR: profile, STUDY_AGENT_LOCAL_FIXTURE: '1',
  MODEL_API_KEY: '', MODEL_BASE_URL: '', MODEL_NAME: '', MODEL_PROVIDER: '', MODEL_PROTOCOL: '', MODEL_TOKEN_PARAMETER: '' }
delete environment.ELECTRON_RUN_AS_NODE
delete environment.ELECTRON_RENDERER_URL
const origin = 'http://127.0.0.1:4178'
const secret = 'workflow-regression-fake-key'
let responseMode = 'blind'
const requests = []

// Decode the actual PNG received over HTTP, independently of the app's expected answer.
function readColors(dataUrl) {
  const image = Buffer.from(dataUrl.split(',')[1], 'base64')
  const compressed = []
  for (let offset = 8; offset < image.length;) {
    const size = image.readUInt32BE(offset)
    if (image.subarray(offset + 4, offset + 8).toString() === 'IDAT') compressed.push(image.subarray(offset + 8, offset + 8 + size))
    offset += size + 12
  }
  const pixels = inflateSync(Buffer.concat(compressed))
  const width = image.readUInt32BE(16)
  const names = { '230,25,25': 'red', '0,160,40': 'green', '25,65,230': 'blue', '245,220,0': 'yellow', '145,35,190': 'purple', '250,130,0': 'orange' }
  return [60, 180, 300].map(x => names[Array.from(pixels.subarray(70 * (width * 3 + 1) + 1 + x * 3, 70 * (width * 3 + 1) + 4 + x * 3)).join(',')])
}

const server = createServer(async (request, response) => {
  if (request.method === 'POST') {
    const chunks = []
    for await (const chunk of request) chunks.push(chunk)
    const body = JSON.parse(Buffer.concat(chunks).toString())
    requests.push({ body, authorization: request.headers.authorization })
    response.setHeader('Content-Type', 'application/json')
    if (responseMode === 'unauthorized') {
      response.writeHead(401); response.end(JSON.stringify({ error: { message: `Do not expose ${secret}` } })); return
    }
    const content = body.messages[1].content
    const probe = content[0].text.startsWith('Identify the colors')
    const reply = probe ? responseMode === 'blind' ? { ok: true } : { colors: readColors(content[1].image_url.url) }
      : { summary: '本地测试：已观察到课程 B 页面。', confidence: 1, pageType: 'courses', questions: [], action: null, needsHuman: false, done: true }
    response.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(reply) }, finish_reason: 'stop' }] })); return
  }
  response.setHeader('Content-Type', 'text/html; charset=utf-8')
  if (request.url === '/slow-course') {
    setTimeout(() => response.end('<!doctype html><title>Slow local fixture</title><h1>Slow course</h1>'), 1200)
    return
  }
  if (request.url === '/video') {
    response.end(`<!doctype html><title>Local video fixture</title><video muted autoplay style="width:400px;height:240px"></video><canvas hidden width="160" height="90"></canvas><script>const c=document.querySelector('canvas'),v=document.querySelector('video'),ctx=c.getContext('2d');let n=0;setInterval(()=>{ctx.fillStyle=n++%2?'#444':'#777';ctx.fillRect(0,0,160,90)},50);v.srcObject=c.captureStream(10);v.play();</script>`)
  } else response.end(`<!doctype html><title>Local course fixture</title><h1>${request.url === '/course-b' ? '课程 B' : '课程 A'}</h1><button>查看章节</button>`)
})
let desktop
async function launch() {
  desktop = await electron.launch({ ...(packaged ? { executablePath: process.env.STUDY_AGENT_SMOKE_EXECUTABLE } : {}),
    args: packaged ? [] : [root], cwd: root, env: environment, timeout: 30000 })
  const page = await desktop.firstWindow()
  await page.getByRole('heading', { name: '学习工作台', exact: true }).waitFor()
  return page
}
async function eventually(test, message) {
  const until = Date.now() + 15_000
  while (Date.now() < until) {
    if (await test()) return
    await new Promise(resolve => setTimeout(resolve, 75))
  }
  assert.fail(message)
}
try {
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(4178, '127.0.0.1', resolve) })
  let page = await launch()
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  const initial = (await page.evaluate(() => window.study.getState())).model
  await page.evaluate(async baseUrl => {
    const { hasKey, keyStorage, ...config } = (await window.study.getState()).model
    await window.study.saveModel({ ...config, provider: 'custom', protocol: 'chat_completions', tokenParameter: 'max_tokens', baseUrl, model: 'local-test-model' })
  }, `${origin}/v1`)
  await desktop.evaluate(({ clipboard }, key) => { clipboard.readText = async () => key }, secret)
  await page.evaluate(() => window.study.pasteApiKey())
  await page.getByRole('button', { name: '模型与设置', exact: true }).click()
  await page.getByLabel('Model Name', { exact: false }).fill(' edited-before-test ')
  await page.getByRole('button', { name: '测试连接', exact: true }).click()
  await page.locator('.model-feedback.error').filter({ hasText: '未通过图片内容校验' }).waitFor()
  assert.equal(requests[0].body.model, 'edited-before-test', 'Test must save and use the visible configuration')
  assert.equal(requests[0].authorization, `Bearer ${secret}`)
  assert.equal(JSON.stringify(await page.evaluate(() => window.study.getState())).includes(secret), false)

  responseMode = 'unauthorized'
  await page.getByRole('button', { name: '测试连接', exact: true }).click()
  await page.locator('.model-feedback.error').filter({ hasText: 'HTTP 401' }).waitFor()
  assert.equal((await page.locator('.model-feedback').textContent()).includes(secret), false)
  await page.screenshot({ path: resolve(root, '.local/desktop-model-error.png'), animations: 'disabled' })
  responseMode = 'vision'
  await page.getByRole('button', { name: '测试连接', exact: true }).click()
  await page.locator('.model-feedback.success').filter({ hasText: '视觉连接验证通过' }).waitFor()
  assert.equal(requests.length, 3, 'Invalid visual replies and 401 must not retry')

  // Exercise upgrading a real encrypted single-key profile, then restarting again.
  const beforeRestart = await page.evaluate(() => window.study.getState())
  await desktop.close(); desktop = undefined
  if (beforeRestart.model.keyStorage === 'encrypted') {
    const files = await readdir(resolve(profile, 'keys'))
    assert.equal(files.length, 1)
    await rename(resolve(profile, 'keys', files[0]), resolve(profile, 'model-key.bin'))
    const stateFile = resolve(profile, 'state.json')
    const oldState = JSON.parse(await readFile(stateFile, 'utf8'))
    delete oldState.modelProfiles
    await writeFile(stateFile, JSON.stringify(oldState))
  }
  page = await launch()
  page.on('pageerror', error => errors.push(error.message))
  const restored = await page.evaluate(() => window.study.getState())
  assert.equal(restored.model.model, 'edited-before-test')
  if (beforeRestart.model.keyStorage === 'encrypted') assert.equal(restored.model.hasKey, true, 'Legacy credential migration lost the key')
  assert.equal(JSON.stringify(restored).includes(secret), false)

  if (!packaged) {
    const slow = await page.evaluate(url => window.study.addTask({ name: '取消启动测试', url, goal: '取消前不能调用模型' }), `${origin}/slow-course`)
    const callsBeforeCancel = requests.length
    const starting = page.evaluate(id => window.study.start(id), slow.tasks[0].id)
    await eventually(async () => (await page.evaluate(() => window.study.getState())).agent.message.includes('正在打开任务地址'), 'Opening a task must expose a cancellable state')
    await page.evaluate(() => window.study.stop())
    await starting
    assert.equal((await page.evaluate(() => window.study.getState())).agent.phase, 'stopped')
    assert.equal(requests.length, callsBeforeCancel, 'Canceled startup must not call the model')
    await page.evaluate(url => window.study.openBrowser(url), `${origin}/course-a`)
    const added = await page.evaluate(url => window.study.addTask({ name: '课程 B 的任务', url, goal: '观察课程 B' }), `${origin}/course-b`)
    await page.evaluate(id => window.study.start(id), added.tasks[0].id)
    await eventually(async () => (await page.evaluate(() => window.study.getState())).agent.phase === 'completed', 'Saved task did not complete on the expected page')
    const completed = await page.evaluate(() => window.study.getState())
    assert.equal(completed.agent.observation.url, `${origin}/course-b`, 'Starting task B must not reuse course A')
    assert.ok(completed.agent.endedAt >= completed.agent.startedAt)
    const beforeVideoCalls = requests.length
    await page.evaluate(async model => {
      const { hasKey, keyStorage, ...config } = model
      await window.study.saveModel(config)
    }, initial)
    assert.equal((await page.evaluate(() => window.study.getState())).model.hasKey, false)
    const video = await page.evaluate(url => window.study.addTask({ name: '无 Key 视频监测', url, goal: '监测真实播放状态' }), `${origin}/video`)
    await page.evaluate(id => window.study.start(id), video.tasks[0].id)
    await eventually(async () => (await page.evaluate(() => window.study.getState())).agent.phase === 'monitoring', 'Deterministic video monitoring should work without an API key')
    assert.equal((await page.evaluate(() => window.study.getState())).agent.modelCalls, 0)
    assert.equal(requests.length, beforeVideoCalls)
    await page.evaluate(() => window.study.stop())
    await page.evaluate(() => window.study.closeBrowser())
  } else {
    const blocked = await page.evaluate(async url => { try { await window.study.openBrowser(url); return false } catch { return true } }, `${origin}/course-a`)
    assert.equal(blocked, true, 'Packaged app must ignore the development fixture bypass')
  }
  assert.deepEqual(errors, [])
  console.log(`PASS Electron workflows: real HTTP visual challenge, actionable 401, save-and-test, encrypted legacy migration/restart; ${packaged ? 'packaged fixture policy' : 'task URL selection, no-key video monitoring, terminal runtime'}. All services/pages are local fixtures.`)
} finally {
  if (desktop) await desktop.close()
  server.closeAllConnections()
  await new Promise(resolve => server.close(resolve))
  await rm(profile, { recursive: true, force: true })
}
