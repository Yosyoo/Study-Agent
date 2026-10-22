// Render the code-native application mark. electron-builder converts this PNG
// to the native macOS/Windows icon format during each platform's build.
import { chromium } from 'playwright'
import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const browser = await chromium.launch({ headless: true })
try {
  const page = await browser.newPage({ viewport: { width: 1024, height: 1024 }, deviceScaleFactor: 1 })
  const svg = await readFile(resolve(root, 'build/icon.svg'), 'utf8')
  await page.setContent(`<style>body{margin:0}svg{display:block}</style>${svg}`)
  await page.screenshot({ path: resolve(root, 'build/icon.png'), omitBackground: true })
} finally {
  await browser.close()
}
