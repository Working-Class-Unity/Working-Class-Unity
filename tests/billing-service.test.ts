import type Stripe from 'stripe'
import { describe, expect, it, vi } from 'vitest'
import { familyPlanKey } from '../shared/family-plan'
import { deleteAccountAtomically } from '../server/services/account-deletion'
import { acceptWorkspaceInvitation, sendWorkspaceInvitation } from '../server/services/workspace-invitations'
import {
  createBillingCheckoutForConnection,
  createBillingPortalForConnection as createFamilyPlanPortalForConnection,
  getBillingStateForConnection,
  reconcileBillingForConnection as reconcileFamilyPlanBillingForConnection,
  type BillingServiceContext
} from '../server/services/payments/billing-service'
import { ensureBillingCheckout } from '../server/services/payments/billing-checkout'
import type { StripeBillingClient } from '../server/services/payments/stripe-client'
import type { AppRuntimeConfig } from '../server/utils/runtime'
import {
  createWorkspaceInvitationFixture,
  type SignedInFixtureUser,
  type WorkspaceInvitationFixture
} from './helpers/workspace-invitation-fixture'

function createFamilyPlanCheckoutForConnection(
  context: BillingServiceContext,
  userId: string,
  input: Readonly<{ plan: string }>,
  now?: Date
) {
  const offering = input.plan === familyPlanKey ? 'family.monthly' : input.plan
  return createBillingCheckoutForConnection(context, userId, { offering } as never, now)
}

