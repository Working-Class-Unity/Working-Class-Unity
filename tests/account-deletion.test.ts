import { Buffer } from 'node:buffer'
import { createServer, type Server } from 'node:http'
import {
  createApp,
  createError,
  createRouter,
  getRequestHeaders,
  toNodeListener,
  type EventHandler,
  type H3Event
} from 'h3'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DatabaseConnection } from '../server/db/connect'
import { deleteAccountAtomically, type AccountDeletionCheckpoint } from '../server/services/account-deletion'
import {
  prepareAccountDeletionBilling,
  withAccountDeletionBillingProof,
  type AccountDeletionBillingProof
} from '../server/services/account-deletion-billing'
import {
  accountDeletionConfirmation,
  createAccountDeletionHandler,
  type AccountDeletionCommandDependencies
} from '../server/services/account-deletion-command'
import type { BillingStripeRuntimeConfiguration } from '../server/services/payments/stripe/configuration'
import { createAccountDeletionUserOptions } from '../server/utils/auth/account-deletion'
import { assertFreshAccountDeletionSession } from '../server/utils/auth/account-deletion-freshness'
import type { AppSession } from '../server/utils/auth/require-session'
import { accountDeletionFreshAgeSeconds } from '../server/utils/auth/security'
import { requestWithChunkedBody, requestWithDeclaredBody } from './billing/http-request'
import { createBillingStripeRuntimeFixture } from './billing/runtime-fixture'

const openServers = new Set<Server>()

afterEach(async () => {
  await Promise.all([...openServers].map((server) => new Promise<void>((resolve) => server.close(() => resolve()))))
  openServers.clear()
})

