import { createHash, randomUUID } from 'node:crypto'
import type Database from 'better-sqlite3'
import type Stripe from 'stripe'
import type { DatabaseConnection } from '../../db/connect'
import { recalculateMembershipStandingInTransaction } from './membership-standing'
import type { StripeMembershipImportDataset } from './stripe-import-source'

type Sqlite = InstanceType<typeof Database>

export type StripeMembershipImportOptions = Readonly<{
  apply: boolean
  grandfatheredBefore: Date
  observedAt: Date
}>

export type StripeMembershipImportIssue = Readonly<{
  code: string
  externalId: string
  objectType: string
}>

export type StripeMembershipImportReport = Readonly<{
  mode: 'apply' | 'dry-run'
  batchId: string | null
  fetched: Readonly<Record<string, number>>
  snapshots: Readonly<{ changed: number; unchanged: number }>
  identities: Readonly<{ ambiguous: number; created: number; existing: number }>
  memberships: Readonly<{ blocked: number; createdActive: number; createdPending: number; existing: number }>
  revenue: Readonly<{ duesCaptured: number; duesRefunded: number; netDuesCollected: number }>
  issues: readonly StripeMembershipImportIssue[]
}>

type PreparedSnapshot = Readonly<{
  externalId: string
  objectType: string
  payloadHash: string
  rawPayload: string
}>

type CustomerResolution = Readonly<{
  accountUserId: string | null
  action: 'ambiguous' | 'created' | 'existing'
  customer: Stripe.Customer
  personId: string | null
}>

type MembershipPlan = Readonly<{
  action: 'created_active' | 'created_pending' | 'existing'
  appliedAt: string
  attendanceRequirementStartsAt: string | null
  membershipId: string
  personId: string
  startedAt: string | null
  subscriptionIds: readonly string[]
}>

type DiscountContext = Readonly<{
  customerId: string
  discount: Stripe.Discount
  externalId: string
  invoiceId: string | null
  localId: string
  subscriptionId: string | null
}>

const supportedRefundStatuses = new Set(['pending', 'requires_action', 'succeeded', 'failed', 'canceled'])
const nonMembershipSubscriptionStatuses = new Set(['incomplete', 'incomplete_expired'])

export function importStripeMembershipDataset(
  connection: DatabaseConnection,
  dataset: StripeMembershipImportDataset,
  options: StripeMembershipImportOptions
): StripeMembershipImportReport {
  validateOptions(options)
  assertMembershipSchema(connection.sqlite)

  const observedAt = options.observedAt.toISOString()
  const grandfatheredBefore = options.grandfatheredBefore.toISOString()
  const issues: StripeMembershipImportIssue[] = []
  const discounts = collectDiscountContexts(dataset, issues)
  preflightDataset(connection.sqlite, dataset, discounts, issues)
  const snapshots = prepareSnapshots(dataset, discounts)
  const snapshotCounts = countSnapshotChanges(connection.sqlite, snapshots)
  const qualifyingPriceIds = readQualifyingPriceIds(connection.sqlite, dataset.prices)
  const customerResolutions = planCustomerResolutions(connection.sqlite, dataset.customers, issues)
  const membershipPlans = planMemberships(
    connection.sqlite,
    dataset,
    customerResolutions,
    qualifyingPriceIds,
    grandfatheredBefore,
    observedAt,
    issues
  )
  const membershipInvoiceIds = membershipInvoiceIdsFor(dataset, qualifyingPriceIds)
  const revenue = calculateDuesRevenue(dataset, membershipInvoiceIds)

  let batchId: string | null = null
  if (options.apply) {
    batchId = `import_stripe_${randomUUID()}`
    applyImport(connection.sqlite, {
      batchId,
      customerResolutions,
      dataset,
      discounts,
      issues,
      membershipInvoiceIds,
      membershipPlans,
      observedAt,
      qualifyingPriceIds,
      snapshots
    })
  }

  return Object.freeze({
    mode: options.apply ? 'apply' : 'dry-run',
    batchId,
    fetched: Object.freeze(fetchedCounts(dataset, discounts)),
    snapshots: Object.freeze(snapshotCounts),
    identities: Object.freeze(countIdentityPlans(customerResolutions)),
    memberships: Object.freeze(countMembershipPlans(membershipPlans, issues)),
    revenue: Object.freeze(revenue),
    issues: Object.freeze([...issues])
  })
}

function validateOptions(options: StripeMembershipImportOptions): void {
  if (Number.isNaN(options.observedAt.getTime())) throw new TypeError('Stripe import observedAt must be a valid date')
  if (Number.isNaN(options.grandfatheredBefore.getTime())) {
    throw new TypeError('Stripe import grandfatheredBefore must be a valid date')
  }
  if (options.grandfatheredBefore.getTime() > options.observedAt.getTime()) {
    throw new TypeError('Stripe membership grandfathering cutoff cannot be after the observation time')
  }
}

export function assertMembershipSchema(sqlite: Sqlite): void {
  const required = [
    'external_record_snapshots',
    'import_batches',
    'membership_dues_prices',
    'memberships',
    'people',
    'stripe_customers',
    'stripe_subscriptions'
  ]
  const rows = sqlite
    .prepare("select name from sqlite_master where type = 'table' and name in (select value from json_each(?))")
    .all(JSON.stringify(required)) as Array<{ name: string }>
  if (rows.length !== required.length) {
    throw new Error('The SQLite database is missing the membership schema; run the packaged migrations first')
  }
}

function prepareSnapshots(
  dataset: StripeMembershipImportDataset,
  discounts: readonly DiscountContext[]
): readonly PreparedSnapshot[] {
  const records = new Map<string, PreparedSnapshot>()
  const add = (objectType: string, externalId: string, value: unknown) => {
    const rawPayload = canonicalJson(value)
    records.set(snapshotKey(objectType, externalId), {
      externalId,
      objectType,
      payloadHash: sha256(rawPayload),
      rawPayload
    })
  }

  for (const value of dataset.customers) add('stripe.customer', value.id, value)
  for (const value of dataset.products) add('stripe.product', value.id, value)
  for (const value of dataset.prices) add('stripe.price', value.id, value)
  for (const value of dataset.subscriptions) add('stripe.subscription', value.id, value)
  for (const values of dataset.subscriptionItems.values()) {
    for (const value of values) add('stripe.subscription_item', value.id, value)
  }
  for (const value of dataset.invoices) add('stripe.invoice', value.id, value)
  for (const values of dataset.invoiceLines.values()) {
    for (const value of values) add('stripe.invoice_line', value.id, value)
  }
  for (const value of dataset.invoicePayments) add('stripe.invoice_payment', value.id, value)
  for (const value of dataset.charges) add('stripe.charge', value.id, value)
  for (const value of dataset.refunds) add('stripe.refund', value.id, value)
  for (const value of dataset.disputes) add('stripe.dispute', value.id, value)
  for (const value of discounts) add('stripe.discount', value.externalId, value.discount)

  return Object.freeze([...records.values()].sort(compareSnapshots))
}

function collectDiscountContexts(
  dataset: StripeMembershipImportDataset,
  issues: StripeMembershipImportIssue[]
): readonly DiscountContext[] {
  const contexts = new Map<string, DiscountContext>()

  for (const subscription of dataset.subscriptions) {
    const customerId = referenceId(subscription.customer)
    if (!customerId) continue
    for (const value of subscription.discounts) {
      const discount = expandedDiscount(value)
      if (!discount) {
        issue(issues, 'discount_not_expanded', 'stripe.subscription', subscription.id)
        continue
      }
      const externalId = `${discount.id}:subscription:${subscription.id}`
      contexts.set(externalId, {
        customerId,
        discount,
        externalId,
        invoiceId: null,
        localId: deterministicId('stripe_discount', externalId),
        subscriptionId: subscription.id
      })
    }
  }

  for (const invoice of dataset.invoices) {
    const customerId = referenceId(invoice.customer)
    if (!customerId) continue
    for (const value of invoice.discounts) {
      const discount = expandedDiscount(value)
      if (!discount) {
        issue(issues, 'discount_not_expanded', 'stripe.invoice', invoice.id)
        continue
      }
      const externalId = `${discount.id}:invoice:${invoice.id}`
      contexts.set(externalId, {
        customerId,
        discount,
        externalId,
        invoiceId: invoice.id,
        localId: deterministicId('stripe_discount', externalId),
        subscriptionId: invoiceSubscriptionId(invoice)
      })
    }
  }

  return Object.freeze([...contexts.values()].sort((left, right) => left.externalId.localeCompare(right.externalId)))
}

