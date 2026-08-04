import { createServer, type Server } from 'node:http'
import type Stripe from 'stripe'
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
import { createPendingFile } from '../server/db/repositories/files'
import { deleteAccountAtomically, type AccountDeletionCheckpoint } from '../server/services/account-deletion'
import { accountDeletionConfirmation, createAccountDeletionHandler } from '../server/services/account-deletion-command'
import {
  claimNextJobForConnection,
  completeJobForConnection,
  failJobForConnection,
  jobDiagnosticCodes,
  maxStoredJobDiagnosticBytes,
  runNextJobForConnection
} from '../server/services/jobs/job-queue'
import { getBillingStateForConnection } from '../server/services/payments/billing-service'
import { prepareBillingAccountDeletionForConnection } from '../server/services/payments/billing-account-deletion'
import {
  activateAccountDeletionBillingProof,
  issueAccountDeletionBillingProof,
  revokeAccountDeletionBillingProof
} from '../server/services/payments/account-deletion-billing-proof'
import {
  billingNotificationDeliveryJobType,
  createBillingNotificationDeliveryHandler
} from '../server/services/payments/billing-notification-delivery'
import { processStripeWebhookEventForConnection } from '../server/services/payments/billing-webhook'
import type { StripeBillingClient } from '../server/services/payments/stripe-client'
import { assertFileStorageBinding } from '../server/services/storage/file-storage-binding'
import type { ObjectStorage } from '../server/services/storage/object-storage'
import { assertFreshAccountDeletionSession } from '../server/utils/auth/account-deletion-freshness'
import type { AppSession } from '../server/utils/auth/require-session'
import { accountDeletionFreshAgeSeconds } from '../server/utils/auth/security'
import type { AppRuntimeConfig } from '../server/utils/runtime'
import {
  authRequest,
  createWorkspaceInvitationFixture,
  type SignedInFixtureUser,
  type WorkspaceInvitationFixture
} from './helpers/workspace-invitation-fixture'

vi.mock('../server/services/observability/capture', () => ({
  captureException: vi.fn().mockResolvedValue(undefined)
}))

const openServers = new Set<Server>()

afterEach(async () => {
  await Promise.all([...openServers].map((server) => new Promise<void>((resolve) => server.close(() => resolve()))))
  openServers.clear()
})

