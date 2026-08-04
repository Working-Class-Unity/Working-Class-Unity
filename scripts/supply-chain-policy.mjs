import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { inspectPnpmLockfile } from './pnpm-lock-preinstall.mjs'

export const INSTALLABLE_DEPENDENCY_SECTIONS = ['dependencies', 'devDependencies', 'optionalDependencies']

export const POLICY_PATH = 'security/supply-chain-policy.json'

const exactSemverPattern =
  /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/
const ghsaPattern = /^GHSA-[23456789cfghjmpqrvwx]{4}-[23456789cfghjmpqrvwx]{4}-[23456789cfghjmpqrvwx]{4}$/i
const sha256Pattern = /^[a-f0-9]{64}$/
const commitPattern = /^[a-f0-9]{40}$/
const datePattern = /^\d{4}-\d{2}-\d{2}$/
const prohibitedScannerFiles = new Set(['.gitleaks.toml', 'gitleaks-baseline.json', 'osv-scanner.toml'])
const approvedScanners = {
  osv: {
    name: 'OSV-Scanner',
    repository: 'google/osv-scanner',
    assetKind: 'binary'
  },
  gitleaks: {
    name: 'Gitleaks',
    repository: 'gitleaks/gitleaks',
    assetKind: 'tar.gz',
    binaryName: 'gitleaks'
  }
}

export function loadSupplyChainPolicy(root) {
  return JSON.parse(readFileSync(join(root, POLICY_PATH), 'utf8'))
}

export function listTrackedFiles(root, pattern = null) {
  const args = ['ls-files', '-z']
  if (pattern) {
    args.push('--', pattern)
  }
  const result = spawnSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024
  })

  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || `git ${args.join(' ')} failed with exit ${result.status}`)
  }

  return result.stdout
    .split('\0')
    .filter(Boolean)
    .sort((left, right) => left.localeCompare(right))
}

export function readTrackedManifests(root) {
  return listTrackedFiles(root, '*package.json').map((path) => ({
    path,
    manifest: JSON.parse(readFileSync(join(root, path), 'utf8'))
  }))
}

export function validatePreinstallRepository(root, policy, options = {}) {
  const manifests = options.manifests ?? readTrackedManifests(root)
  const trackedFiles = options.trackedFiles ?? listTrackedFiles(root)
  const lockSource = options.lockSource ?? readFileSync(join(root, 'pnpm-lock.yaml'), 'utf8')
  return [
    ...validatePolicy(policy, options),
    ...validateManifestVersions(manifests),
    ...validateScannerBypassFiles(trackedFiles),
    ...inspectPnpmLockfile(lockSource, manifests).errors
  ]
}

export function validatePolicy(policy, { now = new Date() } = {}) {
  const errors = []

  if (!isRecord(policy) || policy.schemaVersion !== 1) {
    return ['supply-chain policy schemaVersion must be 1']
  }

  if (
    !Number.isInteger(policy.maximumExceptionDays) ||
    policy.maximumExceptionDays < 1 ||
    policy.maximumExceptionDays > 45
  ) {
    errors.push('maximumExceptionDays must be an integer from 1 through 45')
  }

  errors.push(...validateScannerPins(policy.scanners))
  errors.push(...validateExceptions(policy.vulnerabilityExceptions, policy.maximumExceptionDays, now))
  return errors
}

export function validateManifestVersions(manifests) {
  const errors = []
  const localPackages = new Map()

  for (const { path, manifest } of manifests) {
    if (!isRecord(manifest)) {
      errors.push(`${path} must contain a JSON object`)
      continue
    }
    if (typeof manifest.name === 'string') {
      if (localPackages.has(manifest.name)) {
        errors.push('tracked package manifests must not declare duplicate package names')
      } else {
        localPackages.set(manifest.name, { path, version: manifest.version })
      }
    }
  }

  for (const { path, manifest } of manifests) {
    if (!isRecord(manifest)) {
      continue
    }

    for (const section of INSTALLABLE_DEPENDENCY_SECTIONS) {
      const dependencies = manifest[section]
      if (dependencies === undefined) {
        continue
      }
      if (!isRecord(dependencies)) {
        errors.push(`${path} ${section} must be a mapping`)
        continue
      }

      for (const [name, specifier] of Object.entries(dependencies)) {
        if (localPackages.has(name)) {
          const localVersion = localPackages.get(name).version
          if (!isExactSemver(localVersion) || specifier !== `workspace:${localVersion}`) {
            errors.push(`${path} ${section}.${name} must use workspace:<exact local version>`)
          }
        } else if (!isExactSemver(specifier)) {
          errors.push(`${path} ${section}.${name} must use an exact semantic version`)
        }
      }
    }
  }

  return errors
}