describe('immediate account deletion', () => {
  it('keeps the role server-owned while preserving Better Auth deletion hooks', () => {
    const fixture = createAccountDeletionFixture('identity-options')
    try {
      const options = createAccountDeletionUserOptions(fixture.connection)
      expect(options.additionalFields).toEqual({
        role: {
          type: ['user', 'admin'],
          required: false,
          defaultValue: 'user',
          input: false
        }
      })
      expect(options.deleteUser?.enabled).toBe(true)
      expect(options.deleteUser?.beforeDelete).toBeTypeOf('function')
    } finally {
      fixture.cleanup()
    }
  })

  it('authenticates and checks freshness before parsing an exact confirmation', async () => {
    const now = Date.parse('2026-08-04T12:00:00.000Z')
    const session = testSession(new Date(now - accountDeletionFreshAgeSeconds * 1_000 + 1))
    expect(() => assertFreshAccountDeletionSession(session, now)).not.toThrow()
    expect(() =>
      assertFreshAccountDeletionSession(testSession(new Date(now - accountDeletionFreshAgeSeconds * 1_000)), now)
    ).toThrow(expect.objectContaining({ statusCode: 400, data: expect.objectContaining({ code: 'SESSION_EXPIRED' }) }))

    const calls: string[] = []
    const proof = {} as AccountDeletionBillingProof
    const requireSession = vi.fn(async (event: H3Event) => {
      calls.push('authenticate')
      if (getRequestHeaders(event).authorization !== 'Bearer valid') {
        throw createError({ statusCode: 401, statusMessage: 'Authentication required' })
      }
      return session
    })
    const assertFreshSession = vi.fn(() => calls.push('freshness'))
    const prepareDeletion = vi.fn(async () => {
      calls.push('billing')
      return proof
    })
    const requestHeaders = vi.fn(() => {
      calls.push('headers')
      return new Headers()
    })
    const deleteUser = vi.fn(async () => {
      calls.push('delete')
      return Response.json({ success: true })
    })
    const endpoint = await startAccountDeletionServer({
      requireSession,
      assertFreshSession,
      prepareDeletion,
      requestHeaders,
      deleteUser
    })

    const anonymous = await fetch(endpoint, {
      method: 'DELETE',
      headers: { 'content-type': 'application/json' },
      body: '{'
    })
    expect(anonymous.status).toBe(401)
    expect(calls).toEqual(['authenticate'])

    for (const body of [
      {},
      { confirmation: 'delete' },
      { confirmation: accountDeletionConfirmation, userId: session.user.id }
    ]) {
      calls.length = 0
      const response = await deleteRequest(endpoint, body)
      expect(response.status).toBe(400)
      expect(calls).toEqual(['authenticate', 'freshness'])
    }

    calls.length = 0
    const deleted = await deleteRequest(endpoint, { confirmation: accountDeletionConfirmation })
    expect(deleted.status).toBe(200)
    expect(deleted.headers.get('cache-control')).toBe('private, no-store')
    expect(await deleted.json()).toEqual({ success: true })
    expect(calls).toEqual(['authenticate', 'freshness', 'billing', 'headers', 'delete'])
    expect(deleteUser).toHaveBeenCalledWith(expect.any(Headers), proof, session.user.id)
  })

  it.each(['declared-length', 'chunked'] as const)(
    'rejects a %s 65,537-byte body after identity checks and before Billing or deletion',
    async (framing) => {
      const assertFreshSession = vi.fn()
      const prepareDeletion = vi.fn(async () => ({}) as AccountDeletionBillingProof)
      const requestHeaders = vi.fn(() => new Headers())
      const deleteUser = vi.fn(async () => new Response())
      const endpoint = await startAccountDeletionServer({
        requireSession: async () => testSession(new Date()),
        assertFreshSession,
        prepareDeletion,
        requestHeaders,
        deleteUser
      })
      const exactConfirmation = JSON.stringify({ confirmation: accountDeletionConfirmation })
      const payload = Buffer.from(exactConfirmation + ' '.repeat(65_537 - Buffer.byteLength(exactConfirmation)))
      const headers = {
        authorization: 'Bearer valid',
        'content-type': 'application/json'
      }

      const response =
        framing === 'declared-length'
          ? await requestWithDeclaredBody(endpoint, payload.byteLength, [], {
              endRequest: false,
              headers,
              method: 'DELETE'
            })
          : await requestWithChunkedBody(endpoint, [payload.subarray(0, 65_536), payload.subarray(65_536)], {
              headers,
              method: 'DELETE'
            })

      expect(response.status).toBe(413)
      expect(response.body).not.toMatch(/DELETE|65537/)
      expect(assertFreshSession).toHaveBeenCalledOnce()
      expect(prepareDeletion).not.toHaveBeenCalled()
      expect(requestHeaders).not.toHaveBeenCalled()
      expect(deleteUser).not.toHaveBeenCalled()
    }
  )

  it('deletes only purchaser-owned private data under a fresh Billing proof', async () => {
    const fixture = createAccountDeletionFixture('owned-data')
    seedPrivateData(fixture)

    try {
      expect(() =>
        deleteAccountAtomically(fixture.connection, {
          id: fixture.userId,
          email: fixture.email
        })
      ).toThrow('Billing account deletion proof is stale or invalid')
      expect(count(fixture, 'user', 'id = ?', fixture.userId)).toBe(1)
      expect(count(fixture, 'files', 'owner_id = ?', fixture.userId)).toBe(1)

      const proof = await prepareAccountDeletionBilling(fixture.connection, fixture.userId, testBillingConfiguration())
      const result = await withAccountDeletionBillingProof(fixture.userId, proof, async () =>
        deleteAccountAtomically(
          fixture.connection,
          { id: fixture.userId, email: fixture.email },
          { deletedAt: '2026-08-04T12:00:00.000Z' }
        )
      )

      expect(result).toEqual({ status: 'deleted', detachedBillingSubjects: 0, deletedFiles: 1 })
      for (const [table, where] of [
        ['user', 'id'],
        ['account', 'user_id'],
        ['session', 'user_id'],
        ['ai_conversations', 'owner_user_id'],
        ['ai_generation_leases', 'owner_user_id'],
        ['ai_usage_buckets', 'owner_user_id'],
        ['files', 'owner_id'],
        ['billing_account_deletion_requests', 'purchaser_user_id']
      ] as const) {
        expect(count(fixture, table, `${where} = ?`, fixture.userId), `${table} owned rows`).toBe(0)
      }
      expect(count(fixture, 'verification')).toBe(1)
      expect(count(fixture, 'job_queue', "type = 'files.cleanup-orphans'")).toBe(1)
      expect(count(fixture, 'job_queue', "type like 'billing.%'")).toBe(0)
      expect(
        fixture.sqlite.prepare("select value from app_settings where key = 'files.reconcile-not-before.v1'").get()
      ).toEqual({ value: JSON.stringify('2026-08-04T12:16:00.000Z') })

      expect(count(fixture, 'user', 'id = ?', fixture.foreignUserId)).toBe(1)
      expect(count(fixture, 'files', 'owner_id = ?', fixture.foreignUserId)).toBe(1)
      expect(count(fixture, 'ai_conversations', 'owner_user_id = ?', fixture.foreignUserId)).toBe(1)
      expect(fixture.sqlite.pragma('foreign_key_check')).toEqual([])

      expect(
        deleteAccountAtomically(fixture.connection, {
          id: fixture.userId,
          email: fixture.email
        })
      ).toEqual({ status: 'already-deleted', detachedBillingSubjects: 0, deletedFiles: 0 })
    } finally {
      fixture.cleanup()
    }
  })

  it.each<AccountDeletionCheckpoint>(['billing-data-deleted', 'private-data-deleted', 'auth-records-deleted'])(
    'rolls back every deletion when the %s checkpoint fails',
    async (failingCheckpoint) => {
      const fixture = createAccountDeletionFixture(`rollback-${failingCheckpoint}`)
      seedPrivateData(fixture)

      try {
        const proof = await prepareAccountDeletionBilling(
          fixture.connection,
          fixture.userId,
          testBillingConfiguration()
        )
        const before = privateRowCounts(fixture)

        await expect(
          withAccountDeletionBillingProof(fixture.userId, proof, async () =>
            deleteAccountAtomically(
              fixture.connection,
              { id: fixture.userId, email: fixture.email },
              {
                deletedAt: '2026-08-04T12:00:00.000Z',
                checkpoint: (checkpoint) => {
                  if (checkpoint === failingCheckpoint) throw new Error(`injected-${checkpoint}`)
                }
              }
            )
          )
        ).rejects.toThrow(`injected-${failingCheckpoint}`)

        expect(privateRowCounts(fixture)).toEqual(before)
        expect(count(fixture, 'job_queue', "type = 'files.cleanup-orphans'")).toBe(0)
        expect(count(fixture, 'app_settings')).toBe(0)
        expect(fixture.sqlite.pragma('foreign_key_check')).toEqual([])
      } finally {
        fixture.cleanup()
      }
    }
  )
})