function preflightDataset(
  sqlite: Sqlite,
  dataset: StripeMembershipImportDataset,
  discounts: readonly DiscountContext[],
  issues: StripeMembershipImportIssue[]
): void {
  const existingProduct = sqlite.prepare('select 1 from stripe_products where id = ?')
  const existingPrice = sqlite.prepare('select 1 from stripe_prices where id = ?')
  const existingCustomer = sqlite.prepare('select 1 from stripe_customers where id = ?')
  const existingSubscription = sqlite.prepare('select 1 from stripe_subscriptions where id = ?')
  const existingInvoice = sqlite.prepare('select 1 from stripe_invoices where id = ?')
  const existingCharge = sqlite.prepare('select 1 from stripe_charges where id = ?')
  const products = new Set(dataset.products.map((value) => value.id))
  const prices = new Set(dataset.prices.map((value) => value.id))
  const customers = new Set(dataset.customers.map((value) => value.id))
  const subscriptions = new Set(dataset.subscriptions.map((value) => value.id))
  const invoices = new Set(dataset.invoices.map((value) => value.id))
  const charges = new Set(dataset.charges.map((value) => value.id))

  for (const product of dataset.products) {
    if (!normalizedText(product.name, 255)) issue(issues, 'invalid_product_name', 'stripe.product', product.id)
  }
  for (const price of dataset.prices) {
    const productId = referenceId(price.product)
    if (!productId || (!products.has(productId) && !existingProduct.get(productId))) {
      issue(issues, 'price_product_missing', 'stripe.price', price.id)
    }
  }
  for (const subscription of dataset.subscriptions) {
    const customerId = referenceId(subscription.customer)
    if (!customerId || (!customers.has(customerId) && !existingCustomer.get(customerId))) {
      issue(issues, 'subscription_customer_missing', 'stripe.subscription', subscription.id)
    }
    for (const item of dataset.subscriptionItems.get(subscription.id) ?? []) {
      if (!prices.has(item.price.id) && !existingPrice.get(item.price.id)) {
        issue(issues, 'subscription_item_reference_missing', 'stripe.subscription_item', item.id)
      }
    }
  }
  for (const invoice of dataset.invoices) {
    const customerId = referenceId(invoice.customer)
    if (!customerId || (!customers.has(customerId) && !existingCustomer.get(customerId)))
      issue(issues, 'invoice_customer_missing', 'stripe.invoice', invoice.id)
    if (!invoice.status) issue(issues, 'invoice_status_missing', 'stripe.invoice', invoice.id)
    const subscriptionId = invoiceSubscriptionId(invoice)
    if (subscriptionId && !subscriptions.has(subscriptionId) && !existingSubscription.get(subscriptionId)) {
      issue(issues, 'invoice_subscription_missing', 'stripe.invoice', invoice.id)
    }
  }
  for (const value of discounts) {
    const coupon = expandedCoupon(value.discount.source.coupon)
    if (!coupon) {
      issue(issues, 'discount_coupon_not_expanded', 'stripe.discount', value.externalId)
      continue
    }
    const hasAmount = coupon.amount_off !== null
    const hasPercent = coupon.percent_off !== null
    if (hasAmount === hasPercent || (hasAmount && !coupon.currency)) {
      issue(issues, 'unsupported_discount_value', 'stripe.discount', value.externalId)
    }
    if (
      (!value.subscriptionId ||
        (!subscriptions.has(value.subscriptionId) && !existingSubscription.get(value.subscriptionId))) &&
      (!value.invoiceId || (!invoices.has(value.invoiceId) && !existingInvoice.get(value.invoiceId)))
    ) {
      issue(issues, 'discount_target_missing', 'stripe.discount', value.externalId)
    }
  }
  for (const refund of dataset.refunds) {
    const chargeId = referenceId(refund.charge)
    if (!chargeId || (!charges.has(chargeId) && !existingCharge.get(chargeId))) {
      issue(issues, 'refund_charge_missing', 'stripe.refund', refund.id)
    }
    if (!refund.status || !supportedRefundStatuses.has(refund.status)) {
      issue(issues, 'refund_status_unsupported', 'stripe.refund', refund.id)
    }
  }
  for (const dispute of dataset.disputes) {
    const chargeId = referenceId(dispute.charge)
    if (!chargeId || (!charges.has(chargeId) && !existingCharge.get(chargeId))) {
      issue(issues, 'dispute_charge_missing', 'stripe.dispute', dispute.id)
    }
  }
}

function countSnapshotChanges(sqlite: Sqlite, snapshots: readonly PreparedSnapshot[]) {
  const latest = sqlite.prepare(
    `select payload_hash as payloadHash
     from external_record_snapshots
     where object_type = ? and external_id = ?
     order by observed_at desc, rowid desc limit 1`
  )
  let changed = 0
  for (const snapshot of snapshots) {
    const row = latest.get(snapshot.objectType, snapshot.externalId) as { payloadHash: string } | undefined
    if (row?.payloadHash === snapshot.payloadHash) continue
    changed += 1
  }
  return { changed, unchanged: snapshots.length - changed }
}

function planCustomerResolutions(
  sqlite: Sqlite,
  customers: readonly Stripe.Customer[],
  issues: StripeMembershipImportIssue[]
): readonly CustomerResolution[] {
  const plannedAccounts = new Map<string, string>()
  const resolutions: CustomerResolution[] = []

  for (const customer of [...customers].sort((left, right) => left.id.localeCompare(right.id))) {
    const strongPeople = new Set<string>()
    const strongUsers = new Set<string>()

    const identity = sqlite
      .prepare("select person_id as personId from provider_identities where provider = 'stripe' and external_id = ?")
      .get(customer.id) as { personId: string | null } | undefined
    if (identity?.personId) strongPeople.add(identity.personId)

    const mirrored = sqlite
      .prepare('select person_id as personId from stripe_customers where id = ?')
      .get(customer.id) as { personId: string | null } | undefined
    if (mirrored?.personId) strongPeople.add(mirrored.personId)

    const billing = sqlite
      .prepare(
        `select bc.purchaser_user_id as userId, pa.person_id as personId
         from billing_customers bc
         left join person_accounts pa on pa.user_id = bc.purchaser_user_id
         where bc.stripe_customer_id = ?`
      )
      .get(customer.id) as { personId: string | null; userId: string } | undefined
    if (billing?.personId) strongPeople.add(billing.personId)
    else if (billing?.userId) strongUsers.add(billing.userId)

    for (const userId of strongUsers) {
      const planned = plannedAccounts.get(userId)
      if (planned) strongPeople.add(planned)
    }

    if (strongPeople.size > 1 || (strongPeople.size === 1 && strongUsers.size > 0)) {
      issue(issues, 'conflicting_strong_identity', 'stripe.customer', customer.id)
      resolutions.push({ accountUserId: null, action: 'ambiguous', customer, personId: null })
      continue
    }
    if (strongPeople.size === 1) {
      resolutions.push({ accountUserId: null, action: 'existing', customer, personId: first(strongPeople) })
      continue
    }
    if (strongUsers.size === 1) {
      const userId = first(strongUsers)
      const personId = deterministicId('person_stripe', customer.id)
      plannedAccounts.set(userId, personId)
      resolutions.push({ accountUserId: userId, action: 'created', customer, personId })
      continue
    }

    const normalizedEmail = normalizeEmail(customer.email)
    const candidatePeople = new Set<string>()
    const candidateUsers = new Set<string>()
    if (normalizedEmail) {
      const contacts = sqlite
        .prepare(
          `select distinct person_id as personId from person_contacts
           where kind = 'email' and normalized_value = ? and verified_at is not null`
        )
        .all(normalizedEmail) as Array<{ personId: string }>
      for (const row of contacts) candidatePeople.add(row.personId)

      const users = sqlite
        .prepare(
          `select u.id as userId, pa.person_id as personId
           from user u left join person_accounts pa on pa.user_id = u.id
           where lower(trim(u.email)) = ? and u.email_verified = 1`
        )
        .all(normalizedEmail) as Array<{ personId: string | null; userId: string }>
      for (const row of users) {
        const plannedPerson = row.personId ?? plannedAccounts.get(row.userId)
        if (plannedPerson) candidatePeople.add(plannedPerson)
        else candidateUsers.add(row.userId)
      }
    }

    if (candidatePeople.size > 1 || (candidatePeople.size === 1 && candidateUsers.size > 0)) {
      issue(issues, 'ambiguous_verified_email', 'stripe.customer', customer.id)
      resolutions.push({ accountUserId: null, action: 'ambiguous', customer, personId: null })
      continue
    }
    if (candidatePeople.size === 1) {
      resolutions.push({ accountUserId: null, action: 'existing', customer, personId: first(candidatePeople) })
      continue
    }
    if (candidateUsers.size === 1) {
      const userId = first(candidateUsers)
      const personId = deterministicId('person_stripe', customer.id)
      plannedAccounts.set(userId, personId)
      resolutions.push({ accountUserId: userId, action: 'created', customer, personId })
      continue
    }
    if (candidateUsers.size > 1) {
      issue(issues, 'ambiguous_verified_email', 'stripe.customer', customer.id)
      resolutions.push({ accountUserId: null, action: 'ambiguous', customer, personId: null })
      continue
    }

    resolutions.push({
      accountUserId: null,
      action: 'created',
      customer,
      personId: deterministicId('person_stripe', customer.id)
    })
  }

  return Object.freeze(resolutions)
}

