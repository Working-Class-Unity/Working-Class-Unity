export const billingStripeInvariantSql: string = `
create trigger if not exists billing_checkout_customer_purchaser_insert
before insert on billing_checkout_attempts
when new.billing_customer_id is not null and not exists (
  select 1 from billing_customers customer
  where customer.id = new.billing_customer_id
    and customer.purchaser_user_id = new.purchaser_user_id
)
begin
  select raise(abort, 'billing checkout customer purchaser mismatch');
end;
--> statement-breakpoint

create trigger if not exists billing_checkout_customer_purchaser_update
before update of billing_customer_id, purchaser_user_id on billing_checkout_attempts
when new.billing_customer_id is not null and not exists (
  select 1 from billing_customers customer
  where customer.id = new.billing_customer_id
    and customer.purchaser_user_id = new.purchaser_user_id
)
begin
  select raise(abort, 'billing checkout customer purchaser mismatch');
end;
--> statement-breakpoint

create trigger if not exists billing_subscription_customer_purchaser_insert
before insert on billing_subscriptions
when not exists (
  select 1 from billing_customers customer
  where customer.id = new.billing_customer_id
    and customer.purchaser_user_id = new.purchaser_user_id
)
begin
  select raise(abort, 'billing subscription customer purchaser mismatch');
end;
--> statement-breakpoint

create trigger if not exists billing_subscription_customer_purchaser_update
before update of billing_customer_id, purchaser_user_id on billing_subscriptions
when not exists (
  select 1 from billing_customers customer
  where customer.id = new.billing_customer_id
    and customer.purchaser_user_id = new.purchaser_user_id
)
begin
  select raise(abort, 'billing subscription customer purchaser mismatch');
end;
--> statement-breakpoint

create trigger if not exists billing_subscription_offering_reconciliation_insert
before insert on billing_subscriptions
when new.status not in ('none', 'canceled', 'incomplete_expired')
  and (new.plan_key is null or new.cadence is null)
  and new.reconciliation_required = 0
begin
  select raise(abort, 'billing subscription offering requires reconciliation');
end;
--> statement-breakpoint

create trigger if not exists billing_subscription_offering_reconciliation_update
before update of status, plan_key, cadence, reconciliation_required on billing_subscriptions
when new.status not in ('none', 'canceled', 'incomplete_expired')
  and (new.plan_key is null or new.cadence is null)
  and new.reconciliation_required = 0
begin
  select raise(abort, 'billing subscription offering requires reconciliation');
end;
--> statement-breakpoint

create trigger if not exists billing_transition_subscription_purchaser_insert
before insert on billing_subscription_transitions
when not exists (
  select 1 from billing_subscriptions subscription
  where subscription.id = new.billing_subscription_id
    and subscription.purchaser_user_id = new.purchaser_user_id
    and subscription.revision = new.captured_billing_revision
    and subscription.plan_key = new.source_plan_key
    and subscription.cadence = new.source_cadence
)
begin
  select raise(abort, 'billing transition subscription purchaser mismatch');
end;
--> statement-breakpoint

create trigger if not exists billing_transition_subscription_purchaser_update
before update of billing_subscription_id, purchaser_user_id, captured_billing_revision,
  source_plan_key, source_cadence on billing_subscription_transitions
when not exists (
  select 1 from billing_subscriptions subscription
  where subscription.id = new.billing_subscription_id
    and subscription.purchaser_user_id = new.purchaser_user_id
    and subscription.revision = new.captured_billing_revision
    and subscription.plan_key = new.source_plan_key
    and subscription.cadence = new.source_cadence
)
begin
  select raise(abort, 'billing transition subscription purchaser mismatch');
end;
--> statement-breakpoint

create trigger if not exists billing_deletion_references_insert
before insert on billing_account_deletion_requests
when
  (new.billing_customer_id is not null and not exists (
    select 1 from billing_customers customer
    where customer.id = new.billing_customer_id
      and customer.purchaser_user_id = new.purchaser_user_id
      and customer.stripe_customer_id = new.expected_stripe_customer_id
  ))
  or
  (new.billing_subscription_id is not null and not exists (
    select 1 from billing_subscriptions subscription
    inner join billing_customers customer on customer.id = subscription.billing_customer_id
    where subscription.id = new.billing_subscription_id
      and subscription.purchaser_user_id = new.purchaser_user_id
      and subscription.stripe_subscription_id = new.expected_stripe_subscription_id
      and subscription.revision = new.captured_billing_revision
      and customer.id = new.billing_customer_id
      and customer.stripe_customer_id = new.expected_stripe_customer_id
  ))
  or (new.billing_subscription_id is null and new.captured_billing_revision <> 0)
begin
  select raise(abort, 'billing deletion reference mismatch');
end;
--> statement-breakpoint

create trigger if not exists billing_deletion_references_update
before update of purchaser_user_id, billing_customer_id, billing_subscription_id,
  expected_stripe_customer_id, expected_stripe_subscription_id, captured_billing_revision
  on billing_account_deletion_requests
when
  (new.billing_customer_id is not null and not exists (
    select 1 from billing_customers customer
    where customer.id = new.billing_customer_id
      and customer.purchaser_user_id = new.purchaser_user_id
      and customer.stripe_customer_id = new.expected_stripe_customer_id
  ))
  or
  (new.billing_subscription_id is not null and not exists (
    select 1 from billing_subscriptions subscription
    inner join billing_customers customer on customer.id = subscription.billing_customer_id
    where subscription.id = new.billing_subscription_id
      and subscription.purchaser_user_id = new.purchaser_user_id
      and subscription.stripe_subscription_id = new.expected_stripe_subscription_id
      and subscription.revision = new.captured_billing_revision
      and customer.id = new.billing_customer_id
      and customer.stripe_customer_id = new.expected_stripe_customer_id
  ))
  or (new.billing_subscription_id is null and new.captured_billing_revision <> 0)
begin
  select raise(abort, 'billing deletion reference mismatch');
end;
--> statement-breakpoint

create trigger if not exists billing_deletion_membership_reference_insert
before insert on billing_account_deletion_requests
when new.stripe_membership_user_id is not null and (
  new.stripe_membership_user_id <> new.purchaser_user_id
  or not exists (
    select 1 from account_stripe_memberships membership
    where membership.user_id = new.stripe_membership_user_id
  )
)
begin
  select raise(abort, 'billing deletion membership reference mismatch');
end;
--> statement-breakpoint

create trigger if not exists billing_deletion_membership_reference_update
before update of purchaser_user_id, stripe_membership_user_id on billing_account_deletion_requests
when new.stripe_membership_user_id is not null and (
  new.stripe_membership_user_id <> new.purchaser_user_id
  or not exists (
    select 1 from account_stripe_memberships membership
    where membership.user_id = new.stripe_membership_user_id
  )
)
begin
  select raise(abort, 'billing deletion membership reference mismatch');
end;
--> statement-breakpoint

create trigger if not exists account_stripe_membership_deletion_insert
before insert on account_stripe_memberships
when exists (
  select 1 from billing_account_deletion_requests request
  where request.purchaser_user_id = new.user_id
)
begin
  select raise(abort, 'account Stripe membership is fenced for deletion');
end;
--> statement-breakpoint

create trigger if not exists account_stripe_membership_deletion_update
before update of user_id, stripe_customer_id, stripe_subscription_id on account_stripe_memberships
when exists (
  select 1 from billing_account_deletion_requests request
  where request.purchaser_user_id in (old.user_id, new.user_id)
)
begin
  select raise(abort, 'account Stripe membership is fenced for deletion');
end;
--> statement-breakpoint

create trigger if not exists account_stripe_membership_deletion_delete
before delete on account_stripe_memberships
when exists (
  select 1 from billing_account_deletion_requests request
  where request.purchaser_user_id = old.user_id
)
begin
  select raise(abort, 'account Stripe membership is fenced for deletion');
end;
`
