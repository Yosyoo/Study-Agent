import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { assertNativeTarget, stageBrowser } from './stage-browser.mjs'

const projectRoot = fileURLToPath(new URL('../', import.meta.url))
const require = createRequire(import.meta.url)

async function main() {
  assertNativeTarget()
  const args = process.argv.slice(2)
  if (args.length !== 1 || !['--dir', '--mac', '--win'].includes(args[0])) {
    throw new Error('仅支持 --dir、--mac 或 --win 单一打包模式，不接受跨平台或跨架构参数。')
  }
  const mode = args[0]
  if ((mode === '--mac' && process.platform !== 'darwin') || (mode === '--win' && process.platform !== 'win32')) {
    throw new Error('打包目标必须与当前操作系统一致；请在对应的 macOS 或 Windows 构建机器上运行。')
  }
  await stageBrowser()
  const platformFlag = process.platform === 'darwin' ? '--mac' : '--win'
  const buildArgs = [platformFlag, `--${process.arch}`, ...(mode === '--dir' ? ['--dir'] : []), '--publish', 'never']
  const result = spawnSync(process.execPath, [require.resolve('electron-builder/cli.js'), ...buildArgs], {
    cwd: projectRoot, stdio: 'inherit',
    env: { ...process.env, CSC_IDENTITY_AUTO_DISCOVERY: process.env.CSC_IDENTITY_AUTO_DISCOVERY ?? 'false' },
  })
  if (result.error) throw new Error(`无法启动 electron-builder：${result.error.message}`)
  if (result.status !== 0) throw new Error(`electron-builder 未完成（退出码 ${result.status ?? result.signal ?? '未知'}）。`)
}

main().catch(error => { process.stderr.write(`${error instanceof Error ? error.message : '打包失败'}\n`); process.exitCode = 1 })