function planMemberships(
  sqlite: Sqlite,
  dataset: StripeMembershipImportDataset,
  resolutions: readonly CustomerResolution[],
  qualifyingPriceIds: ReadonlySet<string>,
  grandfatheredBefore: string,
  observedAt: string,
  issues: StripeMembershipImportIssue[]
): readonly MembershipPlan[] {
  const personByCustomer = new Map(
    resolutions.filter((value) => value.personId).map((value) => [value.customer.id, value.personId!])
  )
  const subscriptionsByPerson = new Map<string, Stripe.Subscription[]>()

  for (const subscription of dataset.subscriptions) {
    if (nonMembershipSubscriptionStatuses.has(subscription.status)) continue
    if (!subscriptionQualifies(subscription.id, dataset, qualifyingPriceIds)) continue
    const customerId = referenceId(subscription.customer)
    const personId = customerId ? personByCustomer.get(customerId) : undefined
    if (!personId) {
      issue(issues, 'membership_subscription_unlinked', 'stripe.subscription', subscription.id)
      continue
    }
    const values = subscriptionsByPerson.get(personId) ?? []
    values.push(subscription)
    subscriptionsByPerson.set(personId, values)
  }

  const plans: MembershipPlan[] = []
  for (const [personId, subscriptions] of subscriptionsByPerson) {
    subscriptions.sort((left, right) => left.start_date - right.start_date || left.id.localeCompare(right.id))
    const existing = sqlite
      .prepare(
        `select id, applied_at as appliedAt, started_at as startedAt
         from memberships where person_id = ? and ended_at is null`
      )
      .get(personId) as { appliedAt: string; id: string; startedAt: string | null } | undefined
    if (existing) {
      plans.push({
        action: 'existing',
        appliedAt: existing.appliedAt,
        attendanceRequirementStartsAt: null,
        membershipId: existing.id,
        personId,
        startedAt: existing.startedAt,
        subscriptionIds: Object.freeze(subscriptions.map((value) => value.id))
      })
      continue
    }

    const currentSubscriptions = subscriptions.filter(
      (subscription) => subscription.status === 'active' && subscription.pause_collection == null
    )
    const history = sqlite
      .prepare('select count(*) as count, max(ended_at) as endedAt from memberships where person_id = ?')
      .get(personId) as { count: number; endedAt: string | null }
    let episodeSubscriptions = currentSubscriptions
    if (history.count > 0) {
      episodeSubscriptions = currentSubscriptions.filter((subscription) => {
        const startedAt = timestamp(subscription.start_date)
        return history.endedAt !== null && startedAt !== null && startedAt > history.endedAt
      })
    }
    if (episodeSubscriptions.length === 0) {
      const code = history.count > 0 ? 'membership_history_requires_review' : 'membership_subscription_not_current'
      for (const subscription of subscriptions) {
        issue(issues, code, 'stripe.subscription', subscription.id)
      }
      continue
    }

    const firstSubscription = episodeSubscriptions[0]!
    const appliedAt = timestamp(firstSubscription.start_date) ?? observedAt
    const isGrandfathered = appliedAt < grandfatheredBefore
    plans.push({
      action: isGrandfathered ? 'created_active' : 'created_pending',
      appliedAt,
      attendanceRequirementStartsAt: isGrandfathered ? observedAt : null,
      membershipId: deterministicId('membership_stripe', `${personId}\0${appliedAt}`),
      personId,
      startedAt: isGrandfathered ? appliedAt : null,
      subscriptionIds: Object.freeze(episodeSubscriptions.map((value) => value.id))
    })
  }

  return Object.freeze(plans.sort((left, right) => left.personId.localeCompare(right.personId)))
}

function membershipInvoiceIdsFor(
  dataset: StripeMembershipImportDataset,
  qualifyingPriceIds: ReadonlySet<string>
): ReadonlySet<string> {
  const invoiceIds = new Set<string>()
  for (const invoice of dataset.invoices) {
    const nonzeroLines = (dataset.invoiceLines.get(invoice.id) ?? []).filter((line) => line.amount !== 0)
    if (nonzeroLines.length === 0) continue
    if (nonzeroLines.every((line) => qualifyingPriceIds.has(linePriceId(line) ?? ''))) invoiceIds.add(invoice.id)
  }
  return invoiceIds
}

function calculateDuesRevenue(
  dataset: StripeMembershipImportDataset,
  membershipInvoiceIds: ReadonlySet<string>
): { duesCaptured: number; duesRefunded: number; netDuesCollected: number } {
  const invoiceByPaymentIntent = invoicePaymentReferences(dataset.invoicePayments)
  const invoiceByCharge = invoiceChargeReferences(dataset.invoicePayments)
  const duesChargeIds = new Set<string>()
  let duesCaptured = 0

  for (const charge of dataset.charges) {
    const invoiceId = chargeInvoiceId(charge, invoiceByPaymentIntent, invoiceByCharge)
    if (charge.status !== 'succeeded' || !invoiceId || !membershipInvoiceIds.has(invoiceId)) continue
    duesChargeIds.add(charge.id)
    duesCaptured += charge.amount_captured
  }

  let duesRefunded = 0
  for (const refund of dataset.refunds) {
    const chargeId = referenceId(refund.charge)
    if (refund.status === 'succeeded' && chargeId && duesChargeIds.has(chargeId)) duesRefunded += refund.amount
  }

  return { duesCaptured, duesRefunded, netDuesCollected: duesCaptured - duesRefunded }
}

type ApplyContext = Readonly<{
  batchId: string
  customerResolutions: readonly CustomerResolution[]
  dataset: StripeMembershipImportDataset
  discounts: readonly DiscountContext[]
  issues: StripeMembershipImportIssue[]
  membershipInvoiceIds: ReadonlySet<string>
  membershipPlans: readonly MembershipPlan[]
  observedAt: string
  qualifyingPriceIds: ReadonlySet<string>
  snapshots: readonly PreparedSnapshot[]
}>

