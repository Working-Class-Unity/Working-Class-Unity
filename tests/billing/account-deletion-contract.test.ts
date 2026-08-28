import type Stripe from 'stripe'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { BillingStripeRuntimeConfiguration } from '../../server/services/payments/stripe/configuration'
import { createStripeBillingCatalog } from '../../server/services/payments/stripe/catalog'
import {
  BillingStripeAccountDeletionPendingError,
  accountDeletionBillingProofTtlMs,
  deleteBillingStripeAccountData,
  prepareBillingStripeAccountDeletionWithClient,
  withBillingStripeAccountDeletionProof
} from '../../server/services/payments/stripe/account-deletion'
import { createBillingAccountDeletionCancellationJobHandlerWithClient } from '../../server/services/payments/stripe/account-deletion-job'
import {
  billingAccountDeletionCancellationMaxAttempts,
  captureBillingStripeAccountDeletion,
  confirmBillingStripeAccountDeletion,
  ensureBillingAccountDeletionCancellationJobs
} from '../../server/services/payments/stripe/account-deletion-store'
import {
  createBillingStripeRuntimeFixture,
  seedAccountStripeMembership,
  seedBillingCustomer,
  seedCheckoutAttempt,
  seedBillingSubscription,
  type BillingStripeRuntimeFixture
} from './runtime-fixture'

const fixtures: BillingStripeRuntimeFixture[] = []
const catalog = createStripeBillingCatalog({
  'personal.weekly': 'price_personal_weekly',
  'personal.monthly': 'price_personal_monthly',
  'personal.annual': 'price_personal_annual',
  'family.monthly': 'price_family_monthly',
  'family.annual': 'price_family_annual'
})
const now = new Date('2026-07-15T12:00:00.000Z')
const configuration = {
  enabled: true,
  appName: 'Deletion Test',
  appUrl: 'https://app.example.test',
  stripe: {
    secretKey: 'rk_test_deletion',
    webhookSecret: 'whsec_deletion',
    portalConfigurationId: 'bpc_deletion',
    prices: {
      'personal.weekly': 'price_personal_weekly',
      'personal.monthly': 'price_personal_monthly',
      'personal.annual': 'price_personal_annual',
      'family.monthly': 'price_family_monthly',
      'family.annual': 'price_family_annual'
    }
  }
} as const satisfies BillingStripeRuntimeConfiguration

afterEach(() => {
  for (const fixture of fixtures.splice(0)) fixture.sqlite.close()
  vi.restoreAllMocks()
})

