import type Stripe from 'stripe'
import { eq } from 'drizzle-orm'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  billingSubscriptions,
  familyJoinAttempts,
  invitation,
  jobQueue,
  member,
  organization
} from '../server/db/schema'
import {
  createOrResumeFamilyJoinAttempt,
  ensureFamilyJoinRecoveryJobs,
  familyJoinRecoveryMaxAttempts,
  familyJoinRecoveryJobType,
  markFamilyJoinMembershipPending
} from '../server/db/repositories/family-join'
import { countReservedOrganizationInvitations } from '../server/db/repositories/billing'
import { listPendingWorkspaceInvitationProjections } from '../server/db/repositories/workspace-invitations'
import type { FamilyJoinStripeClient } from '../server/services/family-join'
import {
  ensureFamilyInvitationExpirationJob,
  expirePendingFamilyInvitations,
  familyInvitationExpirationJobType,
  familyInvitationExpirationPageSize
} from '../server/services/jobs/family-invitation-expiration'
import {
  createFamilyJoinRecoveryJobHandler,
  recoverFamilyJoinAttempt
} from '../server/services/jobs/family-join-recovery'
import { runNextJobForConnection } from '../server/services/jobs/job-queue'
import {
  createWorkspaceInvitationFixture,
  seedVerifiedBilling,
  type SignedInFixtureUser,
  type WorkspaceInvitationFixture
} from './helpers/workspace-invitation-fixture'

let fixture: WorkspaceInvitationFixture | undefined

afterEach(() => {
  fixture?.cleanup()
  fixture = undefined
})

describe('Family invitation expiration job', () => {
  it.each([
    { phase: 'grace', status: 'past_due' as const, startedDaysAgo: 1 },
    { phase: 'grace', status: 'unpaid' as const, startedDaysAgo: 1 },
    { phase: 'suspension', status: 'past_due' as const, startedDaysAgo: 15 },
    { phase: 'suspension', status: 'unpaid' as const, startedDaysAgo: 15 }
  ])(
    'keeps expired pending invitations visible and reserved during valid $status $phase',
    async ({ status, startedDaysAgo }) => {
      fixture = createWorkspaceInvitationFixture()
      const manager = await fixture.signIn(`${status}-${startedDaysAgo}-manager@example.test`, 'Freeze Manager')
      const billing = seedVerifiedBilling(fixture, manager, { plan: 'family' })
      const now = new Date('2026-07-28T12:00:00.000Z')
      const graceStartedAt = new Date(now.getTime() - startedDaysAgo * 24 * 60 * 60 * 1_000)
      setFamilyDunning(fixture, billing.subscriptionId, status, graceStartedAt)
      addInvitation(fixture, manager, {
        expiresAt: new Date(now.getTime() - 60_000),
        id: `frozen-${status}-${startedDaysAgo}`,
        status: 'pending'
      })

      expect(countReservedOrganizationInvitations(fixture.connection, manager.workspace.id, now.getTime())).toBe(1)
      expect(listPendingWorkspaceInvitationProjections(fixture.connection, manager.workspace.id, now)).toEqual([
        expect.objectContaining({ id: `frozen-${status}-${startedDaysAgo}` })
      ])
      expect(ensureFamilyInvitationExpirationJob(fixture.connection, now)).toBe('not-needed')
      expect(expirePendingFamilyInvitations(fixture.connection, { cursor: null }, now)).toEqual({
        expired: 0,
        nextCursor: null
      })
      expect(invitationStatus(fixture, `frozen-${status}-${startedDaysAgo}`)).toBe('pending')
    }
  )

  it('re-evaluates the original expiration after verified active recovery', async () => {
    fixture = createWorkspaceInvitationFixture()
    const manager = await fixture.signIn('recovered-expiry-manager@example.test', 'Recovered Manager')
    const billing = seedVerifiedBilling(fixture, manager, { plan: 'family' })
    const now = new Date('2026-07-28T12:00:00.000Z')
    setFamilyDunning(fixture, billing.subscriptionId, 'past_due', new Date(now.getTime() - 60_000))
    addInvitation(fixture, manager, {
      expiresAt: new Date(now.getTime() - 1),
      id: 'expired-after-recovery',
      status: 'pending'
    })
    expect(expirePendingFamilyInvitations(fixture.connection, { cursor: null }, now).expired).toBe(0)

    fixture.connection.db
      .update(billingSubscriptions)
      .set({
        graceEndsAt: null,
        graceInvoiceId: null,
        graceStartedAt: null,
        status: 'active'
      })
      .where(eq(billingSubscriptions.id, billing.subscriptionId))
      .run()

    expect(countReservedOrganizationInvitations(fixture.connection, manager.workspace.id, now.getTime())).toBe(0)
    expect(listPendingWorkspaceInvitationProjections(fixture.connection, manager.workspace.id, now)).toEqual([])
    expect(ensureFamilyInvitationExpirationJob(fixture.connection, now)).toBe('scheduled')
    expect(expirePendingFamilyInvitations(fixture.connection, { cursor: null }, now)).toEqual({
      expired: 1,
      nextCursor: null
    })
    expect(invitationStatus(fixture, 'expired-after-recovery')).toBe('canceled')
  })

  it('releases expired pending reservations in bounded replay-safe pages', async () => {
    fixture = createWorkspaceInvitationFixture()
    const manager = await fixture.signIn('expiry-manager@example.test', 'Expiry Manager')
    const now = new Date()
    for (let index = 0; index < familyInvitationExpirationPageSize + 5; index += 1) {
      addInvitation(fixture, manager, {
        expiresAt: new Date(now.getTime() - 60_000),
        id: `expired-${String(index).padStart(3, '0')}`,
        status: 'pending'
      })
    }
    addInvitation(fixture, manager, {
      expiresAt: new Date(now.getTime() + 60_000),
      id: 'future-pending',
      status: 'pending'
    })
    addInvitation(fixture, manager, {
      expiresAt: new Date(now.getTime() - 60_000),
      id: 'already-accepted',
      status: 'accepted'
    })

    const first = expirePendingFamilyInvitations(fixture.connection, { cursor: null }, now)

    expect(first).toEqual({
      expired: familyInvitationExpirationPageSize,
      nextCursor: `expired-${String(familyInvitationExpirationPageSize - 1).padStart(3, '0')}`
    })
    const successor = fixture.connection.db
      .select({ payload: jobQueue.payload, type: jobQueue.type })
      .from(jobQueue)
      .where(eq(jobQueue.type, familyInvitationExpirationJobType))
      .get()
    expect(successor).toEqual({
      payload: { cursor: first.nextCursor },
      type: familyInvitationExpirationJobType
    })

    const second = expirePendingFamilyInvitations(fixture.connection, { cursor: first.nextCursor }, now)
    const replay = expirePendingFamilyInvitations(fixture.connection, { cursor: first.nextCursor }, now)

    expect(second).toEqual({ expired: 5, nextCursor: null })
    expect(replay).toEqual({ expired: 0, nextCursor: null })
    expect(
      fixture.connection.db
        .select({ status: invitation.status })
        .from(invitation)
        .where(eq(invitation.id, 'future-pending'))
        .get()
    ).toEqual({ status: 'pending' })
    expect(
      fixture.connection.db
        .select({ status: invitation.status })
        .from(invitation)
        .where(eq(invitation.id, 'already-accepted'))
        .get()
    ).toEqual({ status: 'accepted' })
    expect(
      fixture.connection.db
        .select({ status: invitation.status })
        .from(invitation)
        .all()
        .filter((row) => row.status === 'pending')
    ).toHaveLength(1)
  })

  it('schedules one root safety pass only when an expired reservation exists', async () => {
    fixture = createWorkspaceInvitationFixture()
    const manager = await fixture.signIn('expiry-safety@example.test', 'Expiry Safety')
    const now = new Date()

    expect(ensureFamilyInvitationExpirationJob(fixture.connection, now)).toBe('not-needed')
    addInvitation(fixture, manager, {
      expiresAt: new Date(now.getTime() - 1),
      id: 'expired-for-safety',
      status: 'pending'
    })
    expect(ensureFamilyInvitationExpirationJob(fixture.connection, now)).toBe('scheduled')
    expect(ensureFamilyInvitationExpirationJob(fixture.connection, now)).toBe('covered')
    expect(
      fixture.connection.db
        .select({ payload: jobQueue.payload })
        .from(jobQueue)
        .where(eq(jobQueue.type, familyInvitationExpirationJobType))
        .all()
    ).toEqual([{ payload: { cursor: null } }])
  })
})

