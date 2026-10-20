import { defineConfig } from 'vitest/config'
export default defineConfig({ test: { include: ['tests/**/*.test.ts'], exclude: ['tests/**/*.browser.test.ts'], environment: 'node', testTimeout: 15000 } })