export function validateScannerBypassFiles(trackedFiles) {
  const errors = []

  for (const path of trackedFiles) {
    const basename = path.split('/').at(-1)
    if (prohibitedScannerFiles.has(basename)) {
      errors.push(`${path} is prohibited; scanner exceptions must use ${POLICY_PATH}`)
    }
  }

  return errors
}

export function validateLockfile(manifests, lockfile, workspace) {
  const errors = []
  const localPackages = new Map()

  for (const entry of manifests) {
    const name = entry?.manifest?.name
    if (typeof name !== 'string') continue
    if (localPackages.has(name)) {
      errors.push('tracked package manifests must not declare duplicate package names')
    } else {
      localPackages.set(name, entry)
    }
  }

  if (!isRecord(lockfile) || String(lockfile.lockfileVersion) !== '9.0') {
    return ['pnpm-lock.yaml must use lockfileVersion 9.0']
  }

  const importers = lockfile.importers
  if (!isRecord(importers)) {
    errors.push('pnpm-lock.yaml must contain importers')
  } else {
    const expectedImporterPaths = new Set()
    for (const { path, manifest } of manifests) {
      const importerPath = normalizeImporterPath(path)
      expectedImporterPaths.add(importerPath)
      const importer = importers[importerPath]
      if (!isRecord(importer)) {
        errors.push(`pnpm-lock.yaml is missing importer ${importerPath}`)
        continue
      }

      for (const section of INSTALLABLE_DEPENDENCY_SECTIONS) {
        const declared = isRecord(manifest[section]) ? manifest[section] : {}
        const locked = isRecord(importer[section]) ? importer[section] : {}
        const names = new Set([...Object.keys(declared), ...Object.keys(locked)])

        for (const name of [...names].sort((left, right) => left.localeCompare(right))) {
          if (!Object.hasOwn(declared, name)) {
            errors.push(`pnpm-lock.yaml importer ${importerPath} has undeclared ${section}.${name}`)
            continue
          }
          if (!Object.hasOwn(locked, name)) {
            errors.push(`pnpm-lock.yaml importer ${importerPath} is missing ${section}.${name}`)
            continue
          }
          if (!isRecord(locked[name]) || locked[name].specifier !== declared[name]) {
            errors.push(`pnpm-lock.yaml importer ${importerPath} ${section}.${name} must match ${declared[name]}`)
            continue
          }
          const lockedVersion = locked[name].version
          const declaredVersion = declared[name]
          const local = localPackages.get(name)
          const expectedLocalLink = local ? `link:${workspaceLinkTarget(path, local.path)}` : undefined
          const versionMatches = local
            ? lockedVersion === expectedLocalLink
            : lockedVersion === declaredVersion ||
              (typeof lockedVersion === 'string' && lockedVersion.startsWith(`${declaredVersion}(`))
          if (!versionMatches) {
            errors.push(
              `pnpm-lock.yaml importer ${importerPath} ${section}.${name} resolves ${String(lockedVersion)} instead of ${expectedLocalLink ?? declaredVersion}`
            )
          }
        }
      }
    }

    for (const importerPath of Object.keys(importers)) {
      if (!expectedImporterPaths.has(importerPath)) {
        errors.push(`pnpm-lock.yaml has importer without a tracked manifest: ${importerPath}`)
      }
    }
  }

  const packages = lockfile.packages
  if (!isRecord(packages) || Object.keys(packages).length === 0) {
    errors.push('pnpm-lock.yaml must contain resolved packages')
  } else {
    for (const [name, snapshot] of Object.entries(packages)) {
      const integrity = isRecord(snapshot) && isRecord(snapshot.resolution) ? snapshot.resolution.integrity : undefined
      if (typeof integrity !== 'string' || !isSha512Integrity(integrity)) {
        errors.push(`pnpm-lock.yaml package ${name} must have SHA-512 registry integrity`)
      }
      if (isRecord(snapshot?.resolution) && Object.hasOwn(snapshot.resolution, 'tarball')) {
        errors.push(`pnpm-lock.yaml package ${name} must not use a custom tarball resolution`)
      }
    }
  }

  if (!isRecord(workspace)) {
    errors.push('pnpm-workspace.yaml must parse to a mapping')
  } else if (workspace.overrides !== undefined) {
    if (!isRecord(workspace.overrides)) {
      errors.push('pnpm-workspace.yaml overrides must be a mapping')
    } else {
      for (const [name, version] of Object.entries(workspace.overrides)) {
        if (!isExactSemver(version) && !isExactParentScopedRemoval(name, version)) {
          errors.push(
            `pnpm-workspace.yaml override ${name} must use an exact semantic version or an exact parent-scoped dependency removal`
          )
        }
      }
    }
  }

  return errors
}

