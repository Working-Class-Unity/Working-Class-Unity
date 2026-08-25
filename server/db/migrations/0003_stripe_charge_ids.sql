-- Stripe can return legacy Charge objects whose IDs use the py_ prefix.
CREATE TABLE `__stripe_refunds_backup` AS
SELECT `id`, `charge_id`, `balance_transaction_id`, `status`, `amount`, `currency`, `reason`,
	`provider_created_at`, `source_snapshot_id`, `created_at`, `updated_at`
FROM `stripe_refunds`;--> statement-breakpoint
CREATE TABLE `__stripe_disputes_backup` AS
SELECT `id`, `charge_id`, `balance_transaction_id`, `status`, `amount`, `currency`, `reason`,
	`provider_created_at`, `source_snapshot_id`, `created_at`, `updated_at`
FROM `stripe_disputes`;--> statement-breakpoint
DROP TABLE `stripe_refunds`;--> statement-breakpoint
DROP TABLE `stripe_disputes`;--> statement-breakpoint
CREATE TABLE `__new_stripe_charges` (
	`id` text PRIMARY KEY NOT NULL,
	`customer_id` text,
	`invoice_id` text,
	`payment_intent_id` text,
	`balance_transaction_id` text,
	`status` text NOT NULL,
	`revenue_category` text DEFAULT 'unclassified' NOT NULL,
	`amount` integer NOT NULL,
	`amount_captured` integer NOT NULL,
	`amount_refunded` integer NOT NULL,
	`currency` text NOT NULL,
	`paid` integer NOT NULL,
	`disputed` integer NOT NULL,
	`provider_created_at` text,
	`source_snapshot_id` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`customer_id`) REFERENCES `stripe_customers`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`invoice_id`) REFERENCES `stripe_invoices`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`balance_transaction_id`) REFERENCES `stripe_balance_transactions`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`source_snapshot_id`) REFERENCES `external_record_snapshots`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "stripe_charges_id_check" CHECK("__new_stripe_charges"."id" glob 'ch_*' or "__new_stripe_charges"."id" glob 'py_*'),
	CONSTRAINT "stripe_charges_status_check" CHECK("__new_stripe_charges"."status" in ('pending', 'succeeded', 'failed')),
	CONSTRAINT "stripe_charges_revenue_check" CHECK("__new_stripe_charges"."revenue_category" in ('dues', 'donation', 'other', 'unclassified')),
	CONSTRAINT "stripe_charges_amount_check" CHECK("__new_stripe_charges"."amount" >= 0 and "__new_stripe_charges"."amount_captured" >= 0 and "__new_stripe_charges"."amount_captured" <= "__new_stripe_charges"."amount" and "__new_stripe_charges"."amount_refunded" >= 0 and "__new_stripe_charges"."amount_refunded" <= "__new_stripe_charges"."amount_captured"),
	CONSTRAINT "stripe_charges_currency_check" CHECK(length("__new_stripe_charges"."currency") = 3 and "__new_stripe_charges"."currency" = upper("__new_stripe_charges"."currency")),
	CONSTRAINT "stripe_charges_provider_created_check" CHECK("__new_stripe_charges"."provider_created_at" is null or julianday("__new_stripe_charges"."provider_created_at") is not null)
);
--> statement-breakpoint
INSERT INTO `__new_stripe_charges`("id", "customer_id", "invoice_id", "payment_intent_id", "balance_transaction_id", "status", "revenue_category", "amount", "amount_captured", "amount_refunded", "currency", "paid", "disputed", "provider_created_at", "source_snapshot_id", "created_at", "updated_at") SELECT "id", "customer_id", "invoice_id", "payment_intent_id", "balance_transaction_id", "status", "revenue_category", "amount", "amount_captured", "amount_refunded", "currency", "paid", "disputed", "provider_created_at", "source_snapshot_id", "created_at", "updated_at" FROM `stripe_charges`;--> statement-breakpoint
DROP TABLE `stripe_charges`;--> statement-breakpoint
ALTER TABLE `__new_stripe_charges` RENAME TO `stripe_charges`;--> statement-breakpoint
CREATE INDEX `stripe_charges_customer_created_idx` ON `stripe_charges` (`customer_id`,`provider_created_at`);--> statement-breakpoint
CREATE INDEX `stripe_charges_invoice_idx` ON `stripe_charges` (`invoice_id`);--> statement-breakpoint
CREATE INDEX `stripe_charges_revenue_idx` ON `stripe_charges` (`revenue_category`,`status`,`provider_created_at`);--> statement-breakpoint
CREATE TABLE `stripe_refunds` (
	`id` text PRIMARY KEY NOT NULL,
	`charge_id` text NOT NULL,
	`balance_transaction_id` text,
	`status` text NOT NULL,
	`amount` integer NOT NULL,
	`currency` text NOT NULL,
	`reason` text,
	`provider_created_at` text,
	`source_snapshot_id` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`charge_id`) REFERENCES `stripe_charges`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`balance_transaction_id`) REFERENCES `stripe_balance_transactions`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`source_snapshot_id`) REFERENCES `external_record_snapshots`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "stripe_refunds_id_check" CHECK("stripe_refunds"."id" glob 're_*'),
	CONSTRAINT "stripe_refunds_status_check" CHECK("stripe_refunds"."status" in ('pending', 'requires_action', 'succeeded', 'failed', 'canceled')),
	CONSTRAINT "stripe_refunds_amount_check" CHECK("stripe_refunds"."amount" >= 0),
	CONSTRAINT "stripe_refunds_currency_check" CHECK(length("stripe_refunds"."currency") = 3 and "stripe_refunds"."currency" = upper("stripe_refunds"."currency")),
	CONSTRAINT "stripe_refunds_provider_created_check" CHECK("stripe_refunds"."provider_created_at" is null or julianday("stripe_refunds"."provider_created_at") is not null)
);--> statement-breakpoint
INSERT INTO `stripe_refunds`
	(`id`, `charge_id`, `balance_transaction_id`, `status`, `amount`, `currency`, `reason`,
	 `provider_created_at`, `source_snapshot_id`, `created_at`, `updated_at`)
