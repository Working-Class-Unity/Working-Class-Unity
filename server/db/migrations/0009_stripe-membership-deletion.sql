ALTER TABLE `billing_account_deletion_requests` ADD `stripe_membership_user_id` text REFERENCES account_stripe_memberships(user_id);--> statement-breakpoint
CREATE TRIGGER `billing_deletion_membership_reference_insert`
BEFORE INSERT ON `billing_account_deletion_requests`
WHEN new.stripe_membership_user_id IS NOT NULL AND (
  new.stripe_membership_user_id <> new.purchaser_user_id
  OR NOT EXISTS (
    SELECT 1 FROM account_stripe_memberships membership
    WHERE membership.user_id = new.stripe_membership_user_id
  )
)
BEGIN
  SELECT raise(abort, 'billing deletion membership reference mismatch');
END;--> statement-breakpoint
CREATE TRIGGER `billing_deletion_membership_reference_update`
BEFORE UPDATE OF purchaser_user_id, stripe_membership_user_id ON `billing_account_deletion_requests`
WHEN new.stripe_membership_user_id IS NOT NULL AND (
  new.stripe_membership_user_id <> new.purchaser_user_id
  OR NOT EXISTS (
    SELECT 1 FROM account_stripe_memberships membership
    WHERE membership.user_id = new.stripe_membership_user_id
  )
)
BEGIN
  SELECT raise(abort, 'billing deletion membership reference mismatch');
END;--> statement-breakpoint
CREATE TRIGGER `account_stripe_membership_deletion_insert`
BEFORE INSERT ON `account_stripe_memberships`
WHEN EXISTS (
  SELECT 1 FROM billing_account_deletion_requests request
  WHERE request.purchaser_user_id = new.user_id
)
BEGIN
  SELECT raise(abort, 'account Stripe membership is fenced for deletion');
END;--> statement-breakpoint
CREATE TRIGGER `account_stripe_membership_deletion_update`
BEFORE UPDATE OF user_id, stripe_customer_id, stripe_subscription_id ON `account_stripe_memberships`
WHEN EXISTS (
  SELECT 1 FROM billing_account_deletion_requests request
  WHERE request.purchaser_user_id IN (old.user_id, new.user_id)
)
BEGIN
  SELECT raise(abort, 'account Stripe membership is fenced for deletion');
END;--> statement-breakpoint
CREATE TRIGGER `account_stripe_membership_deletion_delete`
BEFORE DELETE ON `account_stripe_memberships`
WHEN EXISTS (
  SELECT 1 FROM billing_account_deletion_requests request
  WHERE request.purchaser_user_id = old.user_id
)
BEGIN
  SELECT raise(abort, 'account Stripe membership is fenced for deletion');
END;
