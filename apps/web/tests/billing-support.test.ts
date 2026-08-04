import type Stripe from 'stripe'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  getBillingCustomerById,
  getCheckoutAttemptById,
  getDetachedStripeBillingSubject,
  listDetachedStripeBillingSubjectsForCustomer,
  updateCheckoutAttempt
} from '../server/db/repositories/billing'
import { deleteAccountAtomically } from '../server/services/account-deletion'
import { mutableAttemptStates, transitionCheckoutAttempt } from '../server/services/payments/billing-checkout-store'
import { prepareBillingAccountDeletionForConnection } from '../server/services/payments/billing-account-deletion'
import {
  createBillingCheckoutForConnection,
  createBillingPortalForConnection as createFamilyPlanPortalForConnection,
  getBillingStateForConnection,
  reconcileBillingForConnection as reconcileFamilyPlanBillingForConnection,
  type BillingServiceContext
} from '../server/services/payments/billing-service'
import {
  constructStripeWebhookEvent,
  createStripeClient,
  getStripeClient,
  getStripeWebhookSecret,
  resetStripeClientForTests
} from '../server/services/payments/stripe-client'
import type { StripeBillingClient } from '../server/services/payments/stripe-client'
import type { AppRuntimeConfig } from '../server/utils/runtime'
import { createWorkspaceInvitationFixture } from './helpers/workspace-invitation-fixture'

function createFamilyPlanCheckoutForConnection(
  context: BillingServiceContext,
  userId: string,
  input: Readonly<{ plan: string }>,
  now?: Date
) {
  const offering = input.plan === 'family' ? 'family.monthly' : input.plan
  return createBillingCheckoutForConnection(context, userId, { offering } as never, now)
}

afterEach(() => {
  vi.unstubAllEnvs()
  resetStripeClientForTests()
})