describe('family-plan billing authority', () => {
  it.each([
    ['personal.weekly', 'personal', 'weekly', 'price_personal_weekly_server_owned'],
    ['personal.monthly', 'personal', 'monthly', 'price_personal_monthly_server_owned'],
    ['personal.annual', 'personal', 'annual', 'price_personal_annual_server_owned'],
    ['family.monthly', 'family', 'monthly', 'price_family_monthly_server_owned'],
    ['family.annual', 'family', 'annual', 'price_family_annual_server_owned']
  ] as const)(
    'derives the durable Checkout exclusively from the %s server catalog entry',
    async (offering, plan, cadence, priceId) => {
      const fixture = createWorkspaceInvitationFixture()
      const owner = await fixture.signIn(`billing-${offering.replace('.', '-')}@example.test`, 'Catalog Checkout')
      const fake = fakeStripe()

      try {
        await expect(
          createBillingCheckoutForConnection(billingContext(fixture, fake.client), owner.user.id, { offering })
        ).resolves.toEqual({ url: 'https://checkout.stripe.test/session/cs_family' })
        expect(fake.checkoutCreate).toHaveBeenCalledWith(
          expect.objectContaining({
            line_items: [{ price: priceId, quantity: 1 }]
          }),
          expect.objectContaining({ idempotencyKey: expect.stringMatching(/^checkout_/) })
        )
        expect(rows(fixture, 'billing_checkout_attempts')).toEqual([
          expect.objectContaining({
            plan_key: plan,
            cadence,
            stripe_price_id: priceId
          })
        ])
      } finally {
        fixture.cleanup()
      }
    }
  )

  it('creates one durable server-owned Checkout attempt across concurrent and sequential retries', async () => {
    const fixture = createWorkspaceInvitationFixture()
    const owner = await fixture.signIn('billing-checkout@example.test', 'Checkout Owner')
    const fake = fakeStripe()
    const context = billingContext(fixture, fake.client)

    try {
      const [first, concurrent] = await Promise.all([
        createFamilyPlanCheckoutForConnection(context, owner.user.id, { plan: familyPlanKey }),
        createFamilyPlanCheckoutForConnection(context, owner.user.id, { plan: familyPlanKey })
      ])
      const sequential = await createFamilyPlanCheckoutForConnection(context, owner.user.id, { plan: familyPlanKey })

      expect(first).toEqual({ url: 'https://checkout.stripe.test/session/cs_family' })
      expect(concurrent).toEqual(first)
      expect(sequential).toEqual(first)
      expect(fake.checkoutCreate).toHaveBeenCalledTimes(2)
      const createCalls = fake.checkoutCreate.mock.calls
      const idempotencyKeys = new Set(createCalls.map(([, options]) => options?.idempotencyKey))
      expect(idempotencyKeys.size).toBe(1)
      for (const [input] of createCalls) {
        expect(input).toMatchObject({
          mode: 'subscription',
          line_items: [{ price: 'price_family_monthly_server_owned', quantity: 1 }]
        })
        expect(input).not.toHaveProperty('payment_method_types')
        expect(input).not.toHaveProperty('customer_email')
      }
      expect(rows(fixture, 'billing_checkout_attempts')).toHaveLength(1)
      expect(rows(fixture, 'billing_customers')).toHaveLength(0)
    } finally {
      fixture.cleanup()
    }
  })

  it('reuses the same logical Checkout after an indeterminate provider failure', async () => {
    const fixture = createWorkspaceInvitationFixture()
    const owner = await fixture.signIn('billing-indeterminate@example.test', 'Indeterminate Checkout')
    const fake = fakeStripe({ failCheckoutCreateAfterPersistOnce: true })
    const context = billingContext(fixture, fake.client)

    try {
      await expect(
        createFamilyPlanCheckoutForConnection(context, owner.user.id, { plan: familyPlanKey })
      ).rejects.toMatchObject({ statusCode: 502 })
      expect(rows(fixture, 'billing_checkout_attempts')).toEqual([
        expect.objectContaining({ state: 'pending', stripe_session_id: null })
      ])

      await expect(
        createFamilyPlanCheckoutForConnection(context, owner.user.id, { plan: familyPlanKey })
      ).resolves.toEqual({ url: 'https://checkout.stripe.test/session/cs_family' })
      expect(fake.checkoutCreate).toHaveBeenCalledTimes(2)
      expect(new Set(fake.checkoutCreate.mock.calls.map(([, options]) => options?.idempotencyKey)).size).toBe(1)
      expect(rows(fixture, 'billing_checkout_attempts')).toEqual([
        expect.objectContaining({ state: 'open', stripe_session_id: 'cs_family' })
      ])
    } finally {
      fixture.cleanup()
    }
  })

  it.each([
    ['a non-subscription session', { mode: 'payment' }],
    ['a mismatched client reference', { client_reference_id: 'billing_attempt_foreign' }],
    ['mismatched attempt metadata', { metadata: { billing_attempt_id: 'billing_attempt_foreign' } }],
    ['a mismatched line-item Price', { line_items: checkoutLineItems('price_foreign', 1) }],
    ['a non-unit line-item quantity', { line_items: checkoutLineItems('price_family_monthly_server_owned', 2) }],
    ['a completed session', { status: 'complete' }],
    ['a missing redirect URL', { url: null }],
    ['an insecure redirect URL', { url: 'http://checkout.stripe.test/session/cs_family' }],
    ['a malformed redirect URL', { url: 'not a URL' }]
  ] satisfies ReadonlyArray<readonly [string, Partial<Stripe.Checkout.Session>]>)(
    'fails closed when Stripe creates %s',
    async (_description, sessionUpdate) => {
      const fixture = createWorkspaceInvitationFixture()
      const owner = await fixture.signIn(
        `billing-unusable-${sessionUpdate.mode ?? sessionUpdate.status ?? 'url'}@example.test`
      )
      const fake = fakeStripe({ checkoutSessionUpdate: sessionUpdate })

      try {
        await expect(
          createFamilyPlanCheckoutForConnection(billingContext(fixture, fake.client), owner.user.id, {
            plan: familyPlanKey
          })
        ).rejects.toMatchObject({ statusCode: 502 })
        expect(rows(fixture, 'billing_checkout_attempts')).toEqual([
          expect.objectContaining({ state: 'reconciliation_required', stripe_session_id: 'cs_family' })
        ])
        expect(rows(fixture, 'detached_billing_subjects')).toHaveLength(0)
      } finally {
        fixture.cleanup()
      }
    }
  )

  it('keeps an open attempt intact when Stripe session retrieval is temporarily unavailable', async () => {
    const fixture = createWorkspaceInvitationFixture()
    const owner = await fixture.signIn('billing-retrieve-failure@example.test', 'Retrieve Failure')
    const fake = fakeStripe()
    const context = billingContext(fixture, fake.client)

    try {
      await createFamilyPlanCheckoutForConnection(context, owner.user.id, { plan: familyPlanKey })
      fake.failNextCheckoutRetrieve()

      await expect(
        createFamilyPlanCheckoutForConnection(context, owner.user.id, { plan: familyPlanKey })
      ).rejects.toMatchObject({ statusCode: 502 })
      expect(rows(fixture, 'billing_checkout_attempts')).toEqual([
        expect.objectContaining({ state: 'open', stripe_session_id: 'cs_family' })
      ])
    } finally {
      fixture.cleanup()
    }
  })

  it('retires an expired Checkout and creates one new durable attempt', async () => {
    const fixture = createWorkspaceInvitationFixture()
    const owner = await fixture.signIn('billing-expired-checkout@example.test', 'Expired Checkout')
    seedSubscription(fixture, owner, 'canceled')
    const fake = fakeStripe()
    const context = billingContext(fixture, fake.client)
    const firstCheckoutTime = new Date('2026-07-14T08:00:00.000Z')
    const replacementCheckoutTime = new Date('2026-07-14T09:30:00.000Z')
    const checkoutAttemptReuseMs = 23 * 60 * 60 * 1_000
    const billingCustomerId = 'billing_customer_billing-expired-checkout'
    const checkoutAttemptFields = {
      organization_id: owner.workspace.id,
      billing_customer_id: billingCustomerId,
      plan_key: familyPlanKey,
      cadence: 'monthly',
      stripe_price_id: 'price_family_monthly_server_owned',
      success_url: 'https://app.example.test/account/billing?checkout=success',
      cancel_url: 'https://app.example.test/account/billing?checkout=cancelled'
    }

    try {
      await createFamilyPlanCheckoutForConnection(context, owner.user.id, { plan: familyPlanKey }, firstCheckoutTime)
      fake.setCheckoutSession({ status: 'expired', url: null })

      await expect(
        createFamilyPlanCheckoutForConnection(context, owner.user.id, { plan: familyPlanKey }, replacementCheckoutTime)
      ).resolves.toEqual({ url: 'https://checkout.stripe.test/session/cs_family_replacement' })
      expect(fake.checkoutCreate).toHaveBeenCalledTimes(2)
      const attempts = rows(fixture, 'billing_checkout_attempts') as Array<{
        id: string
        idempotency_key: string
      }>
      expect(attempts).toHaveLength(2)
      expect(attempts[0]?.id).not.toBe(attempts[1]?.id)
      expect(attempts[0]?.idempotency_key).not.toBe(attempts[1]?.idempotency_key)
      for (const [index, [input, options]] of fake.checkoutCreate.mock.calls.entries()) {
        const persistedAttempt = attempts[index]
        expect(persistedAttempt).toBeDefined()
        expect(input).toMatchObject({
          customer: 'cus_billing-expired-checkout',
          client_reference_id: persistedAttempt?.id,
          line_items: [{ price: 'price_family_monthly_server_owned', quantity: 1 }],
          success_url: checkoutAttemptFields.success_url,
          cancel_url: checkoutAttemptFields.cancel_url,
          metadata: { billing_attempt_id: persistedAttempt?.id },
          subscription_data: { metadata: { billing_attempt_id: persistedAttempt?.id } }
        })
        expect(options).toMatchObject({ idempotencyKey: persistedAttempt?.idempotency_key })
      }
      expect(attempts).toEqual([
        expect.objectContaining({
          ...checkoutAttemptFields,
          state: 'expired',
          stripe_session_id: 'cs_family',
          created_at: firstCheckoutTime.toISOString(),
          reuse_until: new Date(firstCheckoutTime.getTime() + checkoutAttemptReuseMs).toISOString()
        }),
        expect.objectContaining({
          ...checkoutAttemptFields,
          state: 'open',
          stripe_session_id: 'cs_family_replacement',
          created_at: replacementCheckoutTime.toISOString(),
          reuse_until: new Date(replacementCheckoutTime.getTime() + checkoutAttemptReuseMs).toISOString()
        })
      ])
    } finally {
      fixture.cleanup()
    }
  })

  it('requires reconciliation when a retrieved Checkout is complete but billing is unverified', async () => {
    const fixture = createWorkspaceInvitationFixture()
    const owner = await fixture.signIn('billing-complete-checkout@example.test', 'Complete Checkout')
    const fake = fakeStripe()
    const context = billingContext(fixture, fake.client)

    try {
      await createFamilyPlanCheckoutForConnection(context, owner.user.id, { plan: familyPlanKey })
      fake.setCheckoutSession({ status: 'complete', customer: 'cus_complete', url: null })

      await expect(
        createFamilyPlanCheckoutForConnection(context, owner.user.id, { plan: familyPlanKey })
      ).rejects.toMatchObject({ statusCode: 409 })
      expect(rows(fixture, 'billing_checkout_attempts')).toEqual([
        expect.objectContaining({ state: 'reconciliation_required', stripe_session_id: 'cs_family' })
      ])
    } finally {
      fixture.cleanup()
    }
  })

  it('detaches a conflicting retrieved session instead of attaching it to the current account', async () => {
    const fixture = createWorkspaceInvitationFixture()
    const owner = await fixture.signIn('billing-session-conflict@example.test', 'Session Conflict')
    const fake = fakeStripe()
    const context = billingContext(fixture, fake.client)

    try {
      await createFamilyPlanCheckoutForConnection(context, owner.user.id, { plan: familyPlanKey })
      const attempt = rows(fixture, 'billing_checkout_attempts')[0] as { id: string }
      fake.setCheckoutRetrieveSession(checkoutSession(attempt.id, 'cs_conflicting'))

      await expect(
        createFamilyPlanCheckoutForConnection(context, owner.user.id, { plan: familyPlanKey })
      ).rejects.toMatchObject({ statusCode: 409 })
      expect(rows(fixture, 'billing_checkout_attempts')).toEqual([
        expect.objectContaining({ state: 'reconciliation_required', stripe_session_id: 'cs_family' })
      ])
      expect(rows(fixture, 'detached_billing_subjects')).toEqual([
        expect.objectContaining({
          provider_reference: 'checkout:cs_conflicting',
          provider_customer_reference: null,
          provider_status: 'checkout_open'
        })
      ])
    } finally {
      fixture.cleanup()
    }
  })

  it('derives inherited entitlement from fresh membership without exposing or sharing billing scope', async () => {
    const fixture = createWorkspaceInvitationFixture()
    const payer = await fixture.signIn('billing-payer@example.test', 'Payer')
    const relative = await fixture.signIn('billing-relative@example.test', 'Relative')
    seedMember(fixture, payer, relative)
    seedSubscription(fixture, payer, 'active')
    const fake = fakeStripe()
    const context = billingContext(fixture, fake.client)

    try {
      expect(getBillingStateForConnection(fixture.connection, relative.user.id)).toMatchObject({
        entitlement: {
          granted: true,
          source: 'family',
          state: 'active',
          plan: 'family',
          cadence: 'monthly'
        },
        relationship: { kind: 'member' },
        subscription: {
          state: 'active',
          plan: 'family',
          cadence: 'monthly',
          checkoutPending: false
        },
        capabilities: {
          canCheckout: false,
          canManage: false,
          canReconcile: false,
          canLeaveFamily: true
        }
      })
      await expect(
        createFamilyPlanCheckoutForConnection(context, relative.user.id, { plan: familyPlanKey })
      ).rejects.toMatchObject({ statusCode: 403 })
      expect(fake.checkoutCreate).not.toHaveBeenCalled()

      fixture.sqlite
        .prepare('delete from member where organization_id = ? and user_id = ?')
        .run(payer.workspace.id, relative.user.id)
      expect(getBillingStateForConnection(fixture.connection, relative.user.id).capabilities.canCheckout).toBe(true)
    } finally {
      fixture.cleanup()
    }
  })

  it('accepts only an exactly correlated, renewal-off Personal residual after a verified Family join', async () => {
    const fixture = createWorkspaceInvitationFixture()
    const payer = await fixture.signIn('billing-join-payer@example.test', 'Join Payer')
    const relative = await fixture.signIn('billing-join-relative@example.test', 'Join Relative')
    const paidThrough = '2026-08-01T00:00:00.000Z'
    seedSubscription(fixture, payer, 'active')
    const personalSubscriptionId = seedPersonalSubscriptionStoppingRenewal(fixture, relative, paidThrough)
    const invitationId = 'invitation_verified_family_join'
    const now = Date.now()
    fixture.sqlite
      .prepare(
        `insert into invitation (
           id, organization_id, email, role, status, expires_at, created_at, inviter_id
         ) values (?, ?, ?, 'member', 'pending', ?, ?, ?)`
      )
      .run(invitationId, payer.workspace.id, relative.user.email, now + 60_000, now, payer.user.id)
    fixture.sqlite
      .prepare(
        `insert into family_join_attempts (
           id, recipient_user_id, personal_organization_id, personal_billing_subscription_id,
           captured_personal_billing_revision, target_organization_id, invitation_id,
           stripe_cancellation_idempotency_key, personal_paid_through, state, revision,
           created_at, updated_at
         ) values (?, ?, ?, ?, 0, ?, ?, ?, ?, 'membership_pending', 0, ?, ?)`
      )
      .run(
        'family_join_verified',
        relative.user.id,
        relative.workspace.id,
        personalSubscriptionId,
        payer.workspace.id,
        invitationId,
        'family_join_cancel_verified',
        paidThrough,
        new Date(now).toISOString(),
        new Date(now).toISOString()
      )
    seedMember(fixture, payer, relative)

    try {
      expect(getBillingStateForConnection(fixture.connection, relative.user.id)).toMatchObject({
        relationship: { kind: 'member' },
        entitlement: { granted: true, source: 'family', state: 'active' },
        subscription: { state: 'active', plan: 'family', cadence: 'monthly' },
        capabilities: {
          canCheckout: false,
          canManage: false,
          canReconcile: false,
          canLeaveFamily: true
        }
      })

      fixture.sqlite
        .prepare(
          `update family_join_attempts
           set state = 'failed', state_reason = 'test_correlation_lost', revision = revision + 1
           where id = 'family_join_verified'`
        )
        .run()

      expect(getBillingStateForConnection(fixture.connection, relative.user.id)).toMatchObject({
        relationship: { kind: 'member' },
        entitlement: {
          granted: false,
          source: null,
          state: 'reconciliation_required'
        },
        subscription: { state: 'reconciliation_required' },
        capabilities: {
          canCheckout: false,
          canManage: false,
          canReconcile: false,
          canLeaveFamily: true
        }
      })
    } finally {
      fixture.cleanup()
    }
  })

  it('shows the manager customer-only reconciliation state consistently to covered members', async () => {
    const fixture = createWorkspaceInvitationFixture()
    const manager = await fixture.signIn('billing-customer-only-manager@example.test', 'Customer Only Manager')
    const relative = await fixture.signIn('billing-customer-only-relative@example.test', 'Customer Only Relative')
    seedCustomerOnly(fixture, manager)
    seedMember(fixture, manager, relative)

    try {
      expect(getBillingStateForConnection(fixture.connection, manager.user.id)).toMatchObject({
        relationship: { kind: 'manager' },
        entitlement: { granted: false },
        subscription: { state: 'reconciliation_required' },
        capabilities: { canManage: false, canReconcile: true }
      })
      expect(getBillingStateForConnection(fixture.connection, relative.user.id)).toMatchObject({
        relationship: { kind: 'member' },
        entitlement: { granted: false },
        subscription: { state: 'reconciliation_required' },
        capabilities: {
          canCheckout: false,
          canManage: false,
          canReconcile: false,
          canLeaveFamily: true
        }
      })
    } finally {
      fixture.cleanup()
    }
  })

  it('fails closed instead of granting billing from a malformed markerless family', async () => {
    const fixture = createWorkspaceInvitationFixture()
    const actor = await fixture.signIn('billing-markerless-member@example.test', 'Markerless Member')
    const now = Date.now()
    fixture.sqlite.exec('drop trigger member_external_family_authority_before_insert')
    fixture.sqlite
      .prepare(
        `insert into organization (id, name, slug, created_at, personal_owner_user_id)
         values ('markerless_billing_family', 'Markerless family', 'markerless-billing-family', ?, null)`
      )
      .run(now)
    fixture.sqlite
      .prepare(
        `insert into member (id, organization_id, user_id, role, created_at)
         values ('markerless_billing_member', 'markerless_billing_family', ?, 'member', ?)`
      )
      .run(actor.user.id, now)
    fixture.sqlite
      .prepare(
        `insert into billing_customers (id, organization_id, stripe_customer_id, created_at, updated_at)
         values ('markerless_billing_customer', 'markerless_billing_family', 'cus_markerless', ?, ?)`
      )
      .run(new Date(now).toISOString(), new Date(now).toISOString())
    fixture.sqlite
      .prepare(
        `insert into billing_subscriptions (
           id, organization_id, billing_customer_id, stripe_subscription_id, status, plan_key,
           stripe_price_id, current_period_start, current_period_end,
           reconciliation_required, reconciliation_reason, created_at, updated_at
         ) values (
           'markerless_billing_subscription', 'markerless_billing_family', 'markerless_billing_customer',
           'sub_markerless', 'active', 'family', 'price_family',
           '2026-07-01T00:00:00.000Z', '2026-08-01T00:00:00.000Z',
           1, 'malformed_fixture', ?, ?
         )`
      )
      .run(new Date(now).toISOString(), new Date(now).toISOString())

    try {
      expect(() => getBillingStateForConnection(fixture.connection, actor.user.id)).toThrow(
        expect.objectContaining({
          statusCode: 503,
          statusMessage: 'Billing is temporarily unavailable'
        })
      )
    } finally {
      fixture.cleanup()
    }
  })

  it('fails closed when duplicate open attempts make a family billing projection ambiguous', async () => {
    const fixture = createWorkspaceInvitationFixture()
    const manager = await fixture.signIn('billing-ambiguous-manager@example.test', 'Ambiguous Manager')
    const relative = await fixture.signIn('billing-ambiguous-relative@example.test', 'Ambiguous Relative')
    seedMember(fixture, manager, relative)
    const now = new Date()
    const reuseUntil = new Date(now.getTime() + 60_000).toISOString()
    const nowIso = now.toISOString()
    fixture.sqlite.exec('drop index billing_checkout_attempts_one_open_uidx')
    const insertAttempt = fixture.sqlite.prepare(
      `insert into billing_checkout_attempts (
         id, organization_id, plan_key, cadence, stripe_price_id, idempotency_key, state,
         success_url, cancel_url, reuse_until, created_at, updated_at
       ) values (?, ?, 'family', 'monthly', 'price_family_monthly_server_owned', ?, 'pending', ?, ?, ?, ?, ?)`
    )
    for (const suffix of ['first', 'second']) {
      insertAttempt.run(
        `billing_attempt_ambiguous_${suffix}`,
        manager.workspace.id,
        `checkout_ambiguous_${suffix}`,
        'https://app.example.test/account/billing?checkout=success',
        'https://app.example.test/account/billing?checkout=cancelled',
        reuseUntil,
        nowIso,
        nowIso
      )
    }

    try {
      expect(() => getBillingStateForConnection(fixture.connection, relative.user.id)).toThrow(
        expect.objectContaining({
          statusCode: 503,
          statusMessage: 'Billing is temporarily unavailable'
        })
      )
    } finally {
      fixture.cleanup()
    }
  })

  it('rejects a second Checkout before provider I/O when the manager is already entitled', async () => {
    const fixture = createWorkspaceInvitationFixture()
    const manager = await fixture.signIn('billing-already-entitled@example.test', 'Already Entitled')
    seedSubscription(fixture, manager, 'active')
    const fake = fakeStripe()

    try {
      await expect(
        createFamilyPlanCheckoutForConnection(billingContext(fixture, fake.client), manager.user.id, {
          plan: familyPlanKey
        })
      ).rejects.toMatchObject({ statusCode: 409 })
      expect(fake.checkoutCreate).not.toHaveBeenCalled()
      expect(rows(fixture, 'billing_checkout_attempts')).toHaveLength(0)
    } finally {
      fixture.cleanup()
    }
  })

  it('rechecks family membership at the transactional Checkout reservation boundary', async () => {
    const fixture = createWorkspaceInvitationFixture()
    const manager = await fixture.signIn('billing-reservation-manager@example.test', 'Reservation Manager')
    const relative = await fixture.signIn('billing-reservation-relative@example.test', 'Reservation Relative')
    seedMember(fixture, manager, relative)
    const fake = fakeStripe()

    try {
      await expect(
        ensureBillingCheckout(
          billingContext(fixture, fake.client),
          relative.user.id,
          relative.workspace.id,
          null,
          'family.monthly',
          new Date()
        )
      ).rejects.toMatchObject({
        statusCode: 403,
        statusMessage: 'Family members cannot create billing authority'
      })
      expect(rows(fixture, 'billing_checkout_attempts')).toHaveLength(0)
      expect(fake.checkoutCreate).not.toHaveBeenCalled()
    } finally {
      fixture.cleanup()
    }
  })

  it('denies every personal billing command to a member when the family plan is inactive', async () => {
    const fixture = createWorkspaceInvitationFixture()
    const manager = await fixture.signIn('billing-inactive-manager@example.test', 'Inactive Manager')
    const relative = await fixture.signIn('billing-inactive-relative@example.test', 'Inactive Relative')
    seedSubscription(fixture, manager, 'unpaid')
    seedSubscription(fixture, relative, 'canceled')
    seedMember(fixture, manager, relative)
    const fake = fakeStripe()
    const context = billingContext(fixture, fake.client)

    try {
      expect(getBillingStateForConnection(fixture.connection, relative.user.id)).toMatchObject({
        entitlement: { granted: false, source: null, state: 'reconciliation_required' },
        relationship: { kind: 'member' },
        subscription: { state: 'reconciliation_required' },
        capabilities: {
          canCheckout: false,
          canManage: false,
          canReconcile: false,
          canLeaveFamily: true
        }
      })
      await expect(
        createFamilyPlanCheckoutForConnection(context, relative.user.id, { plan: familyPlanKey })
      ).rejects.toMatchObject({ statusCode: 403 })
      await expect(createFamilyPlanPortalForConnection(context, relative.user.id)).rejects.toMatchObject({
        statusCode: 403
      })
      await expect(reconcileFamilyPlanBillingForConnection(context, relative.user.id)).rejects.toMatchObject({
        statusCode: 403
      })
      expect(fake.checkoutCreate).not.toHaveBeenCalled()
      expect(fake.portalCreate).not.toHaveBeenCalled()
      expect(fake.subscriptionList).not.toHaveBeenCalled()
    } finally {
      fixture.cleanup()
    }
  })

  it('withholds a Portal URL when customer-only history becomes a family membership during provider I/O', async () => {
    const fixture = createWorkspaceInvitationFixture()
    const manager = await fixture.signIn('billing-portal-race-manager@example.test', 'Portal Race Manager')
    const relative = await fixture.signIn('billing-portal-race-relative@example.test', 'Portal Race Relative')
    seedSubscription(fixture, manager, 'active')
    await sendWorkspaceInvitation(
      { api: fixture.auth.api, connection: fixture.connection, headers: manager.headers },
      {
        ownerUserId: manager.user.id,
        email: relative.user.email,
        appName: fixture.config.public.appName,
        appUrl: fixture.config.public.appUrl,
        sender: { async send() {} }
      }
    )
    const invitation = fixture.sqlite
      .prepare('select id from invitation where organization_id = ? and email = ?')
      .get(manager.workspace.id, relative.user.email) as { id: string }
    seedCustomerOnly(fixture, relative)
    const fake = fakeStripe({
      async onPortalCreate() {
        await acceptWorkspaceInvitation(
          { api: fixture.auth.api, connection: fixture.connection, headers: relative.headers },
          invitation.id,
          relative.user.id
        )
      }
    })

    try {
      await expect(
        createFamilyPlanPortalForConnection(billingContext(fixture, fake.client), relative.user.id)
      ).rejects.toMatchObject({ statusCode: 403 })
      expect(fake.portalCreate).toHaveBeenCalledTimes(1)
      expect(getBillingStateForConnection(fixture.connection, relative.user.id)).toMatchObject({
        relationship: { kind: 'member' },
        capabilities: { canManage: false, canReconcile: false, canLeaveFamily: true }
      })
    } finally {
      fixture.cleanup()
    }
  })

  it('rejects a stale reconciliation when customer-only history becomes a family membership during provider I/O', async () => {
    const fixture = createWorkspaceInvitationFixture()
    const manager = await fixture.signIn('billing-read-race-manager@example.test', 'Read Race Manager')
    const relative = await fixture.signIn('billing-read-race-relative@example.test', 'Read Race Relative')
    seedSubscription(fixture, manager, 'active')
    await sendWorkspaceInvitation(
      { api: fixture.auth.api, connection: fixture.connection, headers: manager.headers },
      {
        ownerUserId: manager.user.id,
        email: relative.user.email,
        appName: fixture.config.public.appName,
        appUrl: fixture.config.public.appUrl,
        sender: { async send() {} }
      }
    )
    const invitation = fixture.sqlite
      .prepare('select id from invitation where organization_id = ? and email = ?')
      .get(manager.workspace.id, relative.user.email) as { id: string }
    seedCustomerOnly(fixture, relative)
    const fake = fakeStripe({
      subscriptions: [],
      async onSubscriptionList() {
        await acceptWorkspaceInvitation(
          { api: fixture.auth.api, connection: fixture.connection, headers: relative.headers },
          invitation.id,
          relative.user.id
        )
      }
    })

    try {
      await expect(
        reconcileFamilyPlanBillingForConnection(billingContext(fixture, fake.client), relative.user.id)
      ).rejects.toMatchObject({ statusCode: 409 })
      expect(getBillingStateForConnection(fixture.connection, relative.user.id)).toMatchObject({
        relationship: { kind: 'member' },
        capabilities: { canCheckout: false, canManage: false, canReconcile: false, canLeaveFamily: true }
      })
    } finally {
      fixture.cleanup()
    }
  })

  it('keeps the Checkout reservation when a conflicting family admission races provider I/O', async () => {
    const fixture = createWorkspaceInvitationFixture()
    const payer = await fixture.signIn('billing-race-payer@example.test', 'Race Payer')
    const relative = await fixture.signIn('billing-race-relative@example.test', 'Race Relative')
    seedSubscription(fixture, payer, 'active')
    await sendWorkspaceInvitation(
      { api: fixture.auth.api, connection: fixture.connection, headers: payer.headers },
      {
        ownerUserId: payer.user.id,
        email: relative.user.email,
        appName: fixture.config.public.appName,
        appUrl: fixture.config.public.appUrl,
        sender: { async send() {} }
      }
    )
    const invitation = fixture.sqlite
      .prepare('select id from invitation where organization_id = ? and email = ?')
      .get(payer.workspace.id, relative.user.email) as { id: string }
    let acceptanceStatus: PromiseSettledResult<unknown>['status'] | undefined
    const fake = fakeStripe({
      async onCheckoutCreate() {
        const [outcome] = await Promise.allSettled([
          acceptWorkspaceInvitation(
            { api: fixture.auth.api, connection: fixture.connection, headers: relative.headers },
            invitation.id,
            relative.user.id
          )
        ])
        acceptanceStatus = outcome!.status
      }
    })
    const context = billingContext(fixture, fake.client)

    try {
      await expect(
        createFamilyPlanCheckoutForConnection(context, relative.user.id, { plan: familyPlanKey })
      ).resolves.toEqual({ url: 'https://checkout.stripe.test/session/cs_family' })
      expect(acceptanceStatus).toBe('rejected')
      expect(fake.checkoutCreate).toHaveBeenCalledTimes(1)
      expect(rows(fixture, 'billing_checkout_attempts')).toEqual([
        expect.objectContaining({ state: 'open', stripe_session_id: 'cs_family' })
      ])
      expect(getBillingStateForConnection(fixture.connection, relative.user.id)).toMatchObject({
        entitlement: { granted: false },
        relationship: { kind: 'manager' },
        subscription: { state: 'none', checkoutPending: true },
        capabilities: { canCheckout: false }
      })
      expect(fixture.sqlite.prepare('select status from invitation where id = ?').get(invitation.id)).toEqual({
        status: 'pending'
      })
    } finally {
      fixture.cleanup()
    }
  })

  it('keeps reconciliation authority when a conflicting family admission races discovery', async () => {
    const fixture = createWorkspaceInvitationFixture()
    const payer = await fixture.signIn('billing-reconcile-race-payer@example.test', 'Reconcile Race Payer')
    const relative = await fixture.signIn('billing-reconcile-race-relative@example.test', 'Reconcile Race Relative')
    seedSubscription(fixture, payer, 'active')
    await sendWorkspaceInvitation(
      { api: fixture.auth.api, connection: fixture.connection, headers: payer.headers },
      {
        ownerUserId: payer.user.id,
        email: relative.user.email,
        appName: fixture.config.public.appName,
        appUrl: fixture.config.public.appUrl,
        sender: { async send() {} }
      }
    )
    const invitation = fixture.sqlite
      .prepare('select id from invitation where organization_id = ? and email = ?')
      .get(payer.workspace.id, relative.user.email) as { id: string }
    let acceptanceStatus: PromiseSettledResult<unknown>['status'] | undefined
    const fake = fakeStripe({
      failCheckoutCreateAfterPersistOnce: true,
      subscriptions: [stripeSubscription('sub_reconcile_race', 'active', 'cus_reconcile_race')]
    })
    const context = billingContext(fixture, fake.client)

    try {
      await expect(
        createFamilyPlanCheckoutForConnection(context, relative.user.id, { plan: familyPlanKey })
      ).rejects.toMatchObject({ statusCode: 502 })
      fake.setCheckoutSession({ customer: 'cus_reconcile_race', status: 'complete' })
      fake.setOnCheckoutList(async () => {
        const [outcome] = await Promise.allSettled([
          acceptWorkspaceInvitation(
            { api: fixture.auth.api, connection: fixture.connection, headers: relative.headers },
            invitation.id,
            relative.user.id
          )
        ])
        acceptanceStatus = outcome!.status
      })

      const state = await reconcileFamilyPlanBillingForConnection(context, relative.user.id)
      expect(acceptanceStatus).toBe('rejected')
      expect(rows(fixture, 'billing_checkout_attempts')).toEqual([
        expect.objectContaining({
          state: 'completed',
          stripe_session_id: 'cs_family',
          billing_customer_id: expect.stringMatching(/^billing_customer_/)
        })
      ])
      expect(state).toMatchObject({
        entitlement: { granted: true, source: 'manager', state: 'active' },
        relationship: { kind: 'manager' },
        subscription: { state: 'active' },
        capabilities: { canCheckout: false, canManage: true }
      })
    } finally {
      fixture.cleanup()
    }
  })

  it('grants exactly the approved current statuses and denies reconciliation conflicts', async () => {
    const fixture = createWorkspaceInvitationFixture()
    const owner = await fixture.signIn('billing-status@example.test', 'Status Owner')
    seedSubscription(fixture, owner, 'active')

    try {
      setSubscriptionState(fixture, owner, 'active', false)
      expect(getBillingStateForConnection(fixture.connection, owner.user.id).entitlement).toMatchObject({
        granted: true,
        source: 'manager',
        state: 'active'
      })

      setSubscriptionState(fixture, owner, 'past_due', false)
      expect(
        getBillingStateForConnection(fixture.connection, owner.user.id, new Date('2026-07-28T00:00:00.000Z'))
          .entitlement
      ).toMatchObject({
        granted: true,
        source: 'manager',
        state: 'grace'
      })

      setSubscriptionState(fixture, owner, 'trialing', false)
      expect(getBillingStateForConnection(fixture.connection, owner.user.id).entitlement).toMatchObject({
        granted: false,
        source: null,
        state: 'reconciliation_required'
      })
      for (const status of ['canceled', 'incomplete', 'incomplete_expired', 'paused', 'unpaid'] as const) {
        setSubscriptionState(fixture, owner, status, false)
        const terminalState = getBillingStateForConnection(fixture.connection, owner.user.id)
        expect(terminalState.entitlement.granted).toBe(false)
        expect(terminalState.capabilities.canCheckout).toBe(status === 'canceled' || status === 'incomplete_expired')
      }

      fixture.sqlite
        .prepare('update billing_subscriptions set status = ?, cancel_at_period_end = 1 where organization_id = ?')
        .run('canceled', owner.workspace.id)
      expect(getBillingStateForConnection(fixture.connection, owner.user.id).capabilities.canCheckout).toBe(false)

      setSubscriptionState(fixture, owner, 'active', true)
      const state = getBillingStateForConnection(fixture.connection, owner.user.id)
      expect(state.entitlement.granted).toBe(false)
      expect(state.subscription).toMatchObject({ state: 'reconciliation_required' })
      expect(state.capabilities).toMatchObject({
        canCheckout: false,
        canManage: false,
        canReconcile: true
      })
    } finally {
      fixture.cleanup()
    }
  })

  it('returns only the approved billing and accepted-member fields without persisted Stripe identifiers', async () => {
    const fixture = createWorkspaceInvitationFixture()
    const manager = await fixture.signIn('billing-member-summary-manager@example.test', 'Member Summary Manager')
    const relative = await fixture.signIn('billing-member-summary-relative@example.test', 'Member Summary Relative')
    const providerCanaries = [
      'cus_private_billing_response',
      'sub_private_billing_response',
      'si_private_billing_response',
      'price_private_billing_response'
    ] as const
    seedSubscription(fixture, manager, 'active')
    seedMember(fixture, manager, relative)
    fixture.sqlite
      .prepare('update billing_customers set stripe_customer_id = ? where organization_id = ?')
      .run(providerCanaries[0], manager.workspace.id)
    fixture.sqlite
      .prepare(
        `update billing_subscriptions
         set stripe_subscription_id = ?, stripe_subscription_item_id = ?, stripe_price_id = ?
         where organization_id = ?`
      )
      .run(providerCanaries[1], providerCanaries[2], providerCanaries[3], manager.workspace.id)

    try {
      const state = getBillingStateForConnection(
        fixture.connection,
        manager.user.id,
        new Date('2026-07-28T00:00:00.000Z')
      )
      expect(state).toEqual({
        catalog: [
          { key: 'personal.weekly', plan: 'personal', cadence: 'weekly' },
          { key: 'personal.monthly', plan: 'personal', cadence: 'monthly' },
          { key: 'personal.annual', plan: 'personal', cadence: 'annual' },
          { key: 'family.monthly', plan: 'family', cadence: 'monthly' },
          { key: 'family.annual', plan: 'family', cadence: 'annual' }
        ],
        relationship: { kind: 'manager' },
        entitlement: {
          granted: true,
          source: 'manager',
          state: 'active',
          plan: 'family',
          cadence: 'monthly'
        },
        subscription: {
          provider: 'Stripe',
          state: 'active',
          plan: 'family',
          cadence: 'monthly',
          currentPeriodEnd: '2026-08-01T00:00:00.000Z',
          renewalEnabled: true,
          graceDeadline: null,
          checkoutPending: false
        },
        transition: null,
        seats: { accepted: 2, reserved: 0, capacity: 6 },
        members: [
          {
            reference: `member_shared_${relative.user.id}`,
            name: relative.user.name,
            email: relative.user.email
          }
        ],
        capabilities: {
          canCheckout: false,
          canChange: true,
          canManage: true,
          canReconcile: true,
          canLeaveFamily: false,
          canCreateFamilyInvitation: true,
          canResendFamilyInvitation: false,
          canAcceptFamilyInvitation: false,
          canAddFamilyMember: true,
          canRemoveFamilyMember: true
        }
      })
      expect(Object.keys(state.members![0]!).sort()).toEqual(['email', 'name', 'reference'])
      for (const canary of providerCanaries) expect(JSON.stringify(state)).not.toContain(canary)
    } finally {
      fixture.cleanup()
    }
  })

  it('closes renewal mutations during cancellation while preserving manager removal authority', async () => {
    const fixture = createWorkspaceInvitationFixture()
    const manager = await fixture.signIn('billing-cancel-manager@example.test', 'Cancel Manager')
    const relative = await fixture.signIn('billing-cancel-relative@example.test', 'Cancel Relative')
    seedSubscription(fixture, manager, 'active')
    seedMember(fixture, manager, relative)

    try {
      const active = getBillingStateForConnection(fixture.connection, manager.user.id)
      expect(active.capabilities).toMatchObject({
        canChange: true,
        canCreateFamilyInvitation: true,
        canAddFamilyMember: true,
        canRemoveFamilyMember: true
      })

      setSubscriptionState(fixture, manager, 'past_due', false)
      const grace = getBillingStateForConnection(
        fixture.connection,
        manager.user.id,
        new Date('2026-07-28T00:00:00.000Z')
      )
      expect(grace.entitlement).toMatchObject({ granted: true, source: 'manager', state: 'grace' })
      expect(grace.capabilities).toMatchObject({
        canChange: false,
        canCreateFamilyInvitation: false,
        canResendFamilyInvitation: false,
        canAddFamilyMember: false,
        canRemoveFamilyMember: true
      })

      setSubscriptionState(fixture, manager, 'active', false)
      fixture.sqlite
        .prepare('update billing_subscriptions set cancel_at_period_end = 1 where organization_id = ?')
        .run(manager.workspace.id)
      const canceling = getBillingStateForConnection(fixture.connection, manager.user.id)
      expect(canceling.subscription.renewalEnabled).toBe(false)
      expect(canceling.capabilities).toMatchObject({
        canChange: false,
        canCreateFamilyInvitation: false,
        canResendFamilyInvitation: false,
        canAddFamilyMember: false,
        canRemoveFamilyMember: true
      })
    } finally {
      fixture.cleanup()
    }
  })

  it('allows a new Checkout from terminal history while reusing the retained Stripe customer', async () => {
    const fixture = createWorkspaceInvitationFixture()
    const owner = await fixture.signIn('billing-terminal-retry@example.test', 'Terminal Retry')
    seedSubscription(fixture, owner, 'canceled')
    const fake = fakeStripe()

    try {
      await expect(
        createFamilyPlanCheckoutForConnection(billingContext(fixture, fake.client), owner.user.id, {
          plan: familyPlanKey
        })
      ).resolves.toEqual({ url: 'https://checkout.stripe.test/session/cs_family' })
      expect(fake.checkoutCreate).toHaveBeenCalledWith(
        expect.objectContaining({ customer: 'cus_billing-terminal-retry' }),
        expect.objectContaining({ idempotencyKey: expect.stringMatching(/^checkout_/) })
      )
    } finally {
      fixture.cleanup()
    }
  })

  it('keeps Portal available during reconciliation and clears only from an unambiguous provider read', async () => {
    const fixture = createWorkspaceInvitationFixture()
    const owner = await fixture.signIn('billing-reconcile@example.test', 'Reconcile Owner')
    seedSubscription(fixture, owner, 'active', true)
    const fake = fakeStripe({
      subscriptions: [stripeSubscription('sub_billing-reconcile', 'active', 'cus_billing-reconcile')]
    })
    const context = billingContext(fixture, fake.client)

    try {
      await expect(createFamilyPlanPortalForConnection(context, owner.user.id)).resolves.toEqual({
        url: 'https://billing.stripe.test/session/bps_family'
      })
      expect(fake.portalCreate).toHaveBeenCalledWith({
        customer: 'cus_billing-reconcile',
        configuration: 'bpc_server_owned',
        return_url: 'https://app.example.test/account/billing'
      })

      const reconciled = await reconcileFamilyPlanBillingForConnection(context, owner.user.id)
      expect(reconciled.entitlement).toEqual({
        granted: true,
        source: 'manager',
        state: 'active',
        plan: 'family',
        cadence: 'monthly'
      })
      expect(reconciled.subscription.state).toBe('active')

      fake.setSubscriptions([
        stripeSubscription('sub_billing-reconcile', 'active', 'cus_billing-reconcile'),
        stripeSubscription('sub_second', 'active', 'cus_billing-reconcile')
      ])
      const ambiguous = await reconcileFamilyPlanBillingForConnection(context, owner.user.id)
      expect(ambiguous.entitlement.granted).toBe(false)
      expect(ambiguous.subscription.state).toBe('reconciliation_required')
    } finally {
      fixture.cleanup()
    }
  })

  it('blocks Checkout and Portal before provider I/O once account deletion is fenced', async () => {
    const checkoutFixture = createWorkspaceInvitationFixture()
    const checkoutOwner = await checkoutFixture.signIn('billing-fenced-checkout@example.test', 'Fenced Checkout')
    const checkoutProvider = fakeStripe()
    checkoutFixture.sqlite
      .prepare('update organization set billing_deletion_pending = 1 where id = ?')
      .run(checkoutOwner.workspace.id)

    try {
      await expect(
        createFamilyPlanCheckoutForConnection(
          billingContext(checkoutFixture, checkoutProvider.client),
          checkoutOwner.user.id,
          { plan: familyPlanKey }
        )
      ).rejects.toMatchObject({ statusCode: 409 })
      expect(checkoutProvider.checkoutCreate).not.toHaveBeenCalled()
    } finally {
      checkoutFixture.cleanup()
    }

    const portalFixture = createWorkspaceInvitationFixture()
    const portalOwner = await portalFixture.signIn('billing-fenced-portal@example.test', 'Fenced Portal')
    seedSubscription(portalFixture, portalOwner, 'active')
    const portalProvider = fakeStripe()
    portalFixture.sqlite
      .prepare('update organization set billing_deletion_pending = 1 where id = ?')
      .run(portalOwner.workspace.id)

    try {
      await expect(
        createFamilyPlanPortalForConnection(billingContext(portalFixture, portalProvider.client), portalOwner.user.id)
      ).rejects.toMatchObject({ statusCode: 409 })
      expect(portalProvider.portalCreate).not.toHaveBeenCalled()
    } finally {
      portalFixture.cleanup()
    }
  })

  it('persists the captured local subscription when Stripe verifies that exact subscription is terminal', async () => {
    const fixture = createWorkspaceInvitationFixture()
    const owner = await fixture.signIn('billing-terminal-persisted@example.test', 'Terminal Persisted')
    seedSubscription(fixture, owner, 'active', true)
    const fake = fakeStripe({
      subscriptions: [
        stripeSubscription('sub_billing-terminal-persisted', 'canceled', 'cus_billing-terminal-persisted')
      ]
    })

    try {
      const state = await reconcileFamilyPlanBillingForConnection(billingContext(fixture, fake.client), owner.user.id)
      expect(state).toMatchObject({
        entitlement: { granted: false, source: null, state: 'terminal', plan: 'family', cadence: 'monthly' },
        subscription: { state: 'terminal', plan: 'family', cadence: 'monthly' },
        capabilities: { canCheckout: true }
      })
      expect(rows(fixture, 'billing_subscriptions')).toEqual([
        expect.objectContaining({
          stripe_subscription_id: 'sub_billing-terminal-persisted',
          stripe_subscription_item_id: 'si_sub_billing-terminal-persisted',
          status: 'canceled',
          plan_key: 'family',
          cadence: 'monthly',
          reconciliation_required: 0
        })
      ])
    } finally {
      fixture.cleanup()
    }
  })

  it('rejects a stale manual projection when local billing state changes during provider I/O', async () => {
    const fixture = createWorkspaceInvitationFixture()
    const owner = await fixture.signIn('billing-revision@example.test', 'Revision Owner')
    seedSubscription(fixture, owner, 'active', true)
    const fake = fakeStripe({
      subscriptions: [stripeSubscription('sub_billing-revision', 'active', 'cus_billing-revision')],
      onSubscriptionList: () => {
        fixture.sqlite
          .prepare(
            `update billing_subscriptions
             set status = 'past_due', projection_order_ms = 9000,
                 reconciliation_required = 0, reconciliation_reason = null
             where organization_id = ?`
          )
          .run(owner.workspace.id)
      }
    })

    try {
      await expect(
        reconcileFamilyPlanBillingForConnection(billingContext(fixture, fake.client), owner.user.id)
      ).rejects.toMatchObject({ statusCode: 409 })
      expect(rows(fixture, 'billing_subscriptions')).toEqual([
        expect.objectContaining({
          status: 'past_due',
          projection_order_ms: 9000,
          reconciliation_required: 0
        })
      ])
    } finally {
      fixture.cleanup()
    }
  })

  it('reauthorizes after Checkout provider I/O and retains only detached continuity after deletion', async () => {
    const fixture = createWorkspaceInvitationFixture()
    const owner = await fixture.signIn('billing-delete-race@example.test', 'Delete Race')
    const fake = fakeStripe({
      onCheckoutCreate: () => {
        deleteAccountAtomically(fixture.connection, owner.user)
      }
    })

    try {
      await expect(
        createFamilyPlanCheckoutForConnection(billingContext(fixture, fake.client), owner.user.id, {
          plan: familyPlanKey
        })
      ).rejects.toMatchObject({ statusCode: 403 })
      expect(rows(fixture, 'user')).toHaveLength(0)
      expect(rows(fixture, 'billing_checkout_attempts')).toHaveLength(0)
      expect(rows(fixture, 'detached_billing_subjects')).toEqual([
        expect.objectContaining({
          provider_reference: expect.stringMatching(/^attempt:billing_attempt_/),
          provider_customer_reference: null,
          provider_status: 'checkout_open',
          retention_policy: 'stripe_billing_lifecycle'
        })
      ])
    } finally {
      fixture.cleanup()
    }
  })

  it('deletes a covered member without changing the manager subscription or other authority', async () => {
    const fixture = createWorkspaceInvitationFixture()
    const manager = await fixture.signIn('billing-member-delete-manager@example.test', 'Member Delete Manager')
    const relative = await fixture.signIn('billing-member-delete-relative@example.test', 'Member Delete Relative')
    seedSubscription(fixture, manager, 'active')
    seedMember(fixture, manager, relative)

    try {
      expect(deleteAccountAtomically(fixture.connection, relative.user)).toMatchObject({ status: 'deleted' })
      expect(rows(fixture, 'user')).toEqual([expect.objectContaining({ id: manager.user.id })])
      expect(rows(fixture, 'organization')).toContainEqual(
        expect.objectContaining({ id: manager.workspace.id, personal_owner_user_id: manager.user.id })
      )
      expect(rows(fixture, 'billing_subscriptions')).toEqual([
        expect.objectContaining({ organization_id: manager.workspace.id, status: 'active' })
      ])
      expect(getBillingStateForConnection(fixture.connection, manager.user.id)).toMatchObject({
        relationship: { kind: 'manager' },
        entitlement: { granted: true, source: 'manager', state: 'active' }
      })
    } finally {
      fixture.cleanup()
    }
  })

  it('does not overwrite a newer completed attempt with a stale Checkout retrieval', async () => {
    const fixture = createWorkspaceInvitationFixture()
    const owner = await fixture.signIn('billing-checkout-race@example.test', 'Checkout Race')
    const fake = fakeStripe()
    const context = billingContext(fixture, fake.client)

    try {
      await createFamilyPlanCheckoutForConnection(context, owner.user.id, {
        plan: familyPlanKey
      })
      fake.setOnCheckoutRetrieve(() => {
        fixture.sqlite
          .prepare("update billing_checkout_attempts set state = 'completed' where organization_id = ?")
          .run(owner.workspace.id)
      })

      await expect(
        createFamilyPlanCheckoutForConnection(context, owner.user.id, { plan: familyPlanKey })
      ).rejects.toMatchObject({ statusCode: 409 })
      expect(rows(fixture, 'billing_checkout_attempts')).toEqual([
        expect.objectContaining({ state: 'completed', stripe_session_id: 'cs_family' })
      ])
      expect(rows(fixture, 'detached_billing_subjects')).toHaveLength(0)
    } finally {
      fixture.cleanup()
    }
  })

  it('recovers one completed Checkout from reconciliation without choosing among sessions', async () => {
    const fixture = createWorkspaceInvitationFixture()
    const owner = await fixture.signIn('billing-checkout-reconcile@example.test', 'Checkout Reconcile')
    const fake = fakeStripe({
      subscriptions: [stripeSubscription('sub_checkout_reconcile', 'active', 'cus_checkout_reconcile')]
    })
    const context = billingContext(fixture, fake.client)

    try {
      await createFamilyPlanCheckoutForConnection(context, owner.user.id, {
        plan: familyPlanKey
      })
      fixture.sqlite
        .prepare("update billing_checkout_attempts set state = 'reconciliation_required' where organization_id = ?")
        .run(owner.workspace.id)
      fake.setCheckoutSession({ status: 'complete', customer: 'cus_checkout_reconcile', url: null })

      const state = await reconcileFamilyPlanBillingForConnection(context, owner.user.id)
      expect(state.entitlement).toEqual({
        granted: true,
        source: 'manager',
        state: 'active',
        plan: 'family',
        cadence: 'monthly'
      })
      expect(rows(fixture, 'billing_checkout_attempts')).toEqual([
        expect.objectContaining({ state: 'completed', stripe_session_id: 'cs_family' })
      ])
      expect(rows(fixture, 'billing_customers')).toEqual([
        expect.objectContaining({
          organization_id: owner.workspace.id,
          stripe_customer_id: 'cus_checkout_reconcile'
        })
      ])
    } finally {
      fixture.cleanup()
    }
  })

  it('fails closed when reconciliation finds more than one matching Checkout', async () => {
    const fixture = createWorkspaceInvitationFixture()
    const owner = await fixture.signIn('billing-ambiguous-checkout@example.test', 'Ambiguous Checkout')
    const fake = fakeStripe()
    const context = billingContext(fixture, fake.client)

    try {
      await createFamilyPlanCheckoutForConnection(context, owner.user.id, { plan: familyPlanKey })
      const attempt = rows(fixture, 'billing_checkout_attempts')[0] as { id: string }
      fake.setListedCheckoutSessions([checkoutSession(attempt.id), checkoutSession(attempt.id, 'cs_family_duplicate')])

      await expect(reconcileFamilyPlanBillingForConnection(context, owner.user.id)).rejects.toMatchObject({
        statusCode: 409
      })
      expect(rows(fixture, 'billing_checkout_attempts')).toEqual([
        expect.objectContaining({ state: 'reconciliation_required' })
      ])
    } finally {
      fixture.cleanup()
    }
  })

  it('retires an expired unmatched attempt after its reconciliation window closes', async () => {
    const fixture = createWorkspaceInvitationFixture()
    const owner = await fixture.signIn('billing-timeout@example.test', 'Checkout Timeout')
    const fake = fakeStripe()
    const context = billingContext(fixture, fake.client)
    const checkoutTime = new Date('2026-01-01T00:00:00.000Z')
    const reconciliationTime = new Date(checkoutTime.getTime() + 60_000)
    const expiredReuseTime = new Date(reconciliationTime.getTime() - 1).toISOString()

    try {
      await createFamilyPlanCheckoutForConnection(context, owner.user.id, { plan: familyPlanKey }, checkoutTime)
      fixture.sqlite
        .prepare('update billing_checkout_attempts set reuse_until = ? where organization_id = ?')
        .run(expiredReuseTime, owner.workspace.id)
      fake.setListedCheckoutSessions([])

      const state = await reconcileFamilyPlanBillingForConnection(context, owner.user.id, reconciliationTime)
      expect(state).toMatchObject({
        entitlement: { granted: false },
        subscription: { state: 'none', checkoutPending: false },
        capabilities: { canCheckout: true }
      })
      expect(rows(fixture, 'billing_checkout_attempts')).toEqual([expect.objectContaining({ state: 'failed' })])
    } finally {
      fixture.cleanup()
    }
  })

  it('keeps an unmatched attempt open while its reconciliation window remains valid', async () => {
    const fixture = createWorkspaceInvitationFixture()
    const owner = await fixture.signIn('billing-no-match@example.test', 'No Match Checkout')
    const fake = fakeStripe()
    const context = billingContext(fixture, fake.client)

    try {
      await createFamilyPlanCheckoutForConnection(context, owner.user.id, { plan: familyPlanKey })
      fake.setListedCheckoutSessions([])

      const state = await reconcileFamilyPlanBillingForConnection(context, owner.user.id)
      expect(state).toMatchObject({
        entitlement: { granted: false },
        subscription: { state: 'none', checkoutPending: true },
        capabilities: { canCheckout: false }
      })
      expect(rows(fixture, 'billing_checkout_attempts')).toEqual([expect.objectContaining({ state: 'open' })])
    } finally {
      fixture.cleanup()
    }
  })

  it('rejects reconciliation when ownership disappears during Checkout discovery', async () => {
    const fixture = createWorkspaceInvitationFixture()
    const owner = await fixture.signIn('billing-reconcile-delete@example.test', 'Reconcile Delete')
    const fake = fakeStripe()
    const context = billingContext(fixture, fake.client)

    try {
      await createFamilyPlanCheckoutForConnection(context, owner.user.id, { plan: familyPlanKey })
      fake.setListedCheckoutSessions([])
      fake.setOnCheckoutList(() => deleteAccountAtomically(fixture.connection, owner.user))

      await expect(reconcileFamilyPlanBillingForConnection(context, owner.user.id)).rejects.toMatchObject({
        statusCode: 403
      })
      expect(rows(fixture, 'user')).toHaveLength(0)
      expect(rows(fixture, 'billing_checkout_attempts')).toHaveLength(0)
    } finally {
      fixture.cleanup()
    }
  })

  it('recovers a canonical cadence before reopening a migrated legacy Checkout', async () => {
    const fixture = createWorkspaceInvitationFixture()
    const owner = await fixture.signIn('billing-legacy-open@example.test', 'Legacy Open Checkout')
    const fake = fakeStripe()
    const context = billingContext(fixture, fake.client)

    try {
      await createFamilyPlanCheckoutForConnection(context, owner.user.id, { plan: familyPlanKey })
      fixture.sqlite
        .prepare(
          `update billing_checkout_attempts
           set cadence = null, state = 'reconciliation_required'
           where organization_id = ?`
        )
        .run(owner.workspace.id)

      await expect(reconcileFamilyPlanBillingForConnection(context, owner.user.id)).resolves.toMatchObject({
        entitlement: { granted: false },
        subscription: { state: 'none', checkoutPending: true }
      })
      expect(rows(fixture, 'billing_checkout_attempts')).toEqual([
        expect.objectContaining({
          state: 'open',
          cadence: 'monthly',
          stripe_price_id: 'price_family_monthly_server_owned',
          stripe_session_id: 'cs_family'
        })
      ])
    } finally {
      fixture.cleanup()
    }
  })

  it('keeps a migrated legacy Checkout parked when its Price is not in the canonical catalog', async () => {
    const fixture = createWorkspaceInvitationFixture()
    const owner = await fixture.signIn('billing-legacy-unknown-price@example.test', 'Legacy Unknown Price')
    const fake = fakeStripe()
    const context = billingContext(fixture, fake.client)

    try {
      await createFamilyPlanCheckoutForConnection(context, owner.user.id, { plan: familyPlanKey })
      const attempt = rows(fixture, 'billing_checkout_attempts')[0] as { id: string }
      fixture.sqlite
        .prepare(
          `update billing_checkout_attempts
           set cadence = null, stripe_price_id = 'price_legacy_unknown', state = 'reconciliation_required'
           where id = ?`
        )
        .run(attempt.id)
      fake.setListedCheckoutSessions([checkoutSession(attempt.id, 'cs_family', 'price_legacy_unknown')])

      await expect(reconcileFamilyPlanBillingForConnection(context, owner.user.id)).rejects.toMatchObject({
        statusCode: 409
      })
      expect(rows(fixture, 'billing_checkout_attempts')).toEqual([
        expect.objectContaining({
          state: 'reconciliation_required',
          cadence: null,
          stripe_price_id: 'price_legacy_unknown'
        })
      ])
    } finally {
      fixture.cleanup()
    }
  })

  it('preserves local state when Stripe Checkout discovery is temporarily unavailable', async () => {
    const fixture = createWorkspaceInvitationFixture()
    const owner = await fixture.signIn('billing-list-failure@example.test', 'List Failure')
    const fake = fakeStripe()
    const context = billingContext(fixture, fake.client)

    try {
      await createFamilyPlanCheckoutForConnection(context, owner.user.id, { plan: familyPlanKey })
      fake.failNextCheckoutList()

      await expect(reconcileFamilyPlanBillingForConnection(context, owner.user.id)).rejects.toMatchObject({
        statusCode: 502
      })
      expect(rows(fixture, 'billing_checkout_attempts')).toEqual([expect.objectContaining({ state: 'open' })])
    } finally {
      fixture.cleanup()
    }
  })

  it.each([
    ['a non-subscription session', { mode: 'payment' }],
    ['an open session without a safe URL', { status: 'open', url: 'http://checkout.stripe.test/session/cs_family' }],
    ['a completed session without a Customer', { status: 'complete', customer: null, url: null }],
    ['an unexpected session state', { status: null, url: null }]
  ] satisfies ReadonlyArray<readonly [string, Partial<Stripe.Checkout.Session>]>)(
    'keeps reconciliation closed for %s',
    async (_description, sessionUpdate) => {
      const fixture = createWorkspaceInvitationFixture()
      const owner = await fixture.signIn('billing-invalid-reconciliation@example.test', 'Invalid Reconciliation')
      const fake = fakeStripe()
      const context = billingContext(fixture, fake.client)

      try {
        await createFamilyPlanCheckoutForConnection(context, owner.user.id, { plan: familyPlanKey })
        const attempt = rows(fixture, 'billing_checkout_attempts')[0] as { id: string }
        fake.setListedCheckoutSessions([{ ...checkoutSession(attempt.id), ...sessionUpdate }])

        await expect(reconcileFamilyPlanBillingForConnection(context, owner.user.id)).rejects.toMatchObject({
          statusCode: 409
        })
        expect(rows(fixture, 'billing_checkout_attempts')).toEqual([
          expect.objectContaining({ state: 'reconciliation_required' })
        ])
      } finally {
        fixture.cleanup()
      }
    }
  )

  it('accepts an expired Checkout observation without creating billing authority', async () => {
    const fixture = createWorkspaceInvitationFixture()
    const owner = await fixture.signIn('billing-expired-reconcile@example.test', 'Expired Reconcile')
    const fake = fakeStripe()
    const context = billingContext(fixture, fake.client)

    try {
      await createFamilyPlanCheckoutForConnection(context, owner.user.id, { plan: familyPlanKey })
      const attempt = rows(fixture, 'billing_checkout_attempts')[0] as { id: string }
      fake.setListedCheckoutSessions([{ ...checkoutSession(attempt.id), status: 'expired', url: null }])

      const state = await reconcileFamilyPlanBillingForConnection(context, owner.user.id)
      expect(state).toMatchObject({
        entitlement: { granted: false },
        subscription: { state: 'none', checkoutPending: false },
        capabilities: { canCheckout: true }
      })
      expect(rows(fixture, 'billing_checkout_attempts')).toEqual([expect.objectContaining({ state: 'expired' })])
      expect(rows(fixture, 'billing_customers')).toHaveLength(0)
    } finally {
      fixture.cleanup()
    }
  })

  it('refuses to attach a completed Checkout to a different local Customer', async () => {
    const fixture = createWorkspaceInvitationFixture()
    const owner = await fixture.signIn('billing-customer-conflict@example.test', 'Customer Conflict')
    const fake = fakeStripe()
    const context = billingContext(fixture, fake.client)

    try {
      await createFamilyPlanCheckoutForConnection(context, owner.user.id, { plan: familyPlanKey })
      seedCustomerOnly(fixture, owner)
      const attempt = rows(fixture, 'billing_checkout_attempts')[0] as { id: string }
      fake.setListedCheckoutSessions([
        { ...checkoutSession(attempt.id), status: 'complete', customer: 'cus_foreign', url: null }
      ])

      await expect(reconcileFamilyPlanBillingForConnection(context, owner.user.id)).rejects.toMatchObject({
        statusCode: 409
      })
      expect(rows(fixture, 'billing_checkout_attempts')).toEqual([
        expect.objectContaining({ state: 'reconciliation_required', billing_customer_id: null })
      ])
      expect(rows(fixture, 'billing_customers')).toEqual([
        expect.objectContaining({ stripe_customer_id: 'cus_billing-customer-conflict' })
      ])
    } finally {
      fixture.cleanup()
    }
  })

  it('keeps reconciliation closed while a second Checkout remains open beside a subscription', async () => {
    const fixture = createWorkspaceInvitationFixture()
    const owner = await fixture.signIn('billing-overlap@example.test', 'Checkout Overlap')
    const fake = fakeStripe({
      subscriptions: [stripeSubscription('sub_overlap', 'active', 'cus_billing-overlap')]
    })
    const context = billingContext(fixture, fake.client)

    try {
      await createFamilyPlanCheckoutForConnection(context, owner.user.id, {
        plan: familyPlanKey
      })
      seedSubscription(fixture, owner, 'active', true)
      fixture.sqlite
        .prepare("update billing_checkout_attempts set state = 'reconciliation_required' where organization_id = ?")
        .run(owner.workspace.id)

      await expect(reconcileFamilyPlanBillingForConnection(context, owner.user.id)).rejects.toMatchObject({
        statusCode: 409
      })
      expect(rows(fixture, 'billing_checkout_attempts')).toEqual([
        expect.objectContaining({ state: 'reconciliation_required', stripe_session_id: 'cs_family' })
      ])
      expect(getBillingStateForConnection(fixture.connection, owner.user.id)).toMatchObject({
        entitlement: { granted: false },
        subscription: { state: 'reconciliation_required' }
      })
      expect(fake.subscriptionList).not.toHaveBeenCalled()
    } finally {
      fixture.cleanup()
    }
  })

  it('fails closed when Stripe becomes active while reconciliation observes an open Checkout', async () => {
    const fixture = createWorkspaceInvitationFixture()
    const owner = await fixture.signIn('billing-provider-race@example.test', 'Provider Race')
    const fake = fakeStripe({
      subscriptions: [stripeSubscription('sub_provider_race', 'active', 'cus_billing-provider-race')]
    })
    const context = billingContext(fixture, fake.client)

    try {
      await createFamilyPlanCheckoutForConnection(context, owner.user.id, {
        plan: familyPlanKey
      })
      seedCustomerOnly(fixture, owner)

      const state = await reconcileFamilyPlanBillingForConnection(context, owner.user.id)
      expect(state).toMatchObject({
        entitlement: { granted: false },
        subscription: { state: 'reconciliation_required' }
      })
      expect(rows(fixture, 'billing_checkout_attempts')).toEqual([
        expect.objectContaining({ state: 'reconciliation_required', stripe_session_id: 'cs_family' })
      ])
      expect(rows(fixture, 'billing_subscriptions')).toEqual([
        expect.objectContaining({
          status: 'active',
          reconciliation_required: 1,
          reconciliation_reason: 'overlapping_checkout_attempt'
        })
      ])
    } finally {
      fixture.cleanup()
    }
  })

  it('fails disabled injected service seams before any Stripe call', async () => {
    const fixture = createWorkspaceInvitationFixture()
    const owner = await fixture.signIn('billing-disabled@example.test', 'Disabled Owner')
    const fake = fakeStripe()
    const context = billingContext(fixture, fake.client, false)

    try {
      await expect(createFamilyPlanPortalForConnection(context, owner.user.id)).rejects.toMatchObject({
        statusCode: 404
      })
      await expect(reconcileFamilyPlanBillingForConnection(context, owner.user.id)).rejects.toMatchObject({
        statusCode: 404
      })
      expect(fake.portalCreate).not.toHaveBeenCalled()
      expect(fake.subscriptionList).not.toHaveBeenCalled()
    } finally {
      fixture.cleanup()
    }
  })
})

