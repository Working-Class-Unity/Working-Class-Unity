import { afterEach, describe, expect, it } from 'vitest'
import type {
  BillingStripeConnection,
  BillingStripeIntegration,
  BillingStripeSynchronizationRequest
} from '../../server/services/payments/stripe/public-contract'
import { readBillingStripePurchaserState } from '../../server/services/payments/stripe/purchaser-state'
import {
  commitBillingProjection,
  type BillingProjectionCommit
} from '../../server/services/payments/stripe/state-store'
import {
  createBillingStripeRuntimeFixture,
  seedBillingCustomer,
  seedBillingSubscription,
  type BillingStripeRuntimeFixture
} from './runtime-fixture'

const openFixtures: BillingStripeRuntimeFixture[] = []
const now = new Date('2026-07-15T12:00:00.000Z')

afterEach(() => {
  for (const fixture of openFixtures.splice(0)) fixture.sqlite.close()
})

describe('Billing Stripe application callback boundary', () => {
  it('projects the purchaser state synchronously inside the same read transaction', () => {
    const fixture = runtimeFixture()
    let callbackInTransaction = false
    const integration = integrationWith({
      project(connection, purchaserUserId, base) {
        callbackInTransaction = connection.sqlite.inTransaction
        return { purchaserUserId, base, applicationState: 'coherent' as const }
      }
    })

    const state = readBillingStripePurchaserState(fixture.connection, fixture.purchaserUserId, integration, now)

    expect(callbackInTransaction).toBe(true)
    expect(state).toMatchObject({
      purchaserUserId: fixture.purchaserUserId,
      applicationState: 'coherent',
      base: { subscription: { state: 'none' } }
    })
  })

  it('rejects an asynchronous purchaser-state projection', () => {
    const fixture = runtimeFixture()
    const integration = integrationWith({
      project: (() => Promise.resolve({ escaped: true })) as never
    })

    expect(() =>
      readBillingStripePurchaserState(fixture.connection, fixture.purchaserUserId, integration, now)
    ).toThrow('Billing Stripe purchaser-state projection must complete synchronously')
  })

  it('fails a malformed non-none subscription closed in purchaser state', () => {
    const fixture = runtimeFixture('purchaser_malformed_active')
    seedBillingCustomer(fixture)
    seedBillingSubscription(fixture, { stripeSubscriptionId: null })

    expect(readBillingStripePurchaserState(fixture.connection, fixture.purchaserUserId, undefined, now)).toMatchObject({
      subscription: { state: 'reconciliation_required' },
      capabilities: { canChange: false, canManage: false }
    })
  })

  it('hashes provider-derived lifecycle identity and omits the grace invoice reference', () => {
    const fixture = seededActiveFixture()
    const requests: BillingStripeSynchronizationRequest[] = []
    const integration = integrationWith({ synchronizationRequests: requests })

    const result = commitBillingProjection(fixture.connection, integration, {
      purchaserUserId: fixture.purchaserUserId,
      stripeCustomerId: 'cus_test',
      expectedRevision: 0,
      projection: projection({
        status: 'past_due',
        graceInvoiceId: 'in_private_grace',
        graceStartedAt: '2026-07-15T12:00:00.000Z',
        graceEndsAt: '2026-07-29T12:00:00.000Z'
      }),
      cause: 'webhook',
      verifiedAt: now
    })

    expect(result.outcome).toBe('applied')
    const request = requests.at(-1)
    expect(request).toMatchObject({
      kind: 'state_committed',
      after: { paymentGraceActive: true },
      effects: [
        {
          action: 'payment_grace_started',
          episodeKey: expect.stringMatching(/^billing_episode_[a-f0-9]{64}$/)
        }
      ]
    })
    const serialized = JSON.stringify(request)
    expect(serialized).not.toContain('in_private_grace')
    expect(serialized).not.toMatch(/(?:evt|in|sub|cus|cs|sched)_/)
  })

  it.each([
    [
      'active reconciliation',
      projection({
        cancelAtPeriodEnd: true,
        reconciliationRequired: true,
        reconciliationReason: 'ambiguous_provider_projection'
      })
    ],
    ['non-active renewal', projection({ status: 'past_due', cancelAtPeriodEnd: true })]
  ])('does not emit a renewal edge for %s', (_label, nextProjection) => {
    const fixture = seededActiveFixture()
    const requests: BillingStripeSynchronizationRequest[] = []

    commitBillingProjection(fixture.connection, integrationWith({ synchronizationRequests: requests }), {
      purchaserUserId: fixture.purchaserUserId,
      stripeCustomerId: 'cus_test',
      expectedRevision: 0,
      projection: nextProjection,
      cause: 'reconciliation_safety',
      verifiedAt: now
    })

    expect(lastEffects(requests)).toEqual([])
  })

  it('emits normalized renewal and terminal coverage edges only from confirmed states', () => {
    const renewalFixture = seededActiveFixture()
    const renewalRequests: BillingStripeSynchronizationRequest[] = []
    commitBillingProjection(renewalFixture.connection, integrationWith({ synchronizationRequests: renewalRequests }), {
      purchaserUserId: renewalFixture.purchaserUserId,
      stripeCustomerId: 'cus_test',
      expectedRevision: 0,
      projection: projection({ cancelAtPeriodEnd: true }),
      cause: 'reconciliation_safety',
      verifiedAt: now
    })
    expect(lastEffects(renewalRequests)).toEqual([
      expect.objectContaining({
        action: 'renewal_ending',
        episodeKey: expect.stringMatching(/^billing_episode_[a-f0-9]{64}$/)
      })
    ])

    const terminalFixture = seededActiveFixture('terminal')
    const terminalRequests: BillingStripeSynchronizationRequest[] = []
    commitBillingProjection(
      terminalFixture.connection,
      integrationWith({ synchronizationRequests: terminalRequests }),
      {
        purchaserUserId: terminalFixture.purchaserUserId,
        stripeCustomerId: 'cus_test',
        expectedRevision: 0,
        projection: projection({
          status: 'canceled',
          planKey: null,
          cadence: null,
          stripePriceId: null,
          currentPeriodStart: null,
          currentPeriodEnd: null,
          cancelAtPeriodEnd: false
        }),
        cause: 'reconciliation_safety',
        verifiedAt: now
      }
    )
    expect(lastEffects(terminalRequests)).toEqual([expect.objectContaining({ action: 'coverage_ended' })])
  })

  it('rolls back when synchronization returns a thenable', () => {
    const fixture = seededActiveFixture()
    const integration = integrationWith({
      synchronize: (() => Promise.resolve()) as never
    })

    expect(() =>
      commitBillingProjection(fixture.connection, integration, {
        purchaserUserId: fixture.purchaserUserId,
        stripeCustomerId: 'cus_test',
        expectedRevision: 0,
        projection: projection({ cancelAtPeriodEnd: true }),
        cause: 'webhook',
        verifiedAt: now
      })
    ).toThrow('Billing Stripe synchronization callback must complete synchronously')
    expect(
      fixture.sqlite
        .prepare('select revision, cancel_at_period_end as cancelAtPeriodEnd from billing_subscriptions')
        .get()
    ).toEqual({ revision: 0, cancelAtPeriodEnd: 0 })
  })

  it('suppresses supplied effects and package notification when application authority requires reconciliation', () => {
    const fixture = seededActiveFixture('authority_conflict')
    const requests: BillingStripeSynchronizationRequest[] = []
    const result = commitBillingProjection(
      fixture.connection,
      integrationWith({
        authorize: 'reconciliation_required',
        synchronizationRequests: requests
      }),
      {
        purchaserUserId: fixture.purchaserUserId,
        stripeCustomerId: 'cus_test',
        expectedRevision: 0,
        projection: projection({ status: 'past_due' }),
        cause: 'webhook',
        verifiedAt: now,
        effects: [
          {
            action: 'payment_grace_started',
            episodeKey: 'in_private_supplied',
            effectiveAt: now.toISOString(),
            transitionId: null
          }
        ]
      }
    )

    expect(result).toMatchObject({
      outcome: 'applied',
      snapshot: { reconciliationRequired: true }
    })
    expect(lastEffects(requests)).toEqual([])
    expect(
      (
        fixture.sqlite
          .prepare(`select count(*) as count from job_queue where type = 'billing.notification-delivery'`)
          .get() as { count: number }
      ).count
    ).toBe(0)
  })

  it.each(['authority_lost', 'state_changed'] as const)(
    'commits a known live purchaser fail-closed when application projection returns %s',
    (authorize) => {
      const fixture = seededActiveFixture(`known_${authorize}`)
      const requests: BillingStripeSynchronizationRequest[] = []
      const result = commitBillingProjection(
        fixture.connection,
        integrationWith({
          authorize,
          synchronizationRequests: requests
        }),
        {
          purchaserUserId: fixture.purchaserUserId,
          stripeCustomerId: 'cus_test',
          expectedRevision: 0,
          projection: projection(),
          cause: 'webhook',
          verifiedAt: now,
          effects: [
            {
              action: 'payment_attention',
              episodeKey: 'in_private_attention',
              effectiveAt: null,
              transitionId: null
            }
          ]
        }
      )

      expect(result).toMatchObject({
        outcome: 'applied',
        snapshot: { reconciliationRequired: true }
      })
      expect(lastEffects(requests)).toEqual([])
      expect(
        fixture.sqlite
          .prepare(
            `select reconciliation_required as reconciliationRequired,
                reconciliation_reason as reconciliationReason from billing_subscriptions`
          )
          .get()
      ).toEqual({
        reconciliationRequired: 1,
        reconciliationReason: 'integration_authority_conflict'
      })
    }
  )

  it('keeps an existing customer with a newly observed subscription live but fail-closed on app authority loss', () => {
    const fixture = runtimeFixture('purchaser_new_subscription_authority')
    seedBillingCustomer(fixture)
    const result = commitBillingProjection(fixture.connection, integrationWith({ authorize: 'authority_lost' }), {
      purchaserUserId: fixture.purchaserUserId,
      stripeCustomerId: 'cus_test',
      expectedRevision: 0,
      projection: projection(),
      cause: 'webhook',
      verifiedAt: now
    })

    expect(result).toMatchObject({
      outcome: 'applied',
      snapshot: { reconciliationRequired: true }
    })
    expect(
      fixture.sqlite
        .prepare(
          `select status, reconciliation_required as reconciliationRequired,
              reconciliation_reason as reconciliationReason from billing_subscriptions`
        )
        .get()
    ).toEqual({
      status: 'active',
      reconciliationRequired: 1,
      reconciliationReason: 'integration_authority_conflict'
    })
  })
})

