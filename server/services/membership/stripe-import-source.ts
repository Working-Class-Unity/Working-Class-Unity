import type Stripe from 'stripe'

export type StripeMembershipImportDataset = Readonly<{
  customers: readonly Stripe.Customer[]
  products: readonly Stripe.Product[]
  prices: readonly Stripe.Price[]
  subscriptions: readonly Stripe.Subscription[]
  subscriptionItems: ReadonlyMap<string, readonly Stripe.SubscriptionItem[]>
  invoices: readonly Stripe.Invoice[]
  invoiceLines: ReadonlyMap<string, readonly Stripe.InvoiceLineItem[]>
  invoicePayments: readonly Stripe.InvoicePayment[]
  charges: readonly Stripe.Charge[]
  refunds: readonly Stripe.Refund[]
  disputes: readonly Stripe.Dispute[]
}>

export type StripeMembershipImportSource = Readonly<{
  listCustomers: () => AsyncIterable<Stripe.Customer>
  listProducts: () => AsyncIterable<Stripe.Product>
  listPrices: () => AsyncIterable<Stripe.Price>
  listSubscriptions: () => AsyncIterable<Stripe.Subscription>
  listSubscriptionItems: (subscriptionId: string) => AsyncIterable<Stripe.SubscriptionItem>
  listInvoices: () => AsyncIterable<Stripe.Invoice>
  listInvoiceLines: (invoiceId: string) => AsyncIterable<Stripe.InvoiceLineItem>
  listInvoicePayments: () => AsyncIterable<Stripe.InvoicePayment>
  listCharges: () => AsyncIterable<Stripe.Charge>
  listRefunds: () => AsyncIterable<Stripe.Refund>
  listDisputes: () => AsyncIterable<Stripe.Dispute>
}>

export function createStripeMembershipImportSource(client: Stripe): StripeMembershipImportSource {
  return Object.freeze({
    listCustomers: () => client.customers.list({ limit: 100 }),
    listProducts: () => client.products.list({ limit: 100 }),
    listPrices: () => client.prices.list({ limit: 100 }),
    listSubscriptions: () =>
      client.subscriptions.list({
        limit: 100,
        status: 'all',
        expand: ['data.discounts.source.coupon']
      }),
    listSubscriptionItems: (subscriptionId) =>
      client.subscriptionItems.list({
        limit: 100,
        subscription: subscriptionId,
        expand: ['data.discounts.source.coupon']
      }),
    listInvoices: () =>
      client.invoices.list({
        limit: 100,
        expand: ['data.discounts.source.coupon']
      }),
    listInvoiceLines: (invoiceId) => client.invoices.listLineItems(invoiceId, { limit: 100 }),
    listInvoicePayments: () => client.invoicePayments.list({ limit: 100 }),
    listCharges: () => client.charges.list({ limit: 100 }),
    listRefunds: () => client.refunds.list({ limit: 100 }),
    listDisputes: () => client.disputes.list({ limit: 100 })
  })
}

export async function fetchStripeMembershipImportDataset(
  source: StripeMembershipImportSource
): Promise<StripeMembershipImportDataset> {
  const products = await collect(source.listProducts())
  const prices = await collect(source.listPrices())
  const customers = await collect(source.listCustomers())
  const subscriptions = await collect(source.listSubscriptions())
  const subscriptionItems = new Map<string, readonly Stripe.SubscriptionItem[]>()
  for (const subscription of subscriptions) {
    subscriptionItems.set(subscription.id, await collect(source.listSubscriptionItems(subscription.id)))
  }

  const invoices = await collect(source.listInvoices())
  const invoiceLines = new Map<string, readonly Stripe.InvoiceLineItem[]>()
  for (const invoice of invoices) {
    invoiceLines.set(invoice.id, await collect(source.listInvoiceLines(invoice.id)))
  }

  return Object.freeze({
    customers,
    products,
    prices,
    subscriptions,
    subscriptionItems,
    invoices,
    invoiceLines,
    invoicePayments: await collect(source.listInvoicePayments()),
    charges: await collect(source.listCharges()),
    refunds: await collect(source.listRefunds()),
    disputes: await collect(source.listDisputes())
  })
}

async function collect<T>(iterable: AsyncIterable<T>): Promise<readonly T[]> {
  const values: T[] = []
  for await (const value of iterable) values.push(value)
  return Object.freeze(values)
}