describe('immediate account deletion', () => {
  it('authenticates before strict confirmation and rejects authentication at least 24 hours old', async () => {
    const fixture = createWorkspaceInvitationFixture()
    const owner = await fixture.signIn('delete-freshness@example.test', 'Freshness Owner')
    const prepareDeletion = vi.fn(async () => 'unused-freshness-proof')
    const endpoint = await startAccountDeletionServer(fixture, { prepareDeletion })

    try {
      const session = (await fixture.auth.api.getSession({ headers: owner.headers })) as AppSession
      const now = Date.parse('2026-07-28T12:00:00.000Z')
      expect(() =>
        assertFreshAccountDeletionSession(
          {
            ...session,
            session: {
              ...session.session,
              createdAt: new Date(now - accountDeletionFreshAgeSeconds * 1_000 + 1)
            }
          },
          now
        )
      ).not.toThrow()
      for (const ageMs of [accountDeletionFreshAgeSeconds * 1_000, accountDeletionFreshAgeSeconds * 1_000 + 1]) {
        expect(() =>
          assertFreshAccountDeletionSession(
            {
              ...session,
              session: {
                ...session.session,
                createdAt: new Date(now - ageMs)
              }
            },
            now
          )
        ).toThrow(
          expect.objectContaining({ statusCode: 400, data: expect.objectContaining({ code: 'SESSION_EXPIRED' }) })
        )
      }
      expect(() =>
        assertFreshAccountDeletionSession(
          {
            ...session,
            session: {
              ...session.session,
              createdAt: new Date(Number.NaN)
            }
          },
          now
        )
      ).toThrow(
        expect.objectContaining({ statusCode: 400, data: expect.objectContaining({ code: 'SESSION_EXPIRED' }) })
      )

      const anonymous = await fetch(endpoint, {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: '{'
      })
      expect(anonymous.status).toBe(401)

      for (const body of [
        {},
        { confirmation: 'delete' },
        { confirmation: accountDeletionConfirmation, userId: owner.user.id }
      ]) {
        const rejected = await deleteRequest(endpoint, owner, body)
        expect(rejected.status).toBe(400)
      }
      expect(count(fixture, 'user', 'id = ?', owner.user.id)).toBe(1)

      fixture.sqlite
        .prepare('update session set created_at = ? where user_id = ?')
        .run(Math.floor((Date.now() - 24 * 60 * 60 * 1000) / 1000), owner.user.id)
      const stale = await deleteRequest(endpoint, owner, {
        confirmation: accountDeletionConfirmation
      })
      expect(stale.status).toBe(400)
      expect(await stale.text()).toContain('SESSION_EXPIRED')
      expect(count(fixture, 'user', 'id = ?', owner.user.id)).toBe(1)
      expect(prepareDeletion).not.toHaveBeenCalled()
    } finally {
      fixture.cleanup()
    }
  })

  it('deletes only the caller and owned family plan while preserving invitees and minimized billing continuity', async () => {
    const fixture = createWorkspaceInvitationFixture()
    const owner = await fixture.signIn('delete-owner@example.test', 'Deleting Owner')
    const firstInvitee = await fixture.signIn('delete-invitee-one@example.test', 'First Invitee')
    const secondInvitee = await fixture.signIn('delete-invitee-two@example.test', 'Second Invitee')
    const foreignOwner = await fixture.signIn('delete-foreign-owner@example.test', 'Foreign Owner')
    seedDeletionScenario(fixture, owner, firstInvitee, secondInvitee, foreignOwner)
    const pendingMagicLink = await fixture.requestMagicLink(owner.user.email, 'Should Be Purged')
    const inviteeBefore = snapshotInvitee(fixture, firstInvitee)
    const stripe = stripeDeletionClient()
    const endpoint = await startAccountDeletionServer(fixture, {
      getStripeClient: () => stripe.client
    })

    try {
      const deleted = await deleteRequest(endpoint, owner, {
        confirmation: accountDeletionConfirmation
      })
      expect(deleted.status).toBe(200)
      expect(deleted.headers.get('cache-control')).toBe('private, no-store')
      expect(await deleted.json()).toEqual({ success: true, message: 'User deleted' })
      expect(deleted.headers.getSetCookie()).toHaveLength(3)
      expect(deleted.headers.getSetCookie().join('\n')).toMatch(/Max-Age=0|Expires=Thu, 01 Jan 1970/i)
      expect(stripe.cancel).toHaveBeenCalledWith(
        'sub_delete_owner',
        { invoice_now: false, prorate: false },
        { idempotencyKey: expect.stringMatching(/^billing-account-deletion:billing_delete_/) }
      )
      expect(stripe.retrieve).toHaveBeenCalledWith('sub_delete_owner')

      expect(count(fixture, 'user', 'id = ?', owner.user.id)).toBe(0)
      expect(count(fixture, 'session', 'user_id = ?', owner.user.id)).toBe(0)
      expect(count(fixture, 'account', 'user_id = ?', owner.user.id)).toBe(0)
      expect(count(fixture, 'verification', "json_extract(value, '$.email') = ?", owner.user.email)).toBe(0)
      expect(count(fixture, 'projects', 'owner_user_id = ?', owner.user.id)).toBe(0)
      expect(count(fixture, 'files', 'owner_id = ?', owner.user.id)).toBe(0)
      expect(count(fixture, 'ai_conversations', 'owner_user_id = ?', owner.user.id)).toBe(0)
      expect(count(fixture, 'ai_messages')).toBe(3)
      expect(count(fixture, 'ai_message_file_citations')).toBe(1)
      expect(count(fixture, 'ai_message_web_citations')).toBe(1)
      expect(count(fixture, 'ai_generation_attempts')).toBe(1)
      expect(count(fixture, 'ai_generation_leases', 'owner_user_id = ?', owner.user.id)).toBe(0)
      expect(count(fixture, 'ai_generation_leases', 'owner_user_id = ?', firstInvitee.user.id)).toBe(1)
      expect(count(fixture, 'ai_usage_buckets', 'owner_user_id = ?', owner.user.id)).toBe(0)
      expect(count(fixture, 'billing_customers', 'organization_id = ?', owner.workspace.id)).toBe(0)
      expect(count(fixture, 'billing_subscriptions', 'organization_id = ?', owner.workspace.id)).toBe(0)
      expect(count(fixture, 'organization', 'personal_owner_user_id = ?', owner.user.id)).toBe(0)
      expect(count(fixture, 'member', 'user_id = ?', owner.user.id)).toBe(0)
      expect(count(fixture, 'invitation', 'lower(email) = lower(?)', owner.user.email)).toBe(0)

      expect(snapshotInvitee(fixture, firstInvitee)).toEqual(inviteeBefore)
      expect(count(fixture, 'user', 'id = ?', secondInvitee.user.id)).toBe(1)
      expect(count(fixture, 'organization', 'personal_owner_user_id = ?', secondInvitee.user.id)).toBe(1)
      expect(count(fixture, 'organization', 'personal_owner_user_id = ?', foreignOwner.user.id)).toBe(1)
      expect(count(fixture, 'member', 'organization_id = ?', owner.workspace.id)).toBe(0)
      expect(getBillingStateForConnection(fixture.connection, firstInvitee.user.id)).toMatchObject({
        relationship: { kind: 'independent' },
        entitlement: { granted: false },
        subscription: { state: 'reconciliation_required' }
      })
      expect(
        fixture.sqlite
          .prepare('select distinct active_organization_id from session where user_id = ?')
          .all(firstInvitee.user.id)
      ).toEqual([{ active_organization_id: null }])
      await deliverQueuedBillingNotifications(fixture)
      expect(
        fixture.billingNotifications
          .map((message) => ({
            to: message.to,
            includesPrivateBillingIdentifier: /cus_delete_owner|sub_delete_owner|price_family_test|evt_delete/i.test(
              `${message.subject} ${message.text}`
            )
          }))
          .toSorted((left, right) => left.to.localeCompare(right.to))
      ).toEqual([
        { to: firstInvitee.user.email, includesPrivateBillingIdentifier: false },
        { to: secondInvitee.user.email, includesPrivateBillingIdentifier: false }
      ])

      const columns = fixture.sqlite
        .prepare('pragma table_info(detached_billing_subjects)')
        .all()
        .map((column) => (column as { name: string }).name)
      expect(columns).toEqual([
        'id',
        'provider',
        'provider_reference',
        'provider_customer_reference',
        'provider_status',
        'provider_status_expires_at',
        'provider_event_created_at',
        'status_updated_at',
        'deleted_at',
        'retention_purpose',
        'retention_policy',
        'purge_after'
      ])
      expect(fixture.sqlite.prepare('select * from detached_billing_subjects').all()).toEqual([
        {
          id: expect.stringMatching(/^detached_billing_/),
          provider: 'stripe',
          provider_reference: 'sub_delete_owner',
          provider_customer_reference: 'cus_delete_owner',
          provider_status: 'active',
          provider_status_expires_at: '2026-08-01T00:00:00.000Z',
          provider_event_created_at: 1_782_864_000,
          status_updated_at: '2026-07-01T00:00:00.000Z',
          deleted_at: expect.any(String),
          retention_purpose: 'external_billing_reconciliation',
          retention_policy: 'stripe_billing_lifecycle',
          purge_after: null
        }
      ])
      expect(
        fixture.sqlite.prepare('select type, payload, status, max_attempts, run_after from job_queue').all()
      ).toContainEqual({
        type: 'files.cleanup-orphans',
        payload: '{}',
        status: 'queued',
        max_attempts: 2_147_483_647,
        run_after: expect.any(String)
      })

      const oldLink = await fixture.auth.handler(authRequest(pendingMagicLink))
      expect(oldLink.status).toBe(302)
      expect(oldLink.headers.get('location')).toContain('error=INVALID_TOKEN')
      expect(count(fixture, 'user', 'email = ?', owner.user.email)).toBe(0)

      await processStripeWebhookEventForConnection(
        fixture.connection,
        stripeClientWithSubscriptions([
          stripeSubscription({
            id: 'sub_delete_owner',
            customer: 'cus_delete_owner',
            status: 'past_due',
            currentPeriodEnd: 1_786_752_000
          })
        ]),
        billingRuntimeConfig(fixture),
        stripeEvent({
          id: 'evt_delete_late_status',
          type: 'customer.subscription.updated',
          created: 1_784_073_600,
          object: {
            id: 'sub_delete_owner',
            customer: 'cus_delete_owner',
            status: 'past_due',
            metadata: { privateUserId: owner.user.id, privatePriceId: 'price_must_not_survive' }
          }
        })
      )
      expect(
        fixture.sqlite
          .prepare('select provider_status, provider_status_expires_at from detached_billing_subjects')
          .get()
      ).toEqual({
        provider_status: 'past_due',
        provider_status_expires_at: '2026-08-15T00:00:00.000Z'
      })
      expect(count(fixture, 'billing_customers', 'organization_id = ?', owner.workspace.id)).toBe(0)

      expect(count(fixture, 'billing_customers', 'organization_id = ?', owner.workspace.id)).toBe(0)
      expect(count(fixture, 'billing_subscriptions', 'organization_id = ?', owner.workspace.id)).toBe(0)
      expect(count(fixture, 'detached_billing_subjects')).toBe(1)
      expect(fixture.sqlite.prepare('select * from billing_events').all()).toEqual([
        {
          id: expect.any(Number),
          stripe_event_id: 'evt_delete_late_status',
          event_type: 'customer.subscription.updated',
          provider_created_at: 1_784_073_600,
          processed_at: expect.any(String)
        }
      ])

      const duplicate = await deleteRequest(endpoint, owner, {
        confirmation: accountDeletionConfirmation
      })
      expect(duplicate.status).toBe(401)

      const registeredAgain = await fixture.signIn(owner.user.email, 'New Identity')
      expect(registeredAgain.user.id).not.toBe(owner.user.id)
      expect(registeredAgain.workspace.id).not.toBe(owner.workspace.id)
      expect(count(fixture, 'projects', 'owner_user_id = ?', registeredAgain.user.id)).toBe(0)
      expect(count(fixture, 'ai_conversations', 'owner_user_id = ?', registeredAgain.user.id)).toBe(0)
      expect(count(fixture, 'ai_generation_leases', 'owner_user_id = ?', registeredAgain.user.id)).toBe(0)
      expect(count(fixture, 'ai_usage_buckets', 'owner_user_id = ?', registeredAgain.user.id)).toBe(0)
      expect(count(fixture, 'billing_customers', 'organization_id = ?', registeredAgain.workspace.id)).toBe(0)
      expect(count(fixture, 'detached_billing_subjects')).toBe(1)
      expect(fixture.sqlite.pragma('foreign_key_check')).toEqual([])
      expect(fixture.sqlite.pragma('integrity_check')).toEqual([{ integrity_check: 'ok' }])
    } finally {
      fixture.cleanup()
    }
  })

  it('rolls back every local checkpoint and leaves a committed deletion inaccessible if the response is lost', async () => {
    const fixture = createWorkspaceInvitationFixture()
    const owner = await fixture.signIn('delete-recovery@example.test', 'Recovery Owner')
    seedOwnedPrivateRows(fixture, owner)
    const checkpoints: AccountDeletionCheckpoint[] = [
      'billing-detached',
      'private-data-deleted',
      'family-plan-deleted',
      'auth-records-deleted'
    ]

    try {
      for (const failure of checkpoints) {
        expect(() =>
          deleteAccountWithBillingProof(fixture, owner, {
            checkpoint: (checkpoint) => {
              if (checkpoint === failure) throw new Error(`interrupt:${failure}`)
            }
          })
        ).toThrow(`interrupt:${failure}`)
        expect(count(fixture, 'user', 'id = ?', owner.user.id)).toBe(1)
        expect(count(fixture, 'projects', 'owner_user_id = ?', owner.user.id)).toBe(1)
        expect(count(fixture, 'ai_conversations', 'owner_user_id = ?', owner.user.id)).toBe(1)
        expect(count(fixture, 'ai_message_file_citations')).toBe(1)
        expect(count(fixture, 'ai_message_web_citations')).toBe(1)
        expect(count(fixture, 'ai_generation_leases', 'owner_user_id = ?', owner.user.id)).toBe(1)
        expect(count(fixture, 'ai_usage_buckets', 'owner_user_id = ?', owner.user.id)).toBe(1)
        expect(count(fixture, 'billing_subscriptions', 'organization_id = ?', owner.workspace.id)).toBe(1)
        expect(count(fixture, 'detached_billing_subjects')).toBe(0)
        expect(count(fixture, 'job_queue')).toBe(0)
        expect(fixture.sqlite.pragma('foreign_key_check')).toEqual([])
      }

      expect(deleteAccountWithBillingProof(fixture, owner).status).toBe('deleted')
      expect(deleteAccountAtomically(fixture.connection, owner.user).status).toBe('already-deleted')

      // This models termination after the SQLite commit but before Better Auth
      // can send its cookie-expiration response. The stale cookie has no DB
      // session behind it and cannot authenticate.
      expect(await fixture.auth.api.getSession({ headers: owner.headers })).toBeNull()
      expect(count(fixture, 'ai_message_file_citations')).toBe(0)
      expect(count(fixture, 'ai_message_web_citations')).toBe(0)
      expect(count(fixture, 'detached_billing_subjects')).toBe(1)
      expect(count(fixture, 'job_queue')).toBe(1)
      expect(fixture.sqlite.pragma('foreign_key_check')).toEqual([])
      expect(fixture.sqlite.pragma('integrity_check')).toEqual([{ integrity_check: 'ok' }])
    } finally {
      fixture.cleanup()
    }
  })

  it('retains nothing without a projected subscription and does not invent deletion history from a late event', async () => {
    const fixture = createWorkspaceInvitationFixture()
    const owner = await fixture.signIn('delete-no-billing@example.test', 'No Billing Owner')
    const endpoint = await startAccountDeletionServer(fixture)

    try {
      const response = await deleteRequest(endpoint, owner, {
        confirmation: accountDeletionConfirmation
      })
      expect(response.status).toBe(200)
      expect(count(fixture, 'user', 'id = ?', owner.user.id)).toBe(0)
      expect(count(fixture, 'detached_billing_subjects')).toBe(0)

      await processStripeWebhookEventForConnection(
        fixture.connection,
        stripeClientWithSubscriptions([]),
        billingRuntimeConfig(fixture),
        stripeEvent({
          id: 'evt_delete_late_checkout',
          type: 'checkout.session.completed',
          created: 1_784_073_700,
          object: {
            id: 'cs_after_delete',
            mode: 'subscription',
            status: 'complete',
            client_reference_id: 'attempt_without_retained_continuity',
            customer: 'cus_after_delete',
            subscription: 'sub_after_delete',
            metadata: { privateUserId: owner.user.id, privatePriceId: 'price_must_not_survive' }
          }
        })
      )
      expect(count(fixture, 'detached_billing_subjects')).toBe(0)
      expect(count(fixture, 'billing_customers')).toBe(0)
      expect(count(fixture, 'billing_subscriptions')).toBe(0)
      expect(count(fixture, 'billing_events', 'stripe_event_id = ?', 'evt_delete_late_checkout')).toBe(1)
    } finally {
      fixture.cleanup()
    }
  })

  it('returns a retryable failure and retains all local identity when Stripe confirmation is indeterminate', async () => {
    const fixture = createWorkspaceInvitationFixture()
    const owner = await fixture.signIn('delete-provider-pending@example.test', 'Pending Provider')
    seedOwnedPrivateRows(fixture, owner, { cancellationConfirmed: false })
    const sensitiveCanary = 'secret-provider-deletion-diagnostic'
    const cancel = vi.fn(async () => Promise.reject(new Error(sensitiveCanary)))
    const retrieve = vi.fn(async () => Promise.reject(new Error(sensitiveCanary)))
    const list = vi.fn()
    const endpoint = await startAccountDeletionServer(fixture, {
      getStripeClient: () =>
        ({
          subscriptions: { cancel, list, retrieve }
        }) as unknown as StripeBillingClient
    })

    try {
      const response = await deleteRequest(endpoint, owner, {
        confirmation: accountDeletionConfirmation
      })
      expect(response.status).toBe(503)
      const body = await response.text()
      expect(body).toContain('ACCOUNT_DELETION_BILLING_PENDING')
      expect(body).not.toContain(sensitiveCanary)
      expect(body).not.toContain('sub_delete_owner')
      expect(cancel).toHaveBeenCalledOnce()
      expect(retrieve).toHaveBeenCalledOnce()
      expect(list).not.toHaveBeenCalled()
      expect(count(fixture, 'user', 'id = ?', owner.user.id)).toBe(1)
      expect(count(fixture, 'projects', 'owner_user_id = ?', owner.user.id)).toBe(1)
      expect(
        fixture.sqlite
          .prepare(
            `select state, reason, cancellation_confirmed_at as cancellationConfirmedAt
             from billing_account_deletion_requests where user_id = ?`
          )
          .get(owner.user.id)
      ).toEqual({
        state: 'pending',
        reason: null,
        cancellationConfirmedAt: null
      })
      const job = fixture.sqlite
        .prepare(
          `select payload, status from job_queue
           where type = 'billing.account-deletion-cancellation'`
        )
        .get() as { payload: string; status: string }
      expect(job.status).toBe('queued')
      expect(Object.keys(JSON.parse(job.payload))).toEqual(['requestId'])
    } finally {
      fixture.cleanup()
    }
  })

  it('updates the exact detached subscription and closes the deletion lookup race', async () => {
    const fixture = createWorkspaceInvitationFixture()
    const owner = await fixture.signIn('delete-billing-race@example.test', 'Billing Race Owner')
    seedOwnedPrivateRows(fixture, owner)

    try {
      deleteAccountWithBillingProof(fixture, owner, { deletedAt: '2026-07-11T00:00:00.000Z' })
      await processStripeWebhookEventForConnection(
        fixture.connection,
        stripeClientWithSubscriptions([
          stripeSubscription({
            id: 'sub_delete_owner',
            customer: 'cus_delete_owner',
            status: 'past_due',
            currentPeriodEnd: 1_789_430_400
          })
        ]),
        billingRuntimeConfig(fixture),
        stripeEvent({
          id: 'evt_delete_exact',
          type: 'customer.subscription.updated',
          created: 1_784_073_800,
          object: {
            id: 'sub_delete_owner',
            customer: 'cus_delete_owner',
            status: 'past_due'
          }
        })
      )
      expect(
        fixture.sqlite
          .prepare(
            'select provider_reference, provider_status from detached_billing_subjects order by provider_reference'
          )
          .all()
      ).toEqual([{ provider_reference: 'sub_delete_owner', provider_status: 'past_due' }])

      const raceFixture = createWorkspaceInvitationFixture()
      const racingOwner = await raceFixture.signIn('delete-billing-toctou@example.test', 'TOCTOU Owner')
      seedOwnedPrivateRows(raceFixture, racingOwner)
      try {
        await processStripeWebhookEventForConnection(
          raceFixture.connection,
          stripeClientWithSubscriptions(
            [
              stripeSubscription({
                id: 'sub_delete_owner',
                customer: 'cus_delete_owner',
                status: 'unpaid',
                currentPeriodEnd: 1_789_430_400
              })
            ],
            () => {
              deleteAccountWithBillingProof(raceFixture, racingOwner)
            }
          ),
          billingRuntimeConfig(raceFixture),
          stripeEvent({
            id: 'evt_delete_toctou',
            type: 'customer.subscription.updated',
            created: 1_784_073_900,
            object: {
              id: 'sub_delete_owner',
              customer: 'cus_delete_owner',
              status: 'unpaid'
            }
          })
        )
        expect(count(raceFixture, 'user', 'id = ?', racingOwner.user.id)).toBe(0)
        expect(
          raceFixture.sqlite.prepare('select provider_reference, provider_status from detached_billing_subjects').get()
        ).toEqual({ provider_reference: 'sub_delete_owner', provider_status: 'unpaid' })
        expect(count(raceFixture, 'billing_events', 'stripe_event_id = ?', 'evt_delete_toctou')).toBe(1)
      } finally {
        raceFixture.cleanup()
      }
    } finally {
      fixture.cleanup()
    }
  })

  it('blocks late file-row recreation and schedules cleanup after the upload window', async () => {
    const fixture = createWorkspaceInvitationFixture()
    const owner = await fixture.signIn('delete-late-write@example.test', 'Late Write Owner')
    seedOwnedPrivateRows(fixture, owner)
    const deletedAt = '2026-07-11T00:00:00.000Z'
    try {
      deleteAccountWithBillingProof(fixture, owner, { deletedAt })

      await expect(
        createPendingFile(fixture.connection, {
          id: 'file_00000000-0000-4000-8000-000000000099',
          ownerId: owner.user.id,
          bucket: 'local',
          objectKey: 'files/v1/file_00000000-0000-4000-8000-000000000099',
          contentType: 'text/plain',
          byteSize: 1,
          contentMd5: 'ndTkYSaMgDT1yFZOFVxnpg==',
          uploadExpiresAt: '2099-01-01T00:15:00.000Z'
        })
      ).rejects.toThrow(/FOREIGN KEY constraint failed/)
      expect(() => seedAiConversation(fixture, owner.user.id, 9, { conversationOnly: true })).toThrow(
        /FOREIGN KEY constraint failed/
      )
      expect(() =>
        fixture.sqlite
          .prepare(
            `insert into ai_generation_leases (
               owner_user_id, attempt_id, lease_expires_at, created_at, updated_at
             ) values (?, 'ai_attempt_00000000-0000-4000-8000-000000000009', ?, ?, ?)`
          )
          .run(owner.user.id, '2099-01-01T00:15:00.000Z', deletedAt, deletedAt)
      ).toThrow(/FOREIGN KEY constraint failed/)

      const scheduled = fixture.sqlite
        .prepare("select id, run_after, attempts, status from job_queue where type = 'files.cleanup-orphans'")
        .get() as { id: number; run_after: string; attempts: number; status: string }
      expect(scheduled).toEqual({
        id: expect.any(Number),
        run_after: '2026-07-11T00:16:00.000Z',
        attempts: 0,
        status: 'queued'
      })

      const filesDisabled = await runNextJobForConnection(fixture.connection, {}, 'worker_files_disabled', {
        now: new Date('2026-07-11T00:16:01.000Z')
      })
      expect(filesDisabled).toEqual({ ran: false })
      expect(fixture.sqlite.prepare('select attempts, status from job_queue where id = ?').get(scheduled.id)).toEqual({
        attempts: 0,
        status: 'queued'
      })
    } finally {
      fixture.cleanup()
    }
  })

  it('reclaims a crashed queue lease atomically and rejects the former worker completion', async () => {
    const fixture = createWorkspaceInvitationFixture()
    fixture.sqlite
      .prepare("insert into job_queue (type, payload, max_attempts) values ('files.cleanup-orphans', '{}', 3)")
      .run()

    try {
      const first = claimNextJobForConnection(fixture.connection, 'worker_one', {
        now: new Date('2026-07-11T00:00:00.000Z')
      })
      expect(first).toEqual(expect.objectContaining({ attempts: 1, status: 'running' }))
      expect(
        claimNextJobForConnection(fixture.connection, 'worker_two', {
          now: new Date('2026-07-11T00:04:59.000Z')
        })
      ).toBeNull()

      const reclaimed = claimNextJobForConnection(fixture.connection, 'worker_two', {
        now: new Date('2026-07-11T00:05:01.000Z')
      })
      expect(reclaimed).toEqual(expect.objectContaining({ id: first!.id, attempts: 2, status: 'running' }))
      expect(reclaimed!.lockedBy).not.toBe(first!.lockedBy)
      await expect(failJobForConnection(fixture.connection, first!.id, first!.lockedBy)).resolves.toBe('lease-lost')
      await expect(completeJobForConnection(fixture.connection, first!.id, first!.lockedBy)).resolves.toBe(false)
      await expect(completeJobForConnection(fixture.connection, reclaimed!.id, reclaimed!.lockedBy)).resolves.toBe(true)
      expect(fixture.sqlite.prepare('select status, attempts from job_queue where id = ?').get(first!.id)).toEqual({
        status: 'succeeded',
        attempts: 2
      })

      fixture.sqlite
        .prepare("insert into job_queue (type, payload, max_attempts) values ('test.cleanup', '{}', 1)")
        .run()
      const completionLeaseLost = await runNextJobForConnection(
        fixture.connection,
        {
          'test.cleanup': async () => {
            fixture.sqlite
              .prepare("update job_queue set locked_by = 'replacement-token' where type = 'test.cleanup'")
              .run()
          }
        },
        'worker_completion_lost'
      )
      expect(completionLeaseLost).toEqual({ ran: true, jobId: expect.any(Number), status: 'lease-lost' })

      fixture.sqlite
        .prepare("insert into job_queue (type, payload, max_attempts) values ('files.cleanup-orphans', '{}', 1)")
        .run()
      const finalAttempt = claimNextJobForConnection(fixture.connection, 'worker_final', {
        now: new Date('2026-07-11T01:00:00.000Z')
      })
      expect(finalAttempt).toEqual(expect.objectContaining({ attempts: 1, status: 'running' }))
      expect(
        claimNextJobForConnection(fixture.connection, 'worker_after_final', {
          now: new Date('2026-07-11T01:05:01.000Z')
        })
      ).toBeNull()
      expect(
        fixture.sqlite.prepare('select status, locked_by, last_error from job_queue where id = ?').get(finalAttempt!.id)
      ).toEqual({
        status: 'failed',
        locked_by: null,
        last_error: jobDiagnosticCodes.leaseExpiredFinalAttempt
      })

      fixture.sqlite.prepare("insert into job_queue (type, payload) values ('files.cleanup-orphans', 'not-json')").run()
      const validAfterMalformed = Number(
        fixture.sqlite.prepare("insert into job_queue (type, payload) values ('files.cleanup-orphans', '{}')").run()
          .lastInsertRowid
      )
      await expect(
        runNextJobForConnection(
          fixture.connection,
          { 'files.cleanup-orphans': async () => undefined },
          'worker_malformed',
          { now: new Date('2026-07-11T02:00:00.000Z') }
        )
      ).resolves.toEqual({ ran: false })
      expect(
        fixture.sqlite.prepare("select status, locked_by, last_error from job_queue where payload = 'not-json'").get()
      ).toEqual({ status: 'failed', locked_by: null, last_error: jobDiagnosticCodes.invalidPayload })
      await expect(
        runNextJobForConnection(
          fixture.connection,
          { 'files.cleanup-orphans': async () => undefined },
          'worker_after_malformed',
          { now: new Date('2026-07-11T02:00:01.000Z') }
        )
      ).resolves.toEqual({ ran: true, jobId: validAfterMalformed, status: 'succeeded' })
    } finally {
      fixture.cleanup()
    }
  })

  it('finalizes only registered expired job types while claiming the next registered row', () => {
    const fixture = createWorkspaceInvitationFixture()
    try {
      const insert = fixture.sqlite.prepare("insert into job_queue (type, payload, max_attempts) values (?, '{}', ?)")
      const foreignId = Number(insert.run('future.unregistered', 1).lastInsertRowid)
      const expiredRegisteredId = Number(insert.run('files.cleanup-orphans', 1).lastInsertRowid)

      expect(
        claimNextJobForConnection(fixture.connection, 'future_worker', {
          now: new Date('2026-07-11T03:00:00.000Z'),
          types: ['future.unregistered']
        })
      ).toEqual(expect.objectContaining({ id: foreignId, status: 'running' }))
      expect(
        claimNextJobForConnection(fixture.connection, 'files_worker', {
          now: new Date('2026-07-11T03:00:00.000Z'),
          types: ['files.cleanup-orphans']
        })
      ).toEqual(expect.objectContaining({ id: expiredRegisteredId, status: 'running' }))

      const queuedRegisteredId = Number(insert.run('files.cleanup-orphans', 3).lastInsertRowid)
      expect(
        claimNextJobForConnection(fixture.connection, 'files_replacement', {
          now: new Date('2026-07-11T03:05:01.000Z'),
          types: ['files.cleanup-orphans']
        })
      ).toEqual(expect.objectContaining({ id: queuedRegisteredId, status: 'running' }))
      expect(
        fixture.sqlite.prepare('select status, locked_by, last_error from job_queue where id = ?').get(foreignId)
      ).toEqual({ status: 'running', locked_by: expect.any(String), last_error: null })
      expect(
        fixture.sqlite
          .prepare('select status, locked_by, last_error from job_queue where id = ?')
          .get(expiredRegisteredId)
      ).toEqual({
        status: 'failed',
        locked_by: null,
        last_error: jobDiagnosticCodes.leaseExpiredFinalAttempt
      })
    } finally {
      fixture.cleanup()
    }
  })

  it('retries handler failures without persisting sensitive errors and terminally fails exhausted jobs', async () => {
    const fixture = createWorkspaceInvitationFixture()
    const sensitiveCanary = `secret-job-handler-canary-${'🧨'.repeat(maxStoredJobDiagnosticBytes)}`
    fixture.sqlite.prepare("insert into job_queue (type, payload, max_attempts) values ('test.cleanup', '{}', 2)").run()

    try {
      const handler = vi
        .fn<() => Promise<void>>()
        .mockRejectedValueOnce(new Error(sensitiveCanary))
        .mockResolvedValueOnce(undefined)
      const retriedResult = await runNextJobForConnection(
        fixture.connection,
        { 'test.cleanup': handler },
        'worker_retry'
      )
      expect(retriedResult).toEqual({ ran: true, jobId: expect.any(Number), status: 'retry-scheduled' })

      const retried = fixture.sqlite
        .prepare(
          "select status, attempts, run_after as runAfter, last_error as lastError from job_queue where type = 'test.cleanup'"
        )
        .get() as { status: string; attempts: number; runAfter: string; lastError: string }
      expect(retried).toMatchObject({
        status: 'queued',
        attempts: 1,
        lastError: jobDiagnosticCodes.handlerFailed
      })
      expect(retried.lastError).not.toContain('secret-job-handler-canary')
      expect(new TextEncoder().encode(retried.lastError).byteLength).toBeLessThanOrEqual(maxStoredJobDiagnosticBytes)

      await expect(
        runNextJobForConnection(fixture.connection, { 'test.cleanup': handler }, 'worker_retry_early', {
          now: new Date(Date.parse(retried.runAfter) - 1)
        })
      ).resolves.toEqual({ ran: false })
      expect(handler).toHaveBeenCalledOnce()
      expect(
        fixture.sqlite.prepare("select status, attempts from job_queue where type = 'test.cleanup'").get()
      ).toEqual({ status: 'queued', attempts: 1 })

      const succeeded = await runNextJobForConnection(fixture.connection, { 'test.cleanup': handler }, 'worker_retry', {
        now: new Date(Date.parse(retried.runAfter) + 1)
      })
      expect(succeeded).toEqual({ ran: true, jobId: retriedResult.jobId, status: 'succeeded' })
      expect(handler).toHaveBeenCalledTimes(2)
      expect(
        fixture.sqlite.prepare("select status, attempts, last_error from job_queue where type = 'test.cleanup'").get()
      ).toEqual({ status: 'succeeded', attempts: 2, last_error: null })

      fixture.sqlite
        .prepare("insert into job_queue (type, payload, max_attempts) values ('test.cleanup', '{}', 1)")
        .run()
      const exhausted = await runNextJobForConnection(
        fixture.connection,
        { 'test.cleanup': async () => Promise.reject(new Error(sensitiveCanary)) },
        'worker_terminal'
      )
      expect(exhausted).toEqual({ ran: true, jobId: expect.any(Number), status: 'terminal-failed' })
      const terminal = fixture.sqlite
        .prepare('select status, last_error as lastError from job_queue where id = ?')
        .get(exhausted.jobId) as { status: string; lastError: string }
      expect(terminal).toEqual({ status: 'failed', lastError: jobDiagnosticCodes.handlerFailed })
      expect(terminal.lastError).not.toContain('secret-job-handler-canary')
      expect(new TextEncoder().encode(terminal.lastError).byteLength).toBeLessThanOrEqual(maxStoredJobDiagnosticBytes)
    } finally {
      fixture.cleanup()
    }
  })

  it('keeps native Better Auth deletion paths unavailable while concurrent server calls converge', async () => {
    const fixture = createWorkspaceInvitationFixture()
    const owner = await fixture.signIn('delete-concurrent@example.test', 'Concurrent Owner')
    seedOwnedPrivateRows(fixture, owner)
    const stripe = stripeDeletionClient()
    const endpoint = await startAccountDeletionServer(fixture, { getStripeClient: () => stripe.client })

    try {
      const [nativeDelete, nativeCallback] = await Promise.all([
        fixture.auth.handler(
          authRequest('http://localhost:3000/api/auth/delete-user', {
            method: 'POST',
            headers: owner.headers,
            body: '{}'
          })
        ),
        fixture.auth.handler(
          authRequest('http://localhost:3000/api/auth/delete-user/callback?token=private', {
            headers: owner.headers
          })
        )
      ])
      expect(nativeDelete.status).toBe(404)
      expect(nativeCallback.status).toBe(404)

      const responses = await Promise.all([
        deleteRequest(endpoint, owner, { confirmation: accountDeletionConfirmation }),
        deleteRequest(endpoint, owner, { confirmation: accountDeletionConfirmation })
      ])
      expect(responses.some((response) => response.status === 200)).toBe(true)
      expect(responses.every((response) => response.status === 200 || response.status === 401)).toBe(true)
      expect(count(fixture, 'user', 'id = ?', owner.user.id)).toBe(0)
      expect(count(fixture, 'detached_billing_subjects')).toBe(1)
      expect(fixture.sqlite.pragma('foreign_key_check')).toEqual([])
    } finally {
      fixture.cleanup()
    }
  })
})

