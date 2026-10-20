import { constants } from 'node:fs'
import { access, cp, mkdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { chromium } from 'playwright'

const projectRoot = fileURLToPath(new URL('../', import.meta.url))

export function assertNativeTarget(platform = process.platform, arch = process.arch) {
  const supported = (platform === 'darwin' && ['arm64', 'x64'].includes(arch)) || (platform === 'win32' && arch === 'x64')
  if (!supported) throw new Error(`不支持从 ${platform}/${arch} 打包。请在 macOS arm64、macOS x64 或 Windows x64 目标机器上构建。`)
  if (platform !== process.platform || arch !== process.arch) throw new Error('浏览器运行时必须与构建机器的平台和架构一致；请在对应目标机器上构建。')
}

/** Copies only Playwright's downloaded Chromium distribution, never a browser profile. */
export async function stageBrowser() {
  assertNativeTarget()
  const executable = resolve(chromium.executablePath())
  try {
    await access(executable, constants.F_OK)
    if (!(await stat(executable)).isFile()) throw new Error('not a file')
  } catch { throw new Error('未找到已安装的 Playwright Chromium。请先运行 npm run browser:install。') }

  let browserRoot = dirname(executable)
  while (!/^chromium-\d+$/.test(basename(browserRoot))) {
    const parent = dirname(browserRoot)
    if (parent === browserRoot) throw new Error('无法确认 Playwright Chromium 分发目录，已取消打包。')
    browserRoot = parent
  }
  const executableWithinBrowser = relative(browserRoot, executable)
  if (!executableWithinBrowser || isAbsolute(executableWithinBrowser) || executableWithinBrowser.startsWith('..')) throw new Error('浏览器可执行文件路径无效。')

  const localRoot = join(projectRoot, '.local')
  const destination = join(localRoot, 'browser-runtime')
  const staging = join(localRoot, `browser-runtime-staging-${process.pid}`)
  const distributionName = basename(browserRoot)
  await mkdir(localRoot, { recursive: true })
  await rm(staging, { recursive: true, force: true })
  try {
    // Preserve framework/app symlinks exactly; rewriting them can point a packaged
    // app back into the developer's cache or invalidate its browser bundle.
    await cp(browserRoot, join(staging, distributionName), { recursive: true, verbatimSymlinks: true })
    const manifest = { platform: process.platform, arch: process.arch, executable: `${distributionName}/${executableWithinBrowser.split('\\').join('/')}` }
    await writeFile(join(staging, 'study-runtime.json'), `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o644 })
    await rm(destination, { recursive: true, force: true })
    await rename(staging, destination)
    process.stdout.write(`已准备 Chromium 运行时：${manifest.platform}/${manifest.arch} (${distributionName})\n`)
    return destination
  } catch (error) {
    await rm(staging, { recursive: true, force: true })
    throw error
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  stageBrowser().catch(error => { process.stderr.write(`${error instanceof Error ? error.message : '准备浏览器失败'}\n`); process.exitCode = 1 })
}
