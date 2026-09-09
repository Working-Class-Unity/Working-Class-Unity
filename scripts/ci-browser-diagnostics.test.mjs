import assert from 'node:assert/strict'
import fs from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { createOutputMonitor, reportBrowserDiagnostics, scanArtifactTree } from './ci-browser-diagnostics.mjs'

test('aggregate refusal identifies the budget and withholds unverified output', (context) => {
  const directory = fixture(context)
  const monitor = createOutputMonitor('Playwright', ['registered-secret'])
  monitor.consume('assertion details with an unregistered-secret')
  const output = context.mock.method(console, 'error', () => {})
  // Match #104: 35 individually small files totaling 19,435,086 bytes.
  for (let index = 0; index < 35; index++) {
    fs.writeFileSync(join(directory, `private-name-${index}`), Buffer.alloc(index === 34 ? 555_294 : 555_288))
  }
  let safe = false
  assert.throws(() => {
    scanArtifactTree(directory, monitor)
    safe = true
  }, /aggregate-budget.*16777216/)
  reportBrowserDiagnostics([monitor], safe)
  const diagnostic = output.mock.calls.flatMap((call) => call.arguments).join('\n')
  assert.match(diagnostic, /withheld/)
  assert.doesNotMatch(diagnostic, /assertion details|unregistered-secret/)
})

test('filesystem refusal distinguishes the operation without exposing private error details', (context) => {
  const directory = fixture(context)
  fs.writeFileSync(join(directory, 'private-name'), 'artifact')
  const monitor = createOutputMonitor('Playwright', ['registered-secret'])
  // Inject I/O errors because permissions are platform/user dependent and races are nondeterministic.
  for (const [method, reason] of [
    ['statSync', 'stat'],
    ['readFileSync', 'file-read']
  ]) {
    const operation = context.mock.method(fs, method, () => {
      throw new Error(`private-name private-token ${directory}`)
    })
    try {
      assert.throws(
        () => scanArtifactTree(directory, monitor),
        (error) => {
          assert.match(error.message, new RegExp(`failed closed: ${reason}`))
          assert.doesNotMatch(error.message, /private-name|private-token/)
          assert(!error.message.includes(directory))
          assert.equal(error.cause, undefined)
          return true
        }
      )
    } finally {
      operation.mock.restore()
    }
  }
})

test('artifact secrets still reject the run and late-registered output is redacted', (context) => {
  const directory = fixture(context)
  const monitor = createOutputMonitor('Playwright', ['artifact-secret'])
  monitor.consume('assertion failed for late-')
  monitor.consume('registered-secret')
  monitor.registerForbidden(['late-registered-secret'])
  const artifactMonitor = createOutputMonitor('Playwright', ['artifact-secret'])
  fs.writeFileSync(join(directory, 'error-context.md'), 'artifact-secret')
  scanArtifactTree(directory, artifactMonitor)
  assert.throws(() => artifactMonitor.assertNoForbidden(), /forbidden private value/)
  assert.throws(() => monitor.assertNoForbidden(), /forbidden private value/)
  const output = context.mock.method(console, 'error', () => {})
  reportBrowserDiagnostics([monitor, artifactMonitor], true)
  const diagnostic = output.mock.calls.flatMap((call) => call.arguments).join('\n')
  assert.match(diagnostic, /assertion failed for \[redacted\]/)
  assert.doesNotMatch(diagnostic, /artifact-secret|late-registered-secret/)
})

function fixture(context) {
  const directory = fs.mkdtempSync(join(tmpdir(), 'swl-browser-diagnostics-'))
  context.after(() => fs.rmSync(directory, { recursive: true, force: true }))
  return directory
}
