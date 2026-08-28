CREATE TABLE `__new_account_stripe_memberships` (
	`user_id` text PRIMARY KEY NOT NULL,
	`stripe_customer_id` text NOT NULL,
	`stripe_subscription_id` text NOT NULL,
	`stripe_price_id` text NOT NULL,
	`tier` text NOT NULL,
	`stripe_status` text,
	`last_verified_at` text,
	`projection_order_ms` integer DEFAULT 0 NOT NULL,
	`projection_event_id` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "account_stripe_memberships_customer_check" CHECK(`stripe_customer_id` glob 'cus_*'),
	CONSTRAINT "account_stripe_memberships_subscription_check" CHECK(`stripe_subscription_id` glob 'sub_*'),
	CONSTRAINT "account_stripe_memberships_price_check" CHECK(length(`stripe_price_id`) between 1 and 255),
	CONSTRAINT "account_stripe_memberships_tier_check" CHECK(`tier` in ('supporter', 'member', 'solidarity'))
);--> statement-breakpoint
INSERT INTO `__new_account_stripe_memberships`
  (`user_id`, `stripe_customer_id`, `stripe_subscription_id`, `stripe_price_id`, `tier`,
   `stripe_status`, `last_verified_at`, `projection_order_ms`, `projection_event_id`, `created_at`, `updated_at`)
SELECT `user_id`, `stripe_customer_id`, `stripe_subscription_id`, `stripe_price_id`, `tier`,
       `stripe_status`, `last_verified_at`, `projection_order_ms`, `projection_event_id`, `created_at`, `updated_at`