function runtimeFixture(purchaserUserId?: string): BillingStripeRuntimeFixture {
  const fixture = createBillingStripeRuntimeFixture(purchaserUserId)
  openFixtures.push(fixture)
  return fixture
}

function seededActiveFixture(suffix = ''): BillingStripeRuntimeFixture {
  const fixture = runtimeFixture(`purchaser_state${suffix}`)
  seedBillingCustomer(fixture)
  seedBillingSubscription(fixture)
  return fixture
}

function integrationWith<TProjectedState = unknown>(
  input: Readonly<{
    synchronizationRequests?: BillingStripeSynchronizationRequest[]
    authorize?: 'authorized' | 'authority_lost' | 'state_changed' | 'reconciliation_required'
    synchronize?: BillingStripeIntegration['synchronizePurchaserBilling']
    project?: BillingStripeIntegration<BillingStripeConnection, TProjectedState>['projectPurchaserState']
  }> = {}
): BillingStripeIntegration<BillingStripeConnection, TProjectedState> {
  return {
    authorizePurchaserBilling() {
      return input.authorize ?? 'authorized'
    },
    synchronizePurchaserBilling(connection, request) {
      if (input.synchronize) return input.synchronize(connection, request)
      input.synchronizationRequests?.push(request)
      return undefined
    },
    ...(input.project ? { projectPurchaserState: input.project } : {})
  }
}

function projection(overrides: Partial<BillingProjectionCommit> = {}): BillingProjectionCommit {
  return {
    stripeSubscriptionId: 'sub_test',
    stripeSubscriptionItemId: 'si_test',
    status: 'active' as const,
    planKey: 'family' as const,
    cadence: 'monthly' as const,
    stripePriceId: 'price_family_monthly',
    currentPeriodStart: '2026-07-01T00:00:00.000Z',
    currentPeriodEnd: '2026-08-01T00:00:00.000Z',
    cancelAtPeriodEnd: false,
    reconciliationRequired: false,
    reconciliationReason: null,
    ...overrides
  }
}

function lastEffects(requests: BillingStripeSynchronizationRequest[]) {
  const request = requests.at(-1)
  if (!request || request.kind !== 'state_committed') throw new Error('Missing state-commit request')
  return request.effects
}