describe('Stripe SDK and retained billing support boundaries', () => {
  it('uses the official webhook helper and reports missing or invalid signatures safely', () => {
    const client = createStripeClient('sk_test_support')
    const payload = JSON.stringify({ id: 'evt_support', type: 'customer.created' })
    const secret = 'whsec_support'
    const signature = client.webhooks.generateTestHeaderString({ payload, secret })

    expect(constructStripeWebhookEvent(client, payload, signature, secret)).toMatchObject({
      id: 'evt_support',
      type: 'customer.created'
    })
    expect(() => constructStripeWebhookEvent(client, payload, undefined, secret)).toThrow('Missing Stripe signature')
    expect(() => constructStripeWebhookEvent(client, payload, 'invalid', secret)).toThrow(
      'Stripe signature verification failed'
    )
    expect(() => createStripeClient('')).toThrow('Stripe secret key is not configured')
  })

  it('bounds ordinary Stripe attempts and performs only one SDK network retry', async () => {
    const observedTimeouts: number[] = []
    const httpClient = {
      getClientName() {
        return 'deterministic-local-fake'
      },
      async makeRequest(
        _host: string,
        _port: string,
        _path: string,
        _method: string,
        _headers: Stripe.RequestHeaders,
        _requestData: string,
        _protocol: string,
        timeout: number
      ) {
        observedTimeouts.push(timeout)
        const error = new TypeError('local transport closed') as TypeError & { code: string }
        error.code = 'ECONNRESET'
        throw error
      }
    } as Stripe.HttpClient
    const client = createStripeClient('sk_test_local_transport', httpClient)

    await expect(client.subscriptions.list({ limit: 1 })).rejects.toMatchObject({
      type: 'StripeConnectionError'
    })
    expect(observedTimeouts).toEqual([10_000, 10_000])
  })

  it('fails closed on module state and caches only the ready production client', () => {
    const ready = stripeRuntimeConfig()
    const disabled = stripeRuntimeConfig({ enabled: false })
    const missingWebhookSecret = stripeRuntimeConfig({ webhookSecret: '' })

    resetStripeClientForTests()
    expect(() => getStripeClient(disabled)).toThrow()
    expect(() => getStripeWebhookSecret(disabled)).toThrow()
    expect(() => getStripeWebhookSecret(missingWebhookSecret)).toThrow('Stripe webhook secret is not configured')
    expect(getStripeWebhookSecret(ready)).toBe('whsec_support')

    const first = getStripeClient(ready)
    const cached = getStripeClient(stripeRuntimeConfig({ secretKey: 'sk_test_other' }))
    expect(cached).toBe(first)

    resetStripeClientForTests()
    expect(getStripeClient(ready)).not.toBe(first)
  })

  it('returns detached customer correlation only when it is unambiguous', () => {
    const fixture = createWorkspaceInvitationFixture()

    try {
      expect(getDetachedStripeBillingSubject(fixture.connection, {})).toBeNull()
      expect(
        getDetachedStripeBillingSubject(fixture.connection, {
          stripeCustomerId: 'cus_missing'
        })
      ).toBeNull()

      insertDetachedSubject(fixture, 'detached_one', 'subscription:one', 'cus_shared')
      expect(
        getDetachedStripeBillingSubject(fixture.connection, {
          providerReference: 'subscription:one'
        })
      ).toMatchObject({ id: 'detached_one' })
      expect(
        getDetachedStripeBillingSubject(fixture.connection, {
          stripeCustomerId: 'cus_shared'
        })
      ).toMatchObject({ id: 'detached_one' })

      insertDetachedSubject(fixture, 'detached_two', 'subscription:two', 'cus_shared')
      expect(
        getDetachedStripeBillingSubject(fixture.connection, {
          stripeCustomerId: 'cus_shared'
        })
      ).toBeNull()
      expect(listDetachedStripeBillingSubjectsForCustomer(fixture.connection, 'cus_shared')).toHaveLength(2)
      expect(getBillingCustomerById(fixture.connection, 'billing_customer_missing')).toBeNull()
      expect(updateCheckoutAttempt(fixture.connection, 'billing_attempt_missing', { state: 'failed' })).toBeNull()
    } finally {
      fixture.cleanup()
    }
  })

  it('retains customer-only continuity when deletion has no subscription or open Checkout', async () => {
    const fixture = createWorkspaceInvitationFixture()
    const owner = await fixture.signIn('billing-customer-only@example.test', 'Customer Only')

    try {
      fixture.sqlite
        .prepare(
          `insert into billing_customers (
            id, organization_id, stripe_customer_id, created_at, updated_at
          ) values (?, ?, ?, ?, ?)`
        )
        .run(
          'billing_customer_only',
          owner.workspace.id,
          'cus_customer_only',
          '2026-07-01T00:00:00.000Z',
          '2026-07-02T00:00:00.000Z'
        )
      const billingProof = await prepareBillingAccountDeletionForConnection(
        fixture.connection,
        owner.user.id,
        noLiveSubscriptionsClient
      )

      expect(
        deleteAccountAtomically(fixture.connection, owner.user, {
          billingProof,
          deletedAt: '2026-07-13T00:00:00.000Z'
        })
      ).toEqual({ status: 'deleted', detachedBillingSubjects: 1, deletedFiles: 0 })
      expect(fixture.sqlite.prepare('select * from detached_billing_subjects').get()).toMatchObject({
        provider_reference: 'customer:cus_customer_only',
        provider_customer_reference: 'cus_customer_only',
        provider_status: 'customer_retained',
        status_updated_at: '2026-07-02T00:00:00.000Z',
        deleted_at: '2026-07-13T00:00:00.000Z'
      })
    } finally {
      fixture.cleanup()
    }
  })

  it('rejects unauthorized, unsupported, and unreconciled billing commands before Stripe I/O', async () => {
    const fixture = createWorkspaceInvitationFixture()
    const owner = await fixture.signIn('billing-command-guard@example.test', 'Command Guard')
    const provider = {} as StripeBillingClient
    const context = billingContext(fixture, provider)

    try {
      expect(() => getBillingStateForConnection(fixture.connection, 'missing_user')).toThrow(
        'Billing is temporarily unavailable'
      )
      await expect(
        createFamilyPlanCheckoutForConnection(context, owner.user.id, {
          plan: 'unsupported'
        } as never)
      ).rejects.toMatchObject({ statusCode: 403 })
      await expect(createFamilyPlanPortalForConnection(context, owner.user.id)).rejects.toMatchObject({
        statusCode: 409
      })
      await expect(createFamilyPlanPortalForConnection(context, 'missing_user')).rejects.toMatchObject({
        statusCode: 403
      })

      seedCustomer(fixture, owner.workspace.id, 'billing_customer_guard', 'cus_guard')
      await expect(
        createFamilyPlanCheckoutForConnection(context, owner.user.id, { plan: 'family' })
      ).rejects.toMatchObject({ statusCode: 409 })
    } finally {
      fixture.cleanup()
    }
  })

  it('reuses an established Customer only after an unambiguous empty provider projection', async () => {
    const fixture = createWorkspaceInvitationFixture()
    const owner = await fixture.signIn('billing-known-customer@example.test', 'Known Customer')
    seedCustomer(fixture, owner.workspace.id, 'billing_customer_known', 'cus_known')
    seedEmptyProjection(fixture, owner.workspace.id, 'billing_customer_known')
    const checkoutCreate = vi.fn(
      async (input: Stripe.Checkout.SessionCreateParams): Promise<Stripe.Checkout.Session> =>
        ({
          id: 'cs_known',
          object: 'checkout.session',
          mode: 'subscription',
          status: 'open',
          customer: 'cus_known',
          client_reference_id: input.client_reference_id,
          metadata: { billing_attempt_id: input.client_reference_id ?? '' },
          line_items: {
            object: 'list',
            data: [
              {
                id: 'li_known',
                object: 'item',
                price: { id: 'price_family_monthly_support', object: 'price' },
                quantity: 1
              } as Stripe.LineItem
            ],
            has_more: false,
            url: '/v1/checkout/sessions/cs_known/line_items'
          },
          expires_at: 1_784_073_600,
          url: 'https://checkout.stripe.test/session/cs_known'
        }) as Stripe.Checkout.Session
    )
    const provider = {
      checkout: { sessions: { create: checkoutCreate } }
    } as unknown as StripeBillingClient

    try {
      await expect(
        createFamilyPlanCheckoutForConnection(
          billingContext(fixture, provider),
          owner.user.id,
          { plan: 'family' },
          new Date('2026-07-13T00:00:00.000Z')
        )
      ).resolves.toEqual({ url: 'https://checkout.stripe.test/session/cs_known' })
      expect(checkoutCreate).toHaveBeenCalledWith(
        expect.objectContaining({ customer: 'cus_known' }),
        expect.objectContaining({ idempotencyKey: expect.any(String) })
      )
    } finally {
      fixture.cleanup()
    }
  })

  it('fails Portal and reconciliation safely when provider state is unusable or unavailable', async () => {
    const fixture = createWorkspaceInvitationFixture()
    const owner = await fixture.signIn('billing-provider-failure@example.test', 'Provider Failure')
    seedCustomer(fixture, owner.workspace.id, 'billing_customer_failure', 'cus_failure')
    seedEmptyProjection(fixture, owner.workspace.id, 'billing_customer_failure')

    try {
      const unsafePortal = {
        billingPortal: {
          sessions: {
            create: vi.fn(async () => ({ url: 'http://billing.invalid/session' }))
          }
        }
      } as unknown as StripeBillingClient
      await expect(
        createFamilyPlanPortalForConnection(billingContext(fixture, unsafePortal), owner.user.id)
      ).rejects.toMatchObject({ statusCode: 403 })

      const failedPortal = {
        billingPortal: {
          sessions: {
            create: vi.fn(async () => {
              throw new Error('private provider failure')
            })
          }
        }
      } as unknown as StripeBillingClient
      await expect(
        createFamilyPlanPortalForConnection(billingContext(fixture, failedPortal), owner.user.id)
      ).rejects.toMatchObject({ statusCode: 502 })

      const failedProjection = {
        subscriptions: {
          list: vi.fn(async () => {
            throw new Error('private provider failure')
          })
        }
      } as unknown as StripeBillingClient
      await expect(
        reconcileFamilyPlanBillingForConnection(billingContext(fixture, failedProjection), owner.user.id)
      ).rejects.toMatchObject({ statusCode: 502 })

      const billingProof = await prepareBillingAccountDeletionForConnection(
        fixture.connection,
        owner.user.id,
        noLiveSubscriptionsClient
      )
      const createRevokedPortal = vi.fn(async () => {
        deleteAccountAtomically(fixture.connection, owner.user, { billingProof })
        return { url: 'https://billing.stripe.test/session/revoked' }
      })
      const revokedPortal = {
        billingPortal: {
          sessions: {
            create: createRevokedPortal
          }
        }
      } as unknown as StripeBillingClient
      await expect(
        createFamilyPlanPortalForConnection(billingContext(fixture, revokedPortal), owner.user.id)
      ).rejects.toMatchObject({ statusCode: 409 })
      expect(createRevokedPortal).not.toHaveBeenCalled()
    } finally {
      fixture.cleanup()
    }
  })

  it('refuses checkout-attempt transitions after state or owner authority changes', async () => {
    const fixture = createWorkspaceInvitationFixture()
    const owner = await fixture.signIn('billing-transition@example.test', 'Transition Guard')

    try {
      seedCheckoutAttempt(fixture, owner.workspace.id, 'billing_attempt_transition')
      const expected = getCheckoutAttemptById(fixture.connection, 'billing_attempt_transition')!
      fixture.sqlite.prepare("update billing_checkout_attempts set state = 'completed' where id = ?").run(expected.id)

      expect(
        transitionCheckoutAttempt(fixture.connection, owner.user.id, expected, mutableAttemptStates, {
          state: 'failed'
        })
      ).toBe('state_changed')
      expect(
        transitionCheckoutAttempt(fixture.connection, 'missing_user', expected, mutableAttemptStates, {
          state: 'failed'
        })
      ).toBe('authority_lost')
    } finally {
      fixture.cleanup()
    }
  })
})