describe('Family join recovery job', () => {
  it('confirms renewal off with the stable Stripe idempotency key but never creates a member', async () => {
    fixture = createWorkspaceInvitationFixture()
    const manager = await fixture.signIn('recovery-manager@example.test', 'Recovery Manager')
    const recipient = await fixture.signIn('recovery-recipient@example.test', 'Recovery Recipient')
    seedVerifiedBilling(fixture, manager, { plan: 'family' })
    const personal = seedVerifiedBilling(fixture, recipient, { plan: 'personal' })
    addInvitation(fixture, manager, {
      email: recipient.user.email,
      expiresAt: new Date(Date.now() + 60 * 60 * 1_000),
      id: 'recovery-invitation',
      status: 'pending'
    })
    const reserved = createOrResumeFamilyJoinAttempt(fixture.connection, {
      invitationId: 'recovery-invitation',
      recipientUserId: recipient.user.id
    })
    const stripe = recoveryStripeClient(personal, (providerSubscription) => {
      const item = providerSubscription.items.data[0]!
      fixture!.connection.db
        .update(billingSubscriptions)
        .set({
          cancelAtPeriodEnd: true,
          currentPeriodEnd: new Date(item.current_period_end * 1_000).toISOString(),
          currentPeriodStart: new Date(item.current_period_start * 1_000).toISOString(),
          revision: reserved.subscription.revision + 1
        })
        .where(eq(billingSubscriptions.id, personal.subscriptionId))
        .run()
    })
    const context = {
      connection: fixture.connection,
      getStripeClient: () => stripe.client
    }

    await expect(recoverFamilyJoinAttempt(context, reserved.attempt.id)).resolves.toBe('user_retry_required')
    await expect(recoverFamilyJoinAttempt(context, reserved.attempt.id)).resolves.toBe('user_retry_required')

    expect(stripe.update).toHaveBeenCalledTimes(1)
    expect(stripe.retrieve).toHaveBeenCalledTimes(1)
    expect(stripe.update).toHaveBeenCalledWith(
      personal.stripeSubscriptionId,
      { cancel_at_period_end: true },
      { idempotencyKey: reserved.attempt.stripeCancellationIdempotencyKey }
    )
    expect(
      fixture.connection.db
        .select({
          paidThrough: familyJoinAttempts.personalPaidThrough,
          reason: familyJoinAttempts.stateReason,
          state: familyJoinAttempts.state
        })
        .from(familyJoinAttempts)
        .where(eq(familyJoinAttempts.id, reserved.attempt.id))
        .get()
    ).toEqual({
      paidThrough: personal.currentPeriodEnd,
      reason: 'family_acceptance_requires_user_retry',
      state: 'reconciliation_required'
    })
    expect(
      fixture.connection.db
        .select()
        .from(member)
        .where(eq(member.organizationId, manager.workspace.id))
        .all()
        .filter((row) => row.role === 'member')
    ).toEqual([])
    expect(
      fixture.connection.db
        .select({ status: invitation.status })
        .from(invitation)
        .where(eq(invitation.id, 'recovery-invitation'))
        .get()
    ).toEqual({ status: 'pending' })
    expect(
      fixture.connection.db
        .select({ payload: jobQueue.payload })
        .from(jobQueue)
        .where(eq(jobQueue.type, familyJoinRecoveryJobType))
        .all()
    ).toEqual([{ payload: { attemptId: reserved.attempt.id } }])
  })

  it('rediscovers a delayed manager deletion fence after the user-retry recovery job succeeds', async () => {
    fixture = createWorkspaceInvitationFixture()
    const manager = await fixture.signIn('delayed-authority-manager@example.test', 'Delayed Authority Manager')
    const recipient = await fixture.signIn('delayed-authority-recipient@example.test', 'Delayed Authority Recipient')
    seedVerifiedBilling(fixture, manager, { plan: 'family' })
    const personal = seedVerifiedBilling(fixture, recipient, { plan: 'personal' })
    const reservedAt = new Date()
    addInvitation(fixture, manager, {
      email: recipient.user.email,
      expiresAt: new Date(reservedAt.getTime() + 60 * 60 * 1_000),
      id: 'delayed-authority-invitation',
      status: 'pending'
    })
    const reserved = createOrResumeFamilyJoinAttempt(fixture.connection, {
      invitationId: 'delayed-authority-invitation',
      now: reservedAt,
      recipientUserId: recipient.user.id
    })
    const stripe = recoveryStripeClient(personal, (providerSubscription) => {
      const item = providerSubscription.items.data[0]!
      fixture!.connection.db
        .update(billingSubscriptions)
        .set({
          cancelAtPeriodEnd: true,
          currentPeriodEnd: new Date(item.current_period_end * 1_000).toISOString(),
          currentPeriodStart: new Date(item.current_period_start * 1_000).toISOString(),
          revision: reserved.subscription.revision + 1
        })
        .where(eq(billingSubscriptions.id, personal.subscriptionId))
        .run()
    })
    let workerNow = new Date(reservedAt.getTime() + 2 * 60_000)
    const handlers = {
      [familyJoinRecoveryJobType]: createFamilyJoinRecoveryJobHandler({
        connection: fixture.connection,
        getStripeClient: () => stripe.client,
        now: () => workerNow
      })
    }

    await expect(
      runNextJobForConnection(fixture.connection, handlers, 'delayed-authority-worker', {
        now: workerNow
      })
    ).resolves.toEqual({
      jobId: expect.any(Number),
      ran: true,
      status: 'succeeded'
    })
    expect(readFamilyJoinRecoveryJobs(fixture, reserved.attempt.id)).toEqual([
      expect.objectContaining({ attempts: 1, status: 'succeeded' })
    ])
    expect(ensureFamilyJoinRecoveryJobs(fixture.connection, workerNow)).toBe(0)

    fixture.connection.db
      .update(familyJoinAttempts)
      .set({ stateReason: 'family_acceptance_requires_retry' })
      .where(eq(familyJoinAttempts.id, reserved.attempt.id))
      .run()

    fixture.connection.db
      .update(organization)
      .set({ billingDeletionPending: true })
      .where(eq(organization.id, manager.workspace.id))
      .run()
    const authorityLostAt = new Date(workerNow.getTime() + 60_000)
    expect(ensureFamilyJoinRecoveryJobs(fixture.connection, authorityLostAt)).toBe(1)
    expect(ensureFamilyJoinRecoveryJobs(fixture.connection, authorityLostAt)).toBe(0)
    expect(readFamilyJoinRecoveryJobs(fixture, reserved.attempt.id)).toEqual([
      expect.objectContaining({ attempts: 1, status: 'succeeded' }),
      expect.objectContaining({ attempts: 0, status: 'queued' })
    ])

    workerNow = new Date(authorityLostAt.getTime() + 60_000)
    await expect(
      runNextJobForConnection(fixture.connection, handlers, 'delayed-authority-worker', {
        now: workerNow
      })
    ).resolves.toEqual({
      jobId: expect.any(Number),
      ran: true,
      status: 'succeeded'
    })
    expect(stripe.update).toHaveBeenCalledTimes(1)
    expect(stripe.retrieve).toHaveBeenCalledTimes(1)
    expect(
      fixture.connection.db
        .select({
          reason: familyJoinAttempts.stateReason,
          state: familyJoinAttempts.state
        })
        .from(familyJoinAttempts)
        .where(eq(familyJoinAttempts.id, reserved.attempt.id))
        .get()
    ).toEqual({ reason: 'family_authority_changed', state: 'failed' })
    expect(
      fixture.connection.db
        .select({ cancelAtPeriodEnd: billingSubscriptions.cancelAtPeriodEnd })
        .from(billingSubscriptions)
        .where(eq(billingSubscriptions.id, personal.subscriptionId))
        .get()
    ).toEqual({ cancelAtPeriodEnd: true })
    expect(ensureFamilyJoinRecoveryJobs(fixture.connection, workerNow)).toBe(0)

    fixture.connection.db
      .update(organization)
      .set({ billingDeletionPending: false })
      .where(eq(organization.id, manager.workspace.id))
      .run()
    addInvitation(fixture, manager, {
      email: recipient.user.email,
      expiresAt: new Date(workerNow.getTime() + 60 * 60 * 1_000),
      id: 'after-delayed-authority-invitation',
      status: 'pending'
    })
    expect(
      createOrResumeFamilyJoinAttempt(fixture.connection, {
        invitationId: 'after-delayed-authority-invitation',
        now: workerNow,
        recipientUserId: recipient.user.id
      }).attempt.invitationId
    ).toBe('after-delayed-authority-invitation')
  })

  it('appends missing and exhausted provider-uncertain generations without rewriting history', async () => {
    fixture = createWorkspaceInvitationFixture()
    const manager = await fixture.signIn('generation-manager@example.test', 'Generation Manager')
    const recipient = await fixture.signIn('generation-recipient@example.test', 'Generation Recipient')
    seedVerifiedBilling(fixture, manager, { plan: 'family' })
    seedVerifiedBilling(fixture, recipient, { plan: 'personal' })
    addInvitation(fixture, manager, {
      email: recipient.user.email,
      expiresAt: new Date(Date.now() + 60 * 60 * 1_000),
      id: 'generation-invitation',
      status: 'pending'
    })
    const reserved = createOrResumeFamilyJoinAttempt(fixture.connection, {
      invitationId: 'generation-invitation',
      recipientUserId: recipient.user.id
    })
    fixture.sqlite
      .prepare(
        `update family_join_attempts
         set
           state = 'reconciliation_required',
           state_reason = 'stripe_renewal_stop_unconfirmed',
           revision = revision + 1
         where id = ?`
      )
      .run(reserved.attempt.id)
    fixture.sqlite
      .prepare(
        `delete from job_queue
         where type = ?
           and json_extract(payload, '$.attemptId') = ?`
      )
      .run(familyJoinRecoveryJobType, reserved.attempt.id)

    const firstScanAt = new Date('2026-01-01T00:00:00.000Z')
    expect(ensureFamilyJoinRecoveryJobs(fixture.connection, firstScanAt)).toBe(1)
    const firstGeneration = readFamilyJoinRecoveryJobs(fixture, reserved.attempt.id)
    expect(firstGeneration).toEqual([
      expect.objectContaining({
        attempts: 0,
        maxAttempts: familyJoinRecoveryMaxAttempts,
        payload: JSON.stringify({ attemptId: reserved.attempt.id }),
        status: 'queued'
      })
    ])

    fixture.sqlite
      .prepare(
        `update job_queue
         set
           status = 'failed',
           attempts = max_attempts,
           last_error = 'JOB_HANDLER_FAILED',
           updated_at = ?
         where id = ?`
      )
      .run(firstScanAt.toISOString(), firstGeneration[0]!.id)
    const exhaustedHistory = readFamilyJoinRecoveryJobs(fixture, reserved.attempt.id)[0]

    const secondScanAt = new Date('2026-01-01T00:02:00.000Z')
    expect(ensureFamilyJoinRecoveryJobs(fixture.connection, secondScanAt)).toBe(1)
    expect(ensureFamilyJoinRecoveryJobs(fixture.connection, secondScanAt)).toBe(0)

    const generations = readFamilyJoinRecoveryJobs(fixture, reserved.attempt.id)
    expect(generations).toHaveLength(2)
    expect(generations[0]).toEqual(exhaustedHistory)
    expect(generations[1]).toEqual(
      expect.objectContaining({
        attempts: 0,
        maxAttempts: familyJoinRecoveryMaxAttempts,
        payload: JSON.stringify({ attemptId: reserved.attempt.id }),
        status: 'queued'
      })
    )
    expect(
      fixture.connection.db
        .select()
        .from(member)
        .where(eq(member.organizationId, manager.workspace.id))
        .all()
        .filter((row) => row.role === 'member')
    ).toEqual([])
  })

  it('completes bookkeeping only after exact Better Auth invitation and membership rows exist', async () => {
    fixture = createWorkspaceInvitationFixture()
    const manager = await fixture.signIn('persisted-manager@example.test', 'Persisted Manager')
    const recipient = await fixture.signIn('persisted-recipient@example.test', 'Persisted Recipient')
    seedVerifiedBilling(fixture, manager, { plan: 'family' })
    const personal = seedVerifiedBilling(fixture, recipient, { plan: 'personal' })
    addInvitation(fixture, manager, {
      email: recipient.user.email,
      expiresAt: new Date(Date.now() + 60 * 60 * 1_000),
      id: 'persisted-invitation',
      status: 'pending'
    })
    const reserved = createOrResumeFamilyJoinAttempt(fixture.connection, {
      invitationId: 'persisted-invitation',
      recipientUserId: recipient.user.id
    })
    const stripe = recoveryStripeClient(personal)
    const context = {
      connection: fixture.connection,
      getStripeClient: () => stripe.client
    }
    await expect(recoverFamilyJoinAttempt(context, reserved.attempt.id)).resolves.toBe('user_retry_required')

    markFamilyJoinMembershipPending(fixture.connection, reserved.attempt.id)
    fixture.sqlite
      .prepare(
        `insert into member (id, organization_id, user_id, role, created_at)
         values ('better-auth-member', ?, ?, 'member', ?)`
      )
      .run(manager.workspace.id, recipient.user.id, Date.now())
    fixture.connection.db
      .update(invitation)
      .set({ status: 'accepted' })
      .where(eq(invitation.id, 'persisted-invitation'))
      .run()

    await expect(recoverFamilyJoinAttempt(context, reserved.attempt.id)).resolves.toBe('completed')
    await expect(recoverFamilyJoinAttempt(context, reserved.attempt.id)).resolves.toBe('already_completed')

    expect(stripe.update).toHaveBeenCalledTimes(1)
    expect(
      fixture.connection.db
        .select({
          acceptedMemberId: familyJoinAttempts.acceptedMemberId,
          state: familyJoinAttempts.state
        })
        .from(familyJoinAttempts)
        .where(eq(familyJoinAttempts.id, reserved.attempt.id))
        .get()
    ).toEqual({ acceptedMemberId: 'better-auth-member', state: 'completed' })
  })

  it('retries provider uncertainty without leaking provider data and never re-enables renewal', async () => {
    fixture = createWorkspaceInvitationFixture()
    const manager = await fixture.signIn('provider-retry-manager@example.test', 'Provider Retry Manager')
    const recipient = await fixture.signIn('provider-retry-recipient@example.test', 'Provider Retry Recipient')
    seedVerifiedBilling(fixture, manager, { plan: 'family' })
    const personal = seedVerifiedBilling(fixture, recipient, { plan: 'personal' })
    addInvitation(fixture, manager, {
      email: recipient.user.email,
      expiresAt: new Date(Date.now() + 60 * 60 * 1_000),
      id: 'provider-retry-invitation',
      status: 'pending'
    })
    const reserved = createOrResumeFamilyJoinAttempt(fixture.connection, {
      invitationId: 'provider-retry-invitation',
      recipientUserId: recipient.user.id
    })
    const good = recoveryStripeClient(personal)
    const badRetrieve = vi.fn(async () => ({
      ...(await good.retrieve()),
      cancel_at_period_end: false,
      customer: 'cus_private_wrong'
    }))
    const badClient = {
      subscriptions: {
        retrieve: badRetrieve,
        update: vi.fn(async () => {
          throw new Error(`provider failure ${recipient.user.email} ${personal.stripeSubscriptionId}`)
        })
      }
    } as unknown as FamilyJoinStripeClient
    const handler = createFamilyJoinRecoveryJobHandler({
      connection: fixture.connection,
      getStripeClient: () => badClient
    })

    await expect(handler({ attemptId: reserved.attempt.id })).rejects.toThrow(
      'Family join renewal-off confirmation failed'
    )
    expect(
      fixture.connection.db
        .select({ reason: familyJoinAttempts.stateReason, state: familyJoinAttempts.state })
        .from(familyJoinAttempts)
        .where(eq(familyJoinAttempts.id, reserved.attempt.id))
        .get()
    ).toEqual({ reason: 'stripe_renewal_stop_unconfirmed', state: 'reconciliation_required' })
    expect(
      fixture.connection.db
        .select({ cancelAtPeriodEnd: billingSubscriptions.cancelAtPeriodEnd })
        .from(billingSubscriptions)
        .where(eq(billingSubscriptions.id, personal.subscriptionId))
        .get()
    ).toEqual({ cancelAtPeriodEnd: false })

    await expect(
      recoverFamilyJoinAttempt(
        {
          connection: fixture.connection,
          getStripeClient: () => good.client
        },
        reserved.attempt.id
      )
    ).resolves.toBe('user_retry_required')
    expect(good.update).toHaveBeenCalledWith(
      personal.stripeSubscriptionId,
      { cancel_at_period_end: true },
      { idempotencyKey: reserved.attempt.stripeCancellationIdempotencyKey }
    )
    expect(
      fixture.connection.db
        .select({ cancelAtPeriodEnd: billingSubscriptions.cancelAtPeriodEnd })
        .from(billingSubscriptions)
        .where(eq(billingSubscriptions.id, personal.subscriptionId))
        .get()
    ).toEqual({ cancelAtPeriodEnd: true })
  })

  it('reads Stripe without mutating it and releases the attempt after manager authority changes', async () => {
    fixture = createWorkspaceInvitationFixture()
    const manager = await fixture.signIn('authority-manager@example.test', 'Authority Manager')
    const recipient = await fixture.signIn('authority-recipient@example.test', 'Authority Recipient')
    const managerBilling = seedVerifiedBilling(fixture, manager, { plan: 'family' })
    const personal = seedVerifiedBilling(fixture, recipient, { plan: 'personal' })
    addInvitation(fixture, manager, {
      email: recipient.user.email,
      expiresAt: new Date(Date.now() + 60 * 60 * 1_000),
      id: 'authority-invitation',
      status: 'pending'
    })
    const reserved = createOrResumeFamilyJoinAttempt(fixture.connection, {
      invitationId: 'authority-invitation',
      recipientUserId: recipient.user.id
    })
    fixture.connection.db
      .update(billingSubscriptions)
      .set({ cancelAtPeriodEnd: true })
      .where(eq(billingSubscriptions.id, managerBilling.subscriptionId))
      .run()
    const stripe = recoveryStripeClient(personal)

    await expect(
      recoverFamilyJoinAttempt(
        {
          connection: fixture.connection,
          getStripeClient: () => stripe.client
        },
        reserved.attempt.id
      )
    ).resolves.toBe('not_recoverable')

    expect(stripe.update).not.toHaveBeenCalled()
    expect(stripe.retrieve).toHaveBeenCalledOnce()
    expect(
      fixture.connection.db
        .select({
          paidThrough: familyJoinAttempts.personalPaidThrough,
          reason: familyJoinAttempts.stateReason,
          state: familyJoinAttempts.state
        })
        .from(familyJoinAttempts)
        .where(eq(familyJoinAttempts.id, reserved.attempt.id))
        .get()
    ).toEqual({
      paidThrough: personal.currentPeriodEnd,
      reason: 'family_authority_changed',
      state: 'failed'
    })
    expect(
      fixture.connection.db
        .select({ cancelAtPeriodEnd: billingSubscriptions.cancelAtPeriodEnd })
        .from(billingSubscriptions)
        .where(eq(billingSubscriptions.id, personal.subscriptionId))
        .get()
    ).toEqual({ cancelAtPeriodEnd: true })
    expect(
      fixture.connection.db
        .select()
        .from(member)
        .where(eq(member.organizationId, manager.workspace.id))
        .all()
        .filter((row) => row.role === 'member')
    ).toEqual([])

    expect(ensureFamilyJoinRecoveryJobs(fixture.connection)).toBe(0)

    fixture.connection.db
      .update(billingSubscriptions)
      .set({ cancelAtPeriodEnd: false })
      .where(eq(billingSubscriptions.id, managerBilling.subscriptionId))
      .run()
    addInvitation(fixture, manager, {
      email: recipient.user.email,
      expiresAt: new Date(Date.now() + 60 * 60 * 1_000),
      id: 'later-authority-invitation',
      status: 'pending'
    })
    expect(
      createOrResumeFamilyJoinAttempt(fixture.connection, {
        invitationId: 'later-authority-invitation',
        recipientUserId: recipient.user.id
      }).attempt.invitationId
    ).toBe('later-authority-invitation')
  })

  it('releases an authority-lost attempt when exact Stripe state shows renewal remains on', async () => {
    fixture = createWorkspaceInvitationFixture()
    const manager = await fixture.signIn('authority-on-manager@example.test', 'Authority Manager')
    const recipient = await fixture.signIn('authority-on-recipient@example.test', 'Authority Recipient')
    const managerBilling = seedVerifiedBilling(fixture, manager, { plan: 'family' })
    const personal = seedVerifiedBilling(fixture, recipient, { plan: 'personal' })
    addInvitation(fixture, manager, {
      email: recipient.user.email,
      expiresAt: new Date(Date.now() + 60 * 60 * 1_000),
      id: 'authority-on-invitation',
      status: 'pending'
    })
    const reserved = createOrResumeFamilyJoinAttempt(fixture.connection, {
      invitationId: 'authority-on-invitation',
      recipientUserId: recipient.user.id
    })
    fixture.connection.db
      .update(billingSubscriptions)
      .set({ cancelAtPeriodEnd: true })
      .where(eq(billingSubscriptions.id, managerBilling.subscriptionId))
      .run()
    fixture.sqlite
      .prepare('update billing_subscriptions set revision = revision + 1 where id = ?')
      .run(personal.subscriptionId)
    const stripe = recoveryStripeClient(personal, undefined, false)

    await expect(
      recoverFamilyJoinAttempt(
        {
          connection: fixture.connection,
          getStripeClient: () => stripe.client
        },
        reserved.attempt.id
      )
    ).resolves.toBe('not_recoverable')

    expect(stripe.update).not.toHaveBeenCalled()
    expect(stripe.retrieve).toHaveBeenCalledOnce()
    expect(
      fixture.connection.db
        .select({
          reason: familyJoinAttempts.stateReason,
          state: familyJoinAttempts.state
        })
        .from(familyJoinAttempts)
        .where(eq(familyJoinAttempts.id, reserved.attempt.id))
        .get()
    ).toEqual({ reason: 'family_authority_changed', state: 'failed' })
    expect(
      fixture.connection.db
        .select({ cancelAtPeriodEnd: billingSubscriptions.cancelAtPeriodEnd })
        .from(billingSubscriptions)
        .where(eq(billingSubscriptions.id, personal.subscriptionId))
        .get()
    ).toEqual({ cancelAtPeriodEnd: false })
  })

  it('settles from captured billing authority after the target Family is deleted', async () => {
    fixture = createWorkspaceInvitationFixture()
    const manager = await fixture.signIn('deleted-target-manager@example.test', 'Deleted Target Manager')
    const recipient = await fixture.signIn('deleted-target-recipient@example.test', 'Deleted Target Recipient')
    seedVerifiedBilling(fixture, manager, { plan: 'family' })
    const personal = seedVerifiedBilling(fixture, recipient, { plan: 'personal' })
    addInvitation(fixture, manager, {
      email: recipient.user.email,
      expiresAt: new Date(Date.now() + 60 * 60 * 1_000),
      id: 'deleted-target-invitation',
      status: 'pending'
    })
    const reserved = createOrResumeFamilyJoinAttempt(fixture.connection, {
      invitationId: 'deleted-target-invitation',
      recipientUserId: recipient.user.id
    })
    fixture.sqlite.prepare('delete from organization where id = ?').run(manager.workspace.id)
    const stripe = recoveryStripeClient(personal, undefined, false)

    await expect(
      recoverFamilyJoinAttempt(
        {
          connection: fixture.connection,
          getStripeClient: () => stripe.client
        },
        reserved.attempt.id
      )
    ).resolves.toBe('not_recoverable')

    expect(stripe.update).not.toHaveBeenCalled()
    expect(stripe.retrieve).toHaveBeenCalledWith(personal.stripeSubscriptionId)
    expect(
      fixture.connection.db
        .select({
          reason: familyJoinAttempts.stateReason,
          state: familyJoinAttempts.state,
          targetOrganizationId: familyJoinAttempts.targetOrganizationId
        })
        .from(familyJoinAttempts)
        .where(eq(familyJoinAttempts.id, reserved.attempt.id))
        .get()
    ).toEqual({
      reason: 'family_invitation_unavailable',
      state: 'failed',
      targetOrganizationId: null
    })

    const laterManager = await fixture.signIn('later-target-manager@example.test', 'Later Target Manager')
    seedVerifiedBilling(fixture, laterManager, { plan: 'family' })
    addInvitation(fixture, laterManager, {
      email: recipient.user.email,
      expiresAt: new Date(Date.now() + 60 * 60 * 1_000),
      id: 'later-target-invitation',
      status: 'pending'
    })
    expect(
      createOrResumeFamilyJoinAttempt(fixture.connection, {
        invitationId: 'later-target-invitation',
        recipientUserId: recipient.user.id
      }).attempt.invitationId
    ).toBe('later-target-invitation')
  })

  it('keeps authority-lost provider ambiguity retryable without issuing a Stripe mutation', async () => {
    fixture = createWorkspaceInvitationFixture()
    const manager = await fixture.signIn('authority-retry-manager@example.test', 'Authority Manager')
    const recipient = await fixture.signIn('authority-retry-recipient@example.test', 'Authority Recipient')
    const managerBilling = seedVerifiedBilling(fixture, manager, { plan: 'family' })
    const personal = seedVerifiedBilling(fixture, recipient, { plan: 'personal' })
    addInvitation(fixture, manager, {
      email: recipient.user.email,
      expiresAt: new Date(Date.now() + 60 * 60 * 1_000),
      id: 'authority-retry-invitation',
      status: 'pending'
    })
    const reserved = createOrResumeFamilyJoinAttempt(fixture.connection, {
      invitationId: 'authority-retry-invitation',
      recipientUserId: recipient.user.id
    })
    fixture.connection.db
      .update(billingSubscriptions)
      .set({ cancelAtPeriodEnd: true })
      .where(eq(billingSubscriptions.id, managerBilling.subscriptionId))
      .run()
    const update = vi.fn()
    const retrieve = vi.fn(async () => {
      throw new Error('Stripe unavailable')
    })
    const stripe = {
      subscriptions: { retrieve, update }
    } as unknown as FamilyJoinStripeClient

    await expect(
      recoverFamilyJoinAttempt(
        {
          connection: fixture.connection,
          getStripeClient: () => stripe
        },
        reserved.attempt.id
      )
    ).rejects.toThrow('Family join renewal-off confirmation failed')

    expect(update).not.toHaveBeenCalled()
    expect(retrieve).toHaveBeenCalledWith(personal.stripeSubscriptionId)
    expect(
      fixture.connection.db
        .select({
          reason: familyJoinAttempts.stateReason,
          state: familyJoinAttempts.state
        })
        .from(familyJoinAttempts)
        .where(eq(familyJoinAttempts.id, reserved.attempt.id))
        .get()
    ).toEqual({
      reason: 'stripe_renewal_stop_unconfirmed',
      state: 'reconciliation_required'
    })

    fixture.sqlite
      .prepare(
        `update job_queue
         set status = 'failed', attempts = max_attempts
         where type = ?
           and json_extract(payload, '$.attemptId') = ?`
      )
      .run(familyJoinRecoveryJobType, reserved.attempt.id)
    expect(ensureFamilyJoinRecoveryJobs(fixture.connection)).toBe(1)
  })

  it('rejects non-opaque or expanded job payloads', async () => {
    fixture = createWorkspaceInvitationFixture()
    const handler = createFamilyJoinRecoveryJobHandler({
      connection: fixture.connection,
      getStripeClient: () => {
        throw new Error('must not be reached')
      }
    })

    await expect(handler({ attemptId: 'attempt', recipientEmail: 'private@example.test' })).rejects.toThrow(
      'Invalid Family join recovery job payload'
    )
    await expect(handler({ attemptId: ' padded ' })).rejects.toThrow('Invalid Family join recovery job payload')
  })
})