type AccountDeletionServerOptions = Readonly<{
  prepareDeletion?: (userId: string) => Promise<string>
  getStripeClient?: () => StripeBillingClient
}>

async function startAccountDeletionServer(
  fixture: WorkspaceInvitationFixture,
  options: AccountDeletionServerOptions = {}
) {
  const handler = createAccountDeletionHandler({
    requireSession: async (event) => {
      const session = await fixture.auth.api.getSession({ headers: requestHeaders(event) })
      if (!session) throw createError({ statusCode: 401, statusMessage: 'Authentication required' })
      return session as AppSession
    },
    assertFreshSession: assertFreshAccountDeletionSession,
    prepareDeletion:
      options.prepareDeletion ??
      ((userId) =>
        prepareBillingAccountDeletionForConnection(fixture.connection, userId, () => {
          if (!options.getStripeClient) throw new Error('Unexpected Stripe client request')
          return options.getStripeClient()
        })),
    requestHeaders,
    deleteUser: async (headers, billingProof, userId) => {
      if (!activateAccountDeletionBillingProof(userId, billingProof)) {
        throw new Error('Account deletion billing proof was not activated')
      }
      try {
        return await fixture.auth.api.deleteUser({ body: {}, headers, asResponse: true })
      } finally {
        revokeAccountDeletionBillingProof(billingProof)
      }
    }
  })
  const router = createRouter().delete('/api/account', handler as EventHandler)
  const server = createServer(toNodeListener(createApp().use(router)))
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  openServers.add(server)
  const address = server.address()
  if (!address || typeof address === 'string') throw new TypeError('Expected a TCP address')
  return `http://127.0.0.1:${address.port}/api/account`
}

