/** Deterministic visual fixtures in a real isolated Electron window.
 * The main process publishes synthetic view state only; no platform/model call occurs.
 * This is visual QA, not evidence of real Chaoxing or API acceptance.
 */
import { _electron as electron, chromium } from 'playwright'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const output = resolve(root, '.local/ui-review')
const profile = await mkdtemp(resolve(tmpdir(), 'study-visual-review-'))
await mkdir(output, { recursive: true })
const env = { ...process.env, STUDY_AGENT_DATA_DIR: profile, MODEL_API_KEY: '', MODEL_BASE_URL: '', MODEL_NAME: '', MODEL_PROVIDER: '', MODEL_PROTOCOL: '', MODEL_TOKEN_PARAMETER: '' }
for (const key of ['ELECTRON_RUN_AS_NODE', 'ELECTRON_RENDERER_URL', 'STUDY_AGENT_LOCAL_FIXTURE']) delete env[key]
const review = []
let app, browser
try {
  app = await electron.launch({
    ...(process.env.STUDY_AGENT_SMOKE_EXECUTABLE ? { executablePath: process.env.STUDY_AGENT_SMOKE_EXECUTABLE } : {}),
    args: process.env.STUDY_AGENT_SMOKE_EXECUTABLE ? [] : [root], cwd: root, env, timeout: 30000,
  })
  const page = await app.firstWindow()
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.getByRole('heading', { name: '学习工作台', exact: true }).waitFor()
  const original = await page.evaluate(() => window.study.getState())
  async function capture(name) {
    await page.evaluate(() => document.fonts.ready)
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth || document.querySelector('.main-shell').scrollWidth > document.querySelector('.main-shell').clientWidth), false, `${name}: horizontal overflow`)
    const brokenImages = await page.locator('img').evaluateAll(images => images.filter(image => !image.complete || image.naturalWidth === 0).map(image => image.alt || image.src.slice(0, 100)))
    assert.deepEqual(brokenImages, [], `${name}: missing images`)
    await page.screenshot({ path: resolve(output, `${name}.png`), animations: 'disabled', scale: 'css' })
    review.push(name)
  }
  async function view(label) {
    await page.getByRole('button', { name: label, exact: true }).first().click()
    await page.getByRole('heading', { name: label, exact: true }).waitFor()
    await page.waitForFunction(() => document.querySelector('.main-shell').scrollTop === 0)
  }
  async function publish(state) {
    await app.evaluate(({ BrowserWindow }, state) => BrowserWindow.getAllWindows()[0].webContents.send('study:state', state), state)
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  }
  await capture('01-workspace-empty')
  await page.getByRole('button', { name: '新建任务', exact: true }).click()
  await page.getByRole('dialog').waitFor()
  assert.equal(await page.locator('.main-shell').getAttribute('inert'), '')
  await capture('02-new-task')
  await page.getByRole('dialog').getByLabel('任务名称').fill('不支持的课程地址')
  await page.getByRole('dialog').getByLabel('学习页面地址').fill('https://example.com/')
  await page.getByRole('button', { name: '创建任务', exact: true }).click()
  await page.getByRole('dialog').getByRole('alert').waitFor()
  await capture('02b-new-task-error')
  await page.keyboard.press('Escape')
  await page.getByRole('dialog').waitFor({ state: 'hidden' })
  assert.equal(await page.getByRole('button', { name: '新建任务', exact: true }).evaluate(button => button === document.activeElement), true, 'Closing a dialog must restore the trigger focus')
  await view('课程与任务')
  await capture('03-tasks-empty')
  await view('AI 题目分析')
  await capture('04-analysis-empty')
  await view('运行日志')
  await capture('05-logs-empty')
  await view('模型与设置')
  await capture('06-model-openai')
  for (const vendor of ['DeepSeek', 'Kimi', 'GLM', 'Claude', 'Gemini']) {
    await page.getByRole('button', { name: vendor, exact: true }).click()
    await page.getByRole('heading', { name: vendor, exact: true }).waitFor()
    assert.equal(await page.locator('.model-editor-heading img').evaluate(image => image.complete && image.naturalWidth > 0), true)
  }
  await capture('07-model-gemini')
  await page.getByText('更多设置', { exact: true }).click()
  await capture('08-model-advanced')
  await view('学习工作台')

  // These pages are made locally, labeled as test fixtures, then captured by Chromium.
  browser = await chromium.launch({ headless: true })
  const fixture = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 })
  const fixtureHead = '<meta charset="utf-8"><style>body{margin:0;background:#f7f8fb;color:#27334a;font:16px "PingFang SC",sans-serif}header{padding:20px 32px;background:white;border-bottom:1px solid #e5e9f0;display:flex;justify-content:space-between}small{color:#8a6941;background:#fff4dc;padding:5px 10px;border-radius:4px;font-size:12px}main{max-width:1040px;margin:36px auto}h1{font-size:25px}p{color:#69758b;line-height:1.8}.player{height:470px;background:#202c49;border-radius:8px;display:flex;align-items:center;justify-content:center;color:white}.slide{background:#f9fbff;color:#293e66;padding:45px 65px;width:630px;border-radius:3px}.slide h2{font-size:32px}.timeline{height:5px;background:#4b6086;margin-top:15px}.timeline b{display:block;width:37%;height:100%;background:#9fb5ff}.option{padding:16px;border:1px solid #e3e7ee;border-radius:6px;margin:10px 0;background:white}</style>'
  await fixture.setContent(fixtureHead + '<header><span>学习课程 / 高等数学</span><small>本地视觉测试页面 · 非学习通实站</small></header><main><p>第二章　导数与微分</p><h1>2.1 从变化率理解导数</h1><div class="player"><div class="slide"><p>导数的几何意义</p><h2>从割线，到切线。</h2><p>当两点逐渐靠近，平均变化率趋近于瞬时变化率。</p><svg width="520" height="140"><path d="M20 120H480M70 135V10" fill="none" stroke="#b2bed8" stroke-width="2"/><path d="M80 112Q230 110 420 20" fill="none" stroke="#627bcd" stroke-width="3"/><path d="M130 120L430 40" stroke="#82a5b8" stroke-width="2"/></svg></div></div><div class="timeline"><b></b></div><p>07:24 / 20:00</p></main>')
  const videoImage = 'data:image/jpeg;base64,' + (await fixture.screenshot({ type: 'jpeg', quality: 90 })).toString('base64')
  const now = Date.now()
  const tasks = [
    { id: 'visual-task-1', name: '高等数学 · 导数与微分', goal: '观察本章视频播放状态，遇到章节练习时给出解析建议。', url: 'https://mooc2-ans.chaoxing.com/mycourse/studentcourse', status: 'running' },
    { id: 'visual-task-2', name: '大学英语 · 阅读理解', goal: '阅读练习截图，分析文章结构和选项。', url: 'https://i.chaoxing.com/', status: 'pending' },
    { id: 'visual-task-3', name: '计算机基础 · 第一章练习', goal: '核对选择题，并整理概念之间的联系。', url: 'https://i.chaoxing.com/', status: 'completed' },
  ].map(task => ({ ...task, createdAt: now - 3600000, updatedAt: now, lastMessage: '本地视觉测试数据' }))
  const video = { id: 'visual-video', frameId: 'main', currentTime: 444, duration: 1200, paused: false, ended: false, readyState: 4, networkState: 1, playbackRate: 1, bufferedEnd: 492, error: null, sampledAt: now, status: 'playing', stalledForMs: 0 }
  const observation = { id: 'visual-observation', capturedAt: now, url: tasks[0].url, title: '高等数学 · 第二章（本地视觉测试）', pageType: 'video', confidence: .94, screenshot: videoImage, viewport: { width: 1280, height: 800 }, fingerprint: 'visual-fixture-only', frames: [{ id: 'main', url: tasks[0].url }], videos: [video], completion: { state: 'incomplete', evidence: '本地测试：页面显示任务点尚未完成。' } }
  const sample = { ...original, tasks, browserOpen: true, model: { ...original.model, hasKey: true, keyStorage: 'encrypted' }, logs: [
    { id: 'log1', at: now - 15000, level: 'info', message: '本地视觉测试：已读取课程页面，识别到一个视频播放器。' },
    { id: 'log2', at: now - 12000, level: 'info', message: '本地视觉测试：视频正在正常播放，继续监测播放进度。' },
    { id: 'log3', at: now - 6000, level: 'warn', message: '本地视觉测试：尚未检测到平台任务点完成标记。' },
  ], agent: { ...original.agent, phase: 'monitoring', taskId: tasks[0].id, step: 4, modelCalls: 1, startedAt: now - 444000, endedAt: null, observation, videos: [video], message: '正在监测课程视频。播放状态正常，无需重复调用模型。' } }
  await publish(sample)
  await page.getByText('正常播放', { exact: true }).waitFor()
  await capture('09-workspace-video')
  await page.getByRole('button', { name: '放大浏览器截图', exact: true }).click()
  const imageDialog = page.getByRole('dialog', { name: '页面截图', exact: true })
  await imageDialog.waitFor()
  assert.ok((await imageDialog.boundingBox()).width >= 1000, 'Expanded screenshot must use the wide viewer, not the form dialog width')
  await capture('09b-screenshot-viewer')
  await imageDialog.getByRole('button', { name: '原始尺寸', exact: true }).click()
  assert.equal(await imageDialog.locator('img').evaluate(image => image.clientWidth), 1280, 'Original size should retain CSS screenshot coordinates')
  await capture('09c-screenshot-original')
  await page.keyboard.press('Escape')
  await imageDialog.waitFor({ state: 'hidden' })
  assert.equal(await page.getByRole('button', { name: '放大浏览器截图', exact: true }).evaluate(button => button === document.activeElement), true)
  await view('课程与任务')
  await capture('10-tasks-populated')
  await view('运行日志')
  await capture('11-logs-populated')
  await page.getByRole('button', { name: '异常', exact: true }).click()
  await capture('12-logs-filter-empty')
  await view('模型与设置')
  assert.equal(await page.getByLabel('Model Name', { exact: false }).isDisabled(), true)
  await capture('13-model-task-locked')

  await fixture.setContent(fixtureHead + '<header><span>高等数学 / 章节练习</span><small>本地视觉测试页面 · 非学习通实站</small></header><main><p>第二章　导数与微分</p><h1>1. 下列关于函数导数的叙述，正确的是哪一项？</h1><div class="option">A. 函数在一点连续，则一定在该点可导。</div><div class="option">B. 函数在一点可导，则一定在该点连续。</div><div class="option">C. 函数在一点的导数为零，则该点一定是极值点。</div><div class="option">D. 函数在一点不可导，则一定在该点不连续。</div><p>单选题　请结合导数定义作答</p></main>')
  const questionImage = 'data:image/jpeg;base64,' + (await fixture.screenshot({ type: 'jpeg', quality: 90 })).toString('base64')
  const question = { type: 'single', stem: '下列关于函数导数的叙述，正确的是哪一项？', options: ['函数在一点连续，则一定在该点可导。', '函数在一点可导，则一定在该点连续。', '函数在一点的导数为零，则该点一定是极值点。', '函数在一点不可导，则一定在该点不连续。'], suggestedAnswer: ['B'], explanation: '可导是连续的充分条件。根据导数的定义，函数在该点的增量趋于零，因此函数连续。\n连续不一定可导，例如绝对值函数在原点连续但不可导。导数为零也不保证出现极值。', confidence: .96, needsReview: false }
  const decision = { summary: '本地视觉测试：已识别到一道关于可导与连续关系的单选题，请结合原页面核对。', confidence: .96, pageType: 'exercise', questions: [question], action: null, needsHuman: true, done: false }
  const questions = { ...sample, agent: { ...sample.agent, phase: 'awaiting_confirmation', observation: { ...observation, pageType: 'exercise', screenshot: questionImage }, videos: [], decision, pending: { id: 'visual-confirm', kind: 'answers', explanation: '请对照右侧原题截图，核对题干、选项和答案建议。', observationId: observation.id, questions: [question] }, message: '已完成题目分析，等待你核对答案建议。' } }
  await publish(questions)
  await view('AI 题目分析')
  await capture('14-question-confirmation')
  const quick = { ...questions, agent: { ...questions.agent, mode: 'analysis', taskId: null, requestCount: 1, retryCount: 0 } }
  await publish(quick)
  await capture('14b-quick-analysis')
  assert.equal(await page.getByRole('button', { name: '停止当前任务', exact: true }).isVisible(), true, 'Quick analysis must remain controllable without a task')
  await publish({ ...quick, agent: { ...quick.agent, phase: 'thinking', pending: null, decision: null, modelRequestStartedAt: Date.now() - 10000, message: '服务已响应，正在接收并校验分析结果…' } })
  await capture('14c-quick-waiting')
  await publish(questions)

  await page.getByRole('button', { name: '放大分析截图', exact: true }).click()
  await imageDialog.waitFor()
  assert.equal(await imageDialog.locator('img').getAttribute('src'), questionImage)
  await page.keyboard.press('Escape')
  await imageDialog.waitFor({ state: 'hidden' })
  await page.locator('.question-explanation').scrollIntoViewIfNeeded()
  await capture('15-question-explanation')
  await view('学习工作台')
  await capture('16-workspace-awaiting-confirmation')
  await publish({ ...sample, agent: { ...sample.agent, phase: 'error', endedAt: Date.now(), message: '模型请求超时。请检查网络连接，或在模型设置中调整请求超时后重试。' } })
  await capture('17-workspace-error')

  await publish(original)
  await view('模型与设置')
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1100, 720))
  await page.getByRole('button', { name: 'Kimi', exact: true }).click()
  await capture('18-model-compact')
  const primary = await page.getByRole('button', { name: '使用此配置', exact: true }).boundingBox()
  const height = await page.evaluate(() => innerHeight)
  assert.ok(primary && primary.y + primary.height <= height, 'Primary model action must be visible without scrolling at minimum size')
  await view('学习工作台')
  await capture('19-workspace-compact')
  await page.getByRole('button', { name: '新建任务', exact: true }).click()
  await capture('20-new-task-compact')
  await page.keyboard.press('Escape')
  await page.getByRole('dialog').waitFor({ state: 'hidden' })
  await publish(questions)
  await view('AI 题目分析')
  await capture('21-question-compact')
  assert.deepEqual(errors, [], `Renderer errors: ${errors.join('; ')}`)
  await writeFile(resolve(output, 'review.json'), JSON.stringify({ fixturesOnly: true, screenshots: review, assertions: ['No horizontal overflow in every captured state', 'All local provider icons and screenshots loaded', 'Foreground dialog makes background inert and restores focus', 'Invalid task errors appear in the dialog', 'Browser and question screenshots open in a viewer with original dimensions', 'All six vendor selections render', 'Active task locks model editing', 'View changes reset scroll position', 'Minimum window keeps model action visible', 'No renderer exceptions'] }, null, 2))
  console.log(`PASS visual review: ${review.length} real Electron screenshots, isolated fixtures, zero horizontal overflow, valid images, navigation and minimum-window checks.`)
} finally {
  if (browser) await browser.close()
  if (app) await app.close()
  await rm(profile, { recursive: true, force: true })
}
