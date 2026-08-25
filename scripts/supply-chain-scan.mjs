import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { chmod, mkdir, mkdtemp, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { fileURLToPath } from 'node:url'
import { evaluateOsvReport, loadSupplyChainPolicy, validatePreinstallRepository } from './supply-chain-policy.mjs'

const STATE_FILE = 'osv-package-count.json'
const GITLEAKS_FINDING_EXIT = 97

export async function runPreinstallScan({ root = process.cwd(), stateDirectory = resolveStateDirectory(root) } = {}) {
  const statePath = join(stateDirectory, STATE_FILE)
  await initializeStateDirectory(stateDirectory)

  try {
    const policy = loadSupplyChainPolicy(root)
    const policyErrors = validatePreinstallRepository(root, policy)
    if (policyErrors.length) {
      throw new Error(policyErrors.join('\n'))
    }
    const expectedPackageCount = countPnpmLockPackages(await readFile(join(root, 'pnpm-lock.yaml'), 'utf8'))

    const platform = platformKey()
    const tools = {
      osv: await installScanner(policy.scanners.osv, platform),
      gitleaks: await installScanner(policy.scanners.gitleaks, platform)
    }

    await runGitleaksCanary(tools.gitleaks)
    await runGitleaksRepositoryScan(tools.gitleaks, root)
    const evaluation = await runOsvScan(tools.osv, root, policy, expectedPackageCount)
    await writeJson(statePath, { osvPackageCount: evaluation.packageCount })

    console.log(
      `Supply-chain preinstall scan passed: ${evaluation.packageCount} packages, ${evaluation.advisoryCount} reviewed advisories, and a detected redacted canary.`
    )
    return evaluation
  } catch (error) {
    await rm(statePath, { force: true })
    throw error
  }
}

export async function runSignatureAudit({ root = process.cwd(), stateDirectory = resolveStateDirectory(root) } = {}) {
  const statePath = join(stateDirectory, STATE_FILE)

  try {
    const state = parseJson(await readFile(statePath, 'utf8'), 'temporary OSV package-count state')
    if (!Number.isInteger(state?.osvPackageCount) || state.osvPackageCount < 1) {
      throw new Error('temporary OSV package-count state must contain a positive integer')
    }
    const result = runCommand(process.execPath, ['scripts/run-pnpm.mjs', 'audit', 'signatures', '--json'], {
      cwd: root,
      timeout: 180_000
    })
    if (![0, 1].includes(result.status)) {
      throw new Error(`pnpm signature audit returned exit ${String(result.status)}`)
    }
    const report = parseJson(result.stdout, 'pnpm signature audit')
    const expectedPackageCount = countPnpmLockPackages(await readFile(join(root, 'pnpm-lock.yaml'), 'utf8'))

    const coverageErrors = validateScannerPackageCoverage(state.osvPackageCount, report, expectedPackageCount)
    if (result.status !== 0) {
      coverageErrors.unshift('pnpm signature audit reported invalid or missing package signatures')
    }
    if (coverageErrors.length) {
      throw new Error(coverageErrors.join('\n'))
    }

    console.log(`Registry signature audit passed: ${report.verified}/${report.audited} packages verified.`)
    return report
  } finally {
    await rm(statePath, { force: true })
  }
}

export async function installScanner(scanner, platform, { cacheRoot = toolCacheRoot() } = {}) {
  const asset = scanner.assets?.[platform]
  if (!asset) {
    throw new Error(`${scanner.name} does not pin a release asset for ${platform}`)
  }

  const directory = join(cacheRoot, `${scanner.repository.replace('/', '-')}-${scanner.version}-${platform}`)
  await mkdir(directory, { recursive: true, mode: 0o700 })
  const assetPath = join(directory, asset.name)
  const url = `https://github.com/${scanner.repository}/releases/download/${scanner.tag}/${asset.name}`

  if (!(await fileMatchesHash(assetPath, asset.sha256))) {
    await rm(assetPath, { force: true })
    await downloadVerified(url, assetPath, asset.sha256)
  }

  let binaryPath = assetPath
  if (scanner.assetKind === 'tar.gz') {
    binaryPath = join(directory, scanner.binaryName)
    const extraction = runCommand('tar', ['-xzf', assetPath, '-C', directory, scanner.binaryName], {
      timeout: 60_000
    })
    if (extraction.status !== 0) {
      throw new Error(`${scanner.name} release extraction failed with exit ${String(extraction.status)}`)
    }
  }

  await chmod(binaryPath, 0o700)
  verifyScannerVersion(binaryPath, scanner)
  return binaryPath
}

async function runGitleaksCanary(binary) {
  const directory = await mkdtemp(join(tmpdir(), 'swl-gitleaks-canary-'))
  await chmod(directory, 0o700)
  const configPath = join(directory, 'config.toml')
  const ignorePath = join(directory, 'empty-ignore')
  const canaryPath = join(directory, 'probe.env')
  const reportPath = join(directory, 'report.json')
  const prefix = ['gh', 'p_'].join('')
  const suffix = createHash('sha256').update('swl-gitleaks-canary-v1').digest('base64url').slice(0, 36)
  const canary = `${prefix}${suffix}`

  try {
    await writeFile(configPath, '[extend]\nuseDefault = true\n', { mode: 0o600 })
    await writeFile(ignorePath, '', { mode: 0o600 })
    await writeFile(canaryPath, `GITHUB_TOKEN=${canary} # gitleaks:allow\n`, { mode: 0o600 })

    const result = runCommand(binary, gitleaksArguments('dir', configPath, ignorePath, reportPath, canaryPath), {
      timeout: 150_000
    })
    const findings = parseJson(await readFile(reportPath, 'utf8'), 'Gitleaks canary report')
    if (
      result.status !== GITLEAKS_FINDING_EXIT ||
      !Array.isArray(findings) ||
      findings.length !== 1 ||
      findings[0].RuleID !== 'github-pat' ||
      findings[0].Secret !== 'REDACTED' ||
      findings[0].Match !== 'REDACTED' ||
      JSON.stringify(findings).includes(canary)
    ) {
      throw new Error('Gitleaks canary must produce exactly one fully redacted github-pat finding')
    }
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

async function runGitleaksRepositoryScan(binary, root) {
  const directory = await mkdtemp(join(tmpdir(), 'swl-gitleaks-scan-'))
  await chmod(directory, 0o700)
  const configPath = join(directory, 'config.toml')
  const ignorePath = join(root, '.gitleaksignore')
  const reportPath = join(directory, 'report.json')

  try {
    await writeFile(configPath, '[extend]\nuseDefault = true\n', { mode: 0o600 })
    const result = runCommand(binary, gitleaksArguments('git', configPath, ignorePath, reportPath, root), {
      cwd: root,
      timeout: 150_000
    })
    const findings = parseJson(await readFile(reportPath, 'utf8'), 'Gitleaks repository report')
    if (!Array.isArray(findings)) {
      throw new Error('Gitleaks repository report must be a JSON array')
    }
    if (![0, GITLEAKS_FINDING_EXIT].includes(result.status)) {
      throw new Error(`Gitleaks repository scan returned unexpected exit ${String(result.status)}`)
    }
    if (result.status === 0 && findings.length !== 0) {
      throw new Error('Gitleaks returned success with a non-empty finding report')
    }
    if (result.status === GITLEAKS_FINDING_EXIT && findings.length === 0) {
      throw new Error('Gitleaks returned a finding exit with an empty finding report')
    }
    if (result.status === GITLEAKS_FINDING_EXIT) throw new Error('Gitleaks found an unreviewed secret-shaped value')
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

async function runOsvScan(binary, root, policy, expectedPackageCount) {
  const directory = await mkdtemp(join(tmpdir(), 'swl-osv-scan-'))
  await chmod(directory, 0o700)
  const configPath = join(directory, 'empty-config.toml')
  const temporaryReport = join(directory, 'osv.json')

  try {
    await writeFile(configPath, '# Native scanner suppressions are intentionally empty.\n', { mode: 0o600 })
    const result = runCommand(
      binary,
      [
        'scan',
        'source',
        '--all-packages',
        '--format',
        'json',
        '--verbosity',
        'error',
        '--config',
        configPath,
        '--output-file',
        temporaryReport,
        '--lockfile',
        join(root, 'pnpm-lock.yaml')
      ],
      { cwd: root, timeout: 180_000 }
    )
    const reportSource = await readFile(temporaryReport, 'utf8')
    const report = parseJson(reportSource, 'OSV dependency report')
    const rawFindingCount = countOsvFindings(report)

    if (![0, 1].includes(result.status)) {
      throw new Error(`OSV-Scanner returned unexpected exit ${String(result.status)}`)
    }
    if ((result.status === 0 && rawFindingCount !== 0) || (result.status === 1 && rawFindingCount === 0)) {
      throw new Error('OSV-Scanner exit status contradicts its JSON findings')
    }

    const evaluation = evaluateOsvReport(report, policy, { expectedPackageCount })
    if (evaluation.errors.length) {
      throw new Error(evaluation.errors.join('\n'))
    }
    return evaluation
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

function gitleaksArguments(command, configPath, ignorePath, reportPath, source) {
  return [
    command,
    '--config',
    configPath,
    '--gitleaks-ignore-path',
    ignorePath,
    '--ignore-gitleaks-allow',
    '--no-banner',
    '--no-color',
    '--redact=100',
    `--exit-code=${GITLEAKS_FINDING_EXIT}`,
    '--report-format',
    'json',
    '--report-path',
    reportPath,
    '--max-decode-depth=5',
    '--timeout=120',
    source
  ]
}

export async function downloadVerified(url, destination, expectedHash) {
  const temporary = `${destination}.download`
  await rm(temporary, { force: true })
  const response = await fetch(url, {
    redirect: 'follow',
    signal: AbortSignal.timeout(120_000),
    headers: { 'user-agent': 'swl-supply-chain-gate/1' }
  })
  if (!response.ok || !response.body) {
    throw new Error(`scanner release download failed with HTTP ${response.status}`)
  }

  await pipeline(Readable.fromWeb(response.body), createWriteStream(temporary, { mode: 0o600 }))
  const actualHash = await sha256File(temporary)
  if (actualHash !== expectedHash) {
    await rm(temporary, { force: true })
    throw new Error(`scanner release checksum mismatch for ${basename(destination)}`)
  }
  await rename(temporary, destination)
}

export function validateSignatureReport(report, expectedPackageCount) {
  const errors = []
  if (
    !Number.isInteger(report?.audited) ||
    report.audited < 1 ||
    report.verified !== report.audited ||
    !Array.isArray(report.invalid) ||
    report.invalid.length !== 0 ||
    !Array.isArray(report.missing) ||
    report.missing.length !== 0
  ) {
    errors.push('pnpm signature audit must verify every audited package with no invalid or missing signatures')
  }
  if (Number.isInteger(report?.audited) && report.audited !== expectedPackageCount) {
    errors.push(`pnpm signature count ${report.audited} must match the lockfile package count ${expectedPackageCount}`)
  }
  return errors
}

export function validateScannerPackageCoverage(osvPackageCount, signatureReport, expectedPackageCount) {
  const errors = []
  if (osvPackageCount !== expectedPackageCount) {
    errors.push(`OSV scan covered ${osvPackageCount} packages; lockfile contains ${expectedPackageCount}`)
  }
  errors.push(...validateSignatureReport(signatureReport, expectedPackageCount))
  return errors
}

export function countPnpmLockPackages(source) {
  if (typeof source !== 'string') {
    throw new Error('pnpm-lock.yaml source must be text')
  }

  const lines = source.split(/\r?\n/)
  const sectionStart = lines.findIndex((line) => line === 'packages:')
  if (sectionStart === -1) {
    throw new Error('pnpm-lock.yaml must contain a packages section')
  }

  let count = 0
  for (const line of lines.slice(sectionStart + 1)) {
    if (/^[^\s#]/.test(line)) break
    if (/^  \S.*:\s*(?:#.*)?$/.test(line)) count += 1
  }
  if (count === 0) {
    throw new Error('pnpm-lock.yaml packages section must not be empty')
  }
  return count
}

async function fileMatchesHash(path, expectedHash) {
  try {
    const metadata = await stat(path)
    return metadata.isFile() && (await sha256File(path)) === expectedHash
  } catch (error) {
    if (error?.code === 'ENOENT') return false
    throw error
  }
}

async function sha256File(path) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) {
    hash.update(chunk)
  }
  return hash.digest('hex')
}

function verifyScannerVersion(binaryPath, scanner) {
  const args = scanner.name === 'Gitleaks' ? ['version'] : ['--version']
  const result = runCommand(binaryPath, args, { timeout: 30_000 })
  if (result.status !== 0 || !result.stdout.includes(scanner.version)) {
    throw new Error(`${scanner.name} binary does not report pinned version ${scanner.version}`)
  }
}

function runCommand(command, args, { cwd = process.cwd(), timeout = 120_000 } = {}) {
  return spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    env: toolEnvironment(),
    maxBuffer: 64 * 1024 * 1024,
    timeout,
    windowsHide: true
  })
}

function toolEnvironment() {
  const allowed = [
    'PATH',
    'HOME',
    'USER',
    'LOGNAME',
    'TMPDIR',
    'TMP',
    'TEMP',
    'LANG',
    'LC_ALL',
    'CI',
    'GITHUB_ACTIONS',
    'RUNNER_TEMP',
    'XDG_CACHE_HOME',
    'NODE_EXTRA_CA_CERTS',
    'SSL_CERT_FILE',
    'SSL_CERT_DIR',
    'HTTP_PROXY',
    'HTTPS_PROXY',
    'NO_PROXY',
    'http_proxy',
    'https_proxy',
    'no_proxy',
    'NPM_CONFIG_USERCONFIG',
    'npm_config_userconfig',
    'npm_config_cache',
    'npm_config_registry',
    'npm_config_proxy',
    'npm_config_https_proxy',
    'npm_config_cafile'
  ]
  return Object.fromEntries(
    allowed.filter((name) => process.env[name] !== undefined).map((name) => [name, process.env[name]])
  )
}

function countOsvFindings(report) {
  if (!Array.isArray(report?.results)) return 0
  return report.results.reduce(
    (count, result) =>
      count +
      (result.packages ?? []).reduce(
        (packageCount, packageRecord) => packageCount + (packageRecord.vulnerabilities?.length ?? 0),
        0
      ),
    0
  )
}

function parseJson(source, label) {
  try {
    return JSON.parse(source)
  } catch {
    throw new Error(`${label} must be valid JSON`)
  }
}

async function writeJson(path, value) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 })
}

async function initializeStateDirectory(stateDirectory) {
  await mkdir(stateDirectory, { recursive: true, mode: 0o700 })
  await chmod(stateDirectory, 0o700)
  await rm(join(stateDirectory, STATE_FILE), { force: true })
}

function resolveStateDirectory(root) {
  const directory = resolve(process.env.SUPPLY_CHAIN_STATE_DIR || join(root, 'ci-reports/supply-chain-state'))
  const name = basename(directory)
  if (name !== 'supply-chain-state' && !/^swl-[A-Za-z0-9._-]*state$/.test(name)) {
    throw new Error('SUPPLY_CHAIN_STATE_DIR must name a dedicated supply-chain state directory')
  }
  return directory
}

function toolCacheRoot() {
  return join(process.env.RUNNER_TEMP || tmpdir(), 'swl-supply-chain-tools')
}

function platformKey() {
  if (!['darwin', 'linux'].includes(process.platform) || !['x64', 'arm64'].includes(process.arch)) {
    throw new Error(`supply-chain scanners support macOS/Linux x64/arm64; found ${process.platform}-${process.arch}`)
  }
  return `${process.platform}-${process.arch}`
}

function safeError(error) {
  const message = error instanceof Error ? error.message : String(error)
  return message.slice(0, 4000)
}

async function main() {
  const command = process.argv[2]
  if (!['preinstall', 'signatures', 'all'].includes(command)) {
    console.error('Usage: node scripts/supply-chain-scan.mjs <preinstall|signatures|all>')
    process.exit(64)
  }

  try {
    if (command === 'preinstall' || command === 'all') {
      await runPreinstallScan()
    }
    if (command === 'signatures' || command === 'all') {
      await runSignatureAudit()
    }
  } catch (error) {
    console.error(safeError(error))
    process.exit(1)
  }
}

const entrypoint = process.argv[1] ? resolve(process.argv[1]) : ''
if (entrypoint === fileURLToPath(import.meta.url)) {
  await main()
}
