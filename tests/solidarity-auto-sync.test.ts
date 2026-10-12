import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, expect, it } from 'vitest'
import { runAutoSync } from '../scripts/lib/solidarity-auto.mjs'
import { sendResendEmail } from '../scripts/lib/solidarity-alerts.mjs'

const migrationsFolder = fileURLToPath(new URL('../server/db/migrations/', import.meta.url))
const observedAt = '2026-09-09T12:00:00.000Z'
const scope = {
  eventIds: ['event'],
  from: '2026-09-01T00:00:00.000Z',
  to: '2026-10-01T00:00:00.000Z',
  completeInventory: true
}
const event = {
  id: 'event',
  title: 'General meeting',
  status: 'active',
  timezone: 'America/Los_Angeles',
  eventTags: ['audience-public', 'category-meeting', 'meeting-general'],
  campaignTags: [],
  description: 'Private description',
  eventPageUrl: 'https://example.test/event'
}

function session(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    eventId: 'event',
    eventType: 'in_person',
    status: 'scheduled',
    startsAt: '2026-09-15T19:00:00.000Z',
    endsAt: '2026-09-15T20:00:00.000Z',
    timezone: 'America/Los_Angeles',
    title: 'September meeting',
    locationName: 'Hall',
    locationAddress: '100 Main St',
    ...overrides
  }
}

function capture(sessions: readonly Record<string, unknown>[]) {
  return { dataset: { events: [event], sessions }, scope, observedAt }
}

const directories: string[] = []
afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

function createDatabase() {
  const directory = mkdtempSync(join(tmpdir(), 'wcu-auto-'))
  directories.push(directory)
  const databasePath = join(directory, 'app.db')
  const sqlite = new Database(databasePath)
  sqlite.pragma('foreign_keys = ON')
  try {
    migrate(drizzle({ client: sqlite }), { migrationsFolder })
  } finally {
    sqlite.close()
  }
  return { directory, databasePath, databaseUrl: `file:${databasePath}` }
}

function count(databasePath: string, where = ''): number {
  const database = new Database(databasePath, { readonly: true })
  try {
    return (database.prepare(`select count(*) as total from event_sessions ${where}`).get() as { total: number }).total
  } finally {
    database.close()
  }
}

function recorder() {
  const messages: Array<{ subject: string; text: string }> = []
  return {
    messages,
    alert: async (message: { subject: string; text: string }) => {
      messages.push(message)
      return { status: 'sent' }
    }
  }
}

it('applies a complete inventory, then reports a no-op without backups or email', async () => {
  const { directory, databasePath, databaseUrl } = createDatabase()
  const { messages, alert } = recorder()
  const first = await runAutoSync({ collect: async () => ({ capture: capture([session('101')]) }), databaseUrl, alert })
  expect(first.status).toBe('applied')
  expect(first.changeCount).toBeGreaterThan(0)
  expect(first.retirementCount).toBe(0)
  expect(existsSync(first.backup)).toBe(true)
  expect(JSON.parse(readFileSync(first.receiptPath, 'utf8'))).toMatchObject({
    operation: 'auto',
    backup: first.backup,
    retiredSessionIds: []
  })
  expect(messages).toHaveLength(1)
  expect(messages[0].subject).toMatch(/auto-sync: \d+ changed, 0 retired/)
  expect(count(databasePath)).toBe(1)
  const second = await runAutoSync({
    collect: async () => ({ capture: capture([session('101')]) }),
    databaseUrl,
    alert
  })
  expect(second).toEqual({ status: 'noop', target: first.target })
  expect(messages).toHaveLength(1)
  expect(readdirSync(join(directory, 'backups'))).toHaveLength(1)
})

it('retires a session missing from a complete inventory on the first run that reports it', async () => {
  const { databasePath, databaseUrl } = createDatabase()
  const { messages, alert } = recorder()
  const both = [
    session('101'),
    session('102', { startsAt: '2026-09-22T19:00:00.000Z', endsAt: '2026-09-22T20:00:00.000Z' })
  ]
  const kept = session('102', { startsAt: '2026-09-22T19:00:00.000Z', endsAt: '2026-09-22T20:00:00.000Z' })
  await runAutoSync({ collect: async () => ({ capture: capture(both) }), databaseUrl, alert })
  const missing = await runAutoSync({ collect: async () => ({ capture: capture([kept]) }), databaseUrl, alert })
  expect(missing).toMatchObject({ status: 'applied', changeCount: 0, retirementCount: 1 })
  expect(messages).toHaveLength(2)
  expect(messages[1].subject).toMatch(/auto-sync: 0 changed, 1 retired/)
  expect(messages[1].text).toContain('RETIRED')
  expect(count(databasePath, "where status = 'canceled'")).toBe(1)
  expect(JSON.parse(readFileSync(missing.receiptPath, 'utf8')).retiredSessionIds).toHaveLength(1)
})