type TestFixture = Readonly<{
  sqlite: ReturnType<typeof createBillingStripeRuntimeFixture>['sqlite']
  connection: DatabaseConnection
  userId: string
  email: string
  foreignUserId: string
  cleanup: () => void
}>

function createAccountDeletionFixture(label: string): TestFixture {
  const userId = `delete_${label.replace(/[^a-z0-9]/gi, '_')}`
  const billingFixture = createBillingStripeRuntimeFixture(userId)
  const { sqlite } = billingFixture
  sqlite.exec(`
    create table account (
      id text primary key not null,
      account_id text not null,
      provider_id text not null,
      user_id text not null references user(id) on delete cascade
    );
    create table session (
      id text primary key not null,
      user_id text not null references user(id) on delete cascade
    );
    create table verification (
      id text primary key not null,
      value text not null
    );
    create table ai_conversations (
      id text primary key not null,
      owner_user_id text not null references user(id) on delete restrict
    );
    create table ai_messages (
      id text primary key not null,
      conversation_id text not null references ai_conversations(id) on delete cascade
    );
    create table ai_generation_attempts (
      id text primary key not null,
      conversation_id text not null references ai_conversations(id) on delete cascade
    );
    create table ai_generation_leases (
      owner_user_id text primary key not null references user(id) on delete restrict,
      attempt_id text not null
    );
    create table ai_usage_buckets (
      owner_user_id text not null references user(id) on delete restrict,
      bucket_date text not null,
      primary key(owner_user_id, bucket_date)
    );
    create table files (
      id text primary key not null,
      owner_id text not null references user(id) on delete restrict,
      upload_expires_at text not null
    );
    create table app_settings (
      key text primary key not null,
      value text not null
    );
  `)

  const email = `${userId}@example.test`
  const foreignUserId = `${userId}_foreign`
  sqlite.prepare('insert into user (id, email) values (?, ?)').run(foreignUserId, `${foreignUserId}@example.test`)

  return {
    sqlite,
    connection: {
      sqlite,
      db: undefined as never,
      databasePath: ':memory:'
    },
    userId,
    email,
    foreignUserId,
    cleanup: () => sqlite.close()
  }
}