function noLiveSubscriptionsClient() {
  return {
    subscriptions: {
      list: vi.fn(async () => ({
        object: 'list',
        data: [],
        has_more: false,
        url: '/v1/subscriptions'
      }))
    }
  } as unknown as Pick<StripeBillingClient, 'subscriptions'>
}

function stripeRuntimeConfig(
  overrides: Readonly<{
    enabled?: boolean
    secretKey?: string
    webhookSecret?: string
  }> = {}
): AppRuntimeConfig {
  return {
    modules: { billing: { enabled: overrides.enabled ?? true } },
    stripe: {
      secretKey: overrides.secretKey ?? 'sk_test_support',
      webhookSecret: overrides.webhookSecret ?? 'whsec_support',
      portalConfigurationId: 'bpc_support',
      personalWeeklyPriceId: 'price_personal_weekly_support',
      personalMonthlyPriceId: 'price_personal_monthly_support',
      personalAnnualPriceId: 'price_personal_annual_support',
      familyMonthlyPriceId: 'price_family_monthly_support',
      familyAnnualPriceId: 'price_family_annual_support'
    }
  } as unknown as AppRuntimeConfig
}

function insertDetachedSubject(
  fixture: ReturnType<typeof createWorkspaceInvitationFixture>,
  id: string,
  providerReference: string,
  stripeCustomerId: string
) {
  fixture.sqlite
    .prepare(
      `insert into detached_billing_subjects (
        id, provider, provider_reference, provider_customer_reference, provider_status,
        status_updated_at, deleted_at, retention_purpose, retention_policy
      ) values (?, 'stripe', ?, ?, 'active', ?, ?, ?, ?)`
    )
    .run(
      id,
      providerReference,
      stripeCustomerId,
      '2026-07-01T00:00:00.000Z',
      '2026-07-01T00:00:00.000Z',
      'external_billing_reconciliation',
      'stripe_billing_lifecycle'
    )
}

