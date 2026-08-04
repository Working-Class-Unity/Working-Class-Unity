import { randomUUID } from 'node:crypto'
import { resolveCaptureDiagnostic, type CaptureDiagnosticCode } from '../../../shared/sentry-privacy'
import { isModuleReady } from '../../utils/module-state'

export type { CaptureDiagnosticCode } from '../../../shared/sentry-privacy'

export async function captureException(error: unknown, code: CaptureDiagnosticCode) {
  const diagnostic = resolveCaptureDiagnostic(code)
  const correlationId = randomUUID()
  const safeMetadata = {
    ...diagnostic,
    correlationId
  }

  console.error(
    JSON.stringify({
      event: 'application-error',
      ...safeMetadata
    })
  )

  if (!isModuleReady('observability')) return

  try {
    const Sentry = await import('@sentry/nuxt')
    Sentry.captureException(error, { tags: safeMetadata })
  } catch {
    // Keep local development independent from observability configuration.
  }
}
