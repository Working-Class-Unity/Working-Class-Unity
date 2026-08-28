import Database from 'better-sqlite3'
import { billingStripeInvariantSql } from '../../server/db/schema/billing.invariants'
import type { BillingStripeConnection } from '../../server/services/payments/stripe/public-contract'

export type BillingStripeRuntimeFixture = Readonly<{
  sqlite: Database.Database
  connection: BillingStripeConnection
  purchaserUserId: string
}>

export function createBillingStripeRuntimeFixture(purchaserUserId = 'purchaser_test'): BillingStripeRuntimeFixture {
  const sqlite = new Database(':memory:')
  sqlite.pragma('foreign_keys = ON')
  sqlite.exec(`
    create table user (
      id text primary key not null,
      email text not null unique,
      email_verified integer not null default 1
    );
    create table account_stripe_memberships (
      user_id text primary key not null references user(id) on delete cascade,
      stripe_customer_id text not null unique,
      stripe_subscription_id text not null unique,
      stripe_price_id text not null,
      tier text not null,
      stripe_status text,
      last_verified_at text,
      projection_order_ms integer not null default 0,
      projection_event_id text,
      created_at text not null default current_timestamp,
      updated_at text not null default current_timestamp
    );
    create table people (
      id text primary key not null
    );
    create table person_accounts (
      person_id text primary key not null references people(id),
      user_id text not null unique references user(id)
    );
    create table identity_link_reviews (
      id text primary key not null,
      user_id text not null references user(id) on delete cascade,
      reason text not null,
      identifier_hash text not null,
      status text not null default 'open',
      resolved_person_id text references people(id) on delete restrict,
      resolved_at text,
      created_at text not null default current_timestamp,
      updated_at text not null default current_timestamp,
      check(reason in ('ambiguous_verified_email', 'conflicting_verified_email',
                       'phone_match_requires_verified_email', 'conflicting_verified_identifiers')),
      check(identifier_hash not glob '*[^0-9a-f]*' and length(identifier_hash) = 64),
      check((status = 'open' and resolved_person_id is null and resolved_at is null) or
            (status = 'resolved' and resolved_person_id is not null and resolved_at is not null and
             julianday(resolved_at) is not null))
    );
    create unique index identity_link_reviews_one_open_user_uidx
      on identity_link_reviews(user_id)
      where status = 'open';
    create index identity_link_reviews_status_idx
      on identity_link_reviews(status, created_at);
    create table stripe_customers (
      id text primary key not null,
      person_id text references people(id)
    );
    create table stripe_subscriptions (
      id text primary key not null,
      customer_id text not null references stripe_customers(id),
      status text not null,
      current_period_start text,
      current_period_end text,
      cancel_at_period_end integer not null default 0
    );
    create table stripe_subscription_items (
      id text primary key not null,
      subscription_id text not null references stripe_subscriptions(id),
      price_id text not null
    );
    create table billing_customers (
      id text primary key not null,
      purchaser_user_id text not null references user(id) on delete restrict,
      stripe_customer_id text not null unique,
      created_at text not null default current_timestamp,
      updated_at text not null default current_timestamp,
      unique(purchaser_user_id),
      check(length(trim(id)) between 1 and 128),
      check(stripe_customer_id glob 'cus_*')
    );
    create table billing_checkout_attempts (
      id text primary key not null,
      purchaser_user_id text not null references user(id) on delete restrict,
      billing_customer_id text references billing_customers(id) on delete cascade,
      plan_key text not null,
      cadence text not null,
      stripe_price_id text not null,
      stripe_session_id text unique,
      idempotency_key text not null unique,
      state text not null default 'pending',
      success_url text not null,
      cancel_url text not null,
      reuse_until text not null,
      created_at text not null default current_timestamp,
      updated_at text not null default current_timestamp,
      check((plan_key = 'personal' and cadence in ('weekly', 'monthly', 'annual')) or
            (plan_key = 'family' and cadence in ('monthly', 'annual'))),
      check(state in ('pending', 'open', 'completed', 'expired', 'failed', 'reconciliation_required')),
      check(stripe_price_id glob 'price_*'),
      check(reuse_until >= created_at)
    );
    create unique index billing_checkout_attempts_one_open_uidx
      on billing_checkout_attempts(purchaser_user_id)
      where state in ('pending', 'open', 'reconciliation_required');
    create table billing_email_verifications (
      id text primary key not null,
      purchaser_user_id text not null references user(id) on delete cascade,
      billing_checkout_attempt_id text not null unique references billing_checkout_attempts(id) on delete cascade,
      stripe_session_id text not null unique,
      email text not null,
      status text not null default 'pending',
      expires_at text not null,
      sent_at text,
      consumed_at text,
      created_at text not null default current_timestamp,
      updated_at text not null default current_timestamp,
      check(status in ('pending', 'sent', 'consumed', 'conflict', 'expired'))
    );
    create index billing_email_verifications_status_expiry_idx
      on billing_email_verifications(status, expires_at);
    create table billing_subscriptions (
      id text primary key not null,
      purchaser_user_id text not null references user(id) on delete restrict,
      billing_customer_id text not null references billing_customers(id) on delete cascade,
      stripe_subscription_id text unique,
      stripe_subscription_item_id text unique,
      status text not null default 'none',
      plan_key text,
      cadence text,
      stripe_price_id text,
      current_period_start text,
      current_period_end text,
      cancel_at_period_end integer not null default 0,
      grace_invoice_id text unique,
      grace_started_at text,
      grace_ends_at text,
      last_verified_at text,
      projection_order_ms integer not null default 0,
      projection_event_id text,
      reconciliation_required integer not null default 0,
      reconciliation_reason text,
      revision integer not null default 0,
      created_at text not null default current_timestamp,
      updated_at text not null default current_timestamp,
      unique(purchaser_user_id),
      unique(billing_customer_id),
      check(status in ('none', 'active', 'canceled', 'incomplete', 'incomplete_expired',
                       'past_due', 'paused', 'trialing', 'unpaid', 'ambiguous')),
      check((plan_key is null and cadence is null) or
            (plan_key is not null and cadence is not null and
             ((plan_key = 'personal' and cadence in ('weekly', 'monthly', 'annual')) or
              (plan_key = 'family' and cadence in ('monthly', 'annual'))))),
      check((grace_invoice_id is null and grace_started_at is null and grace_ends_at is null) or
            (grace_invoice_id is not null and grace_started_at is not null and grace_ends_at is not null and
             grace_ends_at > grace_started_at)),
      check((reconciliation_required = 1 and reconciliation_reason is not null) or
            (reconciliation_required = 0 and reconciliation_reason is null)),
      check(status <> 'none' or
            (stripe_subscription_id is null and stripe_subscription_item_id is null and plan_key is null and
             cadence is null and stripe_price_id is null and current_period_start is null and
             current_period_end is null and cancel_at_period_end = 0 and grace_invoice_id is null and
             grace_started_at is null and grace_ends_at is null)),
      check(revision >= 0)
    );
    create table billing_subscription_transitions (
      id text primary key not null,
      purchaser_user_id text not null references user(id) on delete restrict,
      billing_subscription_id text not null references billing_subscriptions(id) on delete cascade,
      kind text not null,
      source_plan_key text not null,
      source_cadence text not null,
      target_plan_key text not null,
      target_cadence text not null,
      effective_at text,
      stripe_subscription_schedule_id text unique,
      stripe_pending_invoice_id text unique,
      stripe_pending_update_expires_at text,
      idempotency_key text not null unique,
      captured_billing_revision integer not null,
      state text not null default 'pending',
      state_reason text,
      revision integer not null default 0,
      created_at text not null default current_timestamp,
      updated_at text not null default current_timestamp,
      check(kind in ('cadence_change', 'personal_to_family', 'family_to_personal')),
      check(state in ('pending', 'action_required', 'scheduled', 'reconciliation_required',
                      'applied', 'failed', 'canceled')),
      check((source_plan_key = 'personal' and source_cadence in ('weekly', 'monthly', 'annual')) or
            (source_plan_key = 'family' and source_cadence in ('monthly', 'annual'))),
      check((target_plan_key = 'personal' and target_cadence in ('weekly', 'monthly', 'annual')) or
            (target_plan_key = 'family' and target_cadence in ('monthly', 'annual'))),
      check((kind = 'cadence_change' and source_plan_key = target_plan_key and source_cadence <> target_cadence) or
            (kind = 'personal_to_family' and source_plan_key = 'personal' and target_plan_key = 'family') or
            (kind = 'family_to_personal' and source_plan_key = 'family' and target_plan_key = 'personal')),
      check(kind = 'personal_to_family' or effective_at is not null),
      check(kind = 'personal_to_family' or stripe_pending_update_expires_at is null),
      check(state_reason is null or length(trim(state_reason)) between 1 and 128),
      check(captured_billing_revision >= 0 and revision >= 0)
    );
    create unique index billing_subscription_transitions_one_open_uidx
      on billing_subscription_transitions(purchaser_user_id)
      where state in ('pending', 'action_required', 'scheduled', 'reconciliation_required');
    create table billing_account_deletion_requests (
      id text primary key not null,
      purchaser_user_id text not null references user(id) on delete restrict,
      billing_subscription_id text references billing_subscriptions(id) on delete restrict,
      billing_customer_id text references billing_customers(id) on delete restrict,
      stripe_membership_user_id text references account_stripe_memberships(user_id) on delete restrict,
      expected_stripe_subscription_id text,
      expected_stripe_customer_id text,
      captured_billing_revision integer not null default 0,
      state text not null default 'pending',
      reason text,
      cancellation_confirmed_at text,
      revision integer not null default 0,
      created_at text not null default current_timestamp,
      updated_at text not null default current_timestamp,
      unique(purchaser_user_id),
      unique(billing_subscription_id),
      check(state in ('pending', 'reconciliation_required', 'cancellation_confirmed')),
      check(length(trim(id)) between 1 and 128),
      check((state = 'reconciliation_required' and reason is not null and length(trim(reason)) between 1 and 128) or
            (state <> 'reconciliation_required' and reason is null)),
      check((state = 'cancellation_confirmed' and cancellation_confirmed_at is not null) or
            (state <> 'cancellation_confirmed' and cancellation_confirmed_at is null)),
      check((((billing_customer_id is null and expected_stripe_customer_id is null) or
               (billing_customer_id is not null and expected_stripe_customer_id is not null and
                length(trim(expected_stripe_customer_id)) between 1 and 255 and
                expected_stripe_customer_id glob 'cus_*'))) and
             (((billing_subscription_id is null and expected_stripe_subscription_id is null) or
               (billing_subscription_id is not null and expected_stripe_subscription_id is not null and
                length(trim(expected_stripe_subscription_id)) between 1 and 255 and
                expected_stripe_subscription_id glob 'sub_*')))),
      check(captured_billing_revision >= 0 and revision >= 0)
    );
    create table billing_events (
      id integer primary key autoincrement not null,
      stripe_event_id text not null unique,
      event_type text not null,
      provider_created_at integer,
      processed_at text not null,
      check(provider_created_at is null or provider_created_at >= 0)
    );
    create table detached_billing_subjects (
      id text primary key not null,
      provider text not null,
      provider_reference text not null,
      provider_customer_reference text,
      provider_status text not null,
      provider_status_expires_at text,
      provider_event_created_at integer,
      status_updated_at text not null,
      deleted_at text not null,
      retention_purpose text not null,
      retention_policy text not null,
      purge_after text,
      unique(provider, provider_reference),
      check(provider = 'stripe'),
      check(retention_purpose = 'external_billing_reconciliation'),
      check(retention_policy = 'stripe_billing_lifecycle'),
      check(purge_after is null or purge_after >= deleted_at),
      check(provider_event_created_at is null or provider_event_created_at >= 0)
    );
    create table job_queue (
      id integer primary key autoincrement not null,
      type text not null,
      status text not null default 'queued',
      payload text not null,
      attempts integer not null default 0,
      max_attempts integer not null default 3,
      run_after text,
      locked_at text,
      locked_by text,
      last_error text,
      created_at text not null default current_timestamp,
      updated_at text not null default current_timestamp
    );
  `)
  sqlite.exec(billingStripeInvariantSql)
  sqlite.prepare('insert into user (id, email) values (?, ?)').run(purchaserUserId, `${purchaserUserId}@example.test`)
  return { sqlite, connection: { sqlite }, purchaserUserId }
}

