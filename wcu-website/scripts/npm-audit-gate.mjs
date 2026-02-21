import { spawnSync } from 'node:child_process'

const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm'

const ALLOWED_HIGH_ADVISORIES = new Set([
  // minimatch ReDoS advisory - currently present in build-time tooling deps
  'GHSA-3PPC-4F35-3M26',
])

const runAudit = () => {
  const result = spawnSync(npmCmd, ['audit', '--omit=dev', '--json'], {
    encoding: 'utf8',
  })

  if (result.error) {
    throw result.error
  }

  const stdout = result.stdout?.trim() || ''
  if (!stdout) {
    return { report: null, exitCode: result.status ?? 0 }
  }

  return {
    report: JSON.parse(stdout),
    exitCode: result.status ?? 0,
  }
}

const extractGhsaFromUrl = (url) => {
  if (typeof url !== 'string') return null
  const match = url.match(/\/advisories\/(GHSA-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4})/i)
  return match ? match[1].toUpperCase() : null
}

const collectAdvisories = (pkgName, vulnerabilities, seen = new Set()) => {
  if (seen.has(pkgName)) return new Set()
  seen.add(pkgName)

  const vuln = vulnerabilities[pkgName]
  if (!vuln || typeof vuln !== 'object') return new Set()
  if (!Array.isArray(vuln.via)) return new Set()

  const advisories = new Set()

  for (const entry of vuln.via) {
    if (typeof entry === 'string') {
      const nested = collectAdvisories(entry, vulnerabilities, seen)
      for (const id of nested) advisories.add(id)
      continue
    }

    if (entry && typeof entry === 'object') {
      const ghsa = extractGhsaFromUrl(entry.url)
      if (ghsa) advisories.add(ghsa)
    }
  }

  return advisories
}

const isHighOrCritical = (severity) => severity === 'high' || severity === 'critical'

const main = () => {
  const { report } = runAudit()

  if (!report || typeof report !== 'object') {
    console.error('npm audit returned no JSON output')
    process.exit(2)
  }

  const vulnerabilities = report.vulnerabilities
  if (!vulnerabilities || typeof vulnerabilities !== 'object') {
    console.log('npm audit: no vulnerabilities object present')
    process.exit(0)
  }

  const blocked = []
  const allowed = []

  for (const [pkgName, vuln] of Object.entries(vulnerabilities)) {
    if (!vuln || typeof vuln !== 'object') continue
    if (!isHighOrCritical(vuln.severity)) continue

    const advisories = Array.from(collectAdvisories(pkgName, vulnerabilities))
    const allowedOnly = advisories.length > 0 && advisories.every((id) => ALLOWED_HIGH_ADVISORIES.has(id))

    if (allowedOnly) {
      allowed.push({ pkgName, severity: vuln.severity, advisories })
    } else {
      blocked.push({ pkgName, severity: vuln.severity, advisories })
    }
  }

  if (blocked.length > 0) {
    console.error('npm audit gate: high/critical vulnerabilities found (blocking)')
    for (const item of blocked) {
      console.error(`- ${item.pkgName} (${item.severity}) ${item.advisories.length ? item.advisories.join(',') : ''}`)
    }
    process.exit(1)
  }

  if (allowed.length > 0) {
    console.warn('npm audit gate: high/critical vulnerabilities present but allowlisted')
    for (const item of allowed) {
      console.warn(`- ${item.pkgName} (${item.severity}) ${item.advisories.join(',')}`)
    }
    process.exit(0)
  }

  console.log('npm audit gate: PASS (no high/critical vulnerabilities)')
  process.exit(0)
}

main()