function requestHeaders(event: H3Event) {
  const headers = new Headers()
  for (const [name, value] of Object.entries(getRequestHeaders(event))) {
    if (value) headers.set(name, value)
  }
  return headers
}

function deleteRequest(endpoint: string, user: SignedInFixtureUser, body: unknown) {
  const headers = new Headers(user.headers)
  headers.set('content-type', 'application/json')
  headers.set('origin', 'http://localhost:3000')
  return fetch(endpoint, { method: 'DELETE', headers, body: JSON.stringify(body) })
}

function seedDeletionScenario(
  fixture: WorkspaceInvitationFixture,
  owner: SignedInFixtureUser,
  firstInvitee: SignedInFixtureUser,
  secondInvitee: SignedInFixtureUser,
  foreignOwner: SignedInFixtureUser
) {
  const now = Date.now()
  fixture.sqlite
    .prepare('insert into member (id, organization_id, user_id, role, created_at) values (?, ?, ?, ?, ?)')
    .run('member_owner_first', owner.workspace.id, firstInvitee.user.id, 'member', now)
  fixture.sqlite
    .prepare('insert into member (id, organization_id, user_id, role, created_at) values (?, ?, ?, ?, ?)')
    .run('member_owner_second', owner.workspace.id, secondInvitee.user.id, 'member', now)
  fixture.sqlite
    .prepare('update session set active_organization_id = ? where user_id in (?, ?)')
    .run(owner.workspace.id, firstInvitee.user.id, secondInvitee.user.id)
  fixture.sqlite
    .prepare(
      'insert into invitation (id, organization_id, email, role, status, expires_at, inviter_id) values (?, ?, ?, ?, ?, ?, ?)'
    )
    .run(
      'invitation_owned',
      owner.workspace.id,
      'pending-person@example.test',
      'member',
      'pending',
      now + 86_400_000,
      owner.user.id
    )
  fixture.sqlite
    .prepare(
      'insert into invitation (id, organization_id, email, role, status, expires_at, inviter_id) values (?, ?, ?, ?, ?, ?, ?)'
    )
    .run(
      'invitation_received',
      foreignOwner.workspace.id,
      owner.user.email,
      'member',
      'pending',
      now + 86_400_000,
      foreignOwner.user.id
    )
  seedOwnedPrivateRows(fixture, owner, { cancellationConfirmed: false })
  seedInviteePrivateRows(fixture, firstInvitee)
}

