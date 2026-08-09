import { fileURLToPath } from 'node:url'
import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vitest/config'

const policyReporter = fileURLToPath(new URL('./scripts/vitest-policy-reporter.mjs', import.meta.url))

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '#shared': fileURLToPath(new URL('./shared/', import.meta.url))
    }
  },
  test: {
    allowOnly: false,
    include: ['tests/**/*.test.ts'],
    passWithNoTests: false,
    reporters: ['default', policyReporter]
  }
})