function seedPrivateData(fixture: TestFixture) {
  const seed = (userId: string, suffix: string) => {
    fixture.sqlite
      .prepare('insert into account (id, account_id, provider_id, user_id) values (?, ?, ?, ?)')
      .run(`account_${suffix}`, `credential_${suffix}`, 'credential', userId)
    fixture.sqlite.prepare('insert into session (id, user_id) values (?, ?)').run(`session_${suffix}`, userId)
    fixture.sqlite
      .prepare('insert into ai_conversations (id, owner_user_id) values (?, ?)')
      .run(`conversation_${suffix}`, userId)
    fixture.sqlite
      .prepare('insert into ai_messages (id, conversation_id) values (?, ?)')
      .run(`message_${suffix}`, `conversation_${suffix}`)
    fixture.sqlite
      .prepare('insert into ai_generation_attempts (id, conversation_id) values (?, ?)')
      .run(`attempt_${suffix}`, `conversation_${suffix}`)
    fixture.sqlite
      .prepare('insert into ai_generation_leases (owner_user_id, attempt_id) values (?, ?)')
      .run(userId, `attempt_${suffix}`)
    fixture.sqlite
      .prepare('insert into ai_usage_buckets (owner_user_id, bucket_date) values (?, ?)')
      .run(userId, '2026-08-04')
    fixture.sqlite
      .prepare('insert into files (id, owner_id, upload_expires_at) values (?, ?, ?)')
      .run(`file_${suffix}`, userId, '2026-08-04T12:15:00.000Z')
  }

  seed(fixture.userId, 'owned')
  seed(fixture.foreignUserId, 'foreign')
  fixture.sqlite
    .prepare('insert into verification (id, value) values (?, ?), (?, ?), (?, ?)')
    .run(
      'verification-user-id',
      fixture.userId,
      'verification-user-email',
      JSON.stringify({ email: fixture.email }),
      'verification-foreign',
      fixture.foreignUserId
    )
}

function privateRowCounts(fixture: TestFixture) {
  return {
    account: count(fixture, 'account', 'user_id = ?', fixture.userId),
    aiConversation: count(fixture, 'ai_conversations', 'owner_user_id = ?', fixture.userId),
    aiLease: count(fixture, 'ai_generation_leases', 'owner_user_id = ?', fixture.userId),
    aiUsage: count(fixture, 'ai_usage_buckets', 'owner_user_id = ?', fixture.userId),
    billingDeletion: count(fixture, 'billing_account_deletion_requests', 'purchaser_user_id = ?', fixture.userId),
    files: count(fixture, 'files', 'owner_id = ?', fixture.userId),
    session: count(fixture, 'session', 'user_id = ?', fixture.userId),
    user: count(fixture, 'user', 'id = ?', fixture.userId),
    verification: count(fixture, 'verification')
  }
}

function count(fixture: TestFixture, table: string, where?: string, ...parameters: unknown[]): number {
  const query = `select count(*) as count from ${table}${where ? ` where ${where}` : ''}`
  return (fixture.sqlite.prepare(query).get(...parameters) as { count: number }).count
}

function testBillingConfiguration(): BillingStripeRuntimeConfiguration {
  return {
    enabled: true,
    appName: 'Working Class Unity',
    appUrl: 'https://wcu.example.test',
    stripe: {
      secretKey: 'rk_test_account_deletion',
      webhookSecret: 'whsec_account_deletion',
      portalConfigurationId: 'bpc_account_deletion',
      prices: {
        'personal.weekly': 'price_personal_weekly_account_deletion',
        'personal.monthly': 'price_personal_monthly_account_deletion',
        'personal.annual': 'price_personal_annual_account_deletion',
        'family.monthly': 'price_family_monthly_account_deletion',
        'family.annual': 'price_family_annual_account_deletion'
      }
    }
  }
}

function testSession(createdAt: Date): AppSession {
  return {
    user: {
      id: 'delete-handler-user',
      name: 'Deletion Handler User',
      email: 'delete-handler@example.test',
      emailVerified: true,
      image: null,
      role: 'user',
      createdAt: new Date('2026-08-01T00:00:00.000Z'),
      updatedAt: new Date('2026-08-01T00:00:00.000Z')
    },
    session: {
      id: 'delete-handler-session',
      userId: 'delete-handler-user',
      token: 'private-session-token',
      expiresAt: new Date('2026-08-05T00:00:00.000Z'),
      createdAt,
      updatedAt: createdAt,
      ipAddress: null,
      userAgent: null
    }
  } as AppSession
}

type AccountDeletionServerOptions = AccountDeletionCommandDependencies

async function startAccountDeletionServer(options: AccountDeletionServerOptions): Promise<string> {
  const handler = createAccountDeletionHandler(options)
  const router = createRouter().delete('/api/account', handler as EventHandler)
  const server = createServer(toNodeListener(createApp().use(router)))
  openServers.add(server)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new TypeError('Expected a TCP test address')
  return `http://127.0.0.1:${address.port}/api/account`
}

function deleteRequest(endpoint: string, body: unknown): Promise<Response> {
  return fetch(endpoint, {
    method: 'DELETE',
    headers: {
      authorization: 'Bearer valid',
      'content-type': 'application/json'
    },
    body: JSON.stringify(body)
  })
}
