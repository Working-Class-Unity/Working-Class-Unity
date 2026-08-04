import Database from 'better-sqlite3'
import { createHash, timingSafeEqual } from 'node:crypto'
import { moduleManifest, runtimeModuleIds } from '../../shared/modules'
import { resolveSqlitePath } from '../db/connect'
import { getModuleState } from './module-state'
import type { AppRuntimeConfig } from './runtime'

const bearerPrefix = 'Bearer '
const sqliteBusyTimeoutMs = 1_000

export const readinessUnauthorizedResponse = Object.freeze({
  status: 'unauthorized',
  code: 'READINESS_AUTH_REQUIRED'
} as const)

export const readinessReadyResponse = Object.freeze({ status: 'ready' } as const)

export const readinessUnavailableResponse = Object.freeze({
  status: 'not_ready',
  code: 'SERVICE_NOT_READY'
} as const)

export type ReadinessEvaluation =
  typeof readinessUnauthorizedResponse | typeof readinessReadyResponse | typeof readinessUnavailableResponse

type DatabaseProbe = (databaseUrl: string) => boolean

/**
 * App-owned readiness policy: authenticate the private probe before touching a
 * dependency, treat manifest-defined disabled/ready module states as healthy,
 * and avoid calling optional providers from the request path.
 */
export function evaluateReadiness(
  authorization: string | undefined,
  config: AppRuntimeConfig,
  probeDatabase: DatabaseProbe = probeSqliteReadiness
): ReadinessEvaluation {
  if (!isReadinessAuthorizationValid(authorization, config.readinessToken)) {
    return readinessUnauthorizedResponse
  }

  if (!areRuntimeModulesHealthy(config) || !probeDatabase(config.databaseUrl)) {
    return readinessUnavailableResponse
  }

  return readinessReadyResponse
}

/**
 * SHA-256 normalizes both inputs to equal-length buffers before Node's
 * constant-time comparison. The exact prefix also rejects alternate schemes,
 * casing, or whitespace without parsing a more permissive credential grammar.
 */
export function isReadinessAuthorizationValid(authorization: string | undefined, expectedToken: string): boolean {
  if (!authorization?.startsWith(bearerPrefix) || !expectedToken) return false

  const presentedToken = authorization.slice(bearerPrefix.length)
  const presentedDigest = createHash('sha256').update(presentedToken, 'utf8').digest()
  const expectedDigest = createHash('sha256').update(expectedToken, 'utf8').digest()

  return timingSafeEqual(presentedDigest, expectedDigest)
}

export function areRuntimeModulesHealthy(config: AppRuntimeConfig): boolean {
  return runtimeModuleIds.every((moduleId) => {
    const state = getModuleState(moduleId, config)
    return moduleManifest[moduleId].health[state] === 'healthy'
  })
}

/**
 * Open a fresh read-only connection for every probe. This prevents readiness
 * from succeeding only because the app's cached connection remains reachable,
 * and it guarantees the probe cannot create or mutate the configured database.
 */
export function probeSqliteReadiness(databaseUrl: string): boolean {
  let connection: InstanceType<typeof Database> | undefined
  let ready: boolean

  try {
    connection = new Database(resolveSqlitePath(databaseUrl), {
      readonly: true,
      timeout: sqliteBusyTimeoutMs
    })
    const row = connection.prepare('select 1 as ok').get() as { ok?: unknown } | undefined
    ready = row?.ok === 1
  } catch {
    ready = false
  }

  if (connection) {
    try {
      connection.close()
    } catch {
      ready = false
    }
  }

  return ready
}