FROM `account_stripe_memberships`;--> statement-breakpoint
CREATE TABLE `__new_billing_account_deletion_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`purchaser_user_id` text NOT NULL,
	`billing_subscription_id` text,
	`billing_customer_id` text,
	`stripe_membership_user_id` text,
	`expected_stripe_subscription_id` text,
	`expected_stripe_customer_id` text,
	`captured_billing_revision` integer DEFAULT 0 NOT NULL,
	`state` text DEFAULT 'pending' NOT NULL,
	`reason` text,
	`cancellation_confirmed_at` text,
	`revision` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`purchaser_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`billing_subscription_id`) REFERENCES `billing_subscriptions`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`billing_customer_id`) REFERENCES `billing_customers`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`stripe_membership_user_id`) REFERENCES `__new_account_stripe_memberships`(`user_id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "billing_account_deletion_requests_state_check" CHECK(`state` in ('pending', 'reconciliation_required', 'cancellation_confirmed')),
	CONSTRAINT "billing_account_deletion_requests_id_check" CHECK(length(trim(`id`)) between 1 and 128),
	CONSTRAINT "billing_account_deletion_requests_reason_check" CHECK((`state` = 'reconciliation_required' and `reason` is not null and length(trim(`reason`)) between 1 and 128) or (`state` <> 'reconciliation_required' and `reason` is null)),
	CONSTRAINT "billing_account_deletion_requests_confirmation_check" CHECK((`state` = 'cancellation_confirmed' and `cancellation_confirmed_at` is not null) or (`state` <> 'cancellation_confirmed' and `cancellation_confirmed_at` is null)),
	CONSTRAINT "billing_account_deletion_requests_reference_check" CHECK((((`billing_customer_id` is null and `expected_stripe_customer_id` is null) or (`billing_customer_id` is not null and `expected_stripe_customer_id` is not null and length(trim(`expected_stripe_customer_id`)) between 1 and 255 and `expected_stripe_customer_id` glob 'cus_*')) and ((`billing_subscription_id` is null and `expected_stripe_subscription_id` is null) or (`billing_subscription_id` is not null and `expected_stripe_subscription_id` is not null and length(trim(`expected_stripe_subscription_id`)) between 1 and 255 and `expected_stripe_subscription_id` glob 'sub_*')))),
	CONSTRAINT "billing_account_deletion_requests_revision_check" CHECK(`captured_billing_revision` >= 0 and `revision` >= 0)
);--> statement-breakpoint
INSERT INTO `__new_billing_account_deletion_requests`
  (`id`, `purchaser_user_id`, `billing_subscription_id`, `billing_customer_id`,
   `stripe_membership_user_id`, `expected_stripe_subscription_id`, `expected_stripe_customer_id`,
   `captured_billing_revision`, `state`, `reason`, `cancellation_confirmed_at`, `revision`, `created_at`, `updated_at`)
SELECT `id`, `purchaser_user_id`, `billing_subscription_id`, `billing_customer_id`,
       `stripe_membership_user_id`, `expected_stripe_subscription_id`, `expected_stripe_customer_id`,
       `captured_billing_revision`, `state`, `reason`, `cancellation_confirmed_at`, `revision`, `created_at`, `updated_at`
FROM `billing_account_deletion_requests`;--> statement-breakpoint
DROP TABLE `billing_account_deletion_requests`;--> statement-breakpoint
DROP TABLE `account_stripe_memberships`;--> statement-breakpoint
ALTER TABLE `__new_account_stripe_memberships` RENAME TO `account_stripe_memberships`;--> statement-breakpoint
ALTER TABLE `__new_billing_account_deletion_requests` RENAME TO `billing_account_deletion_requests`;--> statement-breakpoint
CREATE UNIQUE INDEX `account_stripe_memberships_customer_uidx` ON `account_stripe_memberships` (`stripe_customer_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `account_stripe_memberships_subscription_uidx` ON `account_stripe_memberships` (`stripe_subscription_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `billing_account_deletion_requests_purchaser_user_id_uidx` ON `billing_account_deletion_requests` (`purchaser_user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `billing_account_deletion_requests_subscription_id_uidx` ON `billing_account_deletion_requests` (`billing_subscription_id`);--> statement-breakpoint
CREATE TRIGGER `billing_deletion_references_insert`
BEFORE INSERT ON `billing_account_deletion_requests`
WHEN
  (NEW.`billing_customer_id` IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM `billing_customers` AS `customer`
    WHERE `customer`.`id` = NEW.`billing_customer_id`
      AND `customer`.`purchaser_user_id` = NEW.`purchaser_user_id`
      AND `customer`.`stripe_customer_id` = NEW.`expected_stripe_customer_id`
  ))
  OR
  (NEW.`billing_subscription_id` IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM `billing_subscriptions` AS `subscription`
    INNER JOIN `billing_customers` AS `customer` ON `customer`.`id` = `subscription`.`billing_customer_id`
    WHERE `subscription`.`id` = NEW.`billing_subscription_id`
      AND `subscription`.`purchaser_user_id` = NEW.`purchaser_user_id`
      AND `subscription`.`stripe_subscription_id` = NEW.`expected_stripe_subscription_id`
      AND `subscription`.`revision` = NEW.`captured_billing_revision`
      AND `customer`.`id` = NEW.`billing_customer_id`
      AND `customer`.`stripe_customer_id` = NEW.`expected_stripe_customer_id`
  ))
  OR (NEW.`billing_subscription_id` IS NULL AND NEW.`captured_billing_revision` <> 0)
BEGIN
  SELECT RAISE(ABORT, 'billing deletion reference mismatch');
END;--> statement-breakpoint
CREATE TRIGGER `billing_deletion_references_update`
BEFORE UPDATE OF `purchaser_user_id`, `billing_customer_id`, `billing_subscription_id`,
  `expected_stripe_customer_id`, `expected_stripe_subscription_id`, `captured_billing_revision`
  ON `billing_account_deletion_requests`
