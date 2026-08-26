CREATE TABLE `billing_email_verifications` (
	`id` text PRIMARY KEY NOT NULL,
	`purchaser_user_id` text NOT NULL,
	`billing_checkout_attempt_id` text NOT NULL,
	`stripe_session_id` text NOT NULL,
	`email` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`expires_at` text NOT NULL,
	`sent_at` text,
	`consumed_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`purchaser_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`billing_checkout_attempt_id`) REFERENCES `billing_checkout_attempts`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "billing_email_verifications_id_check" CHECK(length("billing_email_verifications"."id") = 63 and substr("billing_email_verifications"."id", 1, 27) = 'billing_email_verification_'),
	CONSTRAINT "billing_email_verifications_session_check" CHECK("billing_email_verifications"."stripe_session_id" glob 'cs_*'),
	CONSTRAINT "billing_email_verifications_email_check" CHECK("billing_email_verifications"."email" = lower(trim("billing_email_verifications"."email")) and length("billing_email_verifications"."email") between 3 and 320 and instr("billing_email_verifications"."email", '@') > 1),
	CONSTRAINT "billing_email_verifications_status_check" CHECK("billing_email_verifications"."status" in ('pending', 'sent', 'consumed', 'conflict', 'expired')),
	CONSTRAINT "billing_email_verifications_lifecycle_check" CHECK(("billing_email_verifications"."status" = 'pending' and "billing_email_verifications"."sent_at" is null and "billing_email_verifications"."consumed_at" is null) or ("billing_email_verifications"."status" = 'sent' and "billing_email_verifications"."sent_at" is not null and "billing_email_verifications"."consumed_at" is null) or ("billing_email_verifications"."status" in ('consumed', 'conflict') and "billing_email_verifications"."sent_at" is not null and "billing_email_verifications"."consumed_at" is not null) or ("billing_email_verifications"."status" = 'expired' and "billing_email_verifications"."consumed_at" is not null)),
	CONSTRAINT "billing_email_verifications_timestamps_check" CHECK(julianday("billing_email_verifications"."expires_at") is not null and julianday("billing_email_verifications"."created_at") is not null and julianday("billing_email_verifications"."updated_at") is not null and julianday("billing_email_verifications"."expires_at") > julianday("billing_email_verifications"."created_at") and julianday("billing_email_verifications"."updated_at") >= julianday("billing_email_verifications"."created_at") and ("billing_email_verifications"."sent_at" is null or julianday("billing_email_verifications"."sent_at") >= julianday("billing_email_verifications"."created_at")) and ("billing_email_verifications"."consumed_at" is null or julianday("billing_email_verifications"."consumed_at") >= julianday("billing_email_verifications"."created_at")))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `billing_email_verifications_attempt_id_uidx` ON `billing_email_verifications` (`billing_checkout_attempt_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `billing_email_verifications_stripe_session_id_uidx` ON `billing_email_verifications` (`stripe_session_id`);--> statement-breakpoint
CREATE INDEX `billing_email_verifications_status_expiry_idx` ON `billing_email_verifications` (`status`,`expires_at`);