function applyImport(sqlite: Sqlite, context: ApplyContext): void {
  const sourceChecksum = sha256(
    context.snapshots.map((value) => `${value.objectType}\0${value.externalId}\0${value.payloadHash}`).join('\n')
  )
  sqlite
    .prepare(
      `insert into import_batches (id, provider, status, source_name, source_checksum, started_at)
       values (?, 'stripe', 'pending', 'stripe-api-full-snapshot', ?, ?)`
    )
    .run(context.batchId, sourceChecksum, context.observedAt)

  const transaction = sqlite.transaction(() => {
    const snapshotIds = persistSnapshots(sqlite, context)
    persistProductsAndPrices(sqlite, context, snapshotIds)
    persistCustomersAndPeople(sqlite, context, snapshotIds)
    persistSubscriptions(sqlite, context, snapshotIds)
    persistInvoices(sqlite, context, snapshotIds)
    persistDiscounts(sqlite, context, snapshotIds)
    const duesChargeIds = persistCharges(sqlite, context, snapshotIds)
    persistRefundsAndDisputes(sqlite, context, snapshotIds, duesChargeIds)
    persistMembershipsAndStanding(sqlite, context, snapshotIds)
    sqlite
      .prepare(
        `update import_batches set status = 'completed', completed_at = ?, record_count = ?, updated_at = ? where id = ?`
      )
      .run(context.observedAt, context.snapshots.length, context.observedAt, context.batchId)
  })

  try {
    transaction.immediate()
  } catch (error) {
    sqlite
      .prepare(`update import_batches set status = 'failed', completed_at = ?, updated_at = ? where id = ?`)
      .run(context.observedAt, context.observedAt, context.batchId)
    throw error
  }
}

function persistSnapshots(sqlite: Sqlite, context: ApplyContext): ReadonlyMap<string, string> {
  const snapshotIds = new Map<string, string>()
  const latest = sqlite.prepare(
    `select id, payload_hash as payloadHash
     from external_record_snapshots
     where object_type = ? and external_id = ?
     order by observed_at desc, rowid desc limit 1`
  )
  const insert = sqlite.prepare(
    `insert into external_record_snapshots
       (id, import_batch_id, object_type, external_id, observed_at, payload_hash, raw_payload)
     values (?, ?, ?, ?, ?, ?, ?)`
  )

  for (const snapshot of context.snapshots) {
    const key = snapshotKey(snapshot.objectType, snapshot.externalId)
    const row = latest.get(snapshot.objectType, snapshot.externalId) as { id: string; payloadHash: string } | undefined
    if (row?.payloadHash === snapshot.payloadHash) {
      snapshotIds.set(key, row.id)
      continue
    }
    const id = deterministicId('stripe_snapshot', `${context.batchId}\0${key}`)
    insert.run(
      id,
      context.batchId,
      snapshot.objectType,
      snapshot.externalId,
      context.observedAt,
      snapshot.payloadHash,
      snapshot.rawPayload
    )
    snapshotIds.set(key, id)
  }
  return snapshotIds
}

function persistProductsAndPrices(
  sqlite: Sqlite,
  context: ApplyContext,
  snapshotIds: ReadonlyMap<string, string>
): void {
  const upsertProduct = sqlite.prepare(
    `insert into stripe_products
       (id, name, description, active, source_snapshot_id, created_at, updated_at)
     values (?, ?, ?, ?, ?, ?, ?)
     on conflict(id) do update set name = excluded.name, description = excluded.description,
       active = excluded.active, source_snapshot_id = excluded.source_snapshot_id, updated_at = excluded.updated_at`
  )
  for (const product of context.dataset.products) {
    const name = normalizedText(product.name, 255)
    if (!name) {
      issue(context.issues, 'invalid_product_name', 'stripe.product', product.id)
      continue
    }
    upsertProduct.run(
      product.id,
      name,
      normalizedText(product.description, 10_000),
      product.active ? 1 : 0,
      snapshotId(snapshotIds, 'stripe.product', product.id),
      context.observedAt,
      context.observedAt
    )
  }

  const productExists = sqlite.prepare('select 1 from stripe_products where id = ?')
  const clearTransferredLookupKey = sqlite.prepare(
    'update stripe_prices set lookup_key = null, updated_at = ? where lookup_key = ? and id <> ?'
  )
  const upsertPrice = sqlite.prepare(
    `insert into stripe_prices
       (id, product_id, lookup_key, active, currency, unit_amount, recurring_interval,
        recurring_interval_count, source_snapshot_id, created_at, updated_at)
     values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     on conflict(id) do update set product_id = excluded.product_id, lookup_key = excluded.lookup_key,
       active = excluded.active, currency = excluded.currency, unit_amount = excluded.unit_amount,
       recurring_interval = excluded.recurring_interval,
       recurring_interval_count = excluded.recurring_interval_count,
       source_snapshot_id = excluded.source_snapshot_id, updated_at = excluded.updated_at`
  )
  for (const price of context.dataset.prices) {
    const productId = referenceId(price.product)
    if (!productId || !productExists.get(productId)) {
      issue(context.issues, 'price_product_missing', 'stripe.price', price.id)
      continue
    }
    if (price.lookup_key) clearTransferredLookupKey.run(context.observedAt, price.lookup_key, price.id)
    upsertPrice.run(
      price.id,
      productId,
      normalizedText(price.lookup_key, 255),
      price.active ? 1 : 0,
      price.currency.toUpperCase(),
      price.unit_amount,
      price.recurring?.interval ?? null,
      price.recurring?.interval_count ?? null,
      snapshotId(snapshotIds, 'stripe.price', price.id),
      context.observedAt,
      context.observedAt
    )
  }

  const configuredDuesPrice = sqlite.prepare(
    `select membership_class as membershipClass, effective_from as effectiveFrom,
       effective_to as effectiveTo
     from membership_dues_prices where price_id = ?`
  )
  const upsertDuesPriceAlias = sqlite.prepare(
    `insert into membership_dues_prices
       (price_id, membership_class, effective_from, effective_to, created_at)
     values (?, ?, ?, ?, ?)
     on conflict(price_id) do update set membership_class = excluded.membership_class,
       effective_from = excluded.effective_from, effective_to = excluded.effective_to`
  )
  for (const price of context.dataset.prices) {
    if (!price.lookup_key || price.lookup_key === price.id) continue
    const configured = configuredDuesPrice.get(price.lookup_key) as
      { effectiveFrom: string | null; effectiveTo: string | null; membershipClass: string } | undefined
    if (!configured) continue
    upsertDuesPriceAlias.run(
      price.id,
      configured.membershipClass,
      configured.effectiveFrom,
      configured.effectiveTo,
      context.observedAt
    )
  }
}

function persistCustomersAndPeople(
  sqlite: Sqlite,
  context: ApplyContext,
  snapshotIds: ReadonlyMap<string, string>
): void {
  const insertPerson = sqlite.prepare(
    `insert into people (id, display_name, created_at, updated_at) values (?, ?, ?, ?)
     on conflict(id) do nothing`
  )
  const linkAccount = sqlite.prepare(
    `insert into person_accounts (person_id, user_id, linked_at, created_at) values (?, ?, ?, ?)
     on conflict do nothing`
  )
  const primaryContact = sqlite.prepare(
    `select 1 from person_contacts where person_id = ? and kind = ? and is_primary = 1 limit 1`
  )
  const upsertContact = sqlite.prepare(
    `insert into person_contacts
       (id, person_id, kind, value, normalized_value, is_primary, verified_at,
        source_snapshot_id, created_at, updated_at)
     values (?, ?, ?, ?, ?, ?, null, ?, ?, ?)
     on conflict(person_id, kind, normalized_value) do update set value = excluded.value,
       source_snapshot_id = excluded.source_snapshot_id, updated_at = excluded.updated_at`
  )
  const upsertIdentity = sqlite.prepare(
    `insert into provider_identities
       (id, person_id, provider, external_id, state, linked_at, last_synced_at,
        source_snapshot_id, created_at, updated_at)
     values (?, ?, 'stripe', ?, ?, ?, ?, ?, ?, ?)
     on conflict(provider, external_id) do update set
       person_id = case
         when provider_identities.state = 'unlinked' and excluded.person_id is not null then excluded.person_id
         else provider_identities.person_id end,
       state = case
         when provider_identities.state = 'unlinked' and excluded.person_id is not null then 'active'
         else provider_identities.state end,
       linked_at = case
         when provider_identities.state = 'unlinked' and excluded.person_id is not null then excluded.linked_at
         else provider_identities.linked_at end,
       last_synced_at = excluded.last_synced_at,
       source_snapshot_id = excluded.source_snapshot_id,
       updated_at = excluded.updated_at`
  )
  const upsertCustomer = sqlite.prepare(
    `insert into stripe_customers
       (id, person_id, email, phone, default_currency, provider_created_at,
        source_snapshot_id, created_at, updated_at)
     values (?, ?, ?, ?, ?, ?, ?, ?, ?)
     on conflict(id) do update set
       person_id = coalesce(stripe_customers.person_id, excluded.person_id),
       email = excluded.email, phone = excluded.phone, default_currency = excluded.default_currency,
       provider_created_at = excluded.provider_created_at,
       source_snapshot_id = excluded.source_snapshot_id, updated_at = excluded.updated_at`
  )

  for (const resolution of context.customerResolutions) {
    const { customer, personId } = resolution
    const sourceSnapshotId = snapshotId(snapshotIds, 'stripe.customer', customer.id)
    if (personId) {
      insertPerson.run(personId, normalizedText(customer.name, 100), context.observedAt, context.observedAt)
      if (resolution.accountUserId) {
        linkAccount.run(personId, resolution.accountUserId, context.observedAt, context.observedAt)
      }
      persistContact('email', customer.email, normalizeEmail(customer.email))
      persistContact('phone', customer.phone, normalizePhone(customer.phone))
    }

    const state = personId ? 'active' : 'unlinked'
    upsertIdentity.run(
      deterministicId('provider_identity_stripe', customer.id),
      personId,
      customer.id,
      state,
      personId ? context.observedAt : null,
      context.observedAt,
      sourceSnapshotId,
      context.observedAt,
      context.observedAt
    )
    upsertCustomer.run(
      customer.id,
      personId,
      normalizedText(customer.email, 320),
      normalizedText(customer.phone, 320),
      customer.currency?.toUpperCase() ?? null,
      timestamp(customer.created),
      sourceSnapshotId,
      context.observedAt,
      context.observedAt
    )

    function persistContact(kind: 'email' | 'phone', value: string | null | undefined, normalized: string | null) {
      const cleanValue = normalizedText(value, 320)
      if (!personId || !cleanValue || !normalized) return
      upsertContact.run(
        deterministicId('person_contact', `${personId}\0${kind}\0${normalized}`),
        personId,
        kind,
        cleanValue,
        normalized,
        primaryContact.get(personId, kind) ? 0 : 1,
        sourceSnapshotId,
        context.observedAt,
        context.observedAt
      )
    }
  }
}