function billingContext(
  fixture: WorkspaceInvitationFixture,
  client: StripeBillingClient,
  enabled = true
): BillingServiceContext {
  return {
    connection: fixture.connection,
    client,
    config: {
      modules: { billing: { enabled } },
      public: { appUrl: 'https://app.example.test' },
      stripe: {
        secretKey: 'sk_test_server_only',
        webhookSecret: 'whsec_server_only',
        portalConfigurationId: 'bpc_server_owned',
        personalWeeklyPriceId: 'price_personal_weekly_server_owned',
        personalMonthlyPriceId: 'price_personal_monthly_server_owned',
        personalAnnualPriceId: 'price_personal_annual_server_owned',
        familyMonthlyPriceId: 'price_family_monthly_server_owned',
        familyAnnualPriceId: 'price_family_annual_server_owned'
      }
    } as unknown as AppRuntimeConfig
  }
}

function fakeStripe(
  options: {
    subscriptions?: Stripe.Subscription[]
    onCheckoutCreate?: () => void | Promise<void>
    onPortalCreate?: () => void | Promise<void>
    onSubscriptionList?: () => void | Promise<void>
    failCheckoutCreateAfterPersistOnce?: boolean
    checkoutSessionUpdate?: Partial<Stripe.Checkout.Session>
  } = {}
) {
  let subscriptions = options.subscriptions ?? []
  let onCheckoutRetrieve: (() => void) | undefined
  let onCheckoutList: (() => void | Promise<void>) | undefined
  let checkoutRetrieveSession: Stripe.Checkout.Session | undefined
  let listedCheckoutSessions: Stripe.Checkout.Session[] | undefined
  let failCheckoutRetrieve = false
  let failCheckoutList = false
  let failCheckoutCreateAfterPersist = options.failCheckoutCreateAfterPersistOnce ?? false
  let subscriptionListObserved = false
  const sessions = new Map<string, Stripe.Checkout.Session>()
  const checkoutCreate = vi.fn(async (input: Stripe.Checkout.SessionCreateParams, request?: Stripe.RequestOptions) => {
    await options.onCheckoutCreate?.()
    const key = request?.idempotencyKey ?? 'missing'
    const existing = sessions.get(key)
    if (existing) return existing
    const requestedPrice =
      typeof input.line_items?.[0]?.price === 'string' ? input.line_items[0].price : 'price_family_monthly_server_owned'
    const session = {
      ...checkoutSession(
        input.client_reference_id ?? null,
        sessions.size === 0 ? 'cs_family' : 'cs_family_replacement',
        requestedPrice
      ),
      customer: typeof input.customer === 'string' ? input.customer : null,
      ...options.checkoutSessionUpdate
    }
    sessions.set(key, session)
    if (failCheckoutCreateAfterPersist) {
      failCheckoutCreateAfterPersist = false
      throw new Error('indeterminate provider response')
    }
    return session
  })
  const checkoutRetrieve = vi.fn(async (id: string) => {
    onCheckoutRetrieve?.()
    if (failCheckoutRetrieve) {
      failCheckoutRetrieve = false
      throw new Error('temporary Checkout retrieval failure')
    }
    if (checkoutRetrieveSession) return checkoutRetrieveSession
    return (
      listedCheckoutSessions?.find((session) => session.id === id) ??
      [...sessions.values()].find((session) => session.id === id) ??
      checkoutSession(null)
    )
  })
  const checkoutList = vi.fn(async () => {
    await onCheckoutList?.()
    if (failCheckoutList) {
      failCheckoutList = false
      throw new Error('temporary Checkout discovery failure')
    }
    return {
      object: 'list',
      data: listedCheckoutSessions ?? [...sessions.values()],
      has_more: false,
      url: '/v1/checkout/sessions'
    } as Stripe.ApiList<Stripe.Checkout.Session>
  })
  const portalCreate = vi.fn(async () => {
    await options.onPortalCreate?.()
    return {
      id: 'bps_family',
      object: 'billing_portal.session',
      created: 1_783_920_000,
      customer: 'cus_family',
      livemode: false,
      locale: null,
      on_behalf_of: null,
      return_url: 'https://app.example.test/account/billing',
      url: 'https://billing.stripe.test/session/bps_family'
    }
  })
  const subscriptionList = vi.fn(async (parameters: Stripe.SubscriptionListParams) => {
    if (!subscriptionListObserved) {
      subscriptionListObserved = true
      await options.onSubscriptionList?.()
    }
    const matching = subscriptions.filter((subscription) => subscription.status === parameters.status)
    const limit = parameters.limit ?? 10
    const data = matching.slice(0, limit)
    return {
      object: 'list',
      data,
      has_more: data.length < matching.length,
      url: '/v1/subscriptions'
    } as Stripe.ApiList<Stripe.Subscription>
  })
  const subscriptionRetrieve = vi.fn(async (id: string) => {
    const subscription = subscriptions.find((candidate) => candidate.id === id)
    if (!subscription) throw new Error('subscription not found')
    return subscription
  })
  const client = {
    checkout: { sessions: { create: checkoutCreate, retrieve: checkoutRetrieve, list: checkoutList } },
    billingPortal: { sessions: { create: portalCreate } },
    subscriptions: { list: subscriptionList, retrieve: subscriptionRetrieve }
  } as unknown as StripeBillingClient
  return {
    client,
    checkoutCreate,
    portalCreate,
    subscriptionList,
    setOnCheckoutRetrieve(callback: () => void) {
      onCheckoutRetrieve = callback
    },
    setOnCheckoutList(callback: () => void | Promise<void>) {
      onCheckoutList = callback
    },
    failNextCheckoutRetrieve() {
      failCheckoutRetrieve = true
    },
    failNextCheckoutList() {
      failCheckoutList = true
    },
    setCheckoutRetrieveSession(session: Stripe.Checkout.Session) {
      checkoutRetrieveSession = session
    },
    setListedCheckoutSessions(sessions: Stripe.Checkout.Session[]) {
      listedCheckoutSessions = sessions
    },
    setCheckoutSession(update: Partial<Stripe.Checkout.Session>) {
      for (const [key, session] of sessions) sessions.set(key, { ...session, ...update })
    },
    setSubscriptions(next: Stripe.Subscription[]) {
      subscriptions = next
    }
  }
}

