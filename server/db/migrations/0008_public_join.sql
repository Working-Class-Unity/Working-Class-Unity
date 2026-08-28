CREATE TABLE `public_join_attempts` (
	`id` text PRIMARY KEY NOT NULL,
	`plan_key` text NOT NULL,
	`cadence` text NOT NULL,
	`stripe_price_id` text NOT NULL,
	`stripe_session_id` text,
	`idempotency_key` text NOT NULL,
	`state` text DEFAULT 'pending' NOT NULL,
	`success_url` text NOT NULL,
	`cancel_url` text NOT NULL,
	`stripe_customer_id` text,
	`stripe_subscription_id` text,
	`stripe_subscription_item_id` text,
	`subscription_status` text,
	`current_period_start` text,
	`current_period_end` text,
	`cancel_at_period_end` integer DEFAULT false NOT NULL,
	`projection_order_ms` integer DEFAULT 0 NOT NULL,
	`projection_event_id` text,
	`reconciliation_reason` text,
	`email` text,
	`claim_expires_at` text,
	`claim_email_sent_at` text,
	`claimed_user_id` text,
	`membership_id` text,
	`claimed_at` text,
	`activated_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`claimed_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`membership_id`) REFERENCES `memberships`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "public_join_attempts_id_check" CHECK(length("public_join_attempts"."id") = 50 and substr("public_join_attempts"."id", 1, 14) = 'join_checkout_'),
	CONSTRAINT "public_join_attempts_offering_check" CHECK(("public_join_attempts"."plan_key" = 'personal' and "public_join_attempts"."cadence" = 'monthly') or ("public_join_attempts"."plan_key" = 'family' and "public_join_attempts"."cadence" = 'monthly')),
	CONSTRAINT "public_join_attempts_price_check" CHECK("public_join_attempts"."stripe_price_id" glob 'price_*'),
	CONSTRAINT "public_join_attempts_state_check" CHECK("public_join_attempts"."state" in ('pending', 'open', 'paid', 'claimed', 'active', 'expired', 'failed', 'review', 'reconciliation_required')),
	CONSTRAINT "public_join_attempts_provider_id_check" CHECK(("public_join_attempts"."stripe_session_id" is null or "public_join_attempts"."stripe_session_id" glob 'cs_*') and ("public_join_attempts"."stripe_customer_id" is null or "public_join_attempts"."stripe_customer_id" glob 'cus_*') and ("public_join_attempts"."stripe_subscription_id" is null or "public_join_attempts"."stripe_subscription_id" glob 'sub_*') and ("public_join_attempts"."stripe_subscription_item_id" is null or "public_join_attempts"."stripe_subscription_item_id" glob 'si_*')),
	CONSTRAINT "public_join_attempts_subscription_check" CHECK(("public_join_attempts"."subscription_status" is null and "public_join_attempts"."stripe_subscription_id" is null and "public_join_attempts"."stripe_subscription_item_id" is null and "public_join_attempts"."current_period_start" is null and "public_join_attempts"."current_period_end" is null) or ("public_join_attempts"."subscription_status" is not null and "public_join_attempts"."stripe_customer_id" is not null and "public_join_attempts"."stripe_subscription_id" is not null and "public_join_attempts"."stripe_subscription_item_id" is not null and "public_join_attempts"."current_period_start" is not null and "public_join_attempts"."current_period_end" is not null)),
	CONSTRAINT "public_join_attempts_email_check" CHECK("public_join_attempts"."email" is null or ("public_join_attempts"."email" = lower(trim("public_join_attempts"."email")) and length("public_join_attempts"."email") between 3 and 320 and instr("public_join_attempts"."email", '@') > 1)),
	CONSTRAINT "public_join_attempts_claim_check" CHECK(("public_join_attempts"."claimed_user_id" is null and "public_join_attempts"."membership_id" is null and "public_join_attempts"."claimed_at" is null and "public_join_attempts"."activated_at" is null) or ("public_join_attempts"."claimed_user_id" is not null and "public_join_attempts"."claimed_at" is not null and ("public_join_attempts"."activated_at" is null or "public_join_attempts"."membership_id" is not null))),
	CONSTRAINT "public_join_attempts_active_check" CHECK("public_join_attempts"."state" <> 'active' or ("public_join_attempts"."claimed_user_id" is not null and "public_join_attempts"."membership_id" is not null and "public_join_attempts"."claimed_at" is not null and "public_join_attempts"."activated_at" is not null)),
	CONSTRAINT "public_join_attempts_reconciliation_check" CHECK(("public_join_attempts"."state" = 'reconciliation_required' and "public_join_attempts"."reconciliation_reason" is not null) or ("public_join_attempts"."state" <> 'reconciliation_required' and "public_join_attempts"."reconciliation_reason" is null)),
	CONSTRAINT "public_join_attempts_time_check" CHECK(("public_join_attempts"."claim_expires_at" is null or julianday("public_join_attempts"."claim_expires_at") > julianday("public_join_attempts"."created_at")) and ("public_join_attempts"."claim_email_sent_at" is null or julianday("public_join_attempts"."claim_email_sent_at") >= julianday("public_join_attempts"."created_at")) and ("public_join_attempts"."claimed_at" is null or julianday("public_join_attempts"."claimed_at") >= julianday("public_join_attempts"."created_at")) and ("public_join_attempts"."activated_at" is null or ("public_join_attempts"."claimed_at" is not null and julianday("public_join_attempts"."activated_at") >= julianday("public_join_attempts"."claimed_at")))),
	CONSTRAINT "public_join_attempts_projection_order_check" CHECK("public_join_attempts"."projection_order_ms" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `public_join_attempts_stripe_session_id_uidx` ON `public_join_attempts` (`stripe_session_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `public_join_attempts_idempotency_key_uidx` ON `public_join_attempts` (`idempotency_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `public_join_attempts_stripe_customer_id_uidx` ON `public_join_attempts` (`stripe_customer_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `public_join_attempts_stripe_subscription_id_uidx` ON `public_join_attempts` (`stripe_subscription_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `public_join_attempts_stripe_subscription_item_id_uidx` ON `public_join_attempts` (`stripe_subscription_item_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `public_join_attempts_membership_id_uidx` ON `public_join_attempts` (`membership_id`);--> statement-breakpoint
CREATE INDEX `public_join_attempts_state_created_idx` ON `public_join_attempts` (`state`,`created_at`);--> statement-breakpoint
CREATE INDEX `public_join_attempts_email_state_idx` ON `public_join_attempts` (`email`,`state`);--> statement-breakpoint
CREATE INDEX `public_join_attempts_claimed_user_idx` ON `public_join_attempts` (`claimed_user_id`,`state`);