function seedOwnedPrivateRows(
  fixture: WorkspaceInvitationFixture,
  owner: SignedInFixtureUser,
  options: Readonly<{ cancellationConfirmed?: boolean }> = { cancellationConfirmed: true }
) {
  assertFileStorageBinding(fixture.connection, { kind: 'local', bucketName: 'local' } as ObjectStorage, {
    initialize: true
  })
  fixture.sqlite
    .prepare("insert into projects (id, name, owner_user_id) values ('project_delete_owner', 'Owner Project', ?)")
    .run(owner.user.id)
  fixture.sqlite
    .prepare(
      `insert into files (
        id, owner_id, bucket, object_key, original_name, content_type, byte_size,
        content_md5, status, upload_expires_at
      ) values (
        'file_00000000-0000-4000-8000-000000000001', ?, 'local', ?, 'private.txt', 'text/plain', 7,
        '1B2M2Y8AsgTpgAmY7PhCfg==', 'ready', '2099-01-01T00:15:00.000Z'
      )`
    )
    .run(owner.user.id, 'files/v1/file_00000000-0000-4000-8000-000000000001')
  fixture.sqlite
    .prepare(
      "insert into billing_customers (id, organization_id, stripe_customer_id) values ('billing_customer_delete_owner', ?, 'cus_delete_owner')"
    )
    .run(owner.workspace.id)
  fixture.sqlite
    .prepare(
      `insert into billing_subscriptions (
        id, organization_id, billing_customer_id, stripe_subscription_id, stripe_subscription_item_id,
        status, plan_key, cadence, stripe_price_id, current_period_start, current_period_end, projection_order_ms,
        projection_event_id, reconciliation_required, reconciliation_reason, created_at, updated_at
      ) values (
        'billing_subscription_delete_owner', ?, 'billing_customer_delete_owner', 'sub_delete_owner', 'si_delete_owner',
        'active', 'family', 'monthly', 'price_family_test', '2026-07-01T00:00:00.000Z',
        '2026-08-01T00:00:00.000Z', 1782864000000, 'evt_seed_delete_owner', 0, null,
        '2026-06-01T00:00:00.000Z', '2026-07-01T00:00:00.000Z'
      )`
    )
    .run(owner.workspace.id)
  if (options.cancellationConfirmed !== false) {
    fixture.sqlite
      .prepare(
        `insert into billing_account_deletion_requests (
          id, user_id, organization_id, billing_subscription_id, billing_customer_id,
          expected_stripe_subscription_id, expected_stripe_customer_id, captured_billing_revision,
          state, cancellation_confirmed_at
        ) values (?, ?, ?, 'billing_subscription_delete_owner', 'billing_customer_delete_owner',
          'sub_delete_owner', 'cus_delete_owner', 0, 'cancellation_confirmed', ?)`
      )
      .run(`billing_delete_confirmed_${owner.user.id}`, owner.user.id, owner.workspace.id, new Date().toISOString())
  }
  fixture.sqlite
    .prepare(
      `insert into account (
        id, account_id, provider_id, user_id, access_token, refresh_token,
        created_at, updated_at
      ) values ('account_delete_owner', 'provider-delete-owner', 'google', ?,
        'access-must-disappear', 'refresh-must-disappear', ?, ?)`
    )
    .run(owner.user.id, Math.floor(Date.now() / 1000), Math.floor(Date.now() / 1000))
  seedAiConversation(fixture, owner.user.id, 1, { includeAttempt: true })
}