function billingContext(
  fixture: ReturnType<typeof createWorkspaceInvitationFixture>,
  client: StripeBillingClient
): BillingServiceContext {
  return {
    connection: fixture.connection,
    client,
    config: {
      ...stripeRuntimeConfig(),
      public: { appUrl: 'https://app.example.test' }
    } as AppRuntimeConfig
  }
}

function seedCustomer(
  fixture: ReturnType<typeof createWorkspaceInvitationFixture>,
  organizationId: string,
  id: string,
  stripeCustomerId: string
) {
  const now = '2026-07-13T00:00:00.000Z'
  fixture.sqlite
    .prepare(
      `insert into billing_customers (
        id, organization_id, stripe_customer_id, created_at, updated_at
      ) values (?, ?, ?, ?, ?)`
    )
    .run(id, organizationId, stripeCustomerId, now, now)
}

function seedEmptyProjection(
  fixture: ReturnType<typeof createWorkspaceInvitationFixture>,
  organizationId: string,
  billingCustomerId: string
) {
  const now = '2026-07-13T00:00:00.000Z'
  fixture.sqlite
    .prepare(
      `insert into billing_subscriptions (
        id, organization_id, billing_customer_id, status, projection_order_ms,
        reconciliation_required, created_at, updated_at
      ) values (?, ?, ?, 'none', 0, 0, ?, ?)`
    )
    .run(`billing_subscription_${billingCustomerId}`, organizationId, billingCustomerId, now, now)
}

function seedCheckoutAttempt(
  fixture: ReturnType<typeof createWorkspaceInvitationFixture>,
  organizationId: string,
  id: string
) {
  fixture.sqlite
    .prepare(
      `insert into billing_checkout_attempts (
        id, organization_id, plan_key, cadence, stripe_price_id, idempotency_key, state,
        success_url, cancel_url, reuse_until, created_at, updated_at
      ) values (?, ?, 'family', 'monthly', 'price_family_monthly_support', ?, 'pending', ?, ?, ?, ?, ?)`
    )
    .run(
      id,
      organizationId,
      `checkout_${id}`,
      'https://app.example.test/account/billing?checkout=success',
      'https://app.example.test/account/billing?checkout=cancelled',
      '2026-07-14T00:00:00.000Z',
      '2026-07-13T00:00:00.000Z',
      '2026-07-13T00:00:00.000Z'
    )
}