SELECT `id`, `charge_id`, `balance_transaction_id`, `status`, `amount`, `currency`, `reason`,
	`provider_created_at`, `source_snapshot_id`, `created_at`, `updated_at`
FROM `__stripe_refunds_backup`;--> statement-breakpoint
CREATE INDEX `stripe_refunds_charge_idx` ON `stripe_refunds` (`charge_id`,`status`);--> statement-breakpoint
CREATE TABLE `stripe_disputes` (
	`id` text PRIMARY KEY NOT NULL,
	`charge_id` text NOT NULL,
	`balance_transaction_id` text,
	`status` text NOT NULL,
	`amount` integer NOT NULL,
	`currency` text NOT NULL,
	`reason` text,
	`provider_created_at` text,
	`source_snapshot_id` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`charge_id`) REFERENCES `stripe_charges`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`balance_transaction_id`) REFERENCES `stripe_balance_transactions`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`source_snapshot_id`) REFERENCES `external_record_snapshots`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "stripe_disputes_id_check" CHECK("stripe_disputes"."id" glob 'dp_*'),
	CONSTRAINT "stripe_disputes_amount_check" CHECK("stripe_disputes"."amount" >= 0),
	CONSTRAINT "stripe_disputes_currency_check" CHECK(length("stripe_disputes"."currency") = 3 and "stripe_disputes"."currency" = upper("stripe_disputes"."currency")),
	CONSTRAINT "stripe_disputes_provider_created_check" CHECK("stripe_disputes"."provider_created_at" is null or julianday("stripe_disputes"."provider_created_at") is not null)
);--> statement-breakpoint
INSERT INTO `stripe_disputes`
	(`id`, `charge_id`, `balance_transaction_id`, `status`, `amount`, `currency`, `reason`,
	 `provider_created_at`, `source_snapshot_id`, `created_at`, `updated_at`)
SELECT `id`, `charge_id`, `balance_transaction_id`, `status`, `amount`, `currency`, `reason`,
	`provider_created_at`, `source_snapshot_id`, `created_at`, `updated_at`
FROM `__stripe_disputes_backup`;--> statement-breakpoint
CREATE INDEX `stripe_disputes_charge_idx` ON `stripe_disputes` (`charge_id`,`status`);--> statement-breakpoint
DROP TABLE `__stripe_refunds_backup`;--> statement-breakpoint
DROP TABLE `__stripe_disputes_backup`;
