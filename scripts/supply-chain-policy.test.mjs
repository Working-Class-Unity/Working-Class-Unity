import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { inspectPnpmLockfile } from './pnpm-lock-preinstall.mjs'
import {
  evaluateOsvReport,
  loadRepositoryLockContract,
  loadSupplyChainPolicy,
  validateLockfile,
  validateManifestVersions,
  validatePolicy,
  validatePreinstallRepository,
  validateRepositorySupplyChain,
  validateScannerBypassFiles
} from './supply-chain-policy.mjs'
import {
  countPnpmLockPackages,
  downloadVerified,
  runPreinstallScan,
  runSignatureAudit,
  validateScannerPackageCoverage,
  validateSignatureReport
} from './supply-chain-scan.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const referenceNow = new Date('2026-07-27T00:00:00.000Z')

test('repository manifests, lockfile, scanner pins, and exceptions satisfy the policy', async () => {
  assert.deepEqual(await validateRepositorySupplyChain(root, { now: referenceNow }), [])

  const { manifests, lockfile } = await loadRepositoryLockContract(root)
  assert.equal(manifests.length, 2)

  const lockSource = await readFile(join(root, 'pnpm-lock.yaml'), 'utf8')
  assert.deepEqual(inspectPnpmLockfile(lockSource, manifests), {
    errors: [],
    packageCount: Object.keys(lockfile.packages).length
  })
})

test('installable dependency ranges, tags, URLs, and workspace wildcards are rejected', () => {
  const credentialBearingUrl = 'https://user:ghp_do-not-retain-this-value@example.test/archive.tgz'
  const manifests = [
    {
      path: 'package.json',
      manifest: {
        name: 'root',
        version: '1.0.0',
        dependencies: { caret: '^1.2.3', tag: 'latest', local: 'workspace:*' },
        devDependencies: { url: credentialBearingUrl }
      }
    },
    {
      path: 'packages/local/package.json',
      manifest: { name: 'local', version: '2.0.0' }
    }
  ]

  const errors = validateManifestVersions(manifests)
  assert(errors.some((error) => error.includes('dependencies.caret')))
  assert(errors.some((error) => error.includes('dependencies.tag')))
  assert(errors.some((error) => error.includes('dependencies.local must use workspace:<exact local version>')))
  assert(errors.some((error) => error.includes('devDependencies.url')))
  assert(!JSON.stringify(errors).includes(credentialBearingUrl))
  assert(!JSON.stringify(errors).includes('ghp_do-not-retain-this-value'))

  manifests[0].manifest.dependencies = { local: 'workspace:2.0.0', stable: '1.2.3' }
  manifests[0].manifest.devDependencies = { preview: '2.0.0-rc.1' }
  assert.deepEqual(validateManifestVersions(manifests), [])
})

test('lock importer drift, weak integrity, custom tarballs, and unsafe overrides are rejected', () => {
  const manifests = [
    {
      path: 'package.json',
      manifest: { name: 'root', dependencies: { example: '1.2.3' } }
    }
  ]
  const lockfile = {
    lockfileVersion: '9.0',
    importers: {
      '.': {
        dependencies: {
          example: { specifier: '1.2.3', version: '9.9.9' },
          extra: { specifier: '9.9.9', version: '9.9.9' }
        }
      }
    },
    packages: {
      'example@1.2.3': { resolution: { integrity: 'sha512-A', tarball: 'https://example.test/archive.tgz' } }
    }
  }
  const workspace = { overrides: { example: '^1.2.3' } }

  const errors = validateLockfile(manifests, lockfile, workspace)
  assert(errors.some((error) => error.includes('dependencies.example resolves 9.9.9 instead of 1.2.3')))
  assert(errors.some((error) => error.includes('undeclared dependencies.extra')))
  assert(errors.some((error) => error.includes('SHA-512 registry integrity')))
  assert(errors.some((error) => error.includes('custom tarball')))
  assert(errors.some((error) => error.includes('override example')))

  const specifierDrift = structuredClone(lockfile)
  specifierDrift.importers['.'].dependencies.example = { specifier: '^1.2.3', version: '1.2.3' }
  assert(
    validateLockfile(manifests, specifierDrift, { overrides: { example: '1.2.3' } }).some((error) =>
      error.includes('dependencies.example must match 1.2.3')
    )
  )

  const exactRemovalErrors = validateLockfile(manifests, lockfile, {
    overrides: { 'parent@1.2.3>unused': '-' }
  })
  assert(!exactRemovalErrors.some((error) => error.includes('override parent@1.2.3>unused')))

  const broadRemovalErrors = validateLockfile(manifests, lockfile, { overrides: { unused: '-' } })
  assert(broadRemovalErrors.some((error) => error.includes('override unused')))
})