function checkoutSession(
  clientReferenceId: string | null,
  id = 'cs_family',
  priceId = 'price_family_monthly_server_owned'
): Stripe.Checkout.Session {
  return {
    id,
    object: 'checkout.session',
    mode: 'subscription',
    status: 'open',
    customer: null,
    client_reference_id: clientReferenceId,
    metadata: clientReferenceId ? { billing_attempt_id: clientReferenceId } : {},
    line_items: {
      object: 'list',
      data: [
        {
          id: `li_${id}`,
          object: 'item',
          price: { id: priceId, object: 'price' },
          quantity: 1
        } as Stripe.LineItem
      ],
      has_more: false,
      url: `/v1/checkout/sessions/${id}/line_items`
    },
    expires_at: 1_783_999_999,
    url: `https://checkout.stripe.test/session/${id}`
  } as Stripe.Checkout.Session
}

function checkoutLineItems(priceId: string, quantity: number): Stripe.ApiList<Stripe.LineItem> {
  return {
    object: 'list',
    data: [
      {
        id: 'li_test',
        object: 'item',
        price: { id: priceId, object: 'price' },
        quantity
      } as Stripe.LineItem
    ],
    has_more: false,
    url: '/v1/checkout/sessions/cs_test/line_items'
  }
}

function stripeSubscription(
  id: string,
  status: Stripe.Subscription.Status,
  customer = 'cus_billing-reconcile'
): Stripe.Subscription {
  return {
    id,
    object: 'subscription',
    customer,
    status,
    items: {
      object: 'list',
      data: [
        {
          id: `si_${id}`,
          object: 'subscription_item',
          current_period_start: 1_783_920_000,
          current_period_end: 1_786_512_000,
          price: { id: 'price_family_monthly_server_owned', object: 'price' },
          quantity: 1
        } as Stripe.SubscriptionItem
      ],
      has_more: false,
      url: `/v1/subscription_items?subscription=${id}`
    }
  } as Stripe.Subscription
}