function seedInviteePrivateRows(fixture: WorkspaceInvitationFixture, invitee: SignedInFixtureUser) {
  fixture.sqlite
    .prepare("insert into projects (id, name, owner_user_id) values ('project_delete_invitee', 'Invitee Project', ?)")
    .run(invitee.user.id)
  fixture.sqlite
    .prepare(
      `insert into files (
        id, owner_id, bucket, object_key, original_name, content_type, byte_size,
        content_md5, status, upload_expires_at
      ) values (
        'file_00000000-0000-4000-8000-000000000002', ?, 'local', ?, 'keep.txt', 'text/plain', 4,
        '1B2M2Y8AsgTpgAmY7PhCfg==', 'ready', '2099-01-01T00:15:00.000Z'
      )`
    )
    .run(invitee.user.id, 'files/v1/file_00000000-0000-4000-8000-000000000002')
  fixture.sqlite
    .prepare(
      "insert into billing_customers (id, organization_id, stripe_customer_id) values ('billing_customer_delete_invitee', ?, 'cus_delete_invitee')"
    )
    .run(invitee.workspace.id)
  seedAiConversation(fixture, invitee.user.id, 2, { includeAttempt: true })
}

function snapshotInvitee(fixture: WorkspaceInvitationFixture, invitee: SignedInFixtureUser) {
  return {
    user: fixture.sqlite.prepare('select * from user where id = ?').get(invitee.user.id),
    organization: fixture.sqlite
      .prepare('select * from organization where personal_owner_user_id = ?')
      .get(invitee.user.id),
    project: fixture.sqlite.prepare("select * from projects where id = 'project_delete_invitee'").get(),
    file: fixture.sqlite.prepare("select * from files where id = 'file_00000000-0000-4000-8000-000000000002'").get(),
    aiConversation: fixture.sqlite
      .prepare('select * from ai_conversations where owner_user_id = ?')
      .get(invitee.user.id),
    aiMessage: fixture.sqlite
      .prepare(
        `select message.* from ai_messages message
         inner join ai_conversations conversation on conversation.id = message.conversation_id
         where conversation.owner_user_id = ?`
      )
      .get(invitee.user.id),
    aiFileCitation: fixture.sqlite
      .prepare(
        `select citation.* from ai_message_file_citations citation
         inner join ai_messages message on message.id = citation.message_id
         inner join ai_conversations conversation on conversation.id = message.conversation_id
         where conversation.owner_user_id = ?`
      )
      .get(invitee.user.id),
    aiWebCitation: fixture.sqlite
      .prepare(
        `select citation.* from ai_message_web_citations citation
         inner join ai_messages message on message.id = citation.message_id
         inner join ai_conversations conversation on conversation.id = message.conversation_id
         where conversation.owner_user_id = ?`
      )
      .get(invitee.user.id),
    aiAttempt: fixture.sqlite
      .prepare(
        `select attempt.* from ai_generation_attempts attempt
         inner join ai_conversations conversation on conversation.id = attempt.conversation_id
         where conversation.owner_user_id = ?`
      )
      .get(invitee.user.id),
    aiLease: fixture.sqlite.prepare('select * from ai_generation_leases where owner_user_id = ?').get(invitee.user.id),
    aiUsage: fixture.sqlite.prepare('select * from ai_usage_buckets where owner_user_id = ?').get(invitee.user.id),
    billing: fixture.sqlite
      .prepare("select * from billing_customers where stripe_customer_id = 'cus_delete_invitee'")
      .get()
  }
}

