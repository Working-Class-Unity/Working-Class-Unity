import Database from 'better-sqlite3'
import { randomUUID } from 'node:crypto'
import { mkdirSync, realpathSync } from 'node:fs'
import { hostname } from 'node:os'
import { dirname, join } from 'node:path'
import { connectDatabase, verifySqliteIntegrityAndForeignKeys } from '../server/db/connect'
import {
  applySolidarityEventSync,
  previewSolidarityEventSync,
  type SolidarityEventSyncCapture,
  type SolidarityEventSyncPreview
} from '../server/services/events/solidarity-sync'

// This private operator receives JSON on stdin; stdout is consumed by the local CLI.
process.umask(0o077)
try {
  const [operation, ...args] = process.argv.slice(2)
  if (operation === '--help') {
    console.log(
      'Usage: solidarity-event-operator.mjs <preview|apply> [--database-url file:/absolute/path] < private.json'
    )
  } else {
    if (!['preview', 'apply'].includes(operation ?? '')) throw new Error('Expected preview or apply')
    if (args.length && (args.length !== 2 || args[0] !== '--database-url')) throw new Error('Invalid operator options')
    const databaseUrl = args[1] ?? process.env.NUXT_DATABASE_URL
    if (!databaseUrl?.startsWith('file:/')) throw new Error('An absolute file: database URL is required')
    const chunks: Buffer[] = []
    let size = 0
    for await (const chunk of process.stdin) {
      size += Buffer.byteLength(chunk)
      if (size > 25 * 1024 * 1024) throw new Error('Sync input exceeds 25 MiB')
      chunks.push(Buffer.from(chunk))
    }
    let input
    try {
      input = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    } catch {
      throw new Error('Sync input is not valid JSON')
    }
    // Preview must not create a database or change its journal mode.
    const check = new Database(databaseUrl.slice(5), { readonly: true, fileMustExist: true })
    const readConnection = { sqlite: check, databasePath: databaseUrl.slice(5) } as ReturnType<typeof connectDatabase>
    const target = `${hostname()}:${realpathSync(readConnection.databasePath)}`
    let output: unknown
    try {
      if (operation === 'preview') {
        output = previewSolidarityEventSync(readConnection, input as SolidarityEventSyncCapture, target)
      } else {
        const { preview, approve, retireSessionIds } = input as {
          preview: SolidarityEventSyncPreview
          approve: string
          retireSessionIds: string[]
        }
        if (!preview || approve !== preview.digest) throw new Error('Apply requires the exact reviewed preview digest')
        const current = previewSolidarityEventSync(readConnection, preview.capture, target)
        if (current.digest !== approve) throw new Error('Preview is stale or changed; preview again')
        if (
          !Array.isArray(retireSessionIds) ||
          retireSessionIds.some((id) => !current.retirementCandidates.some((candidate) => candidate.sessionId === id))
        ) {
          throw new Error('Retirement selection is not in this preview')
        }
        const changes = current.changes.length > 0 || retireSessionIds.length > 0
        let backup: string | null = null
        if (changes) {
          const directory = join(dirname(readConnection.databasePath), 'backups')
          mkdirSync(directory, { recursive: true, mode: 0o700 })
          backup = join(directory, `events-${Date.now()}-${randomUUID()}.db`)
          await check.backup(backup)
          const copy = new Database(backup, { readonly: true, fileMustExist: true })
          try {
            verifySqliteIntegrityAndForeignKeys(copy, 'Event backup', (message) => {
              throw new Error(message)
            })
          } finally {
            copy.close()
          }
        }
        const connection = connectDatabase(databaseUrl)
        output = {
          ...applySolidarityEventSync(connection, preview, { retireSessionIds, observedAt: new Date(), target }),
          backup
        }
        connection.sqlite.close()
      }
    } finally {
      check.close()
    }
    console.log(JSON.stringify(output))
  }
} catch (error) {
  console.error(`Event sync failed: ${error instanceof Error ? error.message : 'invalid input'}`)
  process.exitCode = 1
}
