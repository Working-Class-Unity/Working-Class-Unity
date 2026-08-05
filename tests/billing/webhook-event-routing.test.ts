import type Stripe from 'stripe'
import { describe, expect, it, vi } from 'vitest'
import type { BillingStripeRuntimeConfiguration } from '../../server/services/payments/stripe/configuration'
import {
  isStripeWebhookEventType,
  stripeWebhookEventTypes,
  type StripeWebhookEventType
} from '../../server/services/payments/stripe/webhook-reference'
import { observeStripeWebhookCurrentState } from '../../server/services/payments/stripe/webhook-state'
import type { StripeBillingClient } from '../../server/services/payments/stripe/stripe-client'

const expectedWebhookEventTypes = [
  'checkout.session.completed',
  'checkout.session.expired',
  'checkout.session.async_payment_succeeded',
  'checkout.session.async_payment_failed',
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted',
  'customer.subscription.pending_update_applied',
  'customer.subscription.pending_update_expired',
  'subscription_schedule.created',
  'subscription_schedule.updated',
  'subscription_schedule.completed',
  'subscription_schedule.canceled',
  'subscription_schedule.released',
  'subscription_schedule.aborted',
  'invoice.paid',
  'invoice.payment_failed',
  'invoice.payment_action_required',
  'refund.created',
  'charge.dispute.created',
  'charge.dispute.closed'
] as const satisfies readonly Stripe.Event.Type[]

const liveSubscriptionReads = [
  'subscriptions.list:cus_current:active',
  'subscriptions.list:cus_current:incomplete',
  'subscriptions.list:cus_current:trialing',
  'subscriptions.list:cus_current:paused',
  'subscriptions.list:cus_current:past_due',
  'subscriptions.list:cus_current:unpaid',
  'subscriptions.list:cus_current:active',
  'subscriptions.retrieve:sub_current:exact'
]

const routingCases = [
  ...[
    'customer.subscription.deleted',
    'customer.subscription.pending_update_applied',
    'customer.subscription.pending_update_expired'
  ].map((eventType) => ({
    eventType: eventType as StripeWebhookEventType,
    objectId: 'sub_current',
    providerKind: 'subscription' as const,
    reads: [
      'subscriptions.retrieve:sub_current:expanded',
      'subscriptions.retrieve:sub_current:expanded',
      ...liveSubscriptionReads
    ]
  })),
  ...[
    'subscription_schedule.created',
    'subscription_schedule.updated',
    'subscription_schedule.completed',
    'subscription_schedule.canceled',
    'subscription_schedule.released',
    'subscription_schedule.aborted'
  ].map((eventType) => ({
    eventType: eventType as StripeWebhookEventType,
    objectId: 'sub_sched_current',
    providerKind: 'schedule' as const,
    reads: [
      'subscriptionSchedules.retrieve:sub_sched_current',
      'subscriptions.retrieve:sub_current:expanded',
      ...liveSubscriptionReads
    ]
  })),
  {
    eventType: 'invoice.payment_action_required' as const,
    objectId: 'in_current',
    providerKind: 'invoice' as const,
    reads: ['invoices.retrieve:in_current', 'subscriptions.retrieve:sub_current:expanded', ...liveSubscriptionReads]
  },
  {
    eventType: 'charge.dispute.closed' as const,
    objectId: 'dp_current',
    providerKind: 'financial_risk' as const,
    reads: [
      'disputes.retrieve:dp_current',
      'charges.retrieve:ch_current',
      'invoicePayments.list:pi_current',
      'invoices.retrieve:in_current',
      'subscriptions.retrieve:sub_current:expanded',
      ...liveSubscriptionReads
    ]
  }
]

describe('Stripe webhook event routing contract', () => {
  it('matches the documented 21-event allowlist exactly', () => {
    expect(stripeWebhookEventTypes).toEqual(expectedWebhookEventTypes)
    expect(new Set(stripeWebhookEventTypes).size).toBe(21)
    expect(Object.isFrozen(stripeWebhookEventTypes)).toBe(true)
    expect(isStripeWebhookEventType('charge.refunded')).toBe(false)
    expect(isStripeWebhookEventType('invoice.updated')).toBe(false)
  })

  it.each(routingCases)(
    'treats $eventType only as a trigger for current $providerKind provider reads',
    async ({ eventType, objectId, providerKind, reads }) => {
      const provider = currentProvider()
      const observation = await observeStripeWebhookCurrentState(provider.client, configuration, {
        eventId: `evt_${eventType.replaceAll('.', '_')}`,
        eventType,
        eventCreatedAt: 1_785_000_000,
        objectId
      })

      expect(observation.providerState.kind).toBe(providerKind)
      expect(observation.projection).toMatchObject({
        cadence: 'monthly',
        planKey: 'family',
        reconciliationRequired: false,
        status: 'active',
        stripeSubscriptionId: 'sub_current'
      })
      expect(provider.reads).toEqual(reads)
    }
  )
})