describe('Billing Stripe account-deletion proof contract', () => {
  it('issues an immediate proof without provider I/O or a false pending notification', async () => {
    const fixture = runtimeFixture('immediate')
    const getClient = vi.fn(() => {
      throw new Error('must not construct Stripe')
    })

    const proof = await prepareBillingStripeAccountDeletionWithClient(
      fixture.connection,
      fixture.purchaserUserId,
      getClient,
      catalog,
      now
    )

    expect(getClient).not.toHaveBeenCalled()
    expect(notificationCount(fixture)).toBe(0)
    await withBillingStripeAccountDeletionProof(fixture.purchaserUserId, proof, async () => {
      fixture.sqlite
        .transaction(() => {
          deleteBillingStripeAccountData(fixture.connection, fixture.purchaserUserId, now)
        })
        .immediate()
    })
    expect(purchaserBillingRowCount(fixture)).toBe(0)
    await expect(
      withBillingStripeAccountDeletionProof(fixture.purchaserUserId, proof, async () => undefined)
    ).rejects.toThrow('Billing account deletion proof is stale or invalid')
  })

  it.each([
    ['supporter', 'price_supporter'],
    ['member', 'price_member'],
    ['solidarity', 'price_solidarity']
  ] as const)('cancels the exact %s membership before deleting its link', async (tier, priceId) => {
    const fixture = runtimeFixture(`stripe_membership_${tier}`)
    const stripeCustomerId = `cus_membership_${tier}`
    const stripeSubscriptionId = `sub_membership_${tier}`
    seedAccountStripeMembership(fixture, { stripeCustomerId, stripeSubscriptionId, stripePriceId: priceId, tier })
    const cancel = vi.fn(async () => providerSubscription('canceled', stripeSubscriptionId, stripeCustomerId))
    const retrieve = vi.fn(async () => providerSubscription('canceled', stripeSubscriptionId, stripeCustomerId))
    const list = vi.fn(async () => {
      throw new Error('membership deletion must not discover a replacement subscription')
    })

    const proof = await prepareBillingStripeAccountDeletionWithClient(
      fixture.connection,
      fixture.purchaserUserId,
      () => ({ checkout: {}, subscriptions: { cancel, retrieve, list } }) as never,
      catalog,
      now
    )

    const request = deletionRequest(fixture)
    expect(request.stripeMembershipUserId).toBe(fixture.purchaserUserId)
    expect(cancel).toHaveBeenCalledWith(
      stripeSubscriptionId,
      { invoice_now: false, prorate: false },
      { idempotencyKey: `billing-account-deletion:${request.id}` }
    )
    expect(retrieve).toHaveBeenCalledWith(stripeSubscriptionId)
    expect(list).not.toHaveBeenCalled()

    await consumeProofAndDelete(fixture, proof)
    expect(fixture.sqlite.prepare('select count(*) as count from account_stripe_memberships').get()).toEqual({
      count: 0
    })
    expect(
      fixture.sqlite
        .prepare(
          `select provider_reference as providerReference,
                  provider_customer_reference as customerReference,
                  provider_status as status
           from detached_billing_subjects`
        )
        .get()
    ).toEqual({
      providerReference: stripeSubscriptionId,
      customerReference: stripeCustomerId,
      status: 'canceled'
    })
  })

  it('retains a Stripe membership on provider uncertainty and requires a fresh user proof after worker convergence', async () => {
    const fixture = runtimeFixture('stripe_membership_worker')
    seedAccountStripeMembership(fixture, {
      stripeCustomerId: 'cus_membership_worker',
      stripeSubscriptionId: 'sub_membership_worker'
    })
    await expect(
      prepareBillingStripeAccountDeletionWithClient(
        fixture.connection,
        fixture.purchaserUserId,
        () =>
          ({
            checkout: {},
            subscriptions: {
              cancel: vi.fn(async () => {
                throw new Error('private cancellation failure')
              }),
              retrieve: vi.fn(async () => {
                throw new Error('private retrieval failure')
              })
            }
          }) as never,
        catalog,
        now
      )
    ).rejects.toBeInstanceOf(BillingStripeAccountDeletionPendingError)
    expect(fixture.sqlite.prepare('select count(*) as count from user').get()).toEqual({ count: 1 })
    expect(fixture.sqlite.prepare('select count(*) as count from account_stripe_memberships').get()).toEqual({
      count: 1
    })

    const workerClient = {
      checkout: {},
      subscriptions: {
        cancel: vi.fn(),
        retrieve: vi.fn(async () => providerSubscription('canceled', 'sub_membership_worker', 'cus_membership_worker'))
      }
    } as never
    const handler = createBillingAccountDeletionCancellationJobHandlerWithClient(
      fixture.connection,
      () => workerClient,
      configuration
    )
    await handler({ requestId: deletionRequest(fixture).id })
    expect(deletionRequest(fixture)).toMatchObject({ state: 'cancellation_confirmed' })
    expect(fixture.sqlite.prepare('select count(*) as count from user').get()).toEqual({ count: 1 })

    const getClient = vi.fn(() => {
      throw new Error('confirmed membership cancellation must not repeat provider I/O')
    })
    const proof = await prepareBillingStripeAccountDeletionWithClient(
      fixture.connection,
      fixture.purchaserUserId,
      getClient,
      catalog,
      now
    )
    expect(getClient).not.toHaveBeenCalled()
    await consumeProofAndDelete(fixture, proof)
  })

  it('fails closed when Stripe returns the linked subscription for another customer', async () => {
    const fixture = runtimeFixture('stripe_membership_mismatch')
    seedAccountStripeMembership(fixture, {
      stripeCustomerId: 'cus_membership_expected',
      stripeSubscriptionId: 'sub_membership_mismatch'
    })

    await expect(
      prepareBillingStripeAccountDeletionWithClient(
        fixture.connection,
        fixture.purchaserUserId,
        () =>
          ({
            checkout: {},
            subscriptions: {
              cancel: vi.fn(),
              retrieve: vi.fn(async () =>
                providerSubscription('canceled', 'sub_membership_mismatch', 'cus_membership_other')
              )
            }
          }) as never,
        catalog,
        now
      )
    ).rejects.toBeInstanceOf(BillingStripeAccountDeletionPendingError)
    expect(deletionRequest(fixture)).toMatchObject({
      state: 'reconciliation_required',
      reason: 'stripe_cancellation_unconfirmed'
    })
    expect(fixture.sqlite.prepare('select count(*) as count from user').get()).toEqual({ count: 1 })
    expect(fixture.sqlite.prepare('select count(*) as count from account_stripe_memberships').get()).toEqual({
      count: 1
    })
  })

  it('freezes the linked Stripe authority and blocks a late membership claim behind the deletion fence', () => {
    const linked = runtimeFixture('stripe_membership_frozen')
    seedAccountStripeMembership(linked)
    captureBillingStripeAccountDeletion(linked.connection, linked.purchaserUserId, now)
    expect(() =>
      linked.sqlite
        .prepare('update account_stripe_memberships set stripe_subscription_id = ? where user_id = ?')
        .run('sub_membership_replacement', linked.purchaserUserId)
    ).toThrow('account Stripe membership is fenced for deletion')
    expect(() =>
      linked.sqlite.prepare('delete from account_stripe_memberships where user_id = ?').run(linked.purchaserUserId)
    ).toThrow('account Stripe membership is fenced for deletion')

    const unlinked = runtimeFixture('stripe_membership_late_claim')
    captureBillingStripeAccountDeletion(unlinked.connection, unlinked.purchaserUserId, now)
    expect(() => seedAccountStripeMembership(unlinked)).toThrow('account Stripe membership is fenced for deletion')
  })

  it('atomically removes purchaser-owned Billing jobs while preserving foreign and provider work', async () => {
    const fixture = runtimeFixture('job_residue')
    const customerId = seedBillingCustomer(fixture, 'cus_delete_job_residue')
    const subscriptionId = seedBillingSubscription(fixture, {
      customerId,
      stripeSubscriptionId: 'sub_delete_job_residue',
      stripeSubscriptionItemId: 'si_delete_job_residue'
    })
    const transitionId = 'transition_delete_job_residue'
    fixture.sqlite
      .prepare(
        `insert into billing_subscription_transitions (
         id, purchaser_user_id, billing_subscription_id, kind, source_plan_key, source_cadence,
         target_plan_key, target_cadence, effective_at, idempotency_key,
         captured_billing_revision, state, revision
       ) values (?, ?, ?, 'cadence_change', 'family', 'monthly', 'family', 'annual', ?, ?, 0, 'pending', 0)`
      )
      .run(
        transitionId,
        fixture.purchaserUserId,
        subscriptionId,
        '2026-08-01T00:00:00.000Z',
        'transition_delete_job_residue_idempotency'
      )

    const list = emptySubscriptionList()
    const getClient = () =>
      ({
        checkout: {},
        subscriptions: {
          cancel: vi.fn(),
          retrieve: vi.fn(async () =>
            providerSubscription('canceled', 'sub_delete_job_residue', 'cus_delete_job_residue')
          ),
          list
        }
      }) as never
    const proof = await prepareBillingStripeAccountDeletionWithClient(
      fixture.connection,
      fixture.purchaserUserId,
      getClient,
      catalog,
      now
    )
    const requestId = deletionRequest(fixture).id

    fixture.sqlite
      .prepare('insert into user (id, email) values (?, ?)')
      .run('purchaser_delete_job_foreign', 'foreign@example.test')
    const insertJob = fixture.sqlite.prepare(`insert into job_queue (type, payload, status) values (?, ?, ?)`)
    for (const [type, payload, status = 'queued'] of [
      [
        'billing.notification-delivery',
        JSON.stringify({
          notificationKey: 'a'.repeat(64),
          kind: 'deletion_cancellation_pending',
          purchaserUserId: fixture.purchaserUserId,
          authorityReference: requestId
        })
      ],
      ['billing.transition-convergence', JSON.stringify({ transitionId })],
      [
        'billing.notification-delivery',
        JSON.stringify({
          notificationKey: 'b'.repeat(64),
          kind: 'payment_attention',
          purchaserUserId: 'purchaser_delete_job_foreign',
          authorityReference: null
        })
      ],
      ['billing.account-deletion-cancellation', JSON.stringify({ requestId: 'billing_deletion_foreign' })],
      ['billing.transition-convergence', JSON.stringify({ transitionId: 'transition_foreign' })],
      ['billing.detached-subscription-cancellation', JSON.stringify({ subjectId: 'detached_provider_work' })],
      [
        'billing.webhook-reconciliation',
        JSON.stringify({
          eventId: 'evt_provider_work',
          eventType: 'customer.subscription.deleted',
          eventCreatedAt: 1,
          objectId: 'sub_provider_work'
        })
      ],
      ['billing.reconciliation-safety', JSON.stringify({ cursor: null, cycleStartedAt: now.toISOString() })]
    ] as const) {
      insertJob.run(type, payload, status)
    }
    const beforeRollback = fixture.sqlite.prepare('select type, payload, status from job_queue order by id').all()

    await expect(
      withBillingStripeAccountDeletionProof(fixture.purchaserUserId, proof, async () => {
        fixture.sqlite
          .transaction(() => {
            deleteBillingStripeAccountData(fixture.connection, fixture.purchaserUserId, now)
            throw new Error('injected-after-billing-delete')
          })
          .immediate()
      })
    ).rejects.toThrow('injected-after-billing-delete')
    expect(fixture.sqlite.prepare('select type, payload, status from job_queue order by id').all()).toEqual(
      beforeRollback
    )

    const retryProof = await prepareBillingStripeAccountDeletionWithClient(
      fixture.connection,
      fixture.purchaserUserId,
      getClient,
      catalog,
      now
    )
    await consumeProofAndDelete(fixture, retryProof)

    expect(purchaserBillingRowCount(fixture)).toBe(0)
    expect(
      fixture.sqlite.prepare('select payload from job_queue where instr(payload, ?) > 0').all(fixture.purchaserUserId)
    ).toEqual([])
    expect(fixture.sqlite.prepare('select payload from job_queue where instr(payload, ?) > 0').all(requestId)).toEqual(
      []
    )
    expect(
      fixture.sqlite.prepare('select payload from job_queue where instr(payload, ?) > 0').all(transitionId)
    ).toEqual([])
    expect(fixture.sqlite.prepare('select type, payload from job_queue order by id').all()).toEqual([
      {
        type: 'billing.notification-delivery',
        payload: JSON.stringify({
          notificationKey: 'b'.repeat(64),
          kind: 'payment_attention',
          purchaserUserId: 'purchaser_delete_job_foreign',
          authorityReference: null
        })
      },
      {
        type: 'billing.account-deletion-cancellation',
        payload: JSON.stringify({ requestId: 'billing_deletion_foreign' })
      },
      { type: 'billing.transition-convergence', payload: JSON.stringify({ transitionId: 'transition_foreign' }) },
      {
        type: 'billing.detached-subscription-cancellation',
        payload: JSON.stringify({ subjectId: 'detached_provider_work' })
      },
      {
        type: 'billing.webhook-reconciliation',
        payload: JSON.stringify({
          eventId: 'evt_provider_work',
          eventType: 'customer.subscription.deleted',
          eventCreatedAt: 1,
          objectId: 'sub_provider_work'
        })
      },
      {
        type: 'billing.reconciliation-safety',
        payload: JSON.stringify({ cursor: null, cycleStartedAt: now.toISOString() })
      }
    ])
    expect(fixture.sqlite.prepare('select count(*) as count from detached_billing_subjects').get()).toEqual({
      count: 1
    })
  })

  it('rejects the delete facade outside the identity transaction', async () => {
    const fixture = runtimeFixture('outside_transaction')
    const proof = await prepareBillingStripeAccountDeletionWithClient(
      fixture.connection,
      fixture.purchaserUserId,
      () => {
        throw new Error('must not construct Stripe')
      },
      catalog,
      now
    )

    await expect(
      withBillingStripeAccountDeletionProof(fixture.purchaserUserId, proof, async () =>
        deleteBillingStripeAccountData(fixture.connection, fixture.purchaserUserId, now)
      )
    ).rejects.toThrow('Billing account data deletion must run inside the identity deletion transaction')
    expect(purchaserBillingRowCount(fixture)).toBe(1)
  })

  it('keeps proofs short-lived, purchaser-scoped, and unusable without the active proof scope', async () => {
    const fixture = runtimeFixture('proof_scope')
    const clock = vi.spyOn(Date, 'now').mockReturnValue(1_000)
    const proof = await prepareBillingStripeAccountDeletionWithClient(
      fixture.connection,
      fixture.purchaserUserId,
      () => {
        throw new Error('must not construct Stripe')
      },
      catalog,
      now
    )

    await expect(
      withBillingStripeAccountDeletionProof('purchaser_other', proof, async () => undefined)
    ).rejects.toThrow('Billing account deletion proof is stale or invalid')
    expect(() =>
      fixture.sqlite
        .transaction(() => {
          deleteBillingStripeAccountData(fixture.connection, fixture.purchaserUserId, now)
        })
        .immediate()
    ).toThrow('Billing account deletion proof is stale or invalid')

    clock.mockReturnValue(1_000 + accountDeletionBillingProofTtlMs)
    await expect(
      withBillingStripeAccountDeletionProof(fixture.purchaserUserId, proof, async () => undefined)
    ).rejects.toThrow('Billing account deletion proof is stale or invalid')
    expect(purchaserBillingRowCount(fixture)).toBe(1)
  })

  it('deduplicates actual provider uncertainty to exactly one pending notification', async () => {
    const fixture = runtimeFixture('provider_uncertain')
    seedBillingCustomer(fixture, 'cus_uncertain')
    const list = vi.fn(async () => {
      throw new Error('private Stripe outage detail')
    })

    for (let attempt = 0; attempt < 2; attempt += 1) {
      await expect(
        prepareBillingStripeAccountDeletionWithClient(
          fixture.connection,
          fixture.purchaserUserId,
          () => ({ subscriptions: { list } }) as never,
          catalog,
          now
        )
      ).rejects.toBeInstanceOf(BillingStripeAccountDeletionPendingError)
    }

    expect(list).toHaveBeenCalledTimes(2)
    expect(notificationCount(fixture)).toBe(1)
    expect(
      fixture.sqlite
        .prepare(`select state, reason from billing_account_deletion_requests where purchaser_user_id = ?`)
        .get(fixture.purchaserUserId)
    ).toEqual({
      state: 'reconciliation_required',
      reason: 'customer_subscription_verification_unavailable'
    })
  })

  it('reopens a confirmed deletion fence when a new live subscription appears', () => {
    const fixture = runtimeFixture('new_subscription')
    seedBillingCustomer(fixture, 'cus_new_subscription')
    const captured = captureBillingStripeAccountDeletion(fixture.connection, fixture.purchaserUserId, now)
    expect(confirmBillingStripeAccountDeletion(fixture.connection, captured.request, now)).toMatchObject({
      state: 'cancellation_confirmed'
    })

    seedBillingSubscription(fixture, {
      stripeSubscriptionId: 'sub_new_during_deletion',
      stripeSubscriptionItemId: 'si_new_during_deletion'
    })
    const reopened = captureBillingStripeAccountDeletion(
      fixture.connection,
      fixture.purchaserUserId,
      new Date('2026-07-15T12:01:00.000Z')
    )
    expect(reopened.request).toMatchObject({
      state: 'pending',
      expectedStripeCustomerId: 'cus_new_subscription',
      expectedStripeSubscriptionId: 'sub_new_during_deletion',
      cancellationConfirmedAt: null,
      revision: 2
    })
  })

  it('durably fences billing, expires an exact customerless Checkout, and only then permits deletion', async () => {
    const fixture = runtimeFixture('checkout_expire')
    const attemptId = seedCheckoutAttempt(fixture, {
      id: 'billing_attempt_delete_open',
      state: 'open',
      stripeSessionId: 'cs_delete_open'
    })
    const retrieve = vi
      .fn()
      .mockResolvedValueOnce(checkoutSession(attemptId, 'cs_delete_open', 'open'))
      .mockResolvedValueOnce(checkoutSession(attemptId, 'cs_delete_open', 'expired'))
    const expire = vi.fn(async () => checkoutSession(attemptId, 'cs_delete_open', 'expired'))
    const getClient = vi.fn(
      () =>
        ({
          checkout: { sessions: { retrieve, expire } },
          subscriptions: {}
        }) as never
    )

    const proof = await prepareBillingStripeAccountDeletionWithClient(
      fixture.connection,
      fixture.purchaserUserId,
      getClient,
      catalog,
      now
    )

    expect(expire).toHaveBeenCalledWith(
      'cs_delete_open',
      {},
      { idempotencyKey: `billing-checkout-account-deletion:expire:${attemptId}` }
    )
    expect(checkoutAttemptState(fixture, attemptId)).toBe('expired')
    expect(deletionRequest(fixture)).toMatchObject({ state: 'cancellation_confirmed' })
    await consumeProofAndDelete(fixture, proof)
    expect(purchaserBillingRowCount(fixture)).toBe(0)
  })

  it('replays an idempotent pending Checkout before expiring it', async () => {
    const fixture = runtimeFixture('checkout_replay')
    const attemptId = seedCheckoutAttempt(fixture, {
      id: 'billing_attempt_delete_pending',
      state: 'pending'
    })
    const open = checkoutSession(attemptId, 'cs_delete_replayed', 'open')
    const create = vi.fn(async () => open)
    const list = vi.fn(async () => stripePage([]))
    const retrieve = vi.fn(async () => checkoutSession(attemptId, 'cs_delete_replayed', 'expired'))
    const expire = vi.fn(async () => checkoutSession(attemptId, 'cs_delete_replayed', 'expired'))

    const proof = await prepareBillingStripeAccountDeletionWithClient(
      fixture.connection,
      fixture.purchaserUserId,
      () => ({ checkout: { sessions: { create, list, retrieve, expire } }, subscriptions: {} }) as never,
      catalog,
      now
    )

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: 'subscription',
        client_reference_id: attemptId,
        line_items: [{ price: 'price_family_monthly', quantity: 1 }]
      }),
      { idempotencyKey: `checkout_${attemptId}` }
    )
    expect(expire).toHaveBeenCalledWith(
      'cs_delete_replayed',
      {},
      { idempotencyKey: `billing-checkout-account-deletion:expire:${attemptId}` }
    )
    expect(checkoutAttemptState(fixture, attemptId)).toBe('expired')
    await consumeProofAndDelete(fixture, proof)
  })

  it('discovers and expires an old pending Checkout outside its replay window', async () => {
    const fixture = runtimeFixture('checkout_discovery')
    const attemptId = seedCheckoutAttempt(fixture, {
      id: 'billing_attempt_delete_old_pending',
      state: 'pending'
    })
    fixture.sqlite
      .prepare(
        `update billing_checkout_attempts
       set created_at = '2026-07-15T09:00:00.000Z', reuse_until = '2026-07-15T10:00:00.000Z'
       where id = ?`
      )
      .run(attemptId)
    const open = checkoutSession(attemptId, 'cs_delete_discovered', 'open')
    const list = vi.fn(async () => stripePage([open]))
    const create = vi.fn()
    const retrieve = vi
      .fn()
      .mockResolvedValueOnce(open)
      .mockResolvedValueOnce(checkoutSession(attemptId, 'cs_delete_discovered', 'expired'))
    const expire = vi.fn(async () => checkoutSession(attemptId, 'cs_delete_discovered', 'expired'))

    const proof = await prepareBillingStripeAccountDeletionWithClient(
      fixture.connection,
      fixture.purchaserUserId,
      () => ({ checkout: { sessions: { create, list, retrieve, expire } }, subscriptions: {} }) as never,
      catalog,
      now
    )

    expect(list).toHaveBeenCalledOnce()
    expect(create).not.toHaveBeenCalled()
    expect(expire).toHaveBeenCalledOnce()
    expect(checkoutAttemptState(fixture, attemptId)).toBe('expired')
    await consumeProofAndDelete(fixture, proof)
  })

  it('keeps the durable fence when Checkout discovery is ambiguous or neutralization is unavailable', async () => {
    const ambiguous = runtimeFixture('checkout_ambiguous')
    const ambiguousAttempt = seedCheckoutAttempt(ambiguous, {
      id: 'billing_attempt_delete_ambiguous',
      state: 'pending'
    })
    const list = vi.fn(async () =>
      stripePage([
        checkoutSession(ambiguousAttempt, 'cs_delete_ambiguous_one', 'open'),
        checkoutSession(ambiguousAttempt, 'cs_delete_ambiguous_two', 'open')
      ])
    )
    await expect(
      prepareBillingStripeAccountDeletionWithClient(
        ambiguous.connection,
        ambiguous.purchaserUserId,
        () => ({ checkout: { sessions: { list } }, subscriptions: {} }) as never,
        catalog,
        now
      )
    ).rejects.toBeInstanceOf(BillingStripeAccountDeletionPendingError)
    expect(checkoutAttemptState(ambiguous, ambiguousAttempt)).toBe('pending')
    expect(deletionRequest(ambiguous)).toMatchObject({ state: 'pending' })

    const unavailable = runtimeFixture('checkout_unavailable')
    const unavailableAttempt = seedCheckoutAttempt(unavailable, {
      id: 'billing_attempt_delete_unavailable',
      state: 'open',
      stripeSessionId: 'cs_delete_unavailable'
    })
    await expect(
      prepareBillingStripeAccountDeletionWithClient(
        unavailable.connection,
        unavailable.purchaserUserId,
        () =>
          ({
            checkout: {
              sessions: {
                retrieve: vi.fn(async () => {
                  throw new Error('private provider detail')
                })
              }
            },
            subscriptions: {}
          }) as never,
        catalog,
        now
      )
    ).rejects.toBeInstanceOf(BillingStripeAccountDeletionPendingError)
    expect(checkoutAttemptState(unavailable, unavailableAttempt)).toBe('open')
    expect(deletionRequest(unavailable)).toMatchObject({ state: 'pending' })
  })

  it('cancels an exact subscription when Checkout completes during expiry, but never on customer mismatch', async () => {
    const fixture = runtimeFixture('checkout_completion')
    const attemptId = seedCheckoutAttempt(fixture, {
      id: 'billing_attempt_delete_completion',
      state: 'open',
      stripeSessionId: 'cs_delete_completion'
    })
    const open = checkoutSession(attemptId, 'cs_delete_completion', 'open')
    const complete = checkoutSession(
      attemptId,
      'cs_delete_completion',
      'complete',
      'cus_delete_completion',
      'sub_delete_completion'
    )
    const checkoutRetrieve = vi.fn().mockResolvedValueOnce(open).mockResolvedValueOnce(complete)
    const subscriptionRetrieve = vi
      .fn()
      .mockResolvedValueOnce(providerSubscription('active', 'sub_delete_completion', 'cus_delete_completion'))
      .mockResolvedValueOnce(providerSubscription('canceled', 'sub_delete_completion', 'cus_delete_completion'))
    const cancel = vi.fn(async () => providerSubscription('canceled', 'sub_delete_completion', 'cus_delete_completion'))
    const list = emptySubscriptionList()
    const proof = await prepareBillingStripeAccountDeletionWithClient(
      fixture.connection,
      fixture.purchaserUserId,
      () =>
        ({
          checkout: { sessions: { retrieve: checkoutRetrieve, expire: vi.fn(async () => complete) } },
          subscriptions: { retrieve: subscriptionRetrieve, cancel, list }
        }) as never,
      catalog,
      now
    )

    expect(cancel).toHaveBeenCalledWith(
      'sub_delete_completion',
      { invoice_now: false, prorate: false },
      { idempotencyKey: `billing-checkout-account-deletion:cancel:${attemptId}` }
    )
    expect(checkoutAttemptState(fixture, attemptId)).toBe('completed')
    expect(
      fixture.sqlite.prepare('select provider_reference as providerReference from detached_billing_subjects').get()
    ).toEqual({ providerReference: 'sub_delete_completion' })
    await consumeProofAndDelete(fixture, proof)

    const mismatch = runtimeFixture('checkout_customer_mismatch')
    const mismatchAttempt = seedCheckoutAttempt(mismatch, {
      id: 'billing_attempt_delete_mismatch',
      state: 'open',
      stripeSessionId: 'cs_delete_mismatch'
    })
    const mismatchCancel = vi.fn()
    await expect(
      prepareBillingStripeAccountDeletionWithClient(
        mismatch.connection,
        mismatch.purchaserUserId,
        () =>
          ({
            checkout: {
              sessions: {
                retrieve: vi.fn(async () =>
                  checkoutSession(
                    mismatchAttempt,
                    'cs_delete_mismatch',
                    'complete',
                    'cus_delete_mismatch',
                    'sub_delete_mismatch'
                  )
                )
              }
            },
            subscriptions: {
              retrieve: vi.fn(async () => providerSubscription('active', 'sub_delete_mismatch', 'cus_other')),
              cancel: mismatchCancel
            }
          }) as never,
        catalog,
        now
      )
    ).rejects.toBeInstanceOf(BillingStripeAccountDeletionPendingError)
    expect(mismatchCancel).not.toHaveBeenCalled()
    expect(checkoutAttemptState(mismatch, mismatchAttempt)).toBe('open')
  })

  it('keeps a completed Checkout retryable until exact subscription cancellation is confirmed', async () => {
    const fixture = runtimeFixture('checkout_worker_retry')
    const attemptId = seedCheckoutAttempt(fixture, {
      id: 'billing_attempt_delete_worker_retry',
      state: 'open',
      stripeSessionId: 'cs_delete_worker_retry'
    })
    const complete = checkoutSession(
      attemptId,
      'cs_delete_worker_retry',
      'complete',
      'cus_delete_worker_retry',
      'sub_delete_worker_retry'
    )
    const checkoutRetrieve = vi.fn(async () => complete)
    const subscriptionRetrieve = vi
      .fn()
      .mockResolvedValueOnce(providerSubscription('active', 'sub_delete_worker_retry', 'cus_delete_worker_retry'))
      .mockRejectedValueOnce(new Error('private cancellation confirmation outage'))
      .mockResolvedValue(providerSubscription('canceled', 'sub_delete_worker_retry', 'cus_delete_worker_retry'))
    const cancel = vi.fn(async () => {
      throw new Error('lost cancellation response')
    })
    const client = {
      checkout: { sessions: { retrieve: checkoutRetrieve } },
      subscriptions: { retrieve: subscriptionRetrieve, cancel, list: emptySubscriptionList() }
    } as never

    await expect(
      prepareBillingStripeAccountDeletionWithClient(
        fixture.connection,
        fixture.purchaserUserId,
        () => client,
        catalog,
        now
      )
    ).rejects.toBeInstanceOf(BillingStripeAccountDeletionPendingError)
    expect(checkoutAttemptState(fixture, attemptId)).toBe('open')
    expect(deletionRequest(fixture)).toMatchObject({ state: 'pending' })

    const handler = createBillingAccountDeletionCancellationJobHandlerWithClient(
      fixture.connection,
      () => client,
      configuration
    )
    await expect(handler({ requestId: deletionRequest(fixture).id })).resolves.toBeUndefined()
    expect(checkoutAttemptState(fixture, attemptId)).toBe('completed')
    expect(deletionRequest(fixture)).toMatchObject({
      state: 'cancellation_confirmed',
      expectedStripeCustomerId: 'cus_delete_worker_retry'
    })
    expect(
      fixture.sqlite
        .prepare(
          `select provider_reference as providerReference, provider_status as providerStatus
       from detached_billing_subjects`
        )
        .get()
    ).toEqual({
      providerReference: 'sub_delete_worker_retry',
      providerStatus: 'canceled'
    })
  })

  it('uses exact no-refund cancellation, converges a lost response, and reuses confirmation', async () => {
    const fixture = runtimeFixture('lost_response')
    const customerId = seedBillingCustomer(fixture, 'cus_delete_exact')
    seedBillingSubscription(fixture, {
      customerId,
      stripeSubscriptionId: 'sub_delete_exact',
      stripeSubscriptionItemId: 'si_delete_exact'
    })
    const cancel = vi.fn(async () => {
      throw new Error('lost response')
    })
    const retrieve = vi.fn(async () => providerSubscription('canceled', 'sub_delete_exact', 'cus_delete_exact'))
    const list = emptySubscriptionList()
    const getClient = vi.fn(() => ({ subscriptions: { cancel, retrieve, list }, checkout: {} }) as never)

    await prepareBillingStripeAccountDeletionWithClient(
      fixture.connection,
      fixture.purchaserUserId,
      getClient,
      catalog,
      now
    )
    const proof = await prepareBillingStripeAccountDeletionWithClient(
      fixture.connection,
      fixture.purchaserUserId,
      getClient,
      catalog,
      now
    )

    const request = deletionRequest(fixture)
    expect(cancel).toHaveBeenCalledTimes(1)
    expect(cancel).toHaveBeenCalledWith(
      'sub_delete_exact',
      { invoice_now: false, prorate: false },
      { idempotencyKey: `billing-account-deletion:${request.id}` }
    )
    expect(retrieve).toHaveBeenCalledTimes(1)
    expect(request).toMatchObject({
      state: 'cancellation_confirmed',
      expectedStripeCustomerId: 'cus_delete_exact',
      expectedStripeSubscriptionId: 'sub_delete_exact'
    })
    await consumeProofAndDelete(fixture, proof)
  })

  it('retains identity on provider uncertainty and lets the durable worker confirm later', async () => {
    const fixture = runtimeFixture('worker_confirm')
    const customerId = seedBillingCustomer(fixture, 'cus_delete_worker')
    seedBillingSubscription(fixture, {
      customerId,
      stripeSubscriptionId: 'sub_delete_worker',
      stripeSubscriptionItemId: 'si_delete_worker'
    })
    await expect(
      prepareBillingStripeAccountDeletionWithClient(
        fixture.connection,
        fixture.purchaserUserId,
        () =>
          ({
            checkout: {},
            subscriptions: {
              cancel: vi.fn(async () => {
                throw new Error('private cancel failure')
              }),
              retrieve: vi.fn(async () => {
                throw new Error('private read failure')
              })
            }
          }) as never,
        catalog,
        now
      )
    ).rejects.toBeInstanceOf(BillingStripeAccountDeletionPendingError)
    expect(fixture.sqlite.prepare('select count(*) as count from user').get()).toEqual({ count: 1 })
    expect(deletionRequest(fixture)).toMatchObject({ state: 'pending' })

    const cancel = vi.fn(async () => providerSubscription('canceled', 'sub_delete_worker', 'cus_delete_worker'))
    const retrieve = vi.fn(async () => providerSubscription('canceled', 'sub_delete_worker', 'cus_delete_worker'))
    const workerClient = {
      checkout: {},
      subscriptions: { cancel, retrieve, list: emptySubscriptionList() }
    } as never
    const getWorkerClient = vi.fn(() => workerClient)
    const handler = createBillingAccountDeletionCancellationJobHandlerWithClient(
      fixture.connection,
      getWorkerClient,
      configuration
    )
    await handler({ requestId: deletionRequest(fixture).id })
    expect(deletionRequest(fixture)).toMatchObject({ state: 'cancellation_confirmed' })

    const providerFactoryCalls = getWorkerClient.mock.calls.length
    const cancelCalls = cancel.mock.calls.length
    const retrieveCalls = retrieve.mock.calls.length
    await expect(handler({ requestId: deletionRequest(fixture).id, extra: true })).rejects.toThrow(
      'Invalid Billing account deletion cancellation payload'
    )
    expect(getWorkerClient).toHaveBeenCalledTimes(providerFactoryCalls)
    expect(cancel).toHaveBeenCalledTimes(cancelCalls)
    expect(retrieve).toHaveBeenCalledTimes(retrieveCalls)
  })

  it('fails closed for mismatched exact reads and ambiguous customer subscription listings', async () => {
    const mismatch = runtimeFixture('exact_mismatch')
    const mismatchCustomer = seedBillingCustomer(mismatch, 'cus_delete_mismatch')
    seedBillingSubscription(mismatch, {
      customerId: mismatchCustomer,
      stripeSubscriptionId: 'sub_delete_mismatch',
      stripeSubscriptionItemId: 'si_delete_mismatch'
    })
    await expect(
      prepareBillingStripeAccountDeletionWithClient(
        mismatch.connection,
        mismatch.purchaserUserId,
        () =>
          ({
            checkout: {},
            subscriptions: {
              cancel: vi.fn(),
              retrieve: vi.fn(async () => providerSubscription('canceled', 'sub_delete_mismatch', 'cus_other'))
            }
          }) as never,
        catalog,
        now
      )
    ).rejects.toBeInstanceOf(BillingStripeAccountDeletionPendingError)
    expect(deletionRequest(mismatch)).toMatchObject({
      state: 'reconciliation_required',
      reason: 'stripe_cancellation_unconfirmed'
    })

    const ambiguous = runtimeFixture('customer_ambiguous')
    seedBillingCustomer(ambiguous, 'cus_delete_ambiguous')
    const cancel = vi.fn()
    const list = vi.fn(async () => ({
      ...stripePage([providerSubscription('active', 'sub_one', 'cus_delete_ambiguous')]),
      has_more: true
    }))
    await expect(
      prepareBillingStripeAccountDeletionWithClient(
        ambiguous.connection,
        ambiguous.purchaserUserId,
        () => ({ checkout: {}, subscriptions: { list, cancel } }) as never,
        catalog,
        now
      )
    ).rejects.toBeInstanceOf(BillingStripeAccountDeletionPendingError)
    expect(cancel).not.toHaveBeenCalled()
    expect(deletionRequest(ambiguous)).toMatchObject({
      state: 'reconciliation_required',
      reason: 'customer_subscription_state_unknown'
    })
  })

  it('bounds customer sweeps, detects a replacement live subscription, and never treats it as deletion success', async () => {
    const terminalHistory = runtimeFixture('bounded_history')
    seedBillingCustomer(terminalHistory, 'cus_delete_terminal_history')
    const boundedList = emptySubscriptionList()
    const proof = await prepareBillingStripeAccountDeletionWithClient(
      terminalHistory.connection,
      terminalHistory.purchaserUserId,
      () => ({ checkout: {}, subscriptions: { list: boundedList } }) as never,
      catalog,
      now
    )
    expect(boundedList).toHaveBeenCalledTimes(14)
    for (const [parameters] of boundedList.mock.calls) {
      expect(parameters).toMatchObject({ customer: 'cus_delete_terminal_history', limit: 2 })
      expect(parameters.status).not.toBe('canceled')
      expect(parameters.status).not.toBe('incomplete_expired')
    }
    await consumeProofAndDelete(terminalHistory, proof)
    expect(
      terminalHistory.sqlite
        .prepare(
          `select provider_reference as providerReference,
              provider_customer_reference as customerReference, provider_status as status
       from detached_billing_subjects`
        )
        .get()
    ).toEqual({
      providerReference: 'customer:cus_delete_terminal_history',
      customerReference: 'cus_delete_terminal_history',
      status: 'verified_no_live_subscriptions'
    })

    const replacement = runtimeFixture('replacement_live')
    const replacementCustomer = seedBillingCustomer(replacement, 'cus_delete_replacement')
    seedBillingSubscription(replacement, {
      customerId: replacementCustomer,
      stripeSubscriptionId: 'sub_delete_original',
      stripeSubscriptionItemId: 'si_delete_original'
    })
    const original = providerSubscription('canceled', 'sub_delete_original', 'cus_delete_replacement')
    const live = providerSubscription('active', 'sub_delete_replacement', 'cus_delete_replacement')
    const retrieve = vi.fn(async (id: string) => (id === original.id ? original : live))
    const list = vi.fn(async (parameters: Stripe.SubscriptionListParams) =>
      stripePage(parameters.status === 'active' ? [live] : [])
    )
    await expect(
      prepareBillingStripeAccountDeletionWithClient(
        replacement.connection,
        replacement.purchaserUserId,
        () => ({ checkout: {}, subscriptions: { cancel: vi.fn(), retrieve, list } }) as never,
        catalog,
        now
      )
    ).rejects.toBeInstanceOf(BillingStripeAccountDeletionPendingError)
    expect(deletionRequest(replacement)).toMatchObject({
      state: 'reconciliation_required',
      reason: 'customer_has_live_subscription'
    })
  })

  it('invalidates a confirmation after local billing changes and repairs missing or exhausted jobs once', async () => {
    const fixture = runtimeFixture('proof_and_jobs')
    const customerId = seedBillingCustomer(fixture, 'cus_delete_jobs')
    seedBillingSubscription(fixture, {
      customerId,
      stripeSubscriptionId: 'sub_delete_jobs',
      stripeSubscriptionItemId: 'si_delete_jobs'
    })
    const proof = await prepareBillingStripeAccountDeletionWithClient(
      fixture.connection,
      fixture.purchaserUserId,
      () =>
        ({
          checkout: {},
          subscriptions: {
            cancel: vi.fn(),
            retrieve: vi.fn(async () => providerSubscription('canceled', 'sub_delete_jobs', 'cus_delete_jobs')),
            list: emptySubscriptionList()
          }
        }) as never,
      catalog,
      now
    )
    fixture.sqlite
      .prepare('update billing_subscriptions set revision = revision + 1 where purchaser_user_id = ?')
      .run(fixture.purchaserUserId)
    await expect(consumeProofAndDelete(fixture, proof)).rejects.toThrow(
      'Billing account deletion proof is stale or invalid'
    )
    expect(captureBillingStripeAccountDeletion(fixture.connection, fixture.purchaserUserId, now).request).toMatchObject(
      {
        state: 'pending',
        cancellationConfirmedAt: null,
        capturedBillingRevision: 1
      }
    )

    fixture.sqlite.prepare(`delete from job_queue where type = 'billing.account-deletion-cancellation'`).run()
    expect(ensureBillingAccountDeletionCancellationJobs(fixture.connection, now)).toBe(1)
    expect(ensureBillingAccountDeletionCancellationJobs(fixture.connection, now)).toBe(0)
    fixture.sqlite
      .prepare(
        `update job_queue set attempts = max_attempts
       where type = 'billing.account-deletion-cancellation'`
      )
      .run()
    expect(ensureBillingAccountDeletionCancellationJobs(fixture.connection, now)).toBe(1)
    expect(ensureBillingAccountDeletionCancellationJobs(fixture.connection, now)).toBe(0)
    expect(
      fixture.sqlite
        .prepare(
          `select attempts, max_attempts as maxAttempts
       from job_queue where type = 'billing.account-deletion-cancellation' order by id`
        )
        .all()
    ).toEqual([
      {
        attempts: billingAccountDeletionCancellationMaxAttempts,
        maxAttempts: billingAccountDeletionCancellationMaxAttempts
      },
      { attempts: 0, maxAttempts: billingAccountDeletionCancellationMaxAttempts }
    ])
  })

  it('never confirms a replacement local subscription that appears during the final provider sweep', async () => {
    const fixture = runtimeFixture('final_sweep_race')
    const customerId = seedBillingCustomer(fixture, 'cus_delete_final_sweep')
    let calls = 0
    const list = vi.fn(async () => {
      calls += 1
      if (calls === 8) {
        seedBillingSubscription(fixture, {
          customerId,
          stripeSubscriptionId: 'sub_delete_replacement_race',
          stripeSubscriptionItemId: 'si_delete_replacement_race'
        })
      }
      return stripePage<Stripe.Subscription>([])
    })

    await expect(
      prepareBillingStripeAccountDeletionWithClient(
        fixture.connection,
        fixture.purchaserUserId,
        () => ({ checkout: {}, subscriptions: { list } }) as never,
        catalog,
        now
      )
    ).rejects.toBeInstanceOf(BillingStripeAccountDeletionPendingError)

    expect(list).toHaveBeenCalledTimes(14)
    expect(deletionRequest(fixture)).toMatchObject({
      state: 'pending',
      expectedStripeSubscriptionId: null,
      cancellationConfirmedAt: null
    })
    expect(
      fixture.sqlite
        .prepare(
          'select stripe_subscription_id as stripeSubscriptionId from billing_subscriptions where purchaser_user_id = ?'
        )
        .get(fixture.purchaserUserId)
    ).toEqual({ stripeSubscriptionId: 'sub_delete_replacement_race' })
  })
})

