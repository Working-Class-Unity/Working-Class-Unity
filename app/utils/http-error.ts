export function responseStatus(error: unknown): number | undefined {
  if (!error || typeof error !== 'object') return undefined

  if ('statusCode' in error && typeof error.statusCode === 'number') {
    return error.statusCode
  }

  if ('status' in error && typeof error.status === 'number') {
    return error.status
  }

  if ('response' in error && error.response && typeof error.response === 'object') {
    const response = error.response
    if ('status' in response && typeof response.status === 'number') {
      return response.status
    }
  }

  return undefined
}
