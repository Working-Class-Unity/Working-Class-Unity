import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseEnv } from 'node:util'
import { evaluateRuntimeEnvironment, type RuntimeConfigIssue } from '../server/utils/runtime'

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
const platformIssues = validatePlatformEnvironment(environment)
const issues = [...platformIssues, ...evaluation.issues]

console.log('\nBuild and platform controls')
printIssues(platformIssues, platformIssues.length ? 'invalid' : 'ok', 'NODE_ENV and NITRO_PRESET are configured')

console.log('\nApp runtime')
printIssues(evaluation.issues, evaluation.issues.length ? 'invalid' : 'ok', 'runtime config is complete')

console.log('\nOptional build-only Sentry controls')
const sentryUploadKeys = ['SENTRY_AUTH_TOKEN', 'SENTRY_ORG', 'SENTRY_PROJECT'] as const
const configuredSentryUploadKeys = sentryUploadKeys.filter((name) => hasExactValue(environment[name]))
if (configuredSentryUploadKeys.length === sentryUploadKeys.length) {
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
