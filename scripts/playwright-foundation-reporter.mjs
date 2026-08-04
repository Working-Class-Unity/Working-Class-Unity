const acceptedStatus = 'passed'
const acceptedOutcome = 'expected'

export function resultRejection(result) {
  if (
    result.status === acceptedStatus &&
    result.expectedStatus === acceptedStatus &&
    result.outcome === acceptedOutcome
  ) {
    return undefined
  }
  return `${result.title} [${result.status}/${result.outcome}/${result.expectedStatus}]`
}

export default class FoundationCompletionReporter {
  discoveredCount = 0
  rejected = []

  onBegin(_config, suite) {
    this.discoveredCount = suite.allTests().length
  }

  onTestEnd(test, result) {
    const rejection = resultRejection({
      expectedStatus: test.expectedStatus,
      outcome: test.outcome(),
      status: result.status,
      title: test.titlePath().join(' > ')
    })
    if (rejection) this.rejected.push(rejection)
  }

  onEnd(fullResult) {
    const errors = []
    if (this.discoveredCount === 0) {
      errors.push('expected at least one discovered test, received 0')
    }
    if (this.rejected.length) {
      errors.push(`rejected results: ${this.rejected.join(', ')}`)
    }
    if (fullResult.status !== acceptedStatus) {
      errors.push(`Playwright ended with ${fullResult.status}`)
    }

    if (errors.length) {
      console.error(`Foundation browser policy failed: ${errors.join('; ')}`)
      return { status: 'failed' }
    }

    console.log(`Foundation browser policy passed: ${this.discoveredCount} discovered, 0 rejected.`)
  }
}
