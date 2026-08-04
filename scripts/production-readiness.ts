import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseEnv } from 'node:util'
import { moduleManifest, runtimeModuleIds } from '../apps/web/shared/modules'
import {
  evaluateModuleStates,
  evaluateRuntimeEnvironment,
  type RuntimeConfigIssue
} from '../apps/web/server/utils/runtime'

const args = new Set(process.argv.slice(2))
const repositoryRoot = fileURLToPath(new URL('../', import.meta.url))
const strict = args.has('--strict')
const envFileArg = process.argv.find((arg) => arg.startsWith('--env-file='))
const envFile = envFileArg?.slice('--env-file='.length) ?? '.env.production'
const environment = {
  ...readEnvFile(envFile),
  ...process.env
}
const evaluation = evaluateRuntimeEnvironment(environment)
const moduleStates = evaluateModuleStates(evaluation)
const platformIssues = validatePlatformEnvironment(environment)
const issues = [
  ...platformIssues,
  ...evaluation.coreIssues,
  ...runtimeModuleIds.flatMap((moduleId) => evaluation.moduleIssues[moduleId])
]

console.log('\nBuild and platform controls')
printIssues(platformIssues, platformIssues.length ? 'invalid' : 'ok', 'NODE_ENV and NITRO_PRESET are configured')

console.log('\nApp runtime core')
printIssues(evaluation.coreIssues, evaluation.coreIssues.length ? 'invalid' : 'ok', 'core runtime config is complete')

for (const moduleId of runtimeModuleIds) {
  console.log(`\n${moduleManifest[moduleId].label} runtime module`)
  const moduleIssues = evaluation.moduleIssues[moduleId]
  if (moduleStates[moduleId] === 'incomplete' && moduleIssues.length) {
    printIssues(moduleIssues, 'invalid', '')
  } else if (moduleStates[moduleId] === 'incomplete') {
    console.log('[invalid] enabled module state could not be normalized')
  } else if (moduleStates[moduleId] === 'ready') {
    console.log('[ok] ready (enabled and configuration-complete)')
  } else {
    console.log('[ok] disabled (healthy; provider calls and module mutations are gated)')
  }
}

console.log('\nOptional build-only Sentry controls')
const sentryUploadKeys = ['SENTRY_AUTH_TOKEN', 'SENTRY_ORG', 'SENTRY_PROJECT'] as const
const configuredSentryUploadKeys = sentryUploadKeys.filter((name) => hasExactValue(environment[name]))
if (environment.NUXT_MODULES_OBSERVABILITY_ENABLED !== 'true') {
  console.log('[optional] inactive because Observability is disabled; no source maps will be generated')
} else if (configuredSentryUploadKeys.length === sentryUploadKeys.length) {
  console.log('[ok] complete token/organization/project tuple; client source-map upload is eligible')
} else if (configuredSentryUploadKeys.length) {
  console.log('[attention] incomplete token/organization/project tuple; no source maps will be generated')
} else {
  console.log('[optional] upload not configured; no source maps will be generated')
}
for (const name of ['SENTRY_RELEASE', 'SENTRY_URL', 'SENTRY_UPLOAD_CACHE_BUST']) {
  console.log(`${hasExactValue(environment[name]) ? '[ok] configured' : '[optional] not configured'}: ${name}`)
}

if (issues.length) {
  console.log(`\nProduction readiness: ${issues.length} required checks need attention.`)
  if (strict) process.exit(1)
} else {
  console.log('\nProduction readiness: required environment contract is satisfied.')
}

function validatePlatformEnvironment(source: Record<string, string | undefined>): RuntimeConfigIssue[] {
  const platformIssues: RuntimeConfigIssue[] = []
  if (source.NODE_ENV !== 'production') {
    platformIssues.push({ code: 'invalid', key: 'NODE_ENV', message: 'must be production' })
  }
  if (source.NITRO_PRESET !== 'node-server') {
    platformIssues.push({ code: 'invalid', key: 'NITRO_PRESET', message: 'must be node-server at build time' })
  }
  return platformIssues
}

function printIssues(selectedIssues: readonly RuntimeConfigIssue[], status: 'invalid' | 'ok', successMessage: string) {
  if (!selectedIssues.length) {
    console.log(`[${status}] ${successMessage}`)
    return
  }
  for (const issue of selectedIssues) console.log(`[invalid] ${issue.key}: ${issue.message}`)
}

function readEnvFile(file: string): Record<string, string> {
  const path = resolve(repositoryRoot, file)
  if (!existsSync(path)) return {}
  return parseEnv(readFileSync(path, 'utf8'))
}

function hasExactValue(value: string | undefined): boolean {
  return Boolean(value && value === value.trim())
}
