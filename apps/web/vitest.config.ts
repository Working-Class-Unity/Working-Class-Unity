import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

const policyReporter = fileURLToPath(new URL('../../scripts/vitest-policy-reporter.mjs', import.meta.url))

export default defineConfig({
  resolve: {
    alias: {
      '#shared': fileURLToPath(new URL('./shared/', import.meta.url))
    }
  },
  test: {
    allowOnly: false,
    passWithNoTests: false,
    reporters: ['default', policyReporter]
  }
})
