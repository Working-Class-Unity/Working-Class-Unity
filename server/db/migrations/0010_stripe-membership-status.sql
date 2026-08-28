ALTER TABLE `account_stripe_memberships` ADD `stripe_status` text;--> statement-breakpoint
ALTER TABLE `account_stripe_memberships` ADD `last_verified_at` text;--> statement-breakpoint
ALTER TABLE `account_stripe_memberships` ADD `projection_order_ms` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `account_stripe_memberships` ADD `projection_event_id` text;