function seedMember(fixture: WorkspaceInvitationFixture, owner: SignedInFixtureUser, member: SignedInFixtureUser) {
  fixture.sqlite
    .prepare('insert into member (id, organization_id, user_id, role, created_at) values (?, ?, ?, ?, ?)')
    .run(`member_shared_${member.user.id}`, owner.workspace.id, member.user.id, 'member', Date.now())
}

function seedSubscription(
  fixture: WorkspaceInvitationFixture,
  owner: SignedInFixtureUser,
  status: string,
  reconciliationRequired = false
) {
  const suffix = owner.user.email.split('@')[0]
  const customerId = `billing_customer_${suffix}`
  const stripeCustomerId = `cus_${suffix}`
  const now = new Date().toISOString()
  fixture.sqlite
    .prepare(
      `insert into billing_customers (id, organization_id, stripe_customer_id, created_at, updated_at)
       values (?, ?, ?, ?, ?)`
    )
    .run(customerId, owner.workspace.id, stripeCustomerId, now, now)
  fixture.sqlite
    .prepare(
      `insert into billing_subscriptions (
        id, organization_id, billing_customer_id, stripe_subscription_id, stripe_subscription_item_id,
        status, plan_key, cadence, stripe_price_id, current_period_start, current_period_end, projection_order_ms,
        last_verified_at, reconciliation_required, reconciliation_reason, created_at, updated_at
      ) values (?, ?, ?, ?, ?, ?, 'family', 'monthly', 'price_family_monthly_server_owned', ?, ?, 1, ?, ?, ?, ?, ?)`
    )
    .run(
      `billing_subscription_${suffix}`,
      owner.workspace.id,
      customerId,
      `sub_${suffix}`,
      `si_${suffix}`,
      status,
      '2026-07-01T00:00:00.000Z',
      '2026-08-01T00:00:00.000Z',
      now,
      reconciliationRequired ? 1 : 0,
      reconciliationRequired ? 'test_reconciliation' : null,
      now,
      now
    )
}