it('plans without writing, backing up, or emailing during a dry run', async () => {
  const { directory, databasePath, databaseUrl } = createDatabase()
  const { messages, alert } = recorder()
  const result = await runAutoSync({
    collect: async () => ({ capture: capture([session('101')]) }),
    databaseUrl,
    alert,
    dryRun: true
  })
  expect(result.status).toBe('dry-run')
  expect(result.changeCount).toBeGreaterThan(0)
  expect(String(result.changes[0])).toMatch(/^(CREATE|UPDATE)/)
  expect(count(databasePath)).toBe(0)
  expect(existsSync(join(directory, 'backups'))).toBe(false)
  expect(existsSync(join(directory, 'sync-runs'))).toBe(false)
  expect(messages).toHaveLength(0)
})

it('retires a wholly deleted series while retaining completed history and rejecting partial inventories', async () => {
  const { databasePath, databaseUrl } = createDatabase()
  const { alert } = recorder()
  const original = capture([
    session('101', { pairedSessionId: '102' }),
    session('102', {
      eventType: 'virtual',
      pairedSessionId: '101',
      locationName: null,
      locationAddress: null,
      virtualUrl: 'https://meet.example.test/private'
    }),
    session('completed', { status: 'completed' })
  ])
  expect((await runAutoSync({ collect: async () => ({ capture: original }), databaseUrl, alert })).status).toBe(
    'applied'
  )
  const deleted = {
    dataset: { events: [], sessions: [] },
    scope: { ...scope, eventIds: [] },
    observedAt
  }
  const partial = await runAutoSync({
    collect: async () => ({ capture: { ...deleted, scope: { ...deleted.scope, completeInventory: false } } }),
    databaseUrl,
    alert
  })
  expect(partial).toMatchObject({ status: 'failed', stage: 'plan' })
  expect(count(databasePath, "where status = 'canceled'")).toBe(0)
  const result = await runAutoSync({ collect: async () => ({ capture: deleted }), databaseUrl, alert })
  expect(result).toMatchObject({ status: 'applied', retirementCount: 1 })
  expect(count(databasePath, "where status = 'canceled'")).toBe(1)
  expect(count(databasePath, "where status = 'completed'")).toBe(1)
  expect((await runAutoSync({ collect: async () => ({ capture: deleted }), databaseUrl, alert })).status).toBe('noop')
})

it('sends the organizer email through Resend and reports delivery failures without exposing provider bodies', async () => {
  const email = {
    apiKey: 'test-only-key',
    from: 'alerts@example.test',
    to: 'organizer@example.test',
    subject: 'Events changed',
    text: 'One session updated'
  }
  const sent = await sendResendEmail({
    ...email,
    fetchImpl: async (url: string, init: RequestInit) => {
      expect(url).toBe('https://api.resend.com/emails')
      expect(init.method).toBe('POST')
      expect(new Headers(init.headers).get('authorization')).toBe('Bearer test-only-key')
      expect(JSON.parse(String(init.body))).toEqual({
        from: email.from,
        to: [email.to],
        subject: email.subject,
        text: email.text
      })
      return new Response('{"id":"message"}', { status: 200 })
    }
  })
  expect(sent).toEqual({ status: 'sent' })
  const rejected = await sendResendEmail({
    ...email,
    fetchImpl: async () => new Response('private provider diagnostics', { status: 429 })
  })
  expect(rejected).toEqual({ status: 'failed', reason: 'Resend returned HTTP 429' })
})

it('reports a collection failure with an actionable alert and never throws', async () => {
  const { databaseUrl } = createDatabase()
  const { messages, alert } = recorder()
  const result = await runAutoSync({
    collect: async () => {
      throw new Error('Solidarity dashboard: GET failed or redirected; check dashboard sign-in')
    },
    databaseUrl,
    alert
  })
  expect(result).toMatchObject({ status: 'failed', stage: 'collect' })
  expect(result.message).toContain('check dashboard sign-in')
  expect(messages).toHaveLength(1)
  expect(messages[0].subject).toBe('WCU events auto-sync failed (collect)')
  expect(messages[0].text).toContain('cookie refresh automation')
})

it('survives an alert sender failure and reports an unreadable database', async () => {
  const { databaseUrl } = createDatabase()
  const broken = await runAutoSync({
    collect: async () => {
      throw new Error('collection failed')
    },
    databaseUrl,
    alert: async () => {
      throw new Error('provider down')
    }
  })
  expect(broken).toMatchObject({ status: 'failed', stage: 'collect', alert: { status: 'failed' } })
  const missing = await runAutoSync({
    collect: async () => ({ capture: capture([session('101')]) }),
    databaseUrl: 'file:/nonexistent/wcu/app.db',
    alert: async () => ({ status: 'sent' })
  })
  expect(missing).toMatchObject({ status: 'failed', stage: 'database' })
})