export function evaluateOsvReport(report, policy, { now = new Date(), expectedPackageCount } = {}) {
  const errors = [...validatePolicy(policy, { now })]
  const extraction = extractOsvReport(report)
  errors.push(...extraction.errors)

  if (Number.isInteger(expectedPackageCount) && extraction.packageCount !== expectedPackageCount) {
    errors.push(`OSV report must contain ${expectedPackageCount} package records; found ${extraction.packageCount}`)
  }

  const observed = new Map(extraction.findings.map((finding) => [finding.key, finding]))
  const matchedObserved = new Set()
  const matchedExceptions = new Set()

  for (const exception of policy.vulnerabilityExceptions ?? []) {
    for (const packageEntry of exception.packages ?? []) {
      for (const version of packageEntry.versions ?? []) {
        const exceptionKey = `${exception.id}\0${packageEntry.name}\0${version}`
        const candidates = extraction.findings.filter(
          (finding) =>
            finding.identifiers.has(exception.id) &&
            finding.packageName === packageEntry.name &&
            finding.version === version
        )

        if (candidates.length === 0) {
          errors.push(`stale vulnerability exception: ${exception.id} ${packageEntry.name}@${version}`)
          continue
        }
        if (candidates.length > 1) {
          errors.push(`ambiguous vulnerability exception: ${exception.id} ${packageEntry.name}@${version}`)
          continue
        }
        if (matchedObserved.has(candidates[0].key)) {
          errors.push(`duplicate vulnerability exception match: ${exception.id} ${packageEntry.name}@${version}`)
          continue
        }
        matchedObserved.add(candidates[0].key)
        matchedExceptions.add(exceptionKey)
      }
    }
  }

  for (const finding of observed.values()) {
    if (!matchedObserved.has(finding.key)) {
      errors.push(
        `unreviewed vulnerability: ${[...finding.identifiers].sort().join('/')} ${finding.packageName}@${finding.version}`
      )
    }
  }

  return {
    errors,
    packageCount: extraction.packageCount,
    findingCount: extraction.findings.length,
    advisoryCount: new Set(extraction.findings.map((finding) => finding.groupId)).size,
    exceptionTupleCount: matchedExceptions.size
  }
}

export async function loadRepositoryLockContract(root) {
  const { parse } = await import('yaml')
  return {
    manifests: readTrackedManifests(root),
    lockfile: parse(readFileSync(join(root, 'pnpm-lock.yaml'), 'utf8')),
    workspace: parse(readFileSync(join(root, 'pnpm-workspace.yaml'), 'utf8'))
  }
}

export async function validateRepositorySupplyChain(root, options = {}) {
  const policy = loadSupplyChainPolicy(root)
  const preinstallErrors = validatePreinstallRepository(root, policy, options)
  const contract = await loadRepositoryLockContract(root)
  return [...preinstallErrors, ...validateLockfile(contract.manifests, contract.lockfile, contract.workspace)]
}

function validateScannerPins(scanners) {
  const errors = []
  if (!isRecord(scanners) || !isRecord(scanners.osv) || !isRecord(scanners.gitleaks)) {
    return ['policy must pin osv and gitleaks scanners']
  }

  const scannerIds = Object.keys(scanners).sort()
  if (scannerIds.join(',') !== Object.keys(approvedScanners).sort().join(',')) {
    errors.push('policy must contain exactly the approved osv and gitleaks scanner ids')
  }

  for (const [id, approved] of Object.entries(approvedScanners)) {
    const scanner = scanners[id]
    if (!isRecord(scanner)) continue
    if (
      scanner.name !== approved.name ||
      scanner.repository !== approved.repository ||
      scanner.assetKind !== approved.assetKind ||
      scanner.binaryName !== approved.binaryName
    ) {
      errors.push(`${id} must use the approved ${approved.name} identity, repository, and asset shape`)
    }
    if (!isExactSemver(scanner.version) || scanner.tag !== `v${scanner.version}`) {
      errors.push(`${id} must use matching exact version and v-prefixed tag`)
    }
    if (typeof scanner.repository !== 'string' || !/^[\w.-]+\/[\w.-]+$/.test(scanner.repository)) {
      errors.push(`${id} must declare an owner/repository source`)
    }
    if (typeof scanner.sourceCommit !== 'string' || !commitPattern.test(scanner.sourceCommit)) {
      errors.push(`${id} must pin a 40-character source commit`)
    }
    if (
      scanner.assetKind === 'tar.gz' &&
      (typeof scanner.binaryName !== 'string' || !/^[A-Za-z0-9._-]+$/.test(scanner.binaryName))
    ) {
      errors.push(`${id} must declare a safe archive binary name`)
    }
    if (!isRecord(scanner.assets)) {
      errors.push(`${id} must declare release assets`)
      continue
    }
    for (const platform of ['darwin-x64', 'darwin-arm64', 'linux-x64', 'linux-arm64']) {
      const asset = scanner.assets[platform]
      if (
        !isRecord(asset) ||
        typeof asset.name !== 'string' ||
        !/^[A-Za-z0-9._-]+$/.test(asset.name) ||
        !sha256Pattern.test(asset.sha256 ?? '')
      ) {
        errors.push(`${id} must pin ${platform} asset name and SHA-256`)
      }
    }
  }

  return errors
}

