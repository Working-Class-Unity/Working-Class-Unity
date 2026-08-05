CREATE TABLE `app_settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `ai_conversations` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_user_id` text NOT NULL,
	`history_revision` integer DEFAULT 0 NOT NULL,
	`next_sequence` integer DEFAULT 1 NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`owner_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "ai_conversations_identity_check" CHECK(length("ai_conversations"."id") = 52 and substr("ai_conversations"."id", 1, 16) = 'ai_conversation_' and length(trim("ai_conversations"."owner_user_id")) > 0),
	CONSTRAINT "ai_conversations_sequence_check" CHECK("ai_conversations"."history_revision" >= 0 and "ai_conversations"."next_sequence" >= 1),
	CONSTRAINT "ai_conversations_timestamps_check" CHECK(julianday("ai_conversations"."created_at") is not null and julianday("ai_conversations"."updated_at") is not null and julianday("ai_conversations"."updated_at") >= julianday("ai_conversations"."created_at"))
);
--> statement-breakpoint
CREATE INDEX `ai_conversations_owner_updated_id_idx` ON `ai_conversations` (`owner_user_id`,`updated_at`,`id`);--> statement-breakpoint
CREATE TABLE `ai_generation_attempts` (
	`id` text PRIMARY KEY NOT NULL,
	`conversation_id` text NOT NULL,
	`user_message_id` text NOT NULL,
	`assistant_message_id` text,
	`client_request_id` text NOT NULL,
	`history_revision` integer NOT NULL,
	`usage_bucket_date` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`model` text NOT NULL,
	`provider_request_id` text,
	`input_tokens` integer,
	`output_tokens` integer,
	`reasoning_tokens` integer,
	`cached_input_tokens` integer,
	`cache_write_tokens` integer,
	`error_code` text,
	`lease_expires_at` text,
	`completed_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`conversation_id`) REFERENCES `ai_conversations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_message_id`) REFERENCES `ai_messages`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`assistant_message_id`) REFERENCES `ai_messages`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "ai_generation_attempts_identity_check" CHECK(length("ai_generation_attempts"."id") = 47 and substr("ai_generation_attempts"."id", 1, 11) = 'ai_attempt_' and length(trim("ai_generation_attempts"."conversation_id")) > 0 and length(trim("ai_generation_attempts"."user_message_id")) > 0),
	CONSTRAINT "ai_generation_attempts_request_check" CHECK(length(trim("ai_generation_attempts"."client_request_id")) between 1 and 128 and length(trim("ai_generation_attempts"."model")) between 1 and 128 and "ai_generation_attempts"."history_revision" >= 0),
	CONSTRAINT "ai_generation_attempts_bucket_check" CHECK(length("ai_generation_attempts"."usage_bucket_date") = 10 and date("ai_generation_attempts"."usage_bucket_date") is not null and date("ai_generation_attempts"."usage_bucket_date") = "ai_generation_attempts"."usage_bucket_date"),
	CONSTRAINT "ai_generation_attempts_status_check" CHECK("ai_generation_attempts"."status" in ('pending', 'succeeded', 'failed', 'indeterminate', 'refused', 'cancelled')),
	CONSTRAINT "ai_generation_attempts_provider_metadata_check" CHECK(("ai_generation_attempts"."provider_request_id" is null or length(trim("ai_generation_attempts"."provider_request_id")) between 1 and 512) and ("ai_generation_attempts"."input_tokens" is null or "ai_generation_attempts"."input_tokens" >= 0) and ("ai_generation_attempts"."output_tokens" is null or "ai_generation_attempts"."output_tokens" >= 0) and ("ai_generation_attempts"."reasoning_tokens" is null or "ai_generation_attempts"."reasoning_tokens" >= 0) and ("ai_generation_attempts"."cached_input_tokens" is null or "ai_generation_attempts"."cached_input_tokens" >= 0) and ("ai_generation_attempts"."cache_write_tokens" is null or "ai_generation_attempts"."cache_write_tokens" >= 0) and ("ai_generation_attempts"."error_code" is null or (length("ai_generation_attempts"."error_code") between 1 and 64 and "ai_generation_attempts"."error_code" not glob '*[^a-z0-9_-]*'))),
	CONSTRAINT "ai_generation_attempts_lifecycle_check" CHECK(("ai_generation_attempts"."status" = 'pending' and "ai_generation_attempts"."lease_expires_at" is not null and julianday("ai_generation_attempts"."lease_expires_at") is not null and "ai_generation_attempts"."completed_at" is null and "ai_generation_attempts"."assistant_message_id" is null and "ai_generation_attempts"."error_code" is null) or ("ai_generation_attempts"."status" = 'succeeded' and "ai_generation_attempts"."lease_expires_at" is null and "ai_generation_attempts"."completed_at" is not null and julianday("ai_generation_attempts"."completed_at") is not null and "ai_generation_attempts"."assistant_message_id" is not null and "ai_generation_attempts"."error_code" is null) or ("ai_generation_attempts"."status" = 'refused' and "ai_generation_attempts"."lease_expires_at" is null and "ai_generation_attempts"."completed_at" is not null and julianday("ai_generation_attempts"."completed_at") is not null and "ai_generation_attempts"."assistant_message_id" is not null and "ai_generation_attempts"."error_code" is not null) or ("ai_generation_attempts"."status" in ('failed', 'indeterminate', 'cancelled') and "ai_generation_attempts"."lease_expires_at" is null and "ai_generation_attempts"."completed_at" is not null and julianday("ai_generation_attempts"."completed_at") is not null and "ai_generation_attempts"."assistant_message_id" is null and "ai_generation_attempts"."error_code" is not null)),
	CONSTRAINT "ai_generation_attempts_timestamps_check" CHECK(julianday("ai_generation_attempts"."created_at") is not null and julianday("ai_generation_attempts"."updated_at") is not null and julianday("ai_generation_attempts"."updated_at") >= julianday("ai_generation_attempts"."created_at") and ("ai_generation_attempts"."lease_expires_at" is null or julianday("ai_generation_attempts"."lease_expires_at") >= julianday("ai_generation_attempts"."created_at")) and ("ai_generation_attempts"."completed_at" is null or julianday("ai_generation_attempts"."completed_at") >= julianday("ai_generation_attempts"."created_at")))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ai_generation_attempts_conversation_client_request_uidx` ON `ai_generation_attempts` (`conversation_id`,`client_request_id`);--> statement-breakpoint
CREATE INDEX `ai_generation_attempts_conversation_status_idx` ON `ai_generation_attempts` (`conversation_id`,`status`);--> statement-breakpoint
CREATE INDEX `ai_generation_attempts_status_lease_idx` ON `ai_generation_attempts` (`status`,`lease_expires_at`);--> statement-breakpoint
CREATE TABLE `ai_generation_leases` (
	`owner_user_id` text PRIMARY KEY NOT NULL,
	`attempt_id` text NOT NULL,
	`lease_expires_at` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`owner_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "ai_generation_leases_identity_check" CHECK(length(trim("ai_generation_leases"."owner_user_id")) > 0 and length("ai_generation_leases"."attempt_id") = 47 and substr("ai_generation_leases"."attempt_id", 1, 11) = 'ai_attempt_' and substr("ai_generation_leases"."attempt_id", 20, 1) = '-' and substr("ai_generation_leases"."attempt_id", 25, 1) = '-' and substr("ai_generation_leases"."attempt_id", 26, 1) = '4' and substr("ai_generation_leases"."attempt_id", 30, 1) = '-' and substr("ai_generation_leases"."attempt_id", 31, 1) in ('8', '9', 'a', 'b') and substr("ai_generation_leases"."attempt_id", 35, 1) = '-' and replace(substr("ai_generation_leases"."attempt_id", 12), '-', '') not glob '*[^0-9a-f]*'),
	CONSTRAINT "ai_generation_leases_timestamps_check" CHECK(julianday("ai_generation_leases"."lease_expires_at") is not null and julianday("ai_generation_leases"."created_at") is not null and julianday("ai_generation_leases"."updated_at") is not null and julianday("ai_generation_leases"."lease_expires_at") >= julianday("ai_generation_leases"."created_at") and julianday("ai_generation_leases"."updated_at") >= julianday("ai_generation_leases"."created_at"))
);
--> statement-breakpoint
CREATE TABLE `ai_message_file_citations` (
	`message_id` text NOT NULL,
	`ordinal` integer NOT NULL,
	`title` text NOT NULL,
	PRIMARY KEY(`message_id`, `ordinal`),
	FOREIGN KEY (`message_id`) REFERENCES `ai_messages`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "ai_message_file_citations_ordinal_check" CHECK("ai_message_file_citations"."ordinal" between 1 and 10),
	CONSTRAINT "ai_message_file_citations_title_check" CHECK(length("ai_message_file_citations"."title") between 1 and 512 and "ai_message_file_citations"."title" = trim("ai_message_file_citations"."title") and instr("ai_message_file_citations"."title", char(0)) = 0 and "ai_message_file_citations"."title" not glob ('*[' || char(1) || '-' || char(31) || char(127) || ']*'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ai_message_file_citations_message_title_uidx` ON `ai_message_file_citations` (`message_id`,`title`);--> statement-breakpoint
CREATE TABLE `ai_message_web_citations` (
	`message_id` text NOT NULL,
	`ordinal` integer NOT NULL,
	`title` text NOT NULL,
	`url` text NOT NULL,
	`start_index` integer NOT NULL,
	`end_index` integer NOT NULL,
	PRIMARY KEY(`message_id`, `ordinal`),
	FOREIGN KEY (`message_id`) REFERENCES `ai_messages`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "ai_message_web_citations_ordinal_check" CHECK("ai_message_web_citations"."ordinal" between 1 and 20),
	CONSTRAINT "ai_message_web_citations_title_check" CHECK(length("ai_message_web_citations"."title") between 1 and 512 and "ai_message_web_citations"."title" = trim("ai_message_web_citations"."title") and instr("ai_message_web_citations"."title", char(0)) = 0 and "ai_message_web_citations"."title" not glob ('*[' || char(1) || '-' || char(31) || char(127) || ']*')),
	CONSTRAINT "ai_message_web_citations_url_check" CHECK(length("ai_message_web_citations"."url") between 1 and 4096 and "ai_message_web_citations"."url" = trim("ai_message_web_citations"."url") and substr("ai_message_web_citations"."url", 1, 8) = 'https://' and instr("ai_message_web_citations"."url", char(0)) = 0 and "ai_message_web_citations"."url" not glob ('*[' || char(1) || '-' || char(31) || char(127) || ']*')),
	CONSTRAINT "ai_message_web_citations_span_check" CHECK("ai_message_web_citations"."start_index" >= 0 and "ai_message_web_citations"."start_index" < "ai_message_web_citations"."end_index" and "ai_message_web_citations"."end_index" <= 1000000)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ai_message_web_citations_message_url_span_uidx` ON `ai_message_web_citations` (`message_id`,`url`,`start_index`,`end_index`);--> statement-breakpoint
CREATE TABLE `ai_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`conversation_id` text NOT NULL,
	`sequence` integer NOT NULL,
	`role` text NOT NULL,
	`content` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`conversation_id`) REFERENCES `ai_conversations`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "ai_messages_identity_check" CHECK(length("ai_messages"."id") = 47 and substr("ai_messages"."id", 1, 11) = 'ai_message_' and length(trim("ai_messages"."conversation_id")) > 0),
	CONSTRAINT "ai_messages_sequence_check" CHECK("ai_messages"."sequence" >= 1),
	CONSTRAINT "ai_messages_role_check" CHECK("ai_messages"."role" in ('user', 'assistant')),
	CONSTRAINT "ai_messages_content_check" CHECK(length("ai_messages"."content") between 1 and 1000000),
	CONSTRAINT "ai_messages_timestamp_check" CHECK(julianday("ai_messages"."created_at") is not null)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ai_messages_conversation_sequence_uidx` ON `ai_messages` (`conversation_id`,`sequence`);--> statement-breakpoint
CREATE INDEX `ai_messages_conversation_created_id_idx` ON `ai_messages` (`conversation_id`,`created_at`,`id`);--> statement-breakpoint
CREATE TABLE `ai_usage_buckets` (
	`owner_user_id` text NOT NULL,
	`bucket_date` text NOT NULL,
	`request_count` integer DEFAULT 0 NOT NULL,
	`input_tokens` integer DEFAULT 0 NOT NULL,
	`output_tokens` integer DEFAULT 0 NOT NULL,
	`reasoning_tokens` integer DEFAULT 0 NOT NULL,
	`cached_input_tokens` integer DEFAULT 0 NOT NULL,
	`cache_write_tokens` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	PRIMARY KEY(`owner_user_id`, `bucket_date`),
	FOREIGN KEY (`owner_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "ai_usage_buckets_date_check" CHECK(length("ai_usage_buckets"."bucket_date") = 10 and date("ai_usage_buckets"."bucket_date") is not null and date("ai_usage_buckets"."bucket_date") = "ai_usage_buckets"."bucket_date"),
	CONSTRAINT "ai_usage_buckets_counts_check" CHECK("ai_usage_buckets"."request_count" >= 0 and "ai_usage_buckets"."input_tokens" >= 0 and "ai_usage_buckets"."output_tokens" >= 0 and "ai_usage_buckets"."reasoning_tokens" >= 0 and "ai_usage_buckets"."cached_input_tokens" >= 0 and "ai_usage_buckets"."cache_write_tokens" >= 0),
	CONSTRAINT "ai_usage_buckets_timestamps_check" CHECK(julianday("ai_usage_buckets"."created_at") is not null and julianday("ai_usage_buckets"."updated_at") is not null and julianday("ai_usage_buckets"."updated_at") >= julianday("ai_usage_buckets"."created_at"))
);
--> statement-breakpoint
CREATE TABLE `account` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`provider_id` text NOT NULL,
	`user_id` text NOT NULL,
	`access_token` text,
	`refresh_token` text,
	`id_token` text,
	`access_token_expires_at` integer,
	`refresh_token_expires_at` integer,
	`scope` text,
	`password` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `account_user_id_idx` ON `account` (`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `account_provider_account_idx` ON `account` (`provider_id`,`account_id`);--> statement-breakpoint
CREATE TABLE `session` (
	`id` text PRIMARY KEY NOT NULL,
	`expires_at` integer NOT NULL,
	`token` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`ip_address` text,
	`user_agent` text,
	`user_id` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `session_token_idx` ON `session` (`token`);--> statement-breakpoint
CREATE INDEX `session_user_id_idx` ON `session` (`user_id`);--> statement-breakpoint
CREATE TABLE `user` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`email` text NOT NULL,
	`email_verified` integer DEFAULT false NOT NULL,
	`image` text,
	`role` text DEFAULT 'user' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "user_name_check" CHECK("user"."name" = trim("user"."name") and length("user"."name") between 1 and 100),
	CONSTRAINT "user_role_check" CHECK("user"."role" in ('user', 'admin'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_email_idx` ON `user` (`email`);--> statement-breakpoint
CREATE TABLE `verification` (
	`id` text PRIMARY KEY NOT NULL,
	`identifier` text NOT NULL,
	`value` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `verification_identifier_idx` ON `verification` (`identifier`);--> statement-breakpoint
CREATE TABLE `billing_account_deletion_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`purchaser_user_id` text NOT NULL,
	`billing_subscription_id` text,
	`billing_customer_id` text,
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
	CONSTRAINT "billing_account_deletion_requests_state_check" CHECK("billing_account_deletion_requests"."state" in ('pending', 'reconciliation_required', 'cancellation_confirmed')),
	CONSTRAINT "billing_account_deletion_requests_id_check" CHECK(length(trim("billing_account_deletion_requests"."id")) between 1 and 128),
	CONSTRAINT "billing_account_deletion_requests_reason_check" CHECK(("billing_account_deletion_requests"."state" = 'reconciliation_required' and "billing_account_deletion_requests"."reason" is not null and length(trim("billing_account_deletion_requests"."reason")) between 1 and 128) or ("billing_account_deletion_requests"."state" <> 'reconciliation_required' and "billing_account_deletion_requests"."reason" is null)),
	CONSTRAINT "billing_account_deletion_requests_confirmation_check" CHECK(("billing_account_deletion_requests"."state" = 'cancellation_confirmed' and "billing_account_deletion_requests"."cancellation_confirmed_at" is not null) or ("billing_account_deletion_requests"."state" <> 'cancellation_confirmed' and "billing_account_deletion_requests"."cancellation_confirmed_at" is null)),
	CONSTRAINT "billing_account_deletion_requests_reference_check" CHECK(((("billing_account_deletion_requests"."billing_customer_id" is null and "billing_account_deletion_requests"."expected_stripe_customer_id" is null) or ("billing_account_deletion_requests"."billing_customer_id" is not null and "billing_account_deletion_requests"."expected_stripe_customer_id" is not null and length(trim("billing_account_deletion_requests"."expected_stripe_customer_id")) between 1 and 255 and "billing_account_deletion_requests"."expected_stripe_customer_id" glob 'cus_*')) and (("billing_account_deletion_requests"."billing_subscription_id" is null and "billing_account_deletion_requests"."expected_stripe_subscription_id" is null) or ("billing_account_deletion_requests"."billing_subscription_id" is not null and "billing_account_deletion_requests"."expected_stripe_subscription_id" is not null and length(trim("billing_account_deletion_requests"."expected_stripe_subscription_id")) between 1 and 255 and "billing_account_deletion_requests"."expected_stripe_subscription_id" glob 'sub_*')))),
	CONSTRAINT "billing_account_deletion_requests_revision_check" CHECK("billing_account_deletion_requests"."captured_billing_revision" >= 0 and "billing_account_deletion_requests"."revision" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `billing_account_deletion_requests_purchaser_user_id_uidx` ON `billing_account_deletion_requests` (`purchaser_user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `billing_account_deletion_requests_subscription_id_uidx` ON `billing_account_deletion_requests` (`billing_subscription_id`);--> statement-breakpoint
CREATE TABLE `billing_checkout_attempts` (
	`id` text PRIMARY KEY NOT NULL,
	`purchaser_user_id` text NOT NULL,
	`billing_customer_id` text,
	`plan_key` text NOT NULL,
	`cadence` text NOT NULL,
	`stripe_price_id` text NOT NULL,
	`stripe_session_id` text,
	`idempotency_key` text NOT NULL,
	`state` text DEFAULT 'pending' NOT NULL,
	`success_url` text NOT NULL,
	`cancel_url` text NOT NULL,
	`reuse_until` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`purchaser_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`billing_customer_id`) REFERENCES `billing_customers`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "billing_checkout_attempts_offering_check" CHECK((("billing_checkout_attempts"."plan_key" = 'personal' and "billing_checkout_attempts"."cadence" in ('weekly', 'monthly', 'annual')) or ("billing_checkout_attempts"."plan_key" = 'family' and "billing_checkout_attempts"."cadence" in ('monthly', 'annual')))),
	CONSTRAINT "billing_checkout_attempts_state_check" CHECK("billing_checkout_attempts"."state" in ('pending', 'open', 'completed', 'expired', 'failed', 'reconciliation_required')),
	CONSTRAINT "billing_checkout_attempts_price_check" CHECK("billing_checkout_attempts"."stripe_price_id" glob 'price_*'),
	CONSTRAINT "billing_checkout_attempts_reuse_check" CHECK("billing_checkout_attempts"."reuse_until" >= "billing_checkout_attempts"."created_at")
);
--> statement-breakpoint
CREATE INDEX `billing_checkout_attempts_purchaser_user_id_idx` ON `billing_checkout_attempts` (`purchaser_user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `billing_checkout_attempts_stripe_session_id_uidx` ON `billing_checkout_attempts` (`stripe_session_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `billing_checkout_attempts_idempotency_key_uidx` ON `billing_checkout_attempts` (`idempotency_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `billing_checkout_attempts_one_open_uidx` ON `billing_checkout_attempts` (`purchaser_user_id`) WHERE "billing_checkout_attempts"."state" in ('pending', 'open', 'reconciliation_required');--> statement-breakpoint
CREATE TABLE `billing_customers` (
	`id` text PRIMARY KEY NOT NULL,
	`purchaser_user_id` text NOT NULL,
	`stripe_customer_id` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`purchaser_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "billing_customers_id_check" CHECK(length(trim("billing_customers"."id")) between 1 and 128),
	CONSTRAINT "billing_customers_stripe_id_check" CHECK("billing_customers"."stripe_customer_id" glob 'cus_*')
);
--> statement-breakpoint
CREATE UNIQUE INDEX `billing_customers_purchaser_user_id_uidx` ON `billing_customers` (`purchaser_user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `billing_customers_stripe_customer_id_uidx` ON `billing_customers` (`stripe_customer_id`);--> statement-breakpoint
CREATE TABLE `billing_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`stripe_event_id` text NOT NULL,
	`event_type` text NOT NULL,
	`provider_created_at` integer,
	`processed_at` text NOT NULL,
	CONSTRAINT "billing_events_provider_created_at_check" CHECK("billing_events"."provider_created_at" is null or "billing_events"."provider_created_at" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `billing_events_stripe_event_id_uidx` ON `billing_events` (`stripe_event_id`);--> statement-breakpoint
CREATE INDEX `billing_events_event_type_idx` ON `billing_events` (`event_type`);--> statement-breakpoint
CREATE TABLE `billing_subscription_transitions` (
	`id` text PRIMARY KEY NOT NULL,
	`purchaser_user_id` text NOT NULL,
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
	FOREIGN KEY (`purchaser_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE restrict,
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
CREATE INDEX `billing_subscription_transitions_purchaser_user_id_idx` ON `billing_subscription_transitions` (`purchaser_user_id`);--> statement-breakpoint
CREATE INDEX `billing_subscription_transitions_subscription_id_idx` ON `billing_subscription_transitions` (`billing_subscription_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `billing_subscription_transitions_idempotency_key_uidx` ON `billing_subscription_transitions` (`idempotency_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `billing_subscription_transitions_schedule_id_uidx` ON `billing_subscription_transitions` (`stripe_subscription_schedule_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `billing_subscription_transitions_pending_invoice_id_uidx` ON `billing_subscription_transitions` (`stripe_pending_invoice_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `billing_subscription_transitions_one_open_uidx` ON `billing_subscription_transitions` (`purchaser_user_id`) WHERE "billing_subscription_transitions"."state" in ('pending', 'action_required', 'scheduled', 'reconciliation_required');--> statement-breakpoint
CREATE TABLE `billing_subscriptions` (
	`id` text PRIMARY KEY NOT NULL,
	`purchaser_user_id` text NOT NULL,
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
	FOREIGN KEY (`purchaser_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`billing_customer_id`) REFERENCES `billing_customers`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "billing_subscriptions_status_check" CHECK("billing_subscriptions"."status" in ('none', 'active', 'canceled', 'incomplete', 'incomplete_expired', 'past_due', 'paused', 'trialing', 'unpaid', 'ambiguous')),
	CONSTRAINT "billing_subscriptions_offering_check" CHECK(("billing_subscriptions"."plan_key" is null and "billing_subscriptions"."cadence" is null) or ("billing_subscriptions"."plan_key" is not null and "billing_subscriptions"."cadence" is not null and (("billing_subscriptions"."plan_key" = 'personal' and "billing_subscriptions"."cadence" in ('weekly', 'monthly', 'annual')) or ("billing_subscriptions"."plan_key" = 'family' and "billing_subscriptions"."cadence" in ('monthly', 'annual'))))),
	CONSTRAINT "billing_subscriptions_grace_check" CHECK(("billing_subscriptions"."grace_invoice_id" is null and "billing_subscriptions"."grace_started_at" is null and "billing_subscriptions"."grace_ends_at" is null) or ("billing_subscriptions"."grace_invoice_id" is not null and "billing_subscriptions"."grace_started_at" is not null and "billing_subscriptions"."grace_ends_at" is not null and "billing_subscriptions"."grace_ends_at" > "billing_subscriptions"."grace_started_at")),
	CONSTRAINT "billing_subscriptions_reconciliation_check" CHECK(("billing_subscriptions"."reconciliation_required" = 1 and "billing_subscriptions"."reconciliation_reason" is not null) or ("billing_subscriptions"."reconciliation_required" = 0 and "billing_subscriptions"."reconciliation_reason" is null)),
	CONSTRAINT "billing_subscriptions_none_check" CHECK("billing_subscriptions"."status" <> 'none' or ("billing_subscriptions"."stripe_subscription_id" is null and "billing_subscriptions"."stripe_subscription_item_id" is null and "billing_subscriptions"."plan_key" is null and "billing_subscriptions"."cadence" is null and "billing_subscriptions"."stripe_price_id" is null and "billing_subscriptions"."current_period_start" is null and "billing_subscriptions"."current_period_end" is null and "billing_subscriptions"."cancel_at_period_end" = 0 and "billing_subscriptions"."grace_invoice_id" is null and "billing_subscriptions"."grace_started_at" is null and "billing_subscriptions"."grace_ends_at" is null)),
	CONSTRAINT "billing_subscriptions_revision_check" CHECK("billing_subscriptions"."revision" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `billing_subscriptions_purchaser_user_id_uidx` ON `billing_subscriptions` (`purchaser_user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `billing_subscriptions_customer_id_uidx` ON `billing_subscriptions` (`billing_customer_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `billing_subscriptions_stripe_subscription_id_uidx` ON `billing_subscriptions` (`stripe_subscription_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `billing_subscriptions_stripe_subscription_item_id_uidx` ON `billing_subscriptions` (`stripe_subscription_item_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `billing_subscriptions_grace_invoice_id_uidx` ON `billing_subscriptions` (`grace_invoice_id`);--> statement-breakpoint
CREATE INDEX `billing_subscriptions_status_idx` ON `billing_subscriptions` (`status`);--> statement-breakpoint
CREATE TABLE `detached_billing_subjects` (
	`id` text PRIMARY KEY NOT NULL,
	`provider` text NOT NULL,
	`provider_reference` text NOT NULL,
	`provider_customer_reference` text,
	`provider_status` text NOT NULL,
	`provider_status_expires_at` text,
	`provider_event_created_at` integer,
	`status_updated_at` text NOT NULL,
	`deleted_at` text NOT NULL,
	`retention_purpose` text NOT NULL,
	`retention_policy` text NOT NULL,
	`purge_after` text,
	CONSTRAINT "detached_billing_subject_provider_check" CHECK("detached_billing_subjects"."provider" = 'stripe'),
	CONSTRAINT "detached_billing_subject_retention_purpose_check" CHECK("detached_billing_subjects"."retention_purpose" = 'external_billing_reconciliation'),
	CONSTRAINT "detached_billing_subject_retention_policy_check" CHECK("detached_billing_subjects"."retention_policy" = 'stripe_billing_lifecycle'),
	CONSTRAINT "detached_billing_subject_purge_after_check" CHECK("detached_billing_subjects"."purge_after" is null or "detached_billing_subjects"."purge_after" >= "detached_billing_subjects"."deleted_at"),
	CONSTRAINT "detached_billing_subject_provider_event_check" CHECK("detached_billing_subjects"."provider_event_created_at" is null or "detached_billing_subjects"."provider_event_created_at" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `detached_billing_subject_provider_reference_uidx` ON `detached_billing_subjects` (`provider`,`provider_reference`);--> statement-breakpoint
CREATE INDEX `detached_billing_subject_customer_reference_idx` ON `detached_billing_subjects` (`provider`,`provider_customer_reference`);--> statement-breakpoint
CREATE TABLE `files` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`bucket` text NOT NULL,
	`object_key` text NOT NULL,
	`original_name` text,
	`content_type` text NOT NULL,
	`byte_size` integer NOT NULL,
	`content_md5` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`upload_expires_at` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`owner_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "files_identity_check" CHECK(length(trim("files"."id")) > 0 and length(trim("files"."owner_id")) > 0),
	CONSTRAINT "files_storage_locator_check" CHECK(length(trim("files"."bucket")) > 0 and length(trim("files"."object_key")) > 0 and length("files"."object_key") <= 1024),
	CONSTRAINT "files_metadata_check" CHECK(length(trim("files"."content_type")) between 1 and 180 and "files"."byte_size" between 1 and 26214400 and ("files"."original_name" is null or length(trim("files"."original_name")) between 1 and 180)),
	CONSTRAINT "files_status_check" CHECK("files"."status" in ('pending', 'ready', 'deleted')),
	CONSTRAINT "files_content_md5_check" CHECK(length("files"."content_md5") = 24 and substr("files"."content_md5", 23, 2) = '==' and substr("files"."content_md5", 1, 22) not glob '*[^A-Za-z0-9+/]*' and substr("files"."content_md5", 22, 1) in ('A', 'Q', 'g', 'w')),
	CONSTRAINT "files_deletion_state_check" CHECK(("files"."status" = 'deleted' and "files"."deleted_at" is not null) or ("files"."status" in ('pending', 'ready') and "files"."deleted_at" is null)),
	CONSTRAINT "files_timestamps_check" CHECK(julianday("files"."created_at") is not null and julianday("files"."updated_at") is not null and julianday("files"."upload_expires_at") is not null and julianday("files"."updated_at") >= julianday("files"."created_at") and julianday("files"."upload_expires_at") >= julianday("files"."created_at") and ("files"."deleted_at" is null or (julianday("files"."deleted_at") is not null and julianday("files"."deleted_at") >= julianday("files"."created_at"))))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `files_object_key_idx` ON `files` (`object_key`);--> statement-breakpoint
CREATE INDEX `files_owner_status_created_id_idx` ON `files` (`owner_id`,`status`,`created_at`,`id`);--> statement-breakpoint
CREATE INDEX `files_status_upload_expires_id_idx` ON `files` (`status`,`upload_expires_at`,`id`);--> statement-breakpoint
CREATE TABLE `job_queue` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`type` text NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`payload` text NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`max_attempts` integer DEFAULT 3 NOT NULL,
	`run_after` text,
	`locked_at` text,
	`locked_by` text,
	`last_error` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `job_queue_status_run_after_idx` ON `job_queue` (`status`,`run_after`);--> statement-breakpoint
CREATE INDEX `job_queue_type_idx` ON `job_queue` (`type`);--> statement-breakpoint
CREATE TRIGGER `billing_checkout_customer_purchaser_insert`
BEFORE INSERT ON `billing_checkout_attempts`
WHEN NEW.`billing_customer_id` IS NOT NULL AND NOT EXISTS (
	SELECT 1 FROM `billing_customers` AS `customer`
	WHERE `customer`.`id` = NEW.`billing_customer_id`
		AND `customer`.`purchaser_user_id` = NEW.`purchaser_user_id`
)
BEGIN
	SELECT RAISE(ABORT, 'billing checkout customer purchaser mismatch');
END;--> statement-breakpoint
CREATE TRIGGER `billing_checkout_customer_purchaser_update`
BEFORE UPDATE OF `billing_customer_id`, `purchaser_user_id` ON `billing_checkout_attempts`
WHEN NEW.`billing_customer_id` IS NOT NULL AND NOT EXISTS (
	SELECT 1 FROM `billing_customers` AS `customer`
	WHERE `customer`.`id` = NEW.`billing_customer_id`
		AND `customer`.`purchaser_user_id` = NEW.`purchaser_user_id`
)
BEGIN
	SELECT RAISE(ABORT, 'billing checkout customer purchaser mismatch');
END;--> statement-breakpoint
CREATE TRIGGER `billing_subscription_customer_purchaser_insert`
BEFORE INSERT ON `billing_subscriptions`
WHEN NOT EXISTS (
	SELECT 1 FROM `billing_customers` AS `customer`
	WHERE `customer`.`id` = NEW.`billing_customer_id`
		AND `customer`.`purchaser_user_id` = NEW.`purchaser_user_id`
)
BEGIN
	SELECT RAISE(ABORT, 'billing subscription customer purchaser mismatch');
END;--> statement-breakpoint
CREATE TRIGGER `billing_subscription_customer_purchaser_update`
BEFORE UPDATE OF `billing_customer_id`, `purchaser_user_id` ON `billing_subscriptions`
WHEN NOT EXISTS (
	SELECT 1 FROM `billing_customers` AS `customer`
	WHERE `customer`.`id` = NEW.`billing_customer_id`
		AND `customer`.`purchaser_user_id` = NEW.`purchaser_user_id`
)
BEGIN
	SELECT RAISE(ABORT, 'billing subscription customer purchaser mismatch');
END;--> statement-breakpoint
CREATE TRIGGER `billing_subscription_offering_reconciliation_insert`
BEFORE INSERT ON `billing_subscriptions`
WHEN NEW.`status` NOT IN ('none', 'canceled', 'incomplete_expired')
	AND (NEW.`plan_key` IS NULL OR NEW.`cadence` IS NULL)
	AND NEW.`reconciliation_required` = 0
BEGIN
	SELECT RAISE(ABORT, 'billing subscription offering requires reconciliation');
END;--> statement-breakpoint
CREATE TRIGGER `billing_subscription_offering_reconciliation_update`
BEFORE UPDATE OF `status`, `plan_key`, `cadence`, `reconciliation_required` ON `billing_subscriptions`
WHEN NEW.`status` NOT IN ('none', 'canceled', 'incomplete_expired')
	AND (NEW.`plan_key` IS NULL OR NEW.`cadence` IS NULL)
	AND NEW.`reconciliation_required` = 0
BEGIN
	SELECT RAISE(ABORT, 'billing subscription offering requires reconciliation');
END;--> statement-breakpoint
CREATE TRIGGER `billing_transition_subscription_purchaser_insert`
BEFORE INSERT ON `billing_subscription_transitions`
WHEN NOT EXISTS (
	SELECT 1 FROM `billing_subscriptions` AS `subscription`
	WHERE `subscription`.`id` = NEW.`billing_subscription_id`
		AND `subscription`.`purchaser_user_id` = NEW.`purchaser_user_id`
		AND `subscription`.`revision` = NEW.`captured_billing_revision`
		AND `subscription`.`plan_key` = NEW.`source_plan_key`
		AND `subscription`.`cadence` = NEW.`source_cadence`
)
BEGIN
	SELECT RAISE(ABORT, 'billing transition subscription purchaser mismatch');
END;--> statement-breakpoint
CREATE TRIGGER `billing_transition_subscription_purchaser_update`
BEFORE UPDATE OF `billing_subscription_id`, `purchaser_user_id`, `captured_billing_revision`,
	`source_plan_key`, `source_cadence` ON `billing_subscription_transitions`
WHEN NOT EXISTS (
	SELECT 1 FROM `billing_subscriptions` AS `subscription`
	WHERE `subscription`.`id` = NEW.`billing_subscription_id`
		AND `subscription`.`purchaser_user_id` = NEW.`purchaser_user_id`
		AND `subscription`.`revision` = NEW.`captured_billing_revision`
		AND `subscription`.`plan_key` = NEW.`source_plan_key`
		AND `subscription`.`cadence` = NEW.`source_cadence`
)
BEGIN
	SELECT RAISE(ABORT, 'billing transition subscription purchaser mismatch');
END;--> statement-breakpoint
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
		INNER JOIN `billing_customers` AS `customer`
			ON `customer`.`id` = `subscription`.`billing_customer_id`
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
		INNER JOIN `billing_customers` AS `customer`
			ON `customer`.`id` = `subscription`.`billing_customer_id`
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
END;
