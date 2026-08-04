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
	`active_organization_id` text,
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
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
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
CREATE TABLE `billing_checkout_attempts` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`billing_customer_id` text,
	`plan_key` text DEFAULT 'family' NOT NULL,
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
	CONSTRAINT "billing_checkout_attempts_plan_check" CHECK("billing_checkout_attempts"."plan_key" = 'family'),
	CONSTRAINT "billing_checkout_attempts_state_check" CHECK("billing_checkout_attempts"."state" in ('pending', 'open', 'completed', 'expired', 'failed', 'reconciliation_required')),
	CONSTRAINT "billing_checkout_attempts_reuse_check" CHECK("billing_checkout_attempts"."reuse_until" >= "billing_checkout_attempts"."created_at")
);
--> statement-breakpoint
CREATE INDEX `billing_checkout_attempts_organization_id_idx` ON `billing_checkout_attempts` (`organization_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `billing_checkout_attempts_stripe_session_id_uidx` ON `billing_checkout_attempts` (`stripe_session_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `billing_checkout_attempts_idempotency_key_uidx` ON `billing_checkout_attempts` (`idempotency_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `billing_checkout_attempts_one_open_uidx` ON `billing_checkout_attempts` (`organization_id`) WHERE "billing_checkout_attempts"."state" in ('pending', 'open', 'reconciliation_required');--> statement-breakpoint
CREATE TABLE `billing_customers` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`stripe_customer_id` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `billing_customers_organization_id_uidx` ON `billing_customers` (`organization_id`);--> statement-breakpoint
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
CREATE TABLE `billing_subscriptions` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`billing_customer_id` text NOT NULL,
	`stripe_subscription_id` text,
	`status` text DEFAULT 'none' NOT NULL,
	`plan_key` text,
	`stripe_price_id` text,
	`current_period_start` text,
	`current_period_end` text,
	`cancel_at_period_end` integer DEFAULT false NOT NULL,
	`projection_order_ms` integer DEFAULT 0 NOT NULL,
	`projection_event_id` text,
	`reconciliation_required` integer DEFAULT false NOT NULL,
	`reconciliation_reason` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`billing_customer_id`) REFERENCES `billing_customers`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "billing_subscriptions_status_check" CHECK("billing_subscriptions"."status" in ('none', 'active', 'canceled', 'incomplete', 'incomplete_expired', 'past_due', 'paused', 'trialing', 'unpaid', 'ambiguous')),
	CONSTRAINT "billing_subscriptions_plan_check" CHECK("billing_subscriptions"."plan_key" is null or "billing_subscriptions"."plan_key" = 'family'),
	CONSTRAINT "billing_subscriptions_reconciliation_check" CHECK(("billing_subscriptions"."reconciliation_required" = 1 and "billing_subscriptions"."reconciliation_reason" is not null) or ("billing_subscriptions"."reconciliation_required" = 0 and "billing_subscriptions"."reconciliation_reason" is null)),
	CONSTRAINT "billing_subscriptions_none_check" CHECK("billing_subscriptions"."status" <> 'none' or ("billing_subscriptions"."stripe_subscription_id" is null and "billing_subscriptions"."plan_key" is null and "billing_subscriptions"."stripe_price_id" is null))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `billing_subscriptions_organization_id_uidx` ON `billing_subscriptions` (`organization_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `billing_subscriptions_customer_id_uidx` ON `billing_subscriptions` (`billing_customer_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `billing_subscriptions_stripe_subscription_id_uidx` ON `billing_subscriptions` (`stripe_subscription_id`);--> statement-breakpoint
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
	CONSTRAINT "detached_billing_subject_retention_purpose_check" CHECK("detached_billing_subjects"."retention_purpose" = 'external_billing_reconciliation'),
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
CREATE TABLE `invitation` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`email` text NOT NULL,
	`role` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`inviter_id` text NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`inviter_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `invitation_organizationId_idx` ON `invitation` (`organization_id`);--> statement-breakpoint
CREATE INDEX `invitation_email_idx` ON `invitation` (`email`);--> statement-breakpoint
CREATE TABLE `member` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`user_id` text NOT NULL,
	`role` text DEFAULT 'member' NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "member_single_role_check" CHECK("member"."role" in ('owner', 'member'))
);
--> statement-breakpoint
CREATE INDEX `member_organizationId_idx` ON `member` (`organization_id`);--> statement-breakpoint
CREATE INDEX `member_userId_idx` ON `member` (`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `member_one_external_family_uidx` ON `member` (`user_id`) WHERE "member"."role" = 'member';--> statement-breakpoint
CREATE UNIQUE INDEX `member_organization_id_user_id_uidx` ON `member` (`organization_id`,`user_id`);--> statement-breakpoint
CREATE TABLE `organization` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`logo` text,
	`created_at` integer NOT NULL,
	`metadata` text,
	`personal_owner_user_id` text,
	FOREIGN KEY (`personal_owner_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `organization_personal_owner_user_id_unique` ON `organization` (`personal_owner_user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `organization_slug_uidx` ON `organization` (`slug`);--> statement-breakpoint
CREATE TABLE `projects` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`owner_user_id` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`owner_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `projects_owner_user_id_idx` ON `projects` (`owner_user_id`);
