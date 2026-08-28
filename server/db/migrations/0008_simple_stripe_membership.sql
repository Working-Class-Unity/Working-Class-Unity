CREATE TABLE `account_stripe_memberships` (
	`user_id` text PRIMARY KEY NOT NULL,
	`stripe_customer_id` text NOT NULL,
	`stripe_subscription_id` text NOT NULL,
	`stripe_price_id` text NOT NULL,
	`tier` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "account_stripe_memberships_customer_check" CHECK("account_stripe_memberships"."stripe_customer_id" glob 'cus_*'),
	CONSTRAINT "account_stripe_memberships_subscription_check" CHECK("account_stripe_memberships"."stripe_subscription_id" glob 'sub_*'),
	CONSTRAINT "account_stripe_memberships_price_check" CHECK("account_stripe_memberships"."stripe_price_id" glob 'price_*'),
	CONSTRAINT "account_stripe_memberships_tier_check" CHECK("account_stripe_memberships"."tier" in ('supporter', 'member', 'solidarity'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `account_stripe_memberships_customer_uidx` ON `account_stripe_memberships` (`stripe_customer_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `account_stripe_memberships_subscription_uidx` ON `account_stripe_memberships` (`stripe_subscription_id`);