function persistSubscriptions(sqlite: Sqlite, context: ApplyContext, snapshotIds: ReadonlyMap<string, string>): void {
  const customerExists = sqlite.prepare('select 1 from stripe_customers where id = ?')
  const priceExists = sqlite.prepare('select 1 from stripe_prices where id = ?')
  const subscriptionExists = sqlite.prepare('select 1 from stripe_subscriptions where id = ?')
  const upsertSubscription = sqlite.prepare(
    `insert into stripe_subscriptions
       (id, customer_id, status, current_period_start, current_period_end,
        cancel_at_period_end, cancel_at, canceled_at, ended_at, provider_created_at,
        source_snapshot_id, created_at, updated_at)
     values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     on conflict(id) do update set customer_id = excluded.customer_id, status = excluded.status,
       current_period_start = excluded.current_period_start,
       current_period_end = excluded.current_period_end,
       cancel_at_period_end = excluded.cancel_at_period_end, cancel_at = excluded.cancel_at,
       canceled_at = excluded.canceled_at, ended_at = excluded.ended_at,
       provider_created_at = excluded.provider_created_at,
       source_snapshot_id = excluded.source_snapshot_id, updated_at = excluded.updated_at`
  )
  const upsertItem = sqlite.prepare(
    `insert into stripe_subscription_items
       (id, subscription_id, price_id, quantity, source_snapshot_id, created_at, updated_at)
     values (?, ?, ?, ?, ?, ?, ?)
     on conflict(id) do update set subscription_id = excluded.subscription_id,
       price_id = excluded.price_id, quantity = excluded.quantity,
       source_snapshot_id = excluded.source_snapshot_id, updated_at = excluded.updated_at`
  )

  for (const subscription of context.dataset.subscriptions) {
    const customerId = referenceId(subscription.customer)
    if (!customerId || !customerExists.get(customerId)) {
      issue(context.issues, 'subscription_customer_missing', 'stripe.subscription', subscription.id)
      continue
    }
    const items = context.dataset.subscriptionItems.get(subscription.id) ?? []
    const starts = items.map((value) => value.current_period_start).filter(Number.isFinite)
    const ends = items.map((value) => value.current_period_end).filter(Number.isFinite)
    const periodStart = starts.length ? timestamp(Math.min(...starts)) : null
    const periodEnd = ends.length ? timestamp(Math.max(...ends)) : null
    upsertSubscription.run(
      subscription.id,
      customerId,
      subscription.status,
      periodStart,
      periodEnd,
      subscription.cancel_at_period_end ? 1 : 0,
      timestamp(subscription.cancel_at),
      timestamp(subscription.canceled_at),
      timestamp(subscription.ended_at),
      timestamp(subscription.created),
      snapshotId(snapshotIds, 'stripe.subscription', subscription.id),
      context.observedAt,
      context.observedAt
    )

    for (const item of items) {
      if (!subscriptionExists.get(subscription.id) || !priceExists.get(item.price.id)) {
        issue(context.issues, 'subscription_item_reference_missing', 'stripe.subscription_item', item.id)
        continue
      }
      upsertItem.run(
        item.id,
        subscription.id,
        item.price.id,
        item.quantity ?? 1,
        snapshotId(snapshotIds, 'stripe.subscription_item', item.id),
        context.observedAt,
        context.observedAt
      )
    }
  }
}

function persistInvoices(sqlite: Sqlite, context: ApplyContext, snapshotIds: ReadonlyMap<string, string>): void {
  const customerExists = sqlite.prepare('select 1 from stripe_customers where id = ?')
  const subscriptionExists = sqlite.prepare('select 1 from stripe_subscriptions where id = ?')
  const invoiceExists = sqlite.prepare('select 1 from stripe_invoices where id = ?')
  const itemExists = sqlite.prepare('select 1 from stripe_subscription_items where id = ?')
  const priceExists = sqlite.prepare('select 1 from stripe_prices where id = ?')
  const productExists = sqlite.prepare('select 1 from stripe_products where id = ?')
  const paymentIntentByInvoice = paymentIntentReferences(context.dataset.invoicePayments)
  const upsertInvoice = sqlite.prepare(
    `insert into stripe_invoices
       (id, customer_id, subscription_id, status, currency, subtotal, total,
        amount_due, amount_paid, amount_remaining, period_start, period_end, paid_at,
        payment_intent_id, provider_created_at, source_snapshot_id, created_at, updated_at)
     values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     on conflict(id) do update set customer_id = excluded.customer_id,
       subscription_id = excluded.subscription_id, status = excluded.status,
       currency = excluded.currency, subtotal = excluded.subtotal, total = excluded.total,
       amount_due = excluded.amount_due, amount_paid = excluded.amount_paid,
       amount_remaining = excluded.amount_remaining, period_start = excluded.period_start,
       period_end = excluded.period_end, paid_at = excluded.paid_at,
       payment_intent_id = excluded.payment_intent_id,
       provider_created_at = excluded.provider_created_at,
       source_snapshot_id = excluded.source_snapshot_id, updated_at = excluded.updated_at`
  )
  const upsertLine = sqlite.prepare(
    `insert into stripe_invoice_lines
       (id, invoice_id, subscription_item_id, price_id, product_id, description,
        amount, currency, period_start, period_end, source_snapshot_id, created_at)
     values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     on conflict(id) do update set invoice_id = excluded.invoice_id,
       subscription_item_id = excluded.subscription_item_id, price_id = excluded.price_id,
       product_id = excluded.product_id, description = excluded.description,
       amount = excluded.amount, currency = excluded.currency,
       period_start = excluded.period_start, period_end = excluded.period_end,
       source_snapshot_id = excluded.source_snapshot_id`
  )

  for (const invoice of context.dataset.invoices) {
    const customerId = referenceId(invoice.customer)
    if (!customerId || !customerExists.get(customerId)) {
      issue(context.issues, 'invoice_customer_missing', 'stripe.invoice', invoice.id)
      continue
    }
    if (!invoice.status) {
      issue(context.issues, 'invoice_status_missing', 'stripe.invoice', invoice.id)
      continue
    }
    const rawSubscriptionId = invoiceSubscriptionId(invoice)
    const subscriptionId = rawSubscriptionId && subscriptionExists.get(rawSubscriptionId) ? rawSubscriptionId : null
    if (rawSubscriptionId && !subscriptionId) {
      issue(context.issues, 'invoice_subscription_missing', 'stripe.invoice', invoice.id)
    }
    const paymentIntentIds = paymentIntentByInvoice.get(invoice.id) ?? []
    upsertInvoice.run(
      invoice.id,
      customerId,
      subscriptionId,
      invoice.status,
      invoice.currency.toUpperCase(),
      invoice.subtotal,
      invoice.total,
      invoice.amount_due,
      invoice.amount_paid,
      invoice.amount_remaining,
      timestamp(invoice.period_start),
      timestamp(invoice.period_end),
      timestamp(invoice.status_transitions.paid_at),
      paymentIntentIds.length === 1 ? paymentIntentIds[0] : null,
      timestamp(invoice.created),
      snapshotId(snapshotIds, 'stripe.invoice', invoice.id),
      context.observedAt,
      context.observedAt
    )

    for (const line of context.dataset.invoiceLines.get(invoice.id) ?? []) {
      if (!invoiceExists.get(invoice.id)) continue
      const subscriptionItemId = lineSubscriptionItemId(line)
      const rawPriceId = linePriceId(line)
      const rawProductId = lineProductId(line)
      upsertLine.run(
        line.id,
        invoice.id,
        subscriptionItemId && itemExists.get(subscriptionItemId) ? subscriptionItemId : null,
        rawPriceId && priceExists.get(rawPriceId) ? rawPriceId : null,
        rawProductId && productExists.get(rawProductId) ? rawProductId : null,
        normalizedText(line.description, 10_000),
        line.amount,
        line.currency.toUpperCase(),
        timestamp(line.period.start),
        timestamp(line.period.end),
        snapshotId(snapshotIds, 'stripe.invoice_line', line.id),
        context.observedAt
      )
    }
  }
}