WHEN
  (NEW.`billing_customer_id` IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM `billing_customers` AS `customer`
    WHERE `customer`.`id` = NEW.`billing_customer_id`
      AND `customer`.`purchaser_user_id` = NEW.`purchaser_user_id`
      AND `customer`.`stripe_customer_id` = NEW.`expected_stripe_customer_id`
  ))
  OR
  (NEW.`billing_subscription_id` IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM `billing_subscriptions` AS `subscription`
    INNER JOIN `billing_customers` AS `customer` ON `customer`.`id` = `subscription`.`billing_customer_id`
    WHERE `subscription`.`id` = NEW.`billing_subscription_id`
      AND `subscription`.`purchaser_user_id` = NEW.`purchaser_user_id`
      AND `subscription`.`stripe_subscription_id` = NEW.`expected_stripe_subscription_id`
      AND `subscription`.`revision` = NEW.`captured_billing_revision`
      AND `customer`.`id` = NEW.`billing_customer_id`
      AND `customer`.`stripe_customer_id` = NEW.`expected_stripe_customer_id`
  ))
  OR (NEW.`billing_subscription_id` IS NULL AND NEW.`captured_billing_revision` <> 0)
BEGIN
  SELECT RAISE(ABORT, 'billing deletion reference mismatch');
END;--> statement-breakpoint
CREATE TRIGGER `billing_deletion_membership_reference_insert`
BEFORE INSERT ON `billing_account_deletion_requests`
WHEN NEW.`stripe_membership_user_id` IS NOT NULL AND (
  NEW.`stripe_membership_user_id` <> NEW.`purchaser_user_id`
  OR NOT EXISTS (
    SELECT 1 FROM `account_stripe_memberships` AS `membership`
    WHERE `membership`.`user_id` = NEW.`stripe_membership_user_id`
  )
)
BEGIN
  SELECT RAISE(ABORT, 'billing deletion membership reference mismatch');
END;--> statement-breakpoint
CREATE TRIGGER `billing_deletion_membership_reference_update`
BEFORE UPDATE OF `purchaser_user_id`, `stripe_membership_user_id` ON `billing_account_deletion_requests`
WHEN NEW.`stripe_membership_user_id` IS NOT NULL AND (
  NEW.`stripe_membership_user_id` <> NEW.`purchaser_user_id`
  OR NOT EXISTS (
    SELECT 1 FROM `account_stripe_memberships` AS `membership`
    WHERE `membership`.`user_id` = NEW.`stripe_membership_user_id`
  )
)
BEGIN
  SELECT RAISE(ABORT, 'billing deletion membership reference mismatch');
END;--> statement-breakpoint
CREATE TRIGGER `account_stripe_membership_deletion_insert`
BEFORE INSERT ON `account_stripe_memberships`
WHEN EXISTS (
  SELECT 1 FROM `billing_account_deletion_requests` AS `request`
  WHERE `request`.`purchaser_user_id` = NEW.`user_id`
)
BEGIN
  SELECT RAISE(ABORT, 'account Stripe membership is fenced for deletion');
END;--> statement-breakpoint
CREATE TRIGGER `account_stripe_membership_deletion_update`
BEFORE UPDATE OF `user_id`, `stripe_customer_id`, `stripe_subscription_id` ON `account_stripe_memberships`
WHEN EXISTS (
  SELECT 1 FROM `billing_account_deletion_requests` AS `request`
  WHERE `request`.`purchaser_user_id` IN (OLD.`user_id`, NEW.`user_id`)
)
BEGIN
  SELECT RAISE(ABORT, 'account Stripe membership is fenced for deletion');
END;--> statement-breakpoint
CREATE TRIGGER `account_stripe_membership_deletion_delete`
BEFORE DELETE ON `account_stripe_memberships`
WHEN EXISTS (
  SELECT 1 FROM `billing_account_deletion_requests` AS `request`
  WHERE `request`.`purchaser_user_id` = OLD.`user_id`
)
BEGIN
  SELECT RAISE(ABORT, 'account Stripe membership is fenced for deletion');
END;
