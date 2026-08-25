export type PublicErrorInput = {
  status?: number
  statusCode?: number
}

export type PublicErrorPresentation = {
  statusCode: number
  kind: 'notFound' | 'unexpected'
}

export function resolvePublicErrorPresentation(error: PublicErrorInput): PublicErrorPresentation {
  const statusCode = error.statusCode || error.status || 500

  if (statusCode === 404) {
    return {
      statusCode,
      kind: 'notFound'
    }
  }

  return {
    statusCode,
    kind: 'unexpected'
  }
}