function persistDiscounts(sqlite: Sqlite, context: ApplyContext, snapshotIds: ReadonlyMap<string, string>): void {
  const customerExists = sqlite.prepare('select 1 from stripe_customers where id = ?')
  const subscriptionExists = sqlite.prepare('select 1 from stripe_subscriptions where id = ?')
  const invoiceExists = sqlite.prepare('select 1 from stripe_invoices where id = ?')
  const upsert = sqlite.prepare(
    `insert into stripe_discount_applications
       (id, customer_id, subscription_id, invoice_id, coupon_id, promotion_code_id,
        amount_off, percent_off_basis_points, currency, duration, starts_at, ends_at,
        source_snapshot_id, created_at)
     values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     on conflict(id) do update set customer_id = excluded.customer_id,
       subscription_id = excluded.subscription_id, invoice_id = excluded.invoice_id,
       coupon_id = excluded.coupon_id, promotion_code_id = excluded.promotion_code_id,
       amount_off = excluded.amount_off,
       percent_off_basis_points = excluded.percent_off_basis_points,
       currency = excluded.currency, duration = excluded.duration,
       starts_at = excluded.starts_at, ends_at = excluded.ends_at,
       source_snapshot_id = excluded.source_snapshot_id`
  )

  for (const contextValue of context.discounts) {
    const coupon = expandedCoupon(contextValue.discount.source.coupon)
    if (!coupon) {
      issue(context.issues, 'discount_coupon_not_expanded', 'stripe.discount', contextValue.externalId)
      continue
    }
    if (!customerExists.get(contextValue.customerId)) continue
    const subscriptionId =
      contextValue.subscriptionId && subscriptionExists.get(contextValue.subscriptionId)
        ? contextValue.subscriptionId
        : null
    const invoiceId =
      contextValue.invoiceId && invoiceExists.get(contextValue.invoiceId) ? contextValue.invoiceId : null
    if (!subscriptionId && !invoiceId) {
      issue(context.issues, 'discount_target_missing', 'stripe.discount', contextValue.externalId)
      continue
    }

    const hasAmount = coupon.amount_off !== null
    const hasPercent = coupon.percent_off !== null
    const currency = hasAmount ? (coupon.currency?.toUpperCase() ?? null) : null
    if (hasAmount === hasPercent || (hasAmount && !currency)) {
      issue(context.issues, 'unsupported_discount_value', 'stripe.discount', contextValue.externalId)
      continue
    }
    upsert.run(
      contextValue.localId,
      contextValue.customerId,
      subscriptionId,
      invoiceId,
      coupon.id,
      referenceId(contextValue.discount.promotion_code),
      coupon.amount_off,
      coupon.percent_off === null ? null : Math.round(coupon.percent_off * 100),
      currency,
      coupon.duration,
      timestamp(contextValue.discount.start),
      timestamp(contextValue.discount.end),
      snapshotId(snapshotIds, 'stripe.discount', contextValue.externalId),
      context.observedAt
    )
  }
}

function persistCharges(
  sqlite: Sqlite,
  context: ApplyContext,
  snapshotIds: ReadonlyMap<string, string>
): ReadonlySet<string> {
  const customerExists = sqlite.prepare('select 1 from stripe_customers where id = ?')
  const invoiceExists = sqlite.prepare('select 1 from stripe_invoices where id = ?')
  const invoiceByPaymentIntent = invoicePaymentReferences(context.dataset.invoicePayments)
  const invoiceByCharge = invoiceChargeReferences(context.dataset.invoicePayments)
  const duesChargeIds = new Set<string>()
  const upsertCharge = sqlite.prepare(
    `insert into stripe_charges
       (id, customer_id, invoice_id, payment_intent_id, balance_transaction_id,
        status, revenue_category, amount, amount_captured, amount_refunded, currency,
        paid, disputed, provider_created_at, source_snapshot_id, created_at, updated_at)
     values (?, ?, ?, ?, null, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     on conflict(id) do update set customer_id = excluded.customer_id,
       invoice_id = excluded.invoice_id, payment_intent_id = excluded.payment_intent_id,
       status = excluded.status, revenue_category = excluded.revenue_category,
       amount = excluded.amount, amount_captured = excluded.amount_captured,
       amount_refunded = excluded.amount_refunded, currency = excluded.currency,
       paid = excluded.paid, disputed = excluded.disputed,
       provider_created_at = excluded.provider_created_at,
       source_snapshot_id = excluded.source_snapshot_id, updated_at = excluded.updated_at`
  )
  const upsertLedger = sqlite.prepare(
    `insert into cash_ledger_entries
       (id, occurred_at, kind, amount, currency, category, visibility, description,
        source_type, source_id, source_component, source_snapshot_id, created_at, updated_at)
     values (?, ?, 'dues', ?, ?, 'membership_dues', 'members', 'Stripe membership dues collected',
       'stripe_charge', ?, 'captured', ?, ?, ?)
     on conflict(id) do update set occurred_at = excluded.occurred_at,
       amount = excluded.amount, currency = excluded.currency,
       source_snapshot_id = excluded.source_snapshot_id, updated_at = excluded.updated_at`
  )

  for (const charge of context.dataset.charges) {
    const rawCustomerId = referenceId(charge.customer)
    const customerId = rawCustomerId && customerExists.get(rawCustomerId) ? rawCustomerId : null
    const rawInvoiceId = chargeInvoiceId(charge, invoiceByPaymentIntent, invoiceByCharge)
    const invoiceId = rawInvoiceId && invoiceExists.get(rawInvoiceId) ? rawInvoiceId : null
    const revenueCategory = invoiceId && context.membershipInvoiceIds.has(invoiceId) ? 'dues' : 'unclassified'
    const sourceSnapshotId = snapshotId(snapshotIds, 'stripe.charge', charge.id)
    upsertCharge.run(
      charge.id,
      customerId,
      invoiceId,
      referenceId(charge.payment_intent),
      charge.status,
      revenueCategory,
      charge.amount,
      charge.amount_captured,
      charge.amount_refunded,
      charge.currency.toUpperCase(),
      charge.paid ? 1 : 0,
      charge.disputed ? 1 : 0,
      timestamp(charge.created),
      sourceSnapshotId,
      context.observedAt,
      context.observedAt
    )
    if (revenueCategory !== 'dues' || charge.status !== 'succeeded') continue
    duesChargeIds.add(charge.id)
    if (charge.amount_captured <= 0) continue
    upsertLedger.run(
      deterministicId('cash_stripe_charge', charge.id),
      timestamp(charge.created) ?? context.observedAt,
      charge.amount_captured,
      charge.currency.toUpperCase(),
      charge.id,
      sourceSnapshotId,
      context.observedAt,
      context.observedAt
    )
  }
  return duesChargeIds
}

