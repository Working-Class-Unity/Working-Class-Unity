DROP TRIGGER `member_external_family_authority_before_insert`;--> statement-breakpoint
DROP TRIGGER `member_external_family_authority_before_update`;--> statement-breakpoint
DROP TRIGGER `billing_checkout_external_family_authority_before_insert`;--> statement-breakpoint
DROP TRIGGER `billing_checkout_external_family_authority_before_update`;--> statement-breakpoint
DROP TRIGGER `billing_subscription_external_family_authority_before_insert`;--> statement-breakpoint
DROP TRIGGER `billing_subscription_external_family_authority_before_update`;--> statement-breakpoint
CREATE TABLE `billing_account_deletion_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`organization_id` text NOT NULL,
	`billing_subscription_id` text,
	`billing_customer_id` text NOT NULL,
	`expected_stripe_subscription_id` text,
	`expected_stripe_customer_id` text NOT NULL,
	`captured_billing_revision` integer NOT NULL,
	`state` text DEFAULT 'pending' NOT NULL,
	`reason` text,
	`cancellation_confirmed_at` text,
	`revision` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`billing_subscription_id`) REFERENCES `billing_subscriptions`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`billing_customer_id`) REFERENCES `billing_customers`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "billing_account_deletion_requests_state_check" CHECK("billing_account_deletion_requests"."state" in ('pending', 'reconciliation_required', 'cancellation_confirmed')),
	CONSTRAINT "billing_account_deletion_requests_id_check" CHECK(length(trim("billing_account_deletion_requests"."id")) between 1 and 128),
	CONSTRAINT "billing_account_deletion_requests_reason_check" CHECK(("billing_account_deletion_requests"."state" = 'reconciliation_required' and "billing_account_deletion_requests"."reason" is not null and length(trim("billing_account_deletion_requests"."reason")) between 1 and 128) or ("billing_account_deletion_requests"."state" <> 'reconciliation_required' and "billing_account_deletion_requests"."reason" is null)),
	CONSTRAINT "billing_account_deletion_requests_confirmation_check" CHECK(("billing_account_deletion_requests"."state" = 'cancellation_confirmed' and "billing_account_deletion_requests"."cancellation_confirmed_at" is not null) or ("billing_account_deletion_requests"."state" <> 'cancellation_confirmed' and "billing_account_deletion_requests"."cancellation_confirmed_at" is null)),
	CONSTRAINT "billing_account_deletion_requests_revision_check" CHECK("billing_account_deletion_requests"."captured_billing_revision" >= 0 and "billing_account_deletion_requests"."revision" >= 0),
	CONSTRAINT "billing_account_deletion_requests_reference_check" CHECK((("billing_account_deletion_requests"."billing_subscription_id" is null and "billing_account_deletion_requests"."expected_stripe_subscription_id" is null) or ("billing_account_deletion_requests"."billing_subscription_id" is not null and "billing_account_deletion_requests"."expected_stripe_subscription_id" is not null and length(trim("billing_account_deletion_requests"."expected_stripe_subscription_id")) between 1 and 255)) and length(trim("billing_account_deletion_requests"."expected_stripe_customer_id")) between 1 and 255)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `billing_account_deletion_requests_user_id_uidx` ON `billing_account_deletion_requests` (`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `billing_account_deletion_requests_organization_id_uidx` ON `billing_account_deletion_requests` (`organization_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `billing_account_deletion_requests_subscription_id_uidx` ON `billing_account_deletion_requests` (`billing_subscription_id`);--> statement-breakpoint
CREATE TABLE `billing_subscription_transitions` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`billing_subscription_id` text NOT NULL,
	`kind` text NOT NULL,
	`source_plan_key` text NOT NULL,
	`source_cadence` text NOT NULL,
	`target_plan_key` text NOT NULL,
	`target_cadence` text NOT NULL,
	`effective_at` text,
	`stripe_subscription_schedule_id` text,
	`stripe_pending_invoice_id` text,
	`stripe_pending_update_expires_at` text,
	`idempotency_key` text NOT NULL,
	`captured_billing_revision` integer NOT NULL,
	`state` text DEFAULT 'pending' NOT NULL,
	`state_reason` text,
	`revision` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`billing_subscription_id`) REFERENCES `billing_subscriptions`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "billing_subscription_transitions_kind_check" CHECK("billing_subscription_transitions"."kind" in ('cadence_change', 'personal_to_family', 'family_to_personal')),
	CONSTRAINT "billing_subscription_transitions_state_check" CHECK("billing_subscription_transitions"."state" in ('pending', 'action_required', 'scheduled', 'reconciliation_required', 'applied', 'failed', 'canceled')),
	CONSTRAINT "billing_subscription_transitions_source_offering_check" CHECK((("billing_subscription_transitions"."source_plan_key" = 'personal' and "billing_subscription_transitions"."source_cadence" in ('weekly', 'monthly', 'annual')) or ("billing_subscription_transitions"."source_plan_key" = 'family' and "billing_subscription_transitions"."source_cadence" in ('monthly', 'annual')))),
	CONSTRAINT "billing_subscription_transitions_target_offering_check" CHECK((("billing_subscription_transitions"."target_plan_key" = 'personal' and "billing_subscription_transitions"."target_cadence" in ('weekly', 'monthly', 'annual')) or ("billing_subscription_transitions"."target_plan_key" = 'family' and "billing_subscription_transitions"."target_cadence" in ('monthly', 'annual')))),
	CONSTRAINT "billing_subscription_transitions_semantics_check" CHECK(("billing_subscription_transitions"."kind" = 'cadence_change' and "billing_subscription_transitions"."source_plan_key" = "billing_subscription_transitions"."target_plan_key" and "billing_subscription_transitions"."source_cadence" <> "billing_subscription_transitions"."target_cadence") or ("billing_subscription_transitions"."kind" = 'personal_to_family' and "billing_subscription_transitions"."source_plan_key" = 'personal' and "billing_subscription_transitions"."target_plan_key" = 'family') or ("billing_subscription_transitions"."kind" = 'family_to_personal' and "billing_subscription_transitions"."source_plan_key" = 'family' and "billing_subscription_transitions"."target_plan_key" = 'personal')),
	CONSTRAINT "billing_subscription_transitions_timing_check" CHECK("billing_subscription_transitions"."kind" = 'personal_to_family' or "billing_subscription_transitions"."effective_at" is not null),
	CONSTRAINT "billing_subscription_transitions_provider_reference_check" CHECK("billing_subscription_transitions"."kind" = 'personal_to_family' or "billing_subscription_transitions"."stripe_pending_update_expires_at" is null),
	CONSTRAINT "billing_subscription_transitions_reason_check" CHECK("billing_subscription_transitions"."state_reason" is null or length(trim("billing_subscription_transitions"."state_reason")) between 1 and 128),
	CONSTRAINT "billing_subscription_transitions_revision_check" CHECK("billing_subscription_transitions"."captured_billing_revision" >= 0 and "billing_subscription_transitions"."revision" >= 0)
);
--> statement-breakpoint
CREATE INDEX `billing_subscription_transitions_organization_id_idx` ON `billing_subscription_transitions` (`organization_id`);--> statement-breakpoint
CREATE INDEX `billing_subscription_transitions_subscription_id_idx` ON `billing_subscription_transitions` (`billing_subscription_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `billing_subscription_transitions_idempotency_key_uidx` ON `billing_subscription_transitions` (`idempotency_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `billing_subscription_transitions_schedule_id_uidx` ON `billing_subscription_transitions` (`stripe_subscription_schedule_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `billing_subscription_transitions_pending_invoice_id_uidx` ON `billing_subscription_transitions` (`stripe_pending_invoice_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `billing_subscription_transitions_one_open_uidx` ON `billing_subscription_transitions` (`organization_id`) WHERE "billing_subscription_transitions"."state" in ('pending', 'action_required', 'scheduled', 'reconciliation_required');--> statement-breakpoint
CREATE TABLE `family_join_attempts` (
	`id` text PRIMARY KEY NOT NULL,
	`recipient_user_id` text NOT NULL,
	`personal_organization_id` text NOT NULL,
	`personal_billing_subscription_id` text NOT NULL,
	`captured_personal_billing_revision` integer NOT NULL,
	`target_organization_id` text,
	`invitation_id` text,
	`accepted_member_id` text,
	`stripe_cancellation_idempotency_key` text NOT NULL,
	`personal_paid_through` text,
	`state` text DEFAULT 'pending' NOT NULL,
	`state_reason` text,
	`revision` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`recipient_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`personal_organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`personal_billing_subscription_id`) REFERENCES `billing_subscriptions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`target_organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`invitation_id`) REFERENCES `invitation`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`accepted_member_id`) REFERENCES `member`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "family_join_attempts_state_check" CHECK("family_join_attempts"."state" in ('pending', 'renewal_stop_pending', 'renewal_off_confirmed', 'membership_pending', 'completed', 'reconciliation_required', 'failed')),
	CONSTRAINT "family_join_attempts_paid_through_check" CHECK("family_join_attempts"."state" not in ('renewal_off_confirmed', 'membership_pending', 'completed') or "family_join_attempts"."personal_paid_through" is not null),
	CONSTRAINT "family_join_attempts_reason_check" CHECK("family_join_attempts"."state_reason" is null or length(trim("family_join_attempts"."state_reason")) between 1 and 128),
	CONSTRAINT "family_join_attempts_revision_check" CHECK("family_join_attempts"."captured_personal_billing_revision" >= 0 and "family_join_attempts"."revision" >= 0)
);
--> statement-breakpoint
CREATE INDEX `family_join_attempts_recipient_user_id_idx` ON `family_join_attempts` (`recipient_user_id`);--> statement-breakpoint
CREATE INDEX `family_join_attempts_personal_subscription_id_idx` ON `family_join_attempts` (`personal_billing_subscription_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `family_join_attempts_invitation_id_uidx` ON `family_join_attempts` (`invitation_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `family_join_attempts_stripe_idempotency_key_uidx` ON `family_join_attempts` (`stripe_cancellation_idempotency_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `family_join_attempts_one_open_per_recipient_uidx` ON `family_join_attempts` (`recipient_user_id`) WHERE "family_join_attempts"."state" in ('pending', 'renewal_stop_pending', 'renewal_off_confirmed', 'membership_pending', 'reconciliation_required');--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_billing_checkout_attempts` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`billing_customer_id` text,
	`plan_key` text DEFAULT 'family' NOT NULL,
	`cadence` text,
	`stripe_price_id` text NOT NULL,
	`stripe_session_id` text,
	`idempotency_key` text NOT NULL,
	`state` text DEFAULT 'pending' NOT NULL,
	`success_url` text NOT NULL,
	`cancel_url` text NOT NULL,
	`reuse_until` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`billing_customer_id`) REFERENCES `billing_customers`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "billing_checkout_attempts_offering_check" CHECK(("__new_billing_checkout_attempts"."cadence" is not null and (("__new_billing_checkout_attempts"."plan_key" = 'personal' and "__new_billing_checkout_attempts"."cadence" in ('weekly', 'monthly', 'annual')) or ("__new_billing_checkout_attempts"."plan_key" = 'family' and "__new_billing_checkout_attempts"."cadence" in ('monthly', 'annual')))) or ("__new_billing_checkout_attempts"."plan_key" = 'family' and "__new_billing_checkout_attempts"."cadence" is null)),
	CONSTRAINT "billing_checkout_attempts_state_check" CHECK("__new_billing_checkout_attempts"."state" in ('pending', 'open', 'completed', 'expired', 'failed', 'reconciliation_required')),
	CONSTRAINT "billing_checkout_attempts_reuse_check" CHECK("__new_billing_checkout_attempts"."reuse_until" >= "__new_billing_checkout_attempts"."created_at")
);
--> statement-breakpoint
INSERT INTO `__new_billing_checkout_attempts`("id", "organization_id", "billing_customer_id", "plan_key", "cadence", "stripe_price_id", "stripe_session_id", "idempotency_key", "state", "success_url", "cancel_url", "reuse_until", "created_at", "updated_at") SELECT "id", "organization_id", "billing_customer_id", "plan_key", NULL, "stripe_price_id", "stripe_session_id", "idempotency_key", "state", "success_url", "cancel_url", "reuse_until", "created_at", "updated_at" FROM `billing_checkout_attempts`;--> statement-breakpoint
DROP TABLE `billing_checkout_attempts`;--> statement-breakpoint
ALTER TABLE `__new_billing_checkout_attempts` RENAME TO `billing_checkout_attempts`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `billing_checkout_attempts_organization_id_idx` ON `billing_checkout_attempts` (`organization_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `billing_checkout_attempts_stripe_session_id_uidx` ON `billing_checkout_attempts` (`stripe_session_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `billing_checkout_attempts_idempotency_key_uidx` ON `billing_checkout_attempts` (`idempotency_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `billing_checkout_attempts_one_open_uidx` ON `billing_checkout_attempts` (`organization_id`) WHERE "billing_checkout_attempts"."state" in ('pending', 'open', 'reconciliation_required');--> statement-breakpoint
CREATE TABLE `__new_billing_subscriptions` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`billing_customer_id` text NOT NULL,
	`stripe_subscription_id` text,
	`stripe_subscription_item_id` text,
	`status` text DEFAULT 'none' NOT NULL,
	`plan_key` text,
	`cadence` text,
	`stripe_price_id` text,
	`current_period_start` text,
	`current_period_end` text,
	`cancel_at_period_end` integer DEFAULT false NOT NULL,
	`grace_invoice_id` text,
	`grace_started_at` text,
	`grace_ends_at` text,
	`last_verified_at` text,
	`projection_order_ms` integer DEFAULT 0 NOT NULL,
	`projection_event_id` text,
	`reconciliation_required` integer DEFAULT false NOT NULL,
	`reconciliation_reason` text,
	`revision` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`billing_customer_id`) REFERENCES `billing_customers`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "billing_subscriptions_status_check" CHECK("__new_billing_subscriptions"."status" in ('none', 'active', 'canceled', 'incomplete', 'incomplete_expired', 'past_due', 'paused', 'trialing', 'unpaid', 'ambiguous')),
	CONSTRAINT "billing_subscriptions_offering_check" CHECK(("__new_billing_subscriptions"."plan_key" is null and "__new_billing_subscriptions"."cadence" is null) or ("__new_billing_subscriptions"."plan_key" is not null and "__new_billing_subscriptions"."cadence" is not null and (("__new_billing_subscriptions"."plan_key" = 'personal' and "__new_billing_subscriptions"."cadence" in ('weekly', 'monthly', 'annual')) or ("__new_billing_subscriptions"."plan_key" = 'family' and "__new_billing_subscriptions"."cadence" in ('monthly', 'annual')))) or ("__new_billing_subscriptions"."plan_key" = 'family' and "__new_billing_subscriptions"."cadence" is null)),
	CONSTRAINT "billing_subscriptions_grace_check" CHECK(("__new_billing_subscriptions"."grace_invoice_id" is null and "__new_billing_subscriptions"."grace_started_at" is null and "__new_billing_subscriptions"."grace_ends_at" is null) or ("__new_billing_subscriptions"."grace_invoice_id" is not null and "__new_billing_subscriptions"."grace_started_at" is not null and "__new_billing_subscriptions"."grace_ends_at" is not null and "__new_billing_subscriptions"."grace_ends_at" > "__new_billing_subscriptions"."grace_started_at")),
	CONSTRAINT "billing_subscriptions_reconciliation_check" CHECK(("__new_billing_subscriptions"."reconciliation_required" = 1 and "__new_billing_subscriptions"."reconciliation_reason" is not null) or ("__new_billing_subscriptions"."reconciliation_required" = 0 and "__new_billing_subscriptions"."reconciliation_reason" is null)),
	CONSTRAINT "billing_subscriptions_none_check" CHECK("__new_billing_subscriptions"."status" <> 'none' or ("__new_billing_subscriptions"."stripe_subscription_id" is null and "__new_billing_subscriptions"."stripe_subscription_item_id" is null and "__new_billing_subscriptions"."plan_key" is null and "__new_billing_subscriptions"."cadence" is null and "__new_billing_subscriptions"."stripe_price_id" is null and "__new_billing_subscriptions"."current_period_start" is null and "__new_billing_subscriptions"."current_period_end" is null and "__new_billing_subscriptions"."cancel_at_period_end" = 0 and "__new_billing_subscriptions"."grace_invoice_id" is null and "__new_billing_subscriptions"."grace_started_at" is null and "__new_billing_subscriptions"."grace_ends_at" is null)),
	CONSTRAINT "billing_subscriptions_revision_check" CHECK("__new_billing_subscriptions"."revision" >= 0)
);
--> statement-breakpoint
INSERT INTO `__new_billing_subscriptions`("id", "organization_id", "billing_customer_id", "stripe_subscription_id", "stripe_subscription_item_id", "status", "plan_key", "cadence", "stripe_price_id", "current_period_start", "current_period_end", "cancel_at_period_end", "grace_invoice_id", "grace_started_at", "grace_ends_at", "last_verified_at", "projection_order_ms", "projection_event_id", "reconciliation_required", "reconciliation_reason", "revision", "created_at", "updated_at") SELECT "id", "organization_id", "billing_customer_id", "stripe_subscription_id", NULL, "status", "plan_key", NULL, "stripe_price_id", "current_period_start", "current_period_end", "cancel_at_period_end", NULL, NULL, NULL, NULL, "projection_order_ms", "projection_event_id", "reconciliation_required", "reconciliation_reason", 0, "created_at", "updated_at" FROM `billing_subscriptions`;--> statement-breakpoint
DROP TABLE `billing_subscriptions`;--> statement-breakpoint
ALTER TABLE `__new_billing_subscriptions` RENAME TO `billing_subscriptions`;--> statement-breakpoint
CREATE UNIQUE INDEX `billing_subscriptions_organization_id_uidx` ON `billing_subscriptions` (`organization_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `billing_subscriptions_customer_id_uidx` ON `billing_subscriptions` (`billing_customer_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `billing_subscriptions_stripe_subscription_id_uidx` ON `billing_subscriptions` (`stripe_subscription_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `billing_subscriptions_stripe_subscription_item_id_uidx` ON `billing_subscriptions` (`stripe_subscription_item_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `billing_subscriptions_grace_invoice_id_uidx` ON `billing_subscriptions` (`grace_invoice_id`);--> statement-breakpoint
CREATE INDEX `billing_subscriptions_status_idx` ON `billing_subscriptions` (`status`);--> statement-breakpoint
ALTER TABLE `organization` ADD `billing_deletion_pending` integer DEFAULT false NOT NULL;
