import { describe, expect, it } from 'vitest'
import {
  billingGracePeriodMs,
  evaluateStripeSubscriptionAccess,
  graceWindowFromFirstFailure
} from '../../server/services/payments/stripe/dunning'

describe('Stripe subscription dunning', () => {
  const now = new Date('2026-07-28T12:00:00.000Z')

  it('grants active subscriptions and denies verified terminal subscriptions', () => {
    expect(
      evaluateStripeSubscriptionAccess(
        {
          status: 'active',
          reconciliationRequired: false,
          graceInvoiceId: null,
          graceStartedAt: null,
          graceEndsAt: null
        },
        now
      )
    ).toEqual({
      state: 'active',
      granted: true,
      graceDeadline: null,
      reconciliationReason: null
    })

    for (const status of ['canceled', 'incomplete_expired'] as const) {
      expect(
        evaluateStripeSubscriptionAccess(
          {
            status,
            reconciliationRequired: false,
            graceInvoiceId: null,
            graceStartedAt: null,
            graceEndsAt: null
          },
          now
        )
      ).toEqual({
        state: 'terminal',
        granted: false,
        graceDeadline: null,
        reconciliationReason: null
      })
    }
  })

  it('grants a nonrenewing active subscription only before its verified paid-through date', () => {
    const paidThrough = '2026-07-28T12:00:00.000Z'
    const snapshot = {
      status: 'active' as const,
      reconciliationRequired: false,
      cancelAtPeriodEnd: true,
      currentPeriodEnd: paidThrough,
      graceInvoiceId: null,
      graceStartedAt: null,
      graceEndsAt: null
    }

    expect(evaluateStripeSubscriptionAccess(snapshot, new Date('2026-07-28T11:59:59.999Z'))).toMatchObject({
      state: 'active',
      granted: true
    })
    expect(evaluateStripeSubscriptionAccess(snapshot, new Date(paidThrough))).toEqual({
      state: 'reconciliation_required',
      granted: false,
      graceDeadline: null,
      reconciliationReason: 'nonrenewing_period_ended'
    })
  })

  it('anchors a grace window to the authenticated first-failure event time', () => {
    const firstFailure = new Date('2026-07-14T12:00:00.000Z')

    expect(graceWindowFromFirstFailure(firstFailure)).toEqual({
      startedAt: firstFailure.toISOString(),
      endsAt: new Date(firstFailure.getTime() + billingGracePeriodMs).toISOString()
    })
  })

  it('grants past-due access only before the validated 60-day deadline', () => {
    const graceStartedAt = '2026-05-29T12:00:00.000Z'
    const graceEndsAt = '2026-07-28T12:00:00.000Z'
    const snapshot = {
      status: 'past_due' as const,
      reconciliationRequired: false,
      graceInvoiceId: 'in_renewal',
      graceStartedAt,
      graceEndsAt
    }

    expect(evaluateStripeSubscriptionAccess(snapshot, new Date('2026-07-28T11:59:59.999Z'))).toEqual({
      state: 'grace',
      granted: true,
      graceDeadline: graceEndsAt,
      reconciliationReason: null
    })
    expect(evaluateStripeSubscriptionAccess(snapshot, new Date(graceEndsAt))).toEqual({
      state: 'suspended',
      granted: false,
      graceDeadline: graceEndsAt,
      reconciliationReason: null
    })
  })

  it('fails closed when delinquency lacks a trustworthy bounded anchor', () => {
    for (const snapshot of [
      {
        status: 'past_due' as const,
        reconciliationRequired: false,
        graceInvoiceId: null,
        graceStartedAt: null,
        graceEndsAt: null
      },
      {
        status: 'past_due' as const,
        reconciliationRequired: false,
        graceInvoiceId: 'in_renewal',
        graceStartedAt: 'not-a-date',
        graceEndsAt: '2026-07-28T12:00:00.000Z'
      },
      {
        status: 'past_due' as const,
        reconciliationRequired: false,
        graceInvoiceId: 'in_renewal',
        graceStartedAt: '2026-05-29T12:00:00.000Z',
        graceEndsAt: '2026-07-28T12:00:00.001Z'
      }
    ]) {
      expect(evaluateStripeSubscriptionAccess(snapshot, now)).toEqual({
        state: 'reconciliation_required',
        granted: false,
        graceDeadline: null,
        reconciliationReason: 'missing_or_invalid_grace_anchor'
      })
    }
  })

  it('fails closed on unsupported states, unanchored unpaid state, and explicit reconciliation', () => {
    for (const status of ['trialing', 'paused', 'incomplete'] as const) {
      expect(
        evaluateStripeSubscriptionAccess(
          {
            status,
            reconciliationRequired: false,
            graceInvoiceId: null,
            graceStartedAt: null,
            graceEndsAt: null
          },
          now
        )
      ).toEqual({
        state: 'reconciliation_required',
        granted: false,
        graceDeadline: null,
        reconciliationReason: `unsupported_subscription_status:${status}`
      })
    }

    expect(
      evaluateStripeSubscriptionAccess(
        {
          status: 'unpaid',
          reconciliationRequired: false,
          graceInvoiceId: null,
          graceStartedAt: null,
          graceEndsAt: null
        },
        now
      )
    ).toEqual({
      state: 'reconciliation_required',
      granted: false,
      graceDeadline: null,
      reconciliationReason: 'missing_or_invalid_grace_anchor'
    })

    expect(
      evaluateStripeSubscriptionAccess(
        {
          status: 'active',
          reconciliationRequired: true,
          graceInvoiceId: null,
          graceStartedAt: null,
          graceEndsAt: null
        },
        now
      )
    ).toEqual({
      state: 'reconciliation_required',
      granted: false,
      graceDeadline: null,
      reconciliationReason: 'provider_projection_ambiguous'
    })
  })

  it('treats an empty projection as no subscription', () => {
    expect(
      evaluateStripeSubscriptionAccess(
        {
          status: 'none',
          reconciliationRequired: false,
          graceInvoiceId: null,
          graceStartedAt: null,
          graceEndsAt: null
        },
        now
      )
    ).toEqual({
      state: 'none',
      granted: false,
      graceDeadline: null,
      reconciliationReason: null
    })
  })
})
