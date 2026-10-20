import { defineConfig } from 'vitest/config'
export default defineConfig({ test: { include: ['tests/**/*.browser.test.ts'], environment: 'node', testTimeout: 30000, hookTimeout: 30000, fileParallelism: false } })