function currentProvider(): Readonly<{ client: StripeBillingClient; reads: string[] }> {
  const reads: string[] = []
  const subscription = currentSubscription()
  const schedule = {
    id: 'sub_sched_current',
    object: 'subscription_schedule',
    customer: 'cus_current',
    subscription: subscription.id,
    released_subscription: null,
    status: 'active'
  } as Stripe.SubscriptionSchedule
  const invoice = {
    id: 'in_current',
    object: 'invoice',
    customer: 'cus_current',
    status: 'open',
    parent: {
      type: 'subscription_details',
      quote_details: null,
      subscription_details: { metadata: null, subscription: subscription.id }
    }
  } as Stripe.Invoice
  const dispute = {
    id: 'dp_current',
    object: 'dispute',
    status: 'won',
    charge: 'ch_current',
    payment_intent: 'pi_current'
  } as Stripe.Dispute
  const charge = {
    id: 'ch_current',
    object: 'charge',
    customer: 'cus_current',
    payment_intent: 'pi_current'
  } as Stripe.Charge
  const invoicePayment = {
    id: 'ip_current',
    object: 'invoice_payment',
    invoice: invoice.id,
    payment: { type: 'payment_intent', payment_intent: 'pi_current' }
  } as Stripe.InvoicePayment

  const client = {
    subscriptions: {
      retrieve: vi.fn(async (id: string, parameters: unknown, options: unknown) => {
        expect(id).toBe(subscription.id)
        expect(options).toEqual(webhookReadOptions)
        if (parameters && typeof parameters === 'object' && 'expand' in parameters) {
          expect(parameters).toEqual({ expand: ['latest_invoice', 'schedule'] })
          reads.push(`subscriptions.retrieve:${id}:expanded`)
        } else {
          expect(parameters).toEqual({})
          reads.push(`subscriptions.retrieve:${id}:exact`)
        }
        return subscription
      }),
      list: vi.fn(async (parameters: Stripe.SubscriptionListParams, options: unknown) => {
        expect(parameters).toMatchObject({ customer: 'cus_current', limit: 2 })
        expect(options).toEqual(webhookReadOptions)
        reads.push(`subscriptions.list:${parameters.customer}:${parameters.status}`)
        return {
          object: 'list',
          data: parameters.status === subscription.status ? [subscription] : [],
          has_more: false,
          url: '/v1/subscriptions'
        } as Stripe.ApiList<Stripe.Subscription>
      })
    },
    subscriptionSchedules: {
      retrieve: vi.fn(async (id: string, parameters: unknown, options: unknown) => {
        expect(parameters).toEqual({})
        expect(options).toEqual(webhookReadOptions)
        reads.push(`subscriptionSchedules.retrieve:${id}`)
        return schedule
      })
    },
    invoices: {
      retrieve: vi.fn(async (id: string, parameters: unknown, options: unknown) => {
        expect(parameters).toEqual({})
        expect(options).toEqual(webhookReadOptions)
        reads.push(`invoices.retrieve:${id}`)
        return invoice
      })
    },
    disputes: {
      retrieve: vi.fn(async (id: string, parameters: unknown, options: unknown) => {
        expect(parameters).toEqual({})
        expect(options).toEqual(webhookReadOptions)
        reads.push(`disputes.retrieve:${id}`)
        return dispute
      })
    },
    charges: {
      retrieve: vi.fn(async (id: string, parameters: unknown, options: unknown) => {
        expect(parameters).toEqual({})
        expect(options).toEqual(webhookReadOptions)
        reads.push(`charges.retrieve:${id}`)
        return charge
      })
    },
    invoicePayments: {
      list: vi.fn(async (parameters: Stripe.InvoicePaymentListParams, options: unknown) => {
        expect(parameters).toEqual({
          payment: { payment_intent: 'pi_current', type: 'payment_intent' },
          limit: 100
        })
        expect(options).toEqual(webhookReadOptions)
        reads.push(`invoicePayments.list:${parameters.payment?.payment_intent}`)
        return {
          object: 'list',
          data: [invoicePayment],
          has_more: false,
          url: '/v1/invoice_payments'
        } as Stripe.ApiList<Stripe.InvoicePayment>
      })
    }
  } as unknown as StripeBillingClient
  return { client, reads }
}

function currentSubscription(): Stripe.Subscription {
  return {
    id: 'sub_current',
    object: 'subscription',
    customer: 'cus_current',
    status: 'active',
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
          id: 'si_current',
          object: 'subscription_item',
          current_period_start: 1_783_920_000,
          current_period_end: 1_786_512_000,
          quantity: 1,
          price: { id: 'price_family_monthly_webhook_routing', object: 'price' },
          discounts: []
        } as Stripe.SubscriptionItem
      ],
      has_more: false,
      url: '/v1/subscription_items?subscription=sub_current'
    }
  } as Stripe.Subscription
}

const webhookReadOptions = { timeout: 5_000, maxNetworkRetries: 0 } as const
const configuration = {
  enabled: true,
  appName: 'Webhook Routing',
  appUrl: 'https://app.example.test',
  stripe: {
    secretKey: 'rk_test_webhook_routing',
    webhookSecret: 'whsec_webhook_routing',
    portalConfigurationId: 'bpc_webhook_routing',
    prices: {
      'personal.weekly': 'price_personal_weekly_webhook_routing',
      'personal.monthly': 'price_personal_monthly_webhook_routing',
      'personal.annual': 'price_personal_annual_webhook_routing',
      'family.monthly': 'price_family_monthly_webhook_routing',
      'family.annual': 'price_family_annual_webhook_routing'
    }
  }
} as const satisfies BillingStripeRuntimeConfiguration
