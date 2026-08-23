import { readFileSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
import { connectDatabase } from '../server/db/connect'
import {
  importSolidarityEventDataset,
  type SolidarityEventImportDataset,
  type SolidarityEventImportReport
} from '../server/services/events/solidarity-import'

const maximumInputBytes = 25 * 1024 * 1024
const usage = `Usage: node .output/server/import-solidarity-events.mjs --input <file> [options]

Imports a validated normalized bundle assembled from Solidarity reports. The command is a local database
dry run unless --apply is provided. It never calls or changes Solidarity.

Options:
  --input <file>                 Normalized Solidarity JSON export (required)
  --apply                        Write the imported records to SQLite
  --database-url <file:...>      Override NUXT_DATABASE_URL
  --help                         Show this help
`

main()

function main() {
  const options = parseArguments(process.argv.slice(2))
  if (options.help) {
    console.log(usage)
    return
  }
  const inputPath = resolve(options.input!)
  const inputSize = statSync(inputPath).size
  if (inputSize > maximumInputBytes) throw new Error('Solidarity import input exceeds the 25 MiB limit')
  const dataset = JSON.parse(readFileSync(inputPath, 'utf8')) as SolidarityEventImportDataset
  const databaseUrl = options.databaseUrl ?? process.env.NUXT_DATABASE_URL
  if (!databaseUrl) throw new Error('NUXT_DATABASE_URL is required')

  const report = importSolidarityEventDataset(connectDatabase(databaseUrl), dataset, {
    apply: options.apply,
    observedAt: new Date(),
    sourceName: 'solidarity-manual-event-export'
  })
  console.log(JSON.stringify(redactedReceipt(report)))
}

function parseArguments(
  arguments_: readonly string[]
): Readonly<{ apply: boolean; databaseUrl?: string; help: boolean; input?: string }> {
  let apply = false
  let databaseUrl: string | undefined
  let help = false
  let input: string | undefined
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index]!
    if (argument === '--') continue
    if (argument === '--apply') {
      apply = true
      continue
    }
    if (argument === '--help') {
      help = true
      continue
    }
    const [key, inlineValue] = splitOption(argument)
    if (key === '--input' || key === '--database-url') {
      const value = inlineValue ?? arguments_[index + 1]
      if (!value || value.startsWith('--')) throw new TypeError(`${key} requires a value`)
      if (key === '--input') input = value
      else databaseUrl = value
      if (inlineValue === undefined) index += 1
      continue
    }
    throw new TypeError(`Unknown Solidarity import argument: ${key}`)
  }
  if (!help && !input) throw new TypeError('--input is required')
  return Object.freeze({ apply, databaseUrl, help, input })
}

function splitOption(argument: string): readonly [string, string | undefined] {
  const separator = argument.indexOf('=')
  return separator === -1 ? [argument, undefined] : [argument.slice(0, separator), argument.slice(separator + 1)]
}

function redactedReceipt(report: SolidarityEventImportReport) {
  const issueCodes: Record<string, number> = {}
  for (const { code } of report.issues) issueCodes[code] = (issueCodes[code] ?? 0) + 1
  return Object.freeze({
    activities: report.activities,
    batchId: report.batchId,
    events: report.events,
    identities: report.identities,
    issueCodes,
    mode: report.mode,
    sessions: report.sessions,
    snapshots: report.snapshots
  })
}