function seedPersonalSubscriptionStoppingRenewal(
  fixture: WorkspaceInvitationFixture,
  owner: SignedInFixtureUser,
  paidThrough: string
): string {
  const suffix = owner.user.email.split('@')[0]
  const customerId = `billing_customer_${suffix}`
  const subscriptionId = `billing_subscription_${suffix}`
  const now = new Date().toISOString()
  fixture.sqlite
    .prepare(
      `insert into billing_customers (id, organization_id, stripe_customer_id, created_at, updated_at)
       values (?, ?, ?, ?, ?)`
    )
    .run(customerId, owner.workspace.id, `cus_${suffix}`, now, now)
  fixture.sqlite
    .prepare(
      `insert into billing_subscriptions (
         id, organization_id, billing_customer_id, stripe_subscription_id, stripe_subscription_item_id,
         status, plan_key, cadence, stripe_price_id, current_period_start, current_period_end,
         cancel_at_period_end, projection_order_ms, reconciliation_required, reconciliation_reason,
         revision, created_at, updated_at
       ) values (
         ?, ?, ?, ?, ?, 'active', 'personal', 'monthly', 'price_personal_monthly_server_owned',
         '2026-07-01T00:00:00.000Z', ?, 1, 1, 0, null, 0, ?, ?
       )`
    )
    .run(subscriptionId, owner.workspace.id, customerId, `sub_${suffix}`, `si_${suffix}`, paidThrough, now, now)
  return subscriptionId
}