function runtimeFixture(suffix: string): BillingStripeRuntimeFixture {
  const fixture = createBillingStripeRuntimeFixture(`purchaser_deletion_${suffix}`)
  fixtures.push(fixture)
  return fixture
}

function notificationCount(fixture: BillingStripeRuntimeFixture): number {
  return (
    fixture.sqlite
      .prepare(`select count(*) as count from job_queue where type = 'billing.notification-delivery'`)
      .get() as { count: number }
  ).count
}

function purchaserBillingRowCount(fixture: BillingStripeRuntimeFixture): number {
  return (
    fixture.sqlite
      .prepare(
        `select
       (select count(*) from billing_customers where purchaser_user_id = ?) +
       (select count(*) from billing_checkout_attempts where purchaser_user_id = ?) +
       (select count(*) from billing_subscriptions where purchaser_user_id = ?) +
       (select count(*) from billing_subscription_transitions where purchaser_user_id = ?) +
       (select count(*) from billing_account_deletion_requests where purchaser_user_id = ?) +
       (select count(*) from account_stripe_memberships where user_id = ?) as count`
      )
      .get(
        fixture.purchaserUserId,
        fixture.purchaserUserId,
        fixture.purchaserUserId,
        fixture.purchaserUserId,
        fixture.purchaserUserId,
        fixture.purchaserUserId
      ) as { count: number }
  ).count
}

