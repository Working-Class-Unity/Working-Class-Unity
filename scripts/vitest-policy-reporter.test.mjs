import assert from 'node:assert/strict'
import { test } from 'node:test'
import VitestPolicyReporter, { testCaseRejection } from './vitest-policy-reporter.mjs'

const passed = {
  fullName: 'passes',
  options: { fails: false, mode: 'run' },
  result: () => ({ state: 'passed' })
}

test('ordinary Vitest rejects skipped, todo, expected-failure, and nonpassing cases', () => {
  assert.equal(testCaseRejection(passed), undefined)
  for (const [testCase, expected] of [
    [{ ...passed, options: { mode: 'skip' } }, /forbidden mode skip/],
    [{ ...passed, options: { mode: 'todo' } }, /forbidden mode todo/],
    [{ ...passed, options: { fails: true, mode: 'run' } }, /expected failure/],
    [{ ...passed, result: () => undefined }, /finished with undefined/],
    [{ ...passed, result: () => ({ state: 'failed' }) }, /finished with failed/]
  ]) {
    assert.match(testCaseRejection(testCase), expected)
  }

  const reporter = new VitestPolicyReporter()
  const module = { children: { allTests: () => [passed, { ...passed, options: { mode: 'skip' } }] } }
  assert.throws(() => reporter.onTestRunEnd([module]), /Vitest policy rejected:[\s\S]*forbidden mode skip/)
})