function seedAiConversation(
  fixture: WorkspaceInvitationFixture,
  userId: string,
  sequence: number,
  options: Readonly<{ conversationOnly?: boolean; includeAttempt?: boolean }> = {}
) {
  const suffix = String(sequence).padStart(12, '0')
  const conversationId = `ai_conversation_00000000-0000-4000-8000-${suffix}`
  const messageId = `ai_message_00000000-0000-4000-8000-${suffix}`
  const fileCitationMessageId = `ai_message_10000000-0000-4000-8000-${suffix}`
  const webCitationMessageId = `ai_message_20000000-0000-4000-8000-${suffix}`
  const now = '2026-07-16T12:00:00.000Z'
  fixture.sqlite
    .prepare(
      `insert into ai_conversations (
         id, owner_user_id, history_revision, next_sequence, created_at, updated_at
       ) values (?, ?, 0, 4, ?, ?)`
    )
    .run(conversationId, userId, now, now)
  if (options.conversationOnly) return

  fixture.sqlite
    .prepare(
      `insert into ai_messages (id, conversation_id, sequence, role, content, created_at)
       values (?, ?, 1, 'user', 'private AI content', ?)`
    )
    .run(messageId, conversationId, now)
  fixture.sqlite
    .prepare(
      `insert into ai_messages (id, conversation_id, sequence, role, content, created_at)
       values (?, ?, 2, 'assistant', 'private file-cited answer', ?),
              (?, ?, 3, 'assistant', 'private Web-cited answer', ?)`
    )
    .run(fileCitationMessageId, conversationId, now, webCitationMessageId, conversationId, now)
  fixture.sqlite
    .prepare('insert into ai_message_file_citations (message_id, ordinal, title) values (?, 1, ?)')
    .run(fileCitationMessageId, `Private file source ${sequence}.pdf`)
  fixture.sqlite
    .prepare(
      `insert into ai_message_web_citations (
         message_id, ordinal, title, url, start_index, end_index
       ) values (?, 1, ?, ?, 0, 7)`
    )
    .run(webCitationMessageId, `Private Web source ${sequence}`, `https://example.test/private-source-${sequence}`)
  if (options.includeAttempt) {
    const attemptId = `ai_attempt_00000000-0000-4000-8000-${suffix}`
    fixture.sqlite
      .prepare(
        `insert into ai_generation_attempts (
           id, conversation_id, user_message_id, client_request_id, history_revision,
           usage_bucket_date, status, model, lease_expires_at, created_at, updated_at
         ) values (?, ?, ?, ?, 0, '2026-07-16', 'pending', 'gpt-5.6-luna', ?, ?, ?)`
      )
      .run(
        attemptId,
        conversationId,
        messageId,
        `00000000-0000-4000-8000-${suffix}`,
        '2026-07-16T12:05:00.000Z',
        now,
        now
      )
    fixture.sqlite
      .prepare(
        `insert into ai_generation_leases (
           owner_user_id, attempt_id, lease_expires_at, created_at, updated_at
         ) values (?, ?, ?, ?, ?)`
      )
      .run(userId, attemptId, '2026-07-16T12:05:00.000Z', now, now)
  }
  fixture.sqlite
    .prepare(
      `insert into ai_usage_buckets (
         owner_user_id, bucket_date, request_count, input_tokens, output_tokens,
         reasoning_tokens, cached_input_tokens, cache_write_tokens, created_at, updated_at
       ) values (?, '2026-07-16', 1, 8, 4, 2, 0, 0, ?, ?)`
    )
    .run(userId, now, now)
}