async function consumeProofAndDelete(
  fixture: BillingStripeRuntimeFixture,
  proof: Awaited<ReturnType<typeof prepareBillingStripeAccountDeletionWithClient>>
): Promise<void> {
  await withBillingStripeAccountDeletionProof(fixture.purchaserUserId, proof, async () => {
    fixture.sqlite
      .transaction(() => {
        deleteBillingStripeAccountData(fixture.connection, fixture.purchaserUserId, now)
      })
      .immediate()
  })
}

function deletionRequest(fixture: BillingStripeRuntimeFixture) {
  return fixture.sqlite
    .prepare(
      `select id, state, reason,
            stripe_membership_user_id as stripeMembershipUserId,
            expected_stripe_customer_id as expectedStripeCustomerId,
            expected_stripe_subscription_id as expectedStripeSubscriptionId,
            captured_billing_revision as capturedBillingRevision,
            cancellation_confirmed_at as cancellationConfirmedAt,
            revision
     from billing_account_deletion_requests where purchaser_user_id = ?`
    )
    .get(fixture.purchaserUserId) as {
    id: string
    state: string
    reason: string | null
    stripeMembershipUserId: string | null
    expectedStripeCustomerId: string | null
    expectedStripeSubscriptionId: string | null
    capturedBillingRevision: number
    cancellationConfirmedAt: string | null
    revision: number
  }
}