function seedCustomerOnly(fixture: WorkspaceInvitationFixture, owner: SignedInFixtureUser) {
  const suffix = owner.user.email.split('@')[0]
  const now = new Date().toISOString()
  fixture.sqlite
    .prepare(
      `insert into billing_customers (id, organization_id, stripe_customer_id, created_at, updated_at)
       values (?, ?, ?, ?, ?)`
    )
    .run(`billing_customer_${suffix}`, owner.workspace.id, `cus_${suffix}`, now, now)
}

function setSubscriptionState(
  fixture: WorkspaceInvitationFixture,
  owner: SignedInFixtureUser,
  status: string,
  reconciliationRequired: boolean
) {
  const graceStartedAt = status === 'past_due' ? '2026-07-20T00:00:00.000Z' : null
  const graceEndsAt = status === 'past_due' ? '2026-08-03T00:00:00.000Z' : null
  fixture.sqlite
    .prepare(
      `update billing_subscriptions
       set status = ?, cancel_at_period_end = 0,
           grace_invoice_id = ?, grace_started_at = ?, grace_ends_at = ?,
           reconciliation_required = ?, reconciliation_reason = ?
       where organization_id = ?`
    )
    .run(
      status,
      status === 'past_due' ? `in_grace_${owner.user.id}` : null,
      graceStartedAt,
      graceEndsAt,
      reconciliationRequired ? 1 : 0,
      reconciliationRequired ? 'test_conflict' : null,
      owner.workspace.id
    )
}

function rows(fixture: WorkspaceInvitationFixture, table: string) {
  return fixture.sqlite.prepare(`select * from ${table} order by rowid`).all()
}