function persistRefundsAndDisputes(
  sqlite: Sqlite,
  context: ApplyContext,
  snapshotIds: ReadonlyMap<string, string>,
  duesChargeIds: ReadonlySet<string>
): void {
  const chargeExists = sqlite.prepare('select 1 from stripe_charges where id = ?')
  const upsertRefund = sqlite.prepare(
    `insert into stripe_refunds
       (id, charge_id, balance_transaction_id, status, amount, currency, reason,
        provider_created_at, source_snapshot_id, created_at, updated_at)
     values (?, ?, null, ?, ?, ?, ?, ?, ?, ?, ?)
     on conflict(id) do update set charge_id = excluded.charge_id, status = excluded.status,
       amount = excluded.amount, currency = excluded.currency, reason = excluded.reason,
       provider_created_at = excluded.provider_created_at,
       source_snapshot_id = excluded.source_snapshot_id, updated_at = excluded.updated_at`
  )
  const upsertRefundLedger = sqlite.prepare(
    `insert into cash_ledger_entries
       (id, occurred_at, kind, amount, currency, category, visibility, description,
        source_type, source_id, source_component, source_snapshot_id, created_at, updated_at)
     values (?, ?, 'refund', ?, ?, 'membership_dues_refund', 'members', 'Stripe membership dues refund',
       'stripe_refund', ?, 'succeeded', ?, ?, ?)
     on conflict(id) do update set occurred_at = excluded.occurred_at,
       amount = excluded.amount, currency = excluded.currency,
       source_snapshot_id = excluded.source_snapshot_id, updated_at = excluded.updated_at`
  )
  for (const refund of context.dataset.refunds) {
    const chargeId = referenceId(refund.charge)
    if (!chargeId || !chargeExists.get(chargeId)) {
      issue(context.issues, 'refund_charge_missing', 'stripe.refund', refund.id)
      continue
    }
    if (!refund.status || !supportedRefundStatuses.has(refund.status)) {
      issue(context.issues, 'refund_status_unsupported', 'stripe.refund', refund.id)
      continue
    }
    const sourceSnapshotId = snapshotId(snapshotIds, 'stripe.refund', refund.id)
    upsertRefund.run(
      refund.id,
      chargeId,
      refund.status,
      refund.amount,
      refund.currency.toUpperCase(),
      refund.reason,
      timestamp(refund.created),
      sourceSnapshotId,
      context.observedAt,
      context.observedAt
    )
    if (refund.status !== 'succeeded' || !duesChargeIds.has(chargeId) || refund.amount <= 0) continue
    upsertRefundLedger.run(
      deterministicId('cash_stripe_refund', refund.id),
      timestamp(refund.created) ?? context.observedAt,
      -refund.amount,
      refund.currency.toUpperCase(),
      refund.id,
      sourceSnapshotId,
      context.observedAt,
      context.observedAt
    )
  }

  const upsertDispute = sqlite.prepare(
    `insert into stripe_disputes
       (id, charge_id, balance_transaction_id, status, amount, currency, reason,
        provider_created_at, source_snapshot_id, created_at, updated_at)
     values (?, ?, null, ?, ?, ?, ?, ?, ?, ?, ?)
     on conflict(id) do update set charge_id = excluded.charge_id, status = excluded.status,
       amount = excluded.amount, currency = excluded.currency, reason = excluded.reason,
       provider_created_at = excluded.provider_created_at,
       source_snapshot_id = excluded.source_snapshot_id, updated_at = excluded.updated_at`
  )
  for (const dispute of context.dataset.disputes) {
    const chargeId = referenceId(dispute.charge)
    if (!chargeId || !chargeExists.get(chargeId)) {
      issue(context.issues, 'dispute_charge_missing', 'stripe.dispute', dispute.id)
      continue
    }
    upsertDispute.run(
      dispute.id,
      chargeId,
      dispute.status,
      dispute.amount,
      dispute.currency.toUpperCase(),
      dispute.reason,
      timestamp(dispute.created),
      snapshotId(snapshotIds, 'stripe.dispute', dispute.id),
      context.observedAt,
      context.observedAt
    )
  }
}

function persistMembershipsAndStanding(
  sqlite: Sqlite,
  context: ApplyContext,
  snapshotIds: ReadonlyMap<string, string>
): void {
  const subscriptions = new Map(context.dataset.subscriptions.map((value) => [value.id, value]))
  const insertMembership = sqlite.prepare(
    `insert into memberships
       (id, person_id, status, applied_at, started_at, attendance_requirement_starts_at,
        source_snapshot_id, created_at, updated_at)
     values (?, ?, ?, ?, ?, ?, ?, ?, ?)
     on conflict(id) do nothing`
  )
  const currentMapping = sqlite.prepare(
    `select id, membership_id as membershipId from membership_dues_subscriptions
     where subscription_id = ? and effective_to is null`
  )
  const insertMapping = sqlite.prepare(
    `insert into membership_dues_subscriptions
       (id, membership_id, subscription_id, effective_from, source_snapshot_id, created_at)
     values (?, ?, ?, ?, ?, ?)
     on conflict(subscription_id, effective_from) do nothing`
  )

  for (const plan of context.membershipPlans) {
    const firstSubscription = subscriptions.get(plan.subscriptionIds[0]!)
    const sourceSnapshotId = firstSubscription
      ? snapshotId(snapshotIds, 'stripe.subscription', firstSubscription.id)
      : null
    if (plan.action !== 'existing') {
      insertMembership.run(
        plan.membershipId,
        plan.personId,
        plan.action === 'created_active' ? 'active' : 'pending',
        plan.appliedAt,
        plan.startedAt,
        plan.attendanceRequirementStartsAt,
        sourceSnapshotId,
        context.observedAt,
        context.observedAt
      )
    }

    for (const subscriptionId of plan.subscriptionIds) {
      const subscription = subscriptions.get(subscriptionId)
      if (!subscription) continue
      const existing = currentMapping.get(subscriptionId) as { id: string; membershipId: string } | undefined
      if (existing && existing.membershipId !== plan.membershipId) {
        issue(context.issues, 'subscription_membership_conflict', 'stripe.subscription', subscriptionId)
        continue
      }
      if (existing) continue
      const effectiveFrom = laterTimestamp(timestamp(subscription.start_date) ?? plan.appliedAt, plan.appliedAt)
      insertMapping.run(
        deterministicId('membership_dues_subscription', `${subscriptionId}\0${plan.membershipId}\0${effectiveFrom}`),
        plan.membershipId,
        subscriptionId,
        effectiveFrom,
        snapshotId(snapshotIds, 'stripe.subscription', subscriptionId),
        context.observedAt
      )
    }
  }

  persistStanding(sqlite, context, snapshotIds)
}

function persistStanding(sqlite: Sqlite, context: ApplyContext, snapshotIds: ReadonlyMap<string, string>): void {
  for (const plan of context.membershipPlans) {
    const sourceSnapshotId = plan.subscriptionIds[0]
      ? snapshotId(snapshotIds, 'stripe.subscription', plan.subscriptionIds[0])
      : null
    const result = recalculateMembershipStandingInTransaction(sqlite, {
      membershipId: plan.membershipId,
      observedAt: context.observedAt,
      sourceSnapshotId
    })
    if (result.outcome === 'policy_missing') {
      issue(context.issues, 'membership_policy_missing', 'membership.policy', context.observedAt)
    }
  }
}

function fetchedCounts(dataset: StripeMembershipImportDataset, discounts: readonly DiscountContext[]) {
  return {
    charges: dataset.charges.length,
    customers: dataset.customers.length,
    discounts: discounts.length,
    disputes: dataset.disputes.length,
    invoiceLines: sumMapLengths(dataset.invoiceLines),
    invoicePayments: dataset.invoicePayments.length,
    invoices: dataset.invoices.length,
    prices: dataset.prices.length,
    products: dataset.products.length,
    refunds: dataset.refunds.length,
    subscriptionItems: sumMapLengths(dataset.subscriptionItems),
    subscriptions: dataset.subscriptions.length
  }
}