function checkoutAttemptState(fixture: BillingStripeRuntimeFixture, attemptId: string): string {
  return (
    fixture.sqlite.prepare('select state from billing_checkout_attempts where id = ?').get(attemptId) as {
      state: string
    }
  ).state
}

function checkoutSession(
  attemptId: string,
  id: string,
  status: 'open' | 'expired' | 'complete',
  customer: string | null = null,
  subscription: string | null = null
): Stripe.Checkout.Session {
  return {
    id,
    object: 'checkout.session',
    mode: 'subscription',
    status,
    payment_status: status === 'complete' ? 'paid' : 'unpaid',
    client_reference_id: attemptId,
    customer,
    subscription,
    metadata: { billing_attempt_id: attemptId },
    line_items: {
      object: 'list',
      data: [
        {
          id: `li_${id}`,
          object: 'item',
          price: { id: 'price_family_monthly', object: 'price' },
          quantity: 1
        } as Stripe.LineItem
      ],
      has_more: false,
      url: `/v1/checkout/sessions/${id}/line_items`
    }
  } as Stripe.Checkout.Session
}

function providerSubscription(status: Stripe.Subscription.Status, id: string, customer: string): Stripe.Subscription {
  return {
    id,
    object: 'subscription',
    customer,
    status,
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
          id: `si_${id}`,
          object: 'subscription_item',
          current_period_start: Date.parse('2026-07-01T00:00:00.000Z') / 1_000,
          current_period_end: Date.parse('2026-08-01T00:00:00.000Z') / 1_000,
          quantity: 1,
          price: { id: 'price_family_monthly', object: 'price' },
          discounts: []
        } as Stripe.SubscriptionItem
      ],
      has_more: false,
      url: `/v1/subscription_items?subscription=${id}`
    }
  } as Stripe.Subscription
}

function stripePage<T extends Stripe.Subscription | Stripe.Checkout.Session>(data: T[]): Stripe.ApiList<T> {
  return {
    object: 'list',
    data,
    has_more: false,
    url: '/v1/test-list'
  }
}

function emptySubscriptionList() {
  return vi.fn(async (_parameters: Stripe.SubscriptionListParams) => stripePage<Stripe.Subscription>([]))
}
