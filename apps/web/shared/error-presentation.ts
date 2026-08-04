import { moduleDisabledCode } from './module-states'

export type PublicErrorInput = {
  status?: number
  statusCode?: number
  data?: unknown
}

export type PublicErrorPresentation = {
  statusCode: number
  kind: 'moduleUnavailable' | 'notFound' | 'unexpected'
  showModuleCode: boolean
}

export function resolvePublicErrorPresentation(error: PublicErrorInput): PublicErrorPresentation {
  const statusCode = error.statusCode || error.status || 500
  const showModuleCode = isRecord(error.data) && error.data.code === moduleDisabledCode

  if (showModuleCode) {
    return {
      statusCode,
      kind: 'moduleUnavailable',
      showModuleCode
    }
  }

  if (statusCode === 404) {
    return {
      statusCode,
      kind: 'notFound',
      showModuleCode
    }
  }

  return {
    statusCode,
    kind: 'unexpected',
    showModuleCode
  }
}

function isRecord(value: unknown): value is Record<PropertyKey, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