export function seedBillingCustomer(fixture: BillingStripeRuntimeFixture, stripeCustomerId = 'cus_test'): string {
  const id = `billing_customer_${fixture.purchaserUserId}`
  fixture.sqlite
    .prepare(
      `insert into billing_customers (id, purchaser_user_id, stripe_customer_id)
       values (?, ?, ?)`
    )
    .run(id, fixture.purchaserUserId, stripeCustomerId)
  return id
}

export function seedAccountStripeMembership(
  fixture: BillingStripeRuntimeFixture,
  input: Readonly<{
    stripeCustomerId?: string
    stripeSubscriptionId?: string
    stripePriceId?: string
    tier?: 'supporter' | 'member' | 'solidarity'
  }> = {}
): void {
  fixture.sqlite
    .prepare(
      `insert into account_stripe_memberships
         (user_id, stripe_customer_id, stripe_subscription_id, stripe_price_id, tier)
       values (?, ?, ?, ?, ?)`
    )
    .run(
      fixture.purchaserUserId,
      input.stripeCustomerId ?? 'cus_membership_test',
      input.stripeSubscriptionId ?? 'sub_membership_test',
      input.stripePriceId ?? 'price_membership_test',
      input.tier ?? 'member'
    )
}

export function seedBillingSubscription(
  fixture: BillingStripeRuntimeFixture,
  input: Readonly<{
    customerId?: string
    stripeSubscriptionId?: string | null
    stripeSubscriptionItemId?: string | null
    status?: string
    planKey?: string | null
    cadence?: string | null
    stripePriceId?: string | null
    currentPeriodStart?: string | null
    currentPeriodEnd?: string | null
    cancelAtPeriodEnd?: boolean
    graceInvoiceId?: string | null
    graceStartedAt?: string | null
    graceEndsAt?: string | null
    projectionOrderMs?: number
    projectionEventId?: string | null
    reconciliationRequired?: boolean
    reconciliationReason?: string | null
    revision?: number
  }> = {}
): string {
  const id = `billing_subscription_${fixture.purchaserUserId}`
  fixture.sqlite
    .prepare(
      `insert into billing_subscriptions (
         id, purchaser_user_id, billing_customer_id, stripe_subscription_id,
         stripe_subscription_item_id, status, plan_key, cadence, stripe_price_id,
         current_period_start, current_period_end, cancel_at_period_end,
         grace_invoice_id, grace_started_at, grace_ends_at, last_verified_at,
         projection_order_ms, projection_event_id, reconciliation_required,
         reconciliation_reason, revision
       ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      id,
      fixture.purchaserUserId,
      input.customerId ?? `billing_customer_${fixture.purchaserUserId}`,
      input.stripeSubscriptionId === undefined ? 'sub_test' : input.stripeSubscriptionId,
      input.stripeSubscriptionItemId === undefined ? 'si_test' : input.stripeSubscriptionItemId,
      input.status ?? 'active',
      input.planKey === undefined ? 'family' : input.planKey,
      input.cadence === undefined ? 'monthly' : input.cadence,
      input.stripePriceId === undefined ? 'price_family_monthly' : input.stripePriceId,
      input.currentPeriodStart === undefined ? '2026-07-01T00:00:00.000Z' : input.currentPeriodStart,
      input.currentPeriodEnd === undefined ? '2026-08-01T00:00:00.000Z' : input.currentPeriodEnd,
      input.cancelAtPeriodEnd ? 1 : 0,
      input.graceInvoiceId ?? null,
      input.graceStartedAt ?? null,
      input.graceEndsAt ?? null,
      '2026-07-01T00:00:00.000Z',
      input.projectionOrderMs ?? 0,
      input.projectionEventId ?? null,
      input.reconciliationRequired ? 1 : 0,
      input.reconciliationReason ?? null,
      input.revision ?? 0
    )
  return id
}

export function seedCheckoutAttempt(
  fixture: BillingStripeRuntimeFixture,
  input: Readonly<{
    id?: string
    customerId?: string | null
    state?: string
    stripeSessionId?: string | null
  }> = {}
): string {
  const id = input.id ?? 'billing_attempt_test'
  fixture.sqlite
    .prepare(
      `insert into billing_checkout_attempts (
         id, purchaser_user_id, billing_customer_id, plan_key, cadence, stripe_price_id,
         stripe_session_id, idempotency_key, state, success_url, cancel_url, reuse_until,
         created_at, updated_at
       ) values (?, ?, ?, 'family', 'monthly', 'price_family_monthly', ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      id,
      fixture.purchaserUserId,
      input.customerId ?? null,
      input.stripeSessionId ?? null,
      `checkout_${id}`,
      input.state ?? 'pending',
      'https://app.example.test/account?checkout=success',
      'https://app.example.test/account?checkout=cancelled',
      '2026-08-01T00:00:00.000Z',
      '2026-07-15T12:00:00.000Z',
      '2026-07-15T12:00:00.000Z'
    )
  return id
}

export function seedDetachedSubject(
  fixture: BillingStripeRuntimeFixture,
  input: Readonly<{
    providerReference: string
    customerReference?: string | null
    status?: string
    eventCreatedAt?: number | null
  }>
): string {
  const id = `detached_${input.providerReference.replace(/[^a-z0-9]/gi, '_')}`
  fixture.sqlite
    .prepare(
      `insert into detached_billing_subjects (
         id, provider, provider_reference, provider_customer_reference, provider_status,
         provider_status_expires_at, provider_event_created_at, status_updated_at, deleted_at,
         retention_purpose, retention_policy, purge_after
       ) values (?, 'stripe', ?, ?, ?, null, ?, ?, ?,
                 'external_billing_reconciliation', 'stripe_billing_lifecycle', null)`
    )
    .run(
      id,
      input.providerReference,
      input.customerReference ?? null,
      input.status ?? 'active',
      input.eventCreatedAt ?? null,
      '2026-07-15T00:00:00.000Z',
      '2026-07-15T00:00:00.000Z'
    )
  return id
}