function countIdentityPlans(resolutions: readonly CustomerResolution[]) {
  return {
    ambiguous: resolutions.filter((value) => value.action === 'ambiguous').length,
    created: resolutions.filter((value) => value.action === 'created').length,
    existing: resolutions.filter((value) => value.action === 'existing').length
  }
}

function countMembershipPlans(plans: readonly MembershipPlan[], issues: readonly StripeMembershipImportIssue[]) {
  const blocked = new Set(
    issues
      .filter((value) =>
        ['membership_history_requires_review', 'membership_subscription_unlinked'].includes(value.code)
      )
      .map((value) => value.externalId)
  ).size
  return {
    blocked,
    createdActive: plans.filter((value) => value.action === 'created_active').length,
    createdPending: plans.filter((value) => value.action === 'created_pending').length,
    existing: plans.filter((value) => value.action === 'existing').length
  }
}

function readQualifyingPriceIds(sqlite: Sqlite, prices: readonly Stripe.Price[]): ReadonlySet<string> {
  const rows = sqlite.prepare('select price_id as priceId from membership_dues_prices').all() as Array<{
    priceId: string
  }>
  const configured = new Set(rows.map((value) => value.priceId))
  const resolved = new Set(configured)
  for (const price of prices) {
    if (configured.has(price.id) || (price.lookup_key && configured.has(price.lookup_key))) resolved.add(price.id)
  }
  return resolved
}

function subscriptionQualifies(
  subscriptionId: string,
  dataset: StripeMembershipImportDataset,
  qualifyingPriceIds: ReadonlySet<string>
): boolean {
  return (dataset.subscriptionItems.get(subscriptionId) ?? []).some((item) => qualifyingPriceIds.has(item.price.id))
}

function invoiceSubscriptionId(invoice: Stripe.Invoice): string | null {
  return referenceId(invoice.parent?.subscription_details?.subscription)
}

function lineSubscriptionItemId(line: Stripe.InvoiceLineItem): string | null {
  return line.parent?.subscription_item_details?.subscription_item ?? null
}

function linePriceId(line: Stripe.InvoiceLineItem): string | null {
  return referenceId(line.pricing?.price_details?.price)
}

function lineProductId(line: Stripe.InvoiceLineItem): string | null {
  return line.pricing?.price_details?.product ?? null
}

function paymentIntentReferences(payments: readonly Stripe.InvoicePayment[]): ReadonlyMap<string, readonly string[]> {
  const values = new Map<string, Set<string>>()
  for (const payment of payments) {
    const invoiceId = referenceId(payment.invoice)
    const paymentIntentId = referenceId(payment.payment.payment_intent)
    if (!invoiceId || !paymentIntentId) continue
    const ids = values.get(invoiceId) ?? new Set<string>()
    ids.add(paymentIntentId)
    values.set(invoiceId, ids)
  }
  return new Map([...values].map(([invoiceId, ids]) => [invoiceId, Object.freeze([...ids].sort())]))
}

function invoicePaymentReferences(payments: readonly Stripe.InvoicePayment[]): ReadonlyMap<string, string> {
  return uniqueReverseReferences(
    payments.map((payment) => [referenceId(payment.payment.payment_intent), referenceId(payment.invoice)] as const)
  )
}

function invoiceChargeReferences(payments: readonly Stripe.InvoicePayment[]): ReadonlyMap<string, string> {
  return uniqueReverseReferences(
    payments.map((payment) => [referenceId(payment.payment.charge), referenceId(payment.invoice)] as const)
  )
}

function uniqueReverseReferences(
  pairs: ReadonlyArray<readonly [string | null, string | null]>
): ReadonlyMap<string, string> {
  const candidates = new Map<string, Set<string>>()
  for (const [sourceId, invoiceId] of pairs) {
    if (!sourceId || !invoiceId) continue
    const ids = candidates.get(sourceId) ?? new Set<string>()
    ids.add(invoiceId)
    candidates.set(sourceId, ids)
  }
  return new Map(
    [...candidates]
      .filter(([, invoiceIds]) => invoiceIds.size === 1)
      .map(([sourceId, invoiceIds]) => [sourceId, first(invoiceIds)])
  )
}

function chargeInvoiceId(
  charge: Stripe.Charge,
  invoiceByPaymentIntent: ReadonlyMap<string, string>,
  invoiceByCharge: ReadonlyMap<string, string>
): string | null {
  const invoiceIds = new Set<string>()
  const direct = invoiceByCharge.get(charge.id)
  if (direct) invoiceIds.add(direct)
  const paymentIntentId = referenceId(charge.payment_intent)
  const throughIntent = paymentIntentId ? invoiceByPaymentIntent.get(paymentIntentId) : undefined
  if (throughIntent) invoiceIds.add(throughIntent)
  return invoiceIds.size === 1 ? first(invoiceIds) : null
}

function expandedDiscount(value: string | Stripe.Discount | Stripe.DeletedDiscount): Stripe.Discount | null {
  if (typeof value === 'string' || value.deleted) return null
  return value
}

function expandedCoupon(value: string | Stripe.Coupon | null): Stripe.Coupon | null {
  return value && typeof value !== 'string' ? value : null
}

function referenceId(value: unknown): string | null {
  if (typeof value === 'string') return value
  if (!value || typeof value !== 'object' || !('id' in value)) return null
  const id = (value as { id?: unknown }).id
  return typeof id === 'string' ? id : null
}

function normalizedText(value: unknown, maximumLength: number): string | null {
  if (typeof value !== 'string') return null
  const normalized = value.trim()
  return normalized && normalized.length <= maximumLength ? normalized : null
}

function normalizeEmail(value: unknown): string | null {
  const normalized = normalizedText(value, 320)?.toLowerCase() ?? null
  return normalized?.includes('@') ? normalized : null
}

function normalizePhone(value: unknown): string | null {
  const normalized = normalizedText(value, 320)
  if (!normalized) return null
  const digits = normalized.replace(/\D/g, '')
  if (!digits) return null
  return normalized.startsWith('+') ? `+${digits}` : digits
}

function timestamp(value: number | null | undefined): string | null {
  if (value === null || value === undefined || !Number.isFinite(value)) return null
  const date = new Date(value * 1000)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

function laterTimestamp(left: string, right: string): string {
  return left > right ? left : right
}

function snapshotId(snapshotIds: ReadonlyMap<string, string>, objectType: string, externalId: string): string {
  const id = snapshotIds.get(snapshotKey(objectType, externalId))
  if (!id) throw new Error(`Missing prepared Stripe snapshot for ${objectType}`)
  return id
}

function snapshotKey(objectType: string, externalId: string): string {
  return `${objectType}\0${externalId}`
}

function compareSnapshots(left: PreparedSnapshot, right: PreparedSnapshot): number {
  return left.objectType.localeCompare(right.objectType) || left.externalId.localeCompare(right.externalId)
}

function deterministicId(prefix: string, value: string): string {
  return `${prefix}_${sha256(value).slice(0, 32)}`
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalValue(value))
}

function canonicalValue(value: unknown): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (Array.isArray(value)) return value.map((item) => (item === undefined ? null : canonicalValue(item)))
  if (typeof value !== 'object') return null
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(
        ([key, item]) => !['hosted_invoice_url', 'invoice_pdf', 'lastResponse'].includes(key) && item !== undefined
      )
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, canonicalValue(item)])
  )
}

function issue(issues: StripeMembershipImportIssue[], code: string, objectType: string, externalId: string): void {
  if (
    issues.some((value) => value.code === code && value.objectType === objectType && value.externalId === externalId)
  ) {
    return
  }
  issues.push(Object.freeze({ code, externalId, objectType }))
}

function sumMapLengths<T>(values: ReadonlyMap<string, readonly T[]>): number {
  let count = 0
  for (const rows of values.values()) count += rows.length
  return count
}

function first<T>(values: ReadonlySet<T>): T {
  const value = values.values().next().value as T | undefined
  if (value === undefined) throw new Error('Expected a non-empty set')
  return value
}