test('dependency-free preinstall lock inspection fails before unsafe resolutions can install', async () => {
  const { manifests } = await loadRepositoryLockContract(root)
  const source = await readFile(join(root, 'pnpm-lock.yaml'), 'utf8')
  const weakIntegrity = source.replace('resolution: {integrity: sha512-', 'resolution: {integrity: sha256-')
  const customTarball = source.replace(
    /resolution: \{integrity: (sha512-[^}]+)\}/,
    'resolution: {integrity: $1, tarball: https://example.test/archive.tgz}'
  )
  const importerDrift = source.replace(
    'specifier: 3.9.5\n        version: 3.9.5',
    'specifier: 3.9.5\n        version: 9.9.9'
  )
  const commentedPackageHeader = source.replace(
    "\n  '@antfu/install-pkg@1.1.0':\n",
    "\n  '@antfu/install-pkg@1.1.0': # noncanonical header\n"
  )
  const duplicateImporterSection = source.replace(
    '  .:\n    devDependencies:',
    '  .:\n    devDependencies:\n    devDependencies:'
  )
  const duplicatePackages = source.replace(
    '\nsnapshots:\n',
    '\npackages:\n\n  evil@1.0.0:\n    resolution: {integrity: sha256-weak}\n\nsnapshots:\n'
  )

  assert(inspectPnpmLockfile(weakIntegrity, manifests).errors.some((error) => error.includes('SHA-512')))
  assert(inspectPnpmLockfile(customTarball, manifests).errors.some((error) => error.includes('custom tarballs')))
  assert(inspectPnpmLockfile(importerDrift, manifests).errors.some((error) => error.includes('resolution drift')))
  assert(
    inspectPnpmLockfile(commentedPackageHeader, manifests).errors.some((error) =>
      error.includes('package headers must use the canonical')
    )
  )
  assert(
    inspectPnpmLockfile(duplicateImporterSection, manifests).errors.some((error) =>
      error.includes('dependency sections must not be duplicated')
    )
  )
  assert(
    inspectPnpmLockfile(duplicatePackages, manifests).errors.some((error) =>
      error.includes('exactly one canonical packages entry')
    )
  )
  assert(
    validatePreinstallRepository(root, loadSupplyChainPolicy(root), {
      manifests,
      trackedFiles: [],
      lockSource: weakIntegrity
    }).some((error) => error.includes('SHA-512'))
  )
})