function validateExceptions(exceptions, maximumDays, now) {
  const errors = []
  if (!Array.isArray(exceptions)) {
    return ['vulnerabilityExceptions must be an array']
  }

  const ids = new Set()
  const tuples = new Set()
  for (const exception of exceptions) {
    if (!isRecord(exception) || typeof exception.id !== 'string' || !ghsaPattern.test(exception.id)) {
      errors.push('every vulnerability exception must use a GHSA identifier')
      continue
    }
    if (ids.has(exception.id)) {
      errors.push(`duplicate vulnerability exception id: ${exception.id}`)
    }
    ids.add(exception.id)

    if (typeof exception.owner !== 'string' || exception.owner.trim().length < 5) {
      errors.push(`${exception.id} must name an accountable owner`)
    }
    if (
      typeof exception.followUp !== 'string' ||
      !/^https:\/\/github\.com\/smallwiselabs\/swl-step-by-step\/issues\/\d+$/.test(exception.followUp)
    ) {
      errors.push(`${exception.id} must link a concrete follow-up Issue`)
    }
    if (typeof exception.reason !== 'string' || exception.reason.trim().length < 40) {
      errors.push(`${exception.id} must include a substantive reason`)
    }

    const reviewed = parseDateOnly(exception.reviewedOn)
    const expires = parseDateOnly(exception.expires)
    if (!reviewed || !expires) {
      errors.push(`${exception.id} must use valid reviewedOn and expires dates`)
    } else {
      const lifetime = Math.round((expires.getTime() - reviewed.getTime()) / 86_400_000)
      if (lifetime < 1 || lifetime > maximumDays) {
        errors.push(`${exception.id} exception lifetime must be 1 through ${maximumDays} days`)
      }
      if (expires.getTime() < dateFloor(now).getTime()) {
        errors.push(`${exception.id} vulnerability exception expired on ${exception.expires}`)
      }
      if (reviewed.getTime() > dateFloor(now).getTime()) {
        errors.push(`${exception.id} reviewedOn cannot be in the future`)
      }
    }

    if (!Array.isArray(exception.packages) || exception.packages.length === 0) {
      errors.push(`${exception.id} must bind at least one package and version`)
      continue
    }
    for (const packageEntry of exception.packages) {
      if (!isRecord(packageEntry) || typeof packageEntry.name !== 'string' || packageEntry.name.length === 0) {
        errors.push(`${exception.id} has an invalid package binding`)
        continue
      }
      if (!Array.isArray(packageEntry.versions) || packageEntry.versions.length === 0) {
        errors.push(`${exception.id} ${packageEntry.name} must bind exact versions`)
        continue
      }
      for (const version of packageEntry.versions) {
        const tuple = `${exception.id}\0${packageEntry.name}\0${version}`
        if (!isExactSemver(version)) {
          errors.push(`${exception.id} ${packageEntry.name} must bind exact semantic versions`)
        }
        if (tuples.has(tuple)) {
          errors.push(`duplicate vulnerability exception tuple: ${exception.id} ${packageEntry.name}@${version}`)
        }
        tuples.add(tuple)
      }
    }
  }
  return errors
}