function addInvitation(
  activeFixture: WorkspaceInvitationFixture,
  manager: SignedInFixtureUser,
  input: Readonly<{
    email?: string
    expiresAt: Date
    id: string
    status: 'accepted' | 'pending'
  }>
) {
  activeFixture.sqlite
    .prepare(
      `insert into invitation (
         id, organization_id, email, role, status, expires_at, created_at, inviter_id
       ) values (?, ?, ?, 'member', ?, ?, ?, ?)`
    )
    .run(
      input.id,
      manager.workspace.id,
      input.email ?? `${input.id}@example.test`,
      input.status,
      input.expiresAt.getTime(),
      input.expiresAt.getTime() - 1_000,
      manager.user.id
    )
}

function setFamilyDunning(
  activeFixture: WorkspaceInvitationFixture,
  subscriptionId: string,
  status: 'past_due' | 'unpaid',
  graceStartedAt: Date
) {
  activeFixture.connection.db
    .update(billingSubscriptions)
    .set({
      graceEndsAt: new Date(graceStartedAt.getTime() + 14 * 24 * 60 * 60 * 1_000).toISOString(),
      graceInvoiceId: `invoice-${status}-${graceStartedAt.getTime()}`,
      graceStartedAt: graceStartedAt.toISOString(),
      status
    })
    .where(eq(billingSubscriptions.id, subscriptionId))
    .run()
}

