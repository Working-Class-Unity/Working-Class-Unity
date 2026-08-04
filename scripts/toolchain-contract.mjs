import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const SUPPORTED_NODE_MAJOR = 24
const MINIMUM_NODE_MINOR = 11
const SUPPORTED_NODE_RANGE = '>=24.11.0 <25.0.0'
const EXPECTED_PNPM_VERSION = '11.1.2'
const EXPECTED_NODE_TYPES_VERSION = '24.13.3'

const exactPnpmPattern = /^pnpm@(\d+\.\d+\.\d+)$/

export function parsePnpmVersion(packageManager) {
  const match = exactPnpmPattern.exec(packageManager ?? '')

  if (!match) {
    throw new Error('packageManager must be an exact pnpm version, for example pnpm@11.1.2')
  }

  return match[1]
}

export function assertSupportedNode(version = process.versions.node) {
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(version)
  const major = Number.parseInt(match?.[1] ?? '', 10)
  const minor = Number.parseInt(match?.[2] ?? '', 10)

  if (major !== SUPPORTED_NODE_MAJOR || minor < MINIMUM_NODE_MINOR) {
    throw new Error(`Node.js ${SUPPORTED_NODE_RANGE} is required; current version is ${version}`)
  }
}

export function readManifestContract(root) {
  const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
  const pnpmVersion = parsePnpmVersion(manifest.packageManager)
  const errors = []

  if (manifest.engines?.node !== SUPPORTED_NODE_RANGE) {
    errors.push(`engines.node must be ${SUPPORTED_NODE_RANGE}`)
  }

  if (manifest.engines?.pnpm !== pnpmVersion) {
    errors.push(`engines.pnpm must match packageManager (${pnpmVersion})`)
  }

  if (pnpmVersion !== EXPECTED_PNPM_VERSION) {
    errors.push(`pnpm must remain pinned to ${EXPECTED_PNPM_VERSION}`)
  }

  if (errors.length) {
    throw new Error(errors.join('\n'))
  }

  return { manifest, pnpmVersion }
}

export function buildNpmExecArgs(pnpmVersion, pnpmArgs) {
  return ['exec', '--yes', `--package=pnpm@${pnpmVersion}`, '--', 'pnpm', ...pnpmArgs]
}

export function validateRepositoryDeclarations(root) {
  const errors = []
  let manifest
  let pnpmVersion

  try {
    ;({ manifest, pnpmVersion } = readManifestContract(root))
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error))
  }

  const nvmVersion = readFileSync(join(root, '.nvmrc'), 'utf8').trim()
  if (nvmVersion !== String(SUPPORTED_NODE_MAJOR)) {
    errors.push(`.nvmrc must declare Node ${SUPPORTED_NODE_MAJOR}`)
  }

  const dockerfile = readFileSync(join(root, 'Dockerfile'), 'utf8')
  const dockerTags = [...dockerfile.matchAll(/^FROM node:([^\s]+)(?:\s+AS\s+\S+)?$/gim)].map((match) => match[1])

  if (dockerTags.length === 0) {
    errors.push('Dockerfile must declare at least one Node stage')
  }

  for (const tag of dockerTags) {
    if (tag !== `${SUPPORTED_NODE_MAJOR}-bookworm-slim`) {
      errors.push(`Docker Node tag must be ${SUPPORTED_NODE_MAJOR}-bookworm-slim; found ${tag}`)
    }
  }

  if (/\bcorepack\b/i.test(dockerfile)) {
    errors.push('Dockerfile must not require Corepack')
  }

  if (!dockerfile.includes('RUN npm run bootstrap')) {
    errors.push('Dockerfile dependency stage must use npm run bootstrap')
  }

  if (!dockerfile.includes('npm run pnpm -- run build')) {
    errors.push('Dockerfile build stage must use the pinned pnpm runner')
  }

  if (manifest) {
    if (manifest.scripts?.bootstrap !== 'node scripts/run-pnpm.mjs install --frozen-lockfile') {
      errors.push('bootstrap must perform a frozen install through the pinned pnpm runner')
    }

    if (manifest.scripts?.pnpm !== 'node scripts/run-pnpm.mjs') {
      errors.push('pnpm script must expose the portable pinned pnpm runner')
    }

    if (manifest.scripts?.['verify:pinned'] !== 'node scripts/run-pnpm.mjs run verify') {
      errors.push('verify:pinned must run verify through the pinned pnpm runner')
    }

    if (manifest.engines?.pnpm !== pnpmVersion) {
      errors.push('pnpm engine and packageManager declarations must agree')
    }
  }

  const webManifest = JSON.parse(readFileSync(join(root, 'apps/web/package.json'), 'utf8'))
  if (webManifest.engines?.node !== SUPPORTED_NODE_RANGE) {
    errors.push(`apps/web engines.node must be ${SUPPORTED_NODE_RANGE}`)
  }

  if (webManifest.devDependencies?.['@types/node'] !== EXPECTED_NODE_TYPES_VERSION) {
    errors.push(`@types/node must be pinned to ${EXPECTED_NODE_TYPES_VERSION}`)
  }

  const workspace = readFileSync(join(root, 'pnpm-workspace.yaml'), 'utf8')
  const nodeTypesOverride = workspace.match(/^\s*['"]?@types\/node['"]?:\s*(\d+\.\d+\.\d+)\s*$/m)?.[1]
  if (nodeTypesOverride !== EXPECTED_NODE_TYPES_VERSION) {
    errors.push(`pnpm override for @types/node must be ${EXPECTED_NODE_TYPES_VERSION}`)
  }

  return errors
}