test('clean-checkout preinstall production path rejects a weak lock before scanner download', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'swl-preinstall-fail-closed-'))
  try {
    await mkdir(join(directory, 'security'), { recursive: true })
    await writeFile(
      join(directory, 'package.json'),
      `${JSON.stringify({ name: 'fixture', version: '1.0.0', dependencies: { example: '1.0.0' } }, null, 2)}\n`
    )
    await writeFile(
      join(directory, 'pnpm-lock.yaml'),
      "lockfileVersion: '9.0'\n\nimporters:\n\n  .:\n    dependencies:\n      example:\n        specifier: 1.0.0\n        version: 1.0.0\n\npackages:\n\n  example@1.0.0:\n    resolution: {integrity: sha256-not-allowed}\n\nsnapshots:\n\n  example@1.0.0: {}\n"
    )
    await writeFile(
      join(directory, 'security/supply-chain-policy.json'),
      await readFile(join(root, 'security/supply-chain-policy.json'), 'utf8')
    )
    assert.equal(spawnSync('git', ['init', '-q'], { cwd: directory }).status, 0)
    assert.equal(spawnSync('git', ['add', '.'], { cwd: directory }).status, 0)

    const stateDirectory = join(directory, 'ci-reports/supply-chain-state')
    await mkdir(stateDirectory, { recursive: true })
    await writeFile(join(stateDirectory, 'osv-package-count.json'), '{"osvPackageCount":999}')
    await assert.rejects(runPreinstallScan({ root: directory, stateDirectory }), /SHA-512/)
    await assert.rejects(readFile(join(stateDirectory, 'osv-package-count.json')), /ENOENT/)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('workspace links bind exact local names, versions, and target paths', () => {
  const manifests = [
    {
      path: 'package.json',
      manifest: { name: 'root', version: '1.0.0', dependencies: { local: 'workspace:2.0.0' } }
    },
    { path: 'packages/local/package.json', manifest: { name: 'local', version: '2.0.0' } }
  ]
  const lockfile = {
    lockfileVersion: '9.0',
    importers: {
      '.': { dependencies: { local: { specifier: 'workspace:2.0.0', version: 'link:packages/other' } } },
      'packages/local': {}
    },
    packages: {
      'example@1.0.0': {
        resolution: {
          integrity: 'sha512-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=='
        }
      }
    }
  }

  assert(validateLockfile(manifests, lockfile, {}).some((error) => error.includes('link:packages/other')))

  const duplicates = structuredClone(manifests)
  duplicates.push({ path: 'packages/duplicate/package.json', manifest: { name: 'local', version: '2.0.0' } })
  assert(validateManifestVersions(duplicates).some((error) => error.includes('duplicate package names')))
})

test('exceptions require tuple scope, accountable metadata, and a short live review window', () => {
  const invalid = singleExceptionPolicy()
  invalid.vulnerabilityExceptions.push(structuredClone(invalid.vulnerabilityExceptions[0]))
  invalid.vulnerabilityExceptions[0].owner = ''
  invalid.vulnerabilityExceptions[0].reason = 'short'
  invalid.vulnerabilityExceptions[0].reviewedOn = '2026-01-01'
  invalid.vulnerabilityExceptions[0].expires = '2026-03-01'
  invalid.vulnerabilityExceptions[1].id = invalid.vulnerabilityExceptions[0].id
  invalid.vulnerabilityExceptions[1].packages[0].versions = ['^2.6.1']
  invalid.vulnerabilityExceptions[1].reviewedOn = '2026-07-28'

  const errors = validatePolicy(invalid, { now: referenceNow })
  assert(errors.some((error) => error.includes('accountable owner')))
  assert(errors.some((error) => error.includes('substantive reason')))
  assert(errors.some((error) => error.includes('exception lifetime')))
  assert(errors.some((error) => error.includes('expired')))
  assert(errors.some((error) => error.includes('duplicate vulnerability exception id')))
  assert(errors.some((error) => error.includes('bind exact semantic versions')))
  assert(errors.some((error) => error.includes('reviewedOn cannot be in the future')))
})

test('OSV findings match one live exception by alias, package, and exact version', () => {
  const policy = singleExceptionPolicy()
  const report = osvReport([
    {
      name: 'example',
      version: '1.2.3',
      vulnerabilities: [{ id: 'CVE-2026-1000', aliases: ['GHSA-4x5r-pxfx-6jf8'] }]
    },
    { name: 'clean', version: '2.0.0', vulnerabilities: [] }
  ])

  const result = evaluateOsvReport(report, policy, { now: referenceNow, expectedPackageCount: 2 })
  assert.deepEqual(result.errors, [])
  assert.equal(result.packageCount, 2)
  assert.equal(result.findingCount, 1)
  assert.equal(result.advisoryCount, 1)
  assert.equal(result.exceptionTupleCount, 1)
})

test('OSV policy fails closed for new, version-shifted, stale, and truncated findings', () => {
  const policy = singleExceptionPolicy()
  const report = osvReport([
    {
      name: 'example',
      version: '1.2.4',
      vulnerabilities: [{ id: 'GHSA-4x5r-pxfx-6jf8' }]
    },
    {
      name: 'other',
      version: '9.9.9',
      vulnerabilities: [{ id: 'GHSA-534h-c3cw-v3h9' }]
    }
  ])

  const errors = evaluateOsvReport(report, policy, {
    now: referenceNow,
    expectedPackageCount: 3
  }).errors
  assert(errors.some((error) => error.includes('stale vulnerability exception')))
  assert(errors.some((error) => error.includes('unreviewed vulnerability')))
  assert(errors.some((error) => error.includes('must contain 3 package records')))
})

test('repository-native scanner bypass files and incomplete release pins are rejected', () => {
  assert.deepEqual(validateScannerBypassFiles(['src/index.ts']), [])
  const bypassErrors = validateScannerBypassFiles([
    '.gitleaks.toml',
    'security/osv-scanner.toml',
    'fixtures/gitleaks-baseline.json'
  ])
  assert.equal(bypassErrors.length, 3)

  const policy = loadSupplyChainPolicy(root)
  policy.scanners.osv.assets['linux-x64'].sha256 = 'mutable'
  policy.scanners.gitleaks.sourceCommit = 'v8.30.1'
  policy.scanners.osv.repository = 'lookalike/osv-scanner'
  policy.scanners.osv.name = 'Lookalike Scanner'
  const errors = validatePolicy(policy, { now: referenceNow })
  assert(errors.some((error) => error.includes('osv must pin linux-x64')))
  assert(errors.some((error) => error.includes('gitleaks must pin a 40-character source commit')))
  assert(errors.some((error) => error.includes('approved OSV-Scanner identity')))
})

test('scanner asset verification accepts pinned bytes and rejects a one-byte change', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'swl-scanner-hash-test-'))
  try {
    const accepted = join(directory, 'accepted')
    const rejected = join(directory, 'rejected')
    await downloadVerified(
      'data:application/octet-stream;base64,YQ==',
      accepted,
      'ca978112ca1bbdcafac231b39a23dc4da786eff8147c4e72b9807785afee48bb'
    )
    assert.equal(await readFile(accepted, 'utf8'), 'a')
    await assert.rejects(
      downloadVerified(
        'data:application/octet-stream;base64,Yg==',
        rejected,
        'ca978112ca1bbdcafac231b39a23dc4da786eff8147c4e72b9807785afee48bb'
      ),
      /checksum mismatch/
    )
    await assert.rejects(readFile(rejected), /ENOENT/)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('registry signatures reject invalid, missing, and count-mismatched packages', () => {
  assert.deepEqual(validateSignatureReport({ audited: 2, verified: 2, invalid: [], missing: [] }, 2), [])
  const errors = validateSignatureReport({ audited: 2, verified: 1, invalid: ['bad'], missing: ['unsigned'] }, 3)
  assert(errors.some((error) => error.includes('verify every audited package')))
  assert(errors.some((error) => error.includes('must match the lockfile package count')))
})

test('signature audit fails closed and removes invalid temporary OSV state', async () => {
  const stateDirectory = await mkdtemp(join(tmpdir(), 'swl-signature-state-test-'))
  const statePath = join(stateDirectory, 'osv-package-count.json')
  try {
    await writeFile(statePath, '{"osvPackageCount":0}')
    await assert.rejects(runSignatureAudit({ root, stateDirectory }), /positive integer/)
    await assert.rejects(readFile(statePath), /ENOENT/)
  } finally {
    await rm(stateDirectory, { recursive: true, force: true })
  }
})

test('production scanner coverage is anchored to lockfile package count', async () => {
  const lockSource = await readFile(join(root, 'pnpm-lock.yaml'), 'utf8')
  assert(countPnpmLockPackages(lockSource) > 0)

  const errors = validateScannerPackageCoverage(1, { audited: 1, verified: 1, invalid: [], missing: [] }, 2)
  assert(errors.some((error) => error.includes('OSV scan covered 1 packages; lockfile contains 2')))
  assert(errors.some((error) => error.includes('signature count 1 must match the lockfile package count 2')))
})

function singleExceptionPolicy() {
  const policy = loadSupplyChainPolicy(root)
  policy.vulnerabilityExceptions = [
    {
      id: 'GHSA-4x5r-pxfx-6jf8',
      packages: [{ name: 'example', versions: ['1.2.3'] }],
      owner: 'R-test / #4',
      followUp: 'https://github.com/smallwiselabs/swl-step-by-step/issues/4',
      reason: 'A deterministic test exception with enough context to satisfy the review contract.',
      reviewedOn: '2026-07-09',
      expires: '2026-08-15'
    }
  ]
  return policy
}

function osvReport(packages) {
  return {
    results: [
      {
        source: { path: 'pnpm-lock.yaml', type: 'lockfile' },
        packages: packages.map(({ name, version, vulnerabilities }) => ({
          package: { name, version, ecosystem: 'npm' },
          vulnerabilities
        }))
      }
    ]
  }
}
