export function testCaseRejection(testCase) {
  const name = testCase.fullName ?? testCase.name ?? 'unknown test'
  if (testCase.options.mode !== 'run') {
    return `${name} uses forbidden mode ${String(testCase.options.mode)}`
  }
  if (testCase.options.fails === true) {
    return `${name} is marked as an expected failure`
  }

  const state = testCase.result?.()?.state
  if (state !== 'passed') {
    return `${name} finished with ${String(state)}`
  }
}

export default class VitestPolicyReporter {
  onTestRunEnd(testModules) {
    const rejections = new Set()
    for (const testModule of testModules) {
      for (const testCase of testModule.children.allTests()) {
        const rejection = testCaseRejection(testCase)
        if (rejection) rejections.add(rejection)
      }
    }
    if (rejections.size) {
      throw new Error(`Vitest policy rejected:\n${[...rejections].toSorted().join('\n')}`)
    }
  }
}