function count(fixture: WorkspaceInvitationFixture, table: string, predicate?: string, ...values: unknown[]) {
  const sql = `select count(*) as count from ${table}${predicate ? ` where ${predicate}` : ''}`
  return (fixture.sqlite.prepare(sql).get(...values) as { count: number }).count
}

function billingRuntimeConfig(fixture: WorkspaceInvitationFixture): AppRuntimeConfig {
  return {
    ...fixture.config,
    modules: { billing: { enabled: true } },
    stripe: {
      secretKey: 'sk_test_account_deletion',
      webhookSecret: 'whsec_account_deletion',
      portalConfigurationId: 'bpc_account_deletion',
      personalWeeklyPriceId: 'price_personal_weekly_account_deletion',
      personalMonthlyPriceId: 'price_personal_monthly_account_deletion',
      personalAnnualPriceId: 'price_personal_annual_account_deletion',
      familyMonthlyPriceId: 'price_family_test',
      familyAnnualPriceId: 'price_family_annual_account_deletion'
    }
  } as AppRuntimeConfig
}

function stripeEvent(input: {
  id: string
  type: Stripe.Event.Type
  created: number
  object: Record<string, unknown>
}): Stripe.Event {
  return {
    id: input.id,
    object: 'event',
    api_version: '2026-06-24.dahlia',
    created: input.created,
    data: { object: input.object },
    livemode: false,
    pending_webhooks: 0,
    request: null,
    type: input.type
  } as unknown as Stripe.Event
}

function stripeSubscription(input: {
  id: string
  customer: string
  status: Stripe.Subscription.Status
  currentPeriodEnd: number
}): Stripe.Subscription {
  return {
    id: input.id,
    object: 'subscription',
    customer: input.customer,
    status: input.status,
    collection_method: 'charge_automatically',
    cancel_at: null,
    cancel_at_period_end: false,
    pause_collection: null,
    trial_end: null,
    discounts: [],
    billing_schedules: [],
    schedule: null,
    pending_update: null,
    latest_invoice: null,
    metadata: {},
    items: {
      object: 'list',
      data: [
        {
          id: `si_${input.id}`,
          object: 'subscription_item',
          current_period_start: 1_782_864_000,
          current_period_end: input.currentPeriodEnd,
          price: { id: 'price_family_test', object: 'price' },
          quantity: 1,
          discounts: []
        }
      ],
      has_more: false,
      url: `/v1/subscription_items?subscription=${input.id}`
    }
  } as unknown as Stripe.Subscription
}

function stripeClientWithSubscriptions(
  subscriptions: Stripe.Subscription[],
  beforeList?: () => void | Promise<void>
): StripeBillingClient {
  let listObserved = false
  return {
    checkout: {
      sessions: {
        async retrieve(id: string) {
          return {
            id,
            object: 'checkout.session',
            mode: 'subscription',
            status: 'complete',
            payment_status: 'unpaid',
            client_reference_id: 'attempt_without_retained_continuity',
            metadata: { billing_attempt_id: 'attempt_without_retained_continuity' },
            customer: null,
            subscription: null,
            line_items: {
              object: 'list',
              data: [{ object: 'item', price: { id: 'price_family_test', object: 'price' }, quantity: 1 }],
              has_more: false,
              url: `/v1/checkout/sessions/${id}/line_items`
            }
          } as unknown as Stripe.Checkout.Session
        }
      }
    },
    subscriptions: {
      async retrieve(id: string) {
        return subscriptions.find((subscription) => subscription.id === id) ?? subscriptions[0]
      },
      async list(parameters: Stripe.SubscriptionListParams) {
        if (!listObserved) {
          listObserved = true
          await beforeList?.()
        }
        return {
          object: 'list',
          data: subscriptions.filter((subscription) => subscription.status === parameters.status),
          has_more: false,
          url: '/v1/subscriptions'
        } as Stripe.ApiList<Stripe.Subscription>
      }
    }
  } as unknown as StripeBillingClient
}

function stripeDeletionClient() {
  const canceled = {
    id: 'sub_delete_owner',
    object: 'subscription',
    customer: 'cus_delete_owner',
    status: 'canceled'
  } as Stripe.Subscription
  const cancel = vi.fn(async () => canceled)
  const retrieve = vi.fn(async () => canceled)
  const list = vi.fn(async (parameters: Stripe.SubscriptionListParams) => ({
    object: 'list' as const,
    data: canceled.status === parameters.status ? [canceled] : [],
    has_more: false,
    url: '/v1/subscriptions'
  }))
  return {
    cancel,
    list,
    retrieve,
    client: {
      subscriptions: { cancel, list, retrieve }
    } as unknown as StripeBillingClient
  }
}

async function deliverQueuedBillingNotifications(fixture: WorkspaceInvitationFixture) {
  const handler = createBillingNotificationDeliveryHandler({
    appName: fixture.config.public.appName,
    connection: fixture.connection,
    sender: {
      async send(message) {
        fixture.billingNotifications.push(message)
      }
    }
  })
  const jobs = fixture.sqlite
    .prepare('select payload from job_queue where type = ? order by id')
    .all(billingNotificationDeliveryJobType) as Array<{ payload: string }>
  for (const job of jobs) {
    expect(job.payload).not.toMatch(/@|cus_|sub_|price_|evt_/i)
    await handler(JSON.parse(job.payload))
  }
}

function deleteAccountWithBillingProof(
  fixture: WorkspaceInvitationFixture,
  owner: SignedInFixtureUser,
  options: Readonly<{
    deletedAt?: string
    checkpoint?: (checkpoint: AccountDeletionCheckpoint) => void
  }> = {}
) {
  fixture.sqlite
    .prepare('update organization set billing_deletion_pending = 1 where personal_owner_user_id = ?')
    .run(owner.user.id)
  return deleteAccountAtomically(fixture.connection, owner.user, {
    ...options,
    billingProof: issueAccountDeletionBillingProof(owner.user.id)
  })
}
