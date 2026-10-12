import Database from 'better-sqlite3'
import { randomUUID } from 'node:crypto'
import { mkdirSync, realpathSync, writeFileSync } from 'node:fs'
import { hostname } from 'node:os'
import { dirname, join } from 'node:path'
import { connectDatabase, verifySqliteIntegrityAndForeignKeys } from '../../server/db/connect'
import { applySolidarityEventSync, previewSolidarityEventSync } from '../../server/services/events/solidarity-sync'

/**
 * Unattended Solidarity sync: collect a complete dashboard inventory, plan against the
 * local events database, and apply every validated change. A session missing from a
 * complete inventory retires immediately; incomplete collections never reach apply.
 * Alerts go to an injected sender and never include cookie values or source captures.
 */
export async function runAutoSync({ collect, databaseUrl, alert = defaultAlert, dryRun = false }) {
  if (typeof databaseUrl !== 'string' || !databaseUrl.startsWith('file:/')) {
    throw new Error('An absolute file: database URL is required')
  }
  const databasePath = databaseUrl.slice('file:'.length)
  let collected
  try {
    collected = await collect()
  } catch (error) {
    return failure(alert, 'collect', safeMessage(error))
  }
  if (!collected?.capture) throw new Error('Collector did not return a Solidarity capture')
  const capture = collected.capture
  let check
  try {
    check = new Database(databasePath, { readonly: true, fileMustExist: true })
  } catch {
    return failure(alert, 'database', 'the events database is not readable')
  }
  try {
    const readConnection = { sqlite: check, databasePath }
    const target = `${hostname()}:${realpathSync(databasePath)}`
    let preview
    try {
      if (capture.scope?.completeInventory !== true) {
        throw new Error('Unattended sync requires a complete Solidarity event inventory')
      }
      preview = previewSolidarityEventSync(readConnection, capture, target)
    } catch (error) {
      return failure(alert, 'plan', safeMessage(error))
    }
    const changes = describeChanges(preview)
    const retirements = preview.retirementCandidates.map(
      ({ title, startsAt }) => `${JSON.stringify(title)} ${startsAt}`
    )
    const issues = preview.plan.projection.issues.map(
      ({ code, objectType, externalId }) => `${code} ${objectType} ${externalId}`
    )
    if (dryRun) {
      return {
        status: 'dry-run',
        target,
        changeCount: changes.length,
        retirementCount: retirements.length,
        changes,
        retirements,
        issues
      }
    }
    if (!changes.length && !retirements.length) return { status: 'noop', target }
    let backup
    try {
      backup = await createBackup(check, databasePath)
    } catch (error) {
      return failure(alert, 'backup', safeMessage(error))
    }
    let receipt
    try {
      const connection = connectDatabase(databaseUrl)
      receipt = applySolidarityEventSync(connection, preview, {
        retireSessionIds: preview.retirementCandidates.map(({ sessionId }) => sessionId),
        observedAt: new Date(),
        target
      })
    } catch (error) {
      return failure(alert, 'apply', safeMessage(error))
    }
    let receiptPath
    try {
      receiptPath = writeReceipt(databasePath, {
        version: 1,
        operation: 'auto',
        target,
        observedAt: capture.observedAt,
        appliedAt: new Date().toISOString(),
        digest: preview.digest,
        backup,
        retiredSessionIds: receipt.retiredSessionIds,
        changes: receipt.changes,
        issues,
        report: receipt.report
      })
    } catch {
      return {
        ...(await failure(alert, 'receipt', 'Changes were applied, but the private sync receipt could not be written')),
        applied: true,
        backup,
        changeCount: changes.length,
        retirementCount: receipt.retiredSessionIds.length
      }
    }
    const result = {
      status: 'applied',
      target,
      changeCount: changes.length,
      retirementCount: receipt.retiredSessionIds.length,
      backup,
      receiptPath
    }
    result.alert = await alertWith(alert, {
      subject: `WCU events auto-sync: ${changes.length} changed, ${receipt.retiredSessionIds.length} retired`,
      text: [
        `Target: ${target}`,
        `${changes.length} change(s), ${receipt.retiredSessionIds.length} retirement(s)`,
        ...changes.map((line) => `- ${line}`),
        ...retirements.map((line) => `- RETIRED ${line}`),
        ...issues.map((line) => `- ISSUE ${line}`),
        `Receipt: ${receiptPath}`,
        `Backup: ${backup}`
      ].join('\n')
    })
    return result
  } finally {
    check.close()
  }
}

async function defaultAlert() {
  return { status: 'skipped', reason: 'alerting is not configured' }
}

async function failure(alert, stage, message) {
  const result = { status: 'failed', stage, message }
  result.alert = await alertWith(alert, {
    subject: `WCU events auto-sync failed (${stage})`,
    text: [
      `Stage: ${stage}`,
      `Failure: ${message}`,
      '',
      'If this is a dashboard sign-in failure, run the Solidarity cookie refresh automation and check the next scheduled run.'
    ].join('\n')
  })
  return result
}

async function alertWith(alert, message) {
  try {
    return await alert(message)
  } catch {
    return { status: 'failed', reason: 'alert delivery failed' }
  }
}

async function createBackup(check, databasePath) {
  const directory = join(dirname(databasePath), 'backups')
  mkdirSync(directory, { recursive: true, mode: 0o700 })
  const backup = join(directory, `events-${Date.now()}-${randomUUID()}.db`)
  await check.backup(backup)
  const copy = new Database(backup, { readonly: true, fileMustExist: true })
  try {
    verifySqliteIntegrityAndForeignKeys(copy, 'Event backup', (message) => {
      throw new Error(message)
    })
  } finally {
    copy.close()
  }
  return backup
}

function writeReceipt(databasePath, receipt) {
  const directory = join(dirname(databasePath), 'sync-runs')
  mkdirSync(directory, { recursive: true, mode: 0o700 })
  const path = join(directory, `auto-${Date.now()}-${randomUUID()}.json`)
  writeFileSync(path, JSON.stringify(receipt), { flag: 'wx', mode: 0o600 })
  return path
}

function describeChanges(preview) {
  return preview.changes.map((change) => {
    const rows = change.level === 'series' ? preview.plan.projection.events : preview.plan.projection.sessions
    const row = rows.find(({ after }) => after.id === change.id)?.after
    const details =
      change.kind === 'create'
        ? [row?.startsAt, row?.deliveryMode, row?.category].filter(Boolean).join(' | ')
        : change.fields
            .map(({ field, before, after }) =>
              after === undefined
                ? `${field}: changed`
                : `${field}: ${JSON.stringify(before)} -> ${JSON.stringify(after)}`
            )
            .join('; ')
    return `${change.kind.toUpperCase()} ${change.level} ${JSON.stringify(row?.title ?? change.id)} [${change.id}] ${details}`
  })
}

function safeMessage(error) {
  const message = error && typeof error === 'object' && typeof error.message === 'string' ? error.message : ''
  return message.slice(0, 500) || 'unexpected failure'
}