function invitationStatus(activeFixture: WorkspaceInvitationFixture, invitationId: string) {
  return activeFixture.connection.db
    .select({ status: invitation.status })
    .from(invitation)
    .where(eq(invitation.id, invitationId))
    .get()?.status
}

function recoveryStripeClient(
  personal: ReturnType<typeof seedVerifiedBilling>,
  afterRetrieve?: (subscription: Stripe.Subscription) => void,
  cancelAtPeriodEnd = true
) {
  const currentPeriodStart = Math.floor((Date.now() - 24 * 60 * 60 * 1_000) / 1_000)
  const currentPeriodEnd = Math.floor(Date.parse(personal.currentPeriodEnd) / 1_000)
  const subscription = {
    id: personal.stripeSubscriptionId,
    cancel_at_period_end: cancelAtPeriodEnd,
    customer: personal.stripeCustomerId,
    items: {
      data: [
        {
          id: personal.stripeSubscriptionItemId,
          current_period_start: currentPeriodStart,
          current_period_end: currentPeriodEnd,
          price: { id: personal.stripePriceId },
          quantity: 1
        }
      ],
      has_more: false
    },
    status: 'active'
  } as unknown as Stripe.Subscription
  const update = vi.fn(async () => subscription)
  const retrieve = vi.fn(async () => {
    afterRetrieve?.(subscription)
    return subscription
  })
  const client = { subscriptions: { retrieve, update } } as unknown as FamilyJoinStripeClient
  return { client, retrieve, update }
}

function readFamilyJoinRecoveryJobs(activeFixture: WorkspaceInvitationFixture, attemptId: string) {
  return activeFixture.sqlite
    .prepare(
      `select
         id,
         status,
         attempts,
         max_attempts as maxAttempts,
         payload,
         last_error as lastError,
         created_at as createdAt,
         updated_at as updatedAt
       from job_queue
       where type = ?
         and json_valid(payload)
         and json_extract(payload, '$.attemptId') = ?
         and json_remove(payload, '$.attemptId') = '{}'
       order by id`
    )
    .all(familyJoinRecoveryJobType, attemptId) as Array<{
    attempts: number
    createdAt: string
    id: number
    lastError: string | null
    maxAttempts: number
    payload: string
    status: string
    updatedAt: string
  }>
}
