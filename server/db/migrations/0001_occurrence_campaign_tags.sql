CREATE TABLE `event_session_campaign_tags` (
	`event_session_id` text NOT NULL,
	`value` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`event_session_id`) REFERENCES `event_sessions`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "event_session_campaign_tags_value_check" CHECK("event_session_campaign_tags"."value" = trim("event_session_campaign_tags"."value") and length("event_session_campaign_tags"."value") between 1 and 100)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `event_session_campaign_tags_session_value_uidx` ON `event_session_campaign_tags` (`event_session_id`,`value`);