import { randomUUID } from 'node:crypto'
import {
  chmodSync,
  closeSync,
  existsSync,
  fsyncSync,
  linkSync,
  lstatSync,
  openSync,
  readFileSync,
  unlinkSync,
  writeFileSync
} from 'node:fs'
import { basename, dirname, resolve } from 'node:path'
import {
  convertSolidarityEventReports,
  type SolidarityEventReportInput
} from '../server/services/events/solidarity-report-converter'

const maximumBytes = 25 * 1024 * 1024
const usage = `Usage: node .output/server/normalize-solidarity-events.mjs [options]

Converts private Solidarity People JSON, event metadata JSON, and RSVP CSV reports into one
validated normalized bundle. The command never accesses SQLite or the network.

Options:
  --people <file>               Solidarity People JSON report (required once)
  --event <file>                WCU event metadata JSON (repeat once per event)
  --rsvps <file>                Matching Solidarity RSVP CSV (repeat once per event)
  --bundle <file>               New normalized bundle path (required)
  --manifest <file>             New redacted manifest path (required)
  --help                        Show this help
`

try {
  main()
} catch {
  console.error('Solidarity report normalization failed (converter_failed).')
  process.exitCode = 1
}

function main(): void {
  const options = parseArguments(process.argv.slice(2))
  if (options.help) {
    console.log(usage)
    return
  }

  const peoplePath = resolve(options.people!)
  const eventPaths = options.events.map((path) => resolve(path))
  const rsvpPaths = options.rsvps.map((path) => resolve(path))
  const bundlePath = resolve(options.bundle!)
  const manifestPath = resolve(options.manifest!)
  if (bundlePath === manifestPath) throw new TypeError('Bundle and manifest paths must be different')
  if (existsSync(bundlePath) || existsSync(manifestPath)) throw new Error('Output path already exists')

  const inputPaths = [peoplePath, ...eventPaths, ...rsvpPaths]
  const inputSizes = inputPaths.map((path) => {
    const stats = lstatSync(path)
    if (!stats.isFile()) throw new TypeError('Solidarity report input must be a regular file')
    return stats.size
  })
  if (inputSizes.reduce((total, size) => total + size, 0) > maximumBytes) {
    throw new Error('Solidarity report inputs exceed the 25 MiB limit')
  }
  const sources = inputPaths.map((path, index) => readPrivateInput(path, inputSizes[index]!))
  const people = sources[0]!
  const eventSources = sources.slice(1, eventPaths.length + 1)
  const rsvpSources = sources.slice(eventPaths.length + 1)

  const reports: SolidarityEventReportInput[] = eventSources.map((event, index) => ({
    event,
    rsvps: rsvpSources[index]!
  }))
  const conversion = convertSolidarityEventReports({ people, reports })
  if (Buffer.byteLength(conversion.bundleText) > maximumBytes) {
    throw new Error('Normalized Solidarity bundle exceeds the 25 MiB limit')
  }
  writePrivatePair(bundlePath, conversion.bundleText, manifestPath, conversion.manifestText)
  console.log(
    JSON.stringify({
      bundleCounts: conversion.manifest.bundleCounts,
      bundleSha256: conversion.manifest.bundleSha256,
      issueCounts: conversion.manifest.issueCounts,
      rawCounts: conversion.manifest.rawCounts
    })
  )
}

function readPrivateInput(path: string, expectedSize: number): Buffer {
  const before = lstatSync(path)
  if (!before.isFile() || before.size !== expectedSize)
    throw new Error('Solidarity report input changed before reading')
  const contents = readFileSync(path)
  const after = lstatSync(path)
  if (!after.isFile() || before.size !== contents.byteLength || before.mtimeMs !== after.mtimeMs) {
    throw new Error('Solidarity report input changed while it was being read')
  }
  return contents
}

function parseArguments(arguments_: readonly string[]): Readonly<{
  bundle?: string
  events: readonly string[]
  help: boolean
  manifest?: string
  people?: string
  rsvps: readonly string[]
}> {
  let bundle: string | undefined
  const events: string[] = []
  let help = false
  let manifest: string | undefined
  let people: string | undefined
  const rsvps: string[] = []
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index]!
    if (argument === '--') continue
    if (argument === '--help') {
      help = true
      continue
    }
    const [key, inlineValue] = splitOption(argument)
    if (!['--bundle', '--event', '--manifest', '--people', '--rsvps'].includes(key)) {
      throw new TypeError('Unknown Solidarity report normalization argument')
    }
    const value = inlineValue ?? arguments_[index + 1]
    if (!value || value.startsWith('--')) throw new TypeError('Solidarity report normalization option requires a value')
    if (inlineValue === undefined) index += 1
    if (key === '--event') events.push(value)
    else if (key === '--rsvps') rsvps.push(value)
    else if (key === '--bundle') {
      if (bundle) throw new TypeError('--bundle may be provided only once')
      bundle = value
    } else if (key === '--manifest') {
      if (manifest) throw new TypeError('--manifest may be provided only once')
      manifest = value
    } else {
      if (people) throw new TypeError('--people may be provided only once')
      people = value
    }
  }
  if (!help && (!bundle || !manifest || !people || events.length === 0 || events.length !== rsvps.length)) {
    throw new TypeError('People, outputs, and aligned event/RSVP report pairs are required')
  }
  return Object.freeze({ bundle, events: Object.freeze(events), help, manifest, people, rsvps: Object.freeze(rsvps) })
}

function splitOption(argument: string): readonly [string, string | undefined] {
  const separator = argument.indexOf('=')
  return separator === -1 ? [argument, undefined] : [argument.slice(0, separator), argument.slice(separator + 1)]
}

function writePrivatePair(bundlePath: string, bundle: string, manifestPath: string, manifest: string): void {
  const bundleTemporary = temporaryPath(bundlePath)
  const manifestTemporary = temporaryPath(manifestPath)
  let bundleLinked = false
  let manifestLinked = false
  try {
    writePrivateFile(bundleTemporary, bundle)
    writePrivateFile(manifestTemporary, manifest)
    linkSync(bundleTemporary, bundlePath)
    bundleLinked = true
    linkSync(manifestTemporary, manifestPath)
    manifestLinked = true
  } catch (error) {
    if (manifestLinked) removeOwnedFile(manifestPath)
    if (bundleLinked) removeOwnedFile(bundlePath)
    throw error
  } finally {
    removeOwnedFile(bundleTemporary)
    removeOwnedFile(manifestTemporary)
  }
}

function writePrivateFile(path: string, contents: string): void {
  const descriptor = openSync(path, 'wx', 0o600)
  try {
    writeFileSync(descriptor, contents, 'utf8')
    fsyncSync(descriptor)
    chmodSync(path, 0o600)
  } finally {
    closeSync(descriptor)
  }
}

function temporaryPath(path: string): string {
  return resolve(dirname(path), `.${basename(path)}.${process.pid}.${randomUUID()}.tmp`)
}

function removeOwnedFile(path: string): void {
  try {
    unlinkSync(path)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
}