function extractOsvReport(report) {
  const errors = []
  if (!isRecord(report) || !Array.isArray(report.results) || report.results.length === 0) {
    return { errors: ['OSV report must contain results'], findings: [], packageCount: 0 }
  }

  const rawFindings = []
  let packageCount = 0
  const union = createUnionFind()

  for (const result of report.results) {
    if (!isRecord(result) || !Array.isArray(result.packages)) {
      errors.push('every OSV result must contain packages')
      continue
    }
    packageCount += result.packages.length
    for (const packageRecord of result.packages) {
      const packageName = packageRecord?.package?.name
      const version = packageRecord?.package?.version
      if (typeof packageName !== 'string' || typeof version !== 'string') {
        errors.push('every OSV package record must contain name and version')
        continue
      }
      for (const vulnerability of packageRecord.vulnerabilities ?? []) {
        if (!isRecord(vulnerability) || typeof vulnerability.id !== 'string') {
          errors.push(`OSV vulnerability for ${packageName}@${version} must contain an id`)
          continue
        }
        const identifiers = new Set([vulnerability.id, ...(vulnerability.aliases ?? [])].filter(isIdentifier))
        if (identifiers.size === 0) {
          errors.push(`OSV vulnerability for ${packageName}@${version} has no usable identifier`)
          continue
        }
        const [first, ...rest] = identifiers
        union.add(first)
        for (const identifier of rest) {
          union.add(identifier)
          union.union(first, identifier)
        }
        rawFindings.push({ identifiers, packageName, version })
      }
    }
  }

  const grouped = new Map()
  for (const finding of rawFindings) {
    const roots = [...finding.identifiers].map((identifier) => union.find(identifier)).sort()
    const groupId = roots[0]
    const key = `${groupId}\0${finding.packageName}\0${finding.version}`
    const existing = grouped.get(key) ?? {
      key,
      groupId,
      identifiers: new Set(),
      packageName: finding.packageName,
      version: finding.version
    }
    for (const identifier of finding.identifiers) {
      existing.identifiers.add(identifier)
    }
    grouped.set(key, existing)
  }

  return { errors, findings: [...grouped.values()], packageCount }
}

function createUnionFind() {
  const parent = new Map()
  return {
    add(value) {
      if (!parent.has(value)) parent.set(value, value)
    },
    find(value) {
      const current = parent.get(value)
      if (current === value) return value
      const root = this.find(current)
      parent.set(value, root)
      return root
    },
    union(left, right) {
      const leftRoot = this.find(left)
      const rightRoot = this.find(right)
      if (leftRoot !== rightRoot) {
        const [first, second] = [leftRoot, rightRoot].sort()
        parent.set(second, first)
      }
    }
  }
}

function normalizeImporterPath(manifestPath) {
  const directory = dirname(manifestPath).split(sep).join('/')
  return directory === '.' ? '.' : directory
}

function workspaceLinkTarget(importerManifestPath, targetManifestPath) {
  const importerDirectory = dirname(importerManifestPath)
  const targetDirectory = dirname(targetManifestPath)
  return (relative(importerDirectory, targetDirectory) || '.').split(sep).join('/')
}

function parseDateOnly(value) {
  if (typeof value !== 'string' || !datePattern.test(value)) return null
  const date = new Date(`${value}T00:00:00.000Z`)
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value ? null : date
}

function dateFloor(value) {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()))
}

function isExactSemver(value) {
  return typeof value === 'string' && exactSemverPattern.test(value)
}

function isExactParentScopedRemoval(selector, value) {
  if (value !== '-' || typeof selector !== 'string') return false

  const separator = selector.indexOf('>')
  if (separator <= 0 || separator !== selector.lastIndexOf('>') || separator === selector.length - 1) return false

  const parent = selector.slice(0, separator)
  const versionSeparator = parent.lastIndexOf('@')
  return versionSeparator > 0 && isExactSemver(parent.slice(versionSeparator + 1))
}

function isSha512Integrity(value) {
  if (!value.startsWith('sha512-')) return false
  const encoded = value.slice('sha512-'.length)
  try {
    const digest = Buffer.from(encoded, 'base64')
    return digest.length === 64 && digest.toString('base64') === encoded
  } catch {
    return false
  }
}

function isIdentifier(value) {
  return typeof value === 'string' && /^(?:GHSA|CVE)-[A-Za-z0-9-]+$/.test(value)
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

async function main() {
  const root = process.cwd()
  const errors = await validateRepositorySupplyChain(root)
  if (errors.length) {
    console.error(errors.map((error) => `- ${error}`).join('\n'))
    process.exit(1)
  }

  const contract = await loadRepositoryLockContract(root)
  const policy = loadSupplyChainPolicy(root)
  console.log(
    `Supply-chain policy passed: ${contract.manifests.length} manifest(s), ${Object.keys(contract.lockfile.packages).length} SHA-512 package resolution(s), and ${policy.vulnerabilityExceptions.length} vulnerability exception(s).`
  )
}

const entrypoint = process.argv[1] ? resolve(process.argv[1]) : ''
if (entrypoint === fileURLToPath(import.meta.url)) {
  await main()
}
