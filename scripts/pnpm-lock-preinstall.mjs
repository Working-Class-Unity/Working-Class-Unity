import { dirname, relative, sep } from 'node:path'

const INSTALLABLE_SECTIONS = ['dependencies', 'devDependencies', 'optionalDependencies']

export function inspectPnpmLockfile(source, manifests) {
  const errors = []
  if (typeof source !== 'string') {
    return { errors: ['pnpm-lock.yaml source must be text'], packageCount: 0 }
  }
  if (!Array.isArray(manifests)) {
    return { errors: ['tracked package manifests must be an array'], packageCount: 0 }
  }

  const lines = source.split(/\r?\n/)
  errors.push(...validateTopLevel(lines))

  const importerResult = parseImporters(lines)
  errors.push(...importerResult.errors)
  errors.push(...validateImporters(importerResult.importers, manifests))

  const packageResult = inspectPackages(lines)
  errors.push(...packageResult.errors)

  return { errors, packageCount: packageResult.packageCount }
}

function validateTopLevel(lines) {
  const errors = []
  const allowed = new Set([
    "lockfileVersion: '9.0'",
    'settings:',
    'overrides:',
    'importers:',
    'packages:',
    'snapshots:'
  ])
  const topLevel = lines.filter((line) => /^[^\s#]/.test(line))
  if (topLevel.some((line) => !allowed.has(line))) {
    errors.push('pnpm-lock.yaml contains a noncanonical top-level entry')
  }

  for (const required of ["lockfileVersion: '9.0'", 'settings:', 'importers:', 'packages:', 'snapshots:']) {
    if (topLevel.filter((line) => line === required).length !== 1) {
      errors.push(`pnpm-lock.yaml must contain exactly one canonical ${required.split(':')[0]} entry`)
    }
  }
  if (topLevel.filter((line) => line === 'overrides:').length > 1) {
    errors.push('pnpm-lock.yaml must not duplicate its overrides entry')
  }

  const importerIndex = topLevel.indexOf('importers:')
  const packageIndex = topLevel.indexOf('packages:')
  const snapshotIndex = topLevel.indexOf('snapshots:')
  if (!(importerIndex < packageIndex && packageIndex < snapshotIndex)) {
    errors.push('pnpm-lock.yaml must order importers before packages before snapshots')
  }
  return errors
}

function parseImporters(lines) {
  const errors = []
  const importers = new Map()
  const start = lines.findIndex((line) => line === 'importers:')
  const end = lines.findIndex((line, index) => index > start && line === 'packages:')
  if (start === -1 || end === -1 || end <= start) {
    return { errors: ['pnpm-lock.yaml must contain canonical importers before packages'], importers }
  }

  let importer
  let section
  let dependency
  for (const line of lines.slice(start + 1, end)) {
    if (line.trim() === '' || line.trimStart().startsWith('#')) continue

    let match = line.match(/^ {2}(\S.*):$/)
    if (match) {
      const name = decodeScalar(match[1])
      if (importers.has(name)) errors.push('pnpm-lock.yaml must not contain duplicate importers')
      importer = { sections: new Map() }
      importers.set(name, importer)
      section = undefined
      dependency = undefined
      continue
    }

    match = line.match(/^ {4}(dependencies|devDependencies|optionalDependencies):$/)
    if (match && importer) {
      if (importer.sections.has(match[1])) {
        errors.push('pnpm-lock.yaml importer dependency sections must not be duplicated')
      }
      section = new Map()
      importer.sections.set(match[1], section)
      dependency = undefined
      continue
    }

    match = line.match(/^ {6}(\S.*):$/)
    if (match && section) {
      const name = decodeScalar(match[1])
      if (section.has(name)) errors.push('pnpm-lock.yaml must not contain duplicate importer dependencies')
      dependency = {}
      section.set(name, dependency)
      continue
    }

    match = line.match(/^ {8}(specifier|version): (.+)$/)
    if (match && dependency) {
      if (Object.hasOwn(dependency, match[1])) {
        errors.push('pnpm-lock.yaml importer dependencies must not repeat specifier or version')
      }
      dependency[match[1]] = decodeScalar(match[2])
      continue
    }

    errors.push('pnpm-lock.yaml importers must use the canonical pnpm mapping shape')
  }

  return { errors, importers }
}

function validateImporters(importers, manifests) {
  const errors = []
  const expectedImporters = new Set()
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

  for (const { path, manifest } of manifests) {
    const importerPath = normalizeImporterPath(path)
    expectedImporters.add(importerPath)
    const importer = importers.get(importerPath)
    if (!importer) {
      errors.push(`pnpm-lock.yaml is missing importer ${importerPath}`)
      continue
    }

    for (const sectionName of INSTALLABLE_SECTIONS) {
      const declared = isRecord(manifest?.[sectionName]) ? manifest[sectionName] : {}
      const locked = importer.sections.get(sectionName) ?? new Map()
      const names = new Set([...Object.keys(declared), ...locked.keys()])

      for (const name of names) {
        const declaration = declared[name]
        const resolution = locked.get(name)
        if (declaration === undefined) {
          errors.push(`pnpm-lock.yaml importer ${importerPath} has an undeclared dependency`)
          continue
        }
        if (!resolution) {
          errors.push(`pnpm-lock.yaml importer ${importerPath} is missing a declared dependency`)
          continue
        }
        if (resolution.specifier !== declaration) {
          errors.push(`pnpm-lock.yaml importer ${importerPath} has dependency specifier drift`)
          continue
        }

        const local = localPackages.get(name)
        const expectedVersion = local ? `link:${workspaceLinkTarget(path, local.path)}` : declaration
        const versionMatches = local
          ? resolution.version === expectedVersion
          : resolution.version === expectedVersion || resolution.version?.startsWith(`${expectedVersion}(`)
        if (!versionMatches) {
          errors.push(`pnpm-lock.yaml importer ${importerPath} has dependency resolution drift`)
        }
      }
    }
  }

  for (const importerPath of importers.keys()) {
    if (!expectedImporters.has(importerPath)) {
      errors.push('pnpm-lock.yaml contains an importer without a tracked package manifest')
    }
  }

  return errors
}

function inspectPackages(lines) {
  const errors = []
  const start = lines.findIndex((line) => line === 'packages:')
  if (start === -1) return { errors: ['pnpm-lock.yaml must contain a packages section'], packageCount: 0 }

  const seen = new Set()
  let current
  let packageCount = 0
  const finishPackage = () => {
    if (current && current.integrities !== 1) {
      errors.push('every pnpm lock package must contain exactly one canonical SHA-512 registry integrity')
    }
  }

  for (const line of lines.slice(start + 1)) {
    if (/^[^\s#]/.test(line)) break
    if (line.trim() === '' || line.trimStart().startsWith('#')) continue

    const header = line.match(/^ {2}(\S.*):$/)
    if (header) {
      finishPackage()
      const key = header[1]
      if (seen.has(key)) errors.push('pnpm-lock.yaml must not contain duplicate package resolutions')
      seen.add(key)
      current = { integrities: 0 }
      packageCount += 1
      continue
    }

    if (/^ {2}\S/.test(line)) {
      errors.push('pnpm-lock.yaml package headers must use the canonical pnpm mapping shape')
      current = undefined
      continue
    }

    if (!current) {
      errors.push('pnpm-lock.yaml packages must use the canonical pnpm mapping shape')
      continue
    }
    if (/tarball\s*:/.test(line)) {
      errors.push('pnpm-lock.yaml package resolutions must not use custom tarballs')
    }
    if (/^ {4}resolution:/.test(line)) {
      const resolution = line.match(/^ {4}resolution: \{integrity: (sha512-[A-Za-z0-9+/]+={0,2})\}$/)
      if (!resolution || !isSha512Integrity(resolution[1])) {
        errors.push('pnpm-lock.yaml package resolution must use canonical SHA-512 integrity only')
      } else {
        current.integrities += 1
      }
    }
  }
  finishPackage()

  if (packageCount === 0) errors.push('pnpm-lock.yaml packages section must not be empty')
  return { errors, packageCount }
}

function workspaceLinkTarget(importerManifestPath, targetManifestPath) {
  const importerDirectory = dirname(importerManifestPath)
  const targetDirectory = dirname(targetManifestPath)
  return (relative(importerDirectory, targetDirectory) || '.').split(sep).join('/')
}

function normalizeImporterPath(manifestPath) {
  const directory = dirname(manifestPath).split(sep).join('/')
  return directory === '.' ? '.' : directory
}

function decodeScalar(value) {
  const trimmed = value.trim()
  if (trimmed.startsWith("'") && trimmed.endsWith("'")) {
    return trimmed.slice(1, -1).replaceAll("''", "'")
  }
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    try {
      return JSON.parse(trimmed)
    } catch {
      return trimmed
    }
  }
  return trimmed
}

function isSha512Integrity(value) {
  if (typeof value !== 'string' || !value.startsWith('sha512-')) return false
  const encoded = value.slice('sha512-'.length)
  try {
    const digest = Buffer.from(encoded, 'base64')
    return digest.length === 64 && digest.toString('base64') === encoded
  } catch {
    return false
  }
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
