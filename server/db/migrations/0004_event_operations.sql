ALTER TABLE `events` ADD `visibility` text DEFAULT 'hidden' NOT NULL
  CONSTRAINT "events_visibility_check" CHECK(`visibility` in ('hidden', 'public', 'members'));--> statement-breakpoint
ALTER TABLE `events` ADD `event_page_url` text
  CONSTRAINT "events_page_url_check" CHECK(`event_page_url` is null or (length(trim(`event_page_url`)) between 9 and 2000 and lower(`event_page_url`) like 'https://%'));--> statement-breakpoint
UPDATE `events`
SET `kind` = CASE lower(trim(`kind`))
  WHEN 'meeting' THEN 'meeting'
  WHEN 'general_meeting' THEN 'meeting'
  WHEN 'steering_meeting' THEN 'meeting'
  WHEN 'organizing' THEN 'meeting'
  WHEN 'action' THEN 'action'
  WHEN 'canvass' THEN 'action'
  WHEN 'training' THEN 'learning'
  WHEN 'forum' THEN 'learning'
  WHEN 'learning' THEN 'learning'
  WHEN 'community' THEN 'social'
  WHEN 'social' THEN 'social'
  ELSE 'social'
END;--> statement-breakpoint
CREATE TRIGGER `events_category_insert`
BEFORE INSERT ON `events`
WHEN NEW.`kind` NOT IN ('meeting', 'action', 'learning', 'social')
BEGIN
  SELECT RAISE(ABORT, 'events category is not supported');
END;--> statement-breakpoint
CREATE TRIGGER `events_category_update`
BEFORE UPDATE OF `kind` ON `events`
WHEN NEW.`kind` NOT IN ('meeting', 'action', 'learning', 'social')
BEGIN
  SELECT RAISE(ABORT, 'events category is not supported');
END;--> statement-breakpoint
CREATE INDEX `events_visibility_status_category_idx` ON `events` (`visibility`,`status`,`kind`);--> statement-breakpoint
ALTER TABLE `event_sessions` ADD `title` text
  CONSTRAINT "event_sessions_title_check" CHECK(`title` is null or length(trim(`title`)) between 1 and 255);--> statement-breakpoint
ALTER TABLE `event_sessions` ADD `delivery_mode` text DEFAULT 'in_person' NOT NULL
  CONSTRAINT "event_sessions_delivery_check" CHECK(`delivery_mode` in ('in_person', 'virtual', 'hybrid'));--> statement-breakpoint
ALTER TABLE `event_sessions` ADD `location_name` text
  CONSTRAINT "event_sessions_location_name_check" CHECK(`location_name` is null or length(trim(`location_name`)) between 1 and 255);--> statement-breakpoint
ALTER TABLE `event_sessions` ADD `rsvp_url` text
  CONSTRAINT "event_sessions_rsvp_url_check" CHECK(`rsvp_url` is null or (length(trim(`rsvp_url`)) between 9 and 2000 and lower(`rsvp_url`) like 'https://%'));--> statement-breakpoint
UPDATE `event_sessions`
SET `delivery_mode` = CASE
  WHEN `location` is not null AND `virtual_url` is not null THEN 'hybrid'
  WHEN `virtual_url` is not null THEN 'virtual'
  ELSE 'in_person'
END;--> statement-breakpoint
CREATE TABLE `event_tags` (
	`event_id` text NOT NULL,
	`kind` text NOT NULL,
	`value` text NOT NULL,
	`source_snapshot_id` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`source_snapshot_id`) REFERENCES `external_record_snapshots`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "event_tags_kind_check" CHECK(`kind` in ('event', 'campaign')),
	CONSTRAINT "event_tags_value_check" CHECK(`value` = trim(`value`) and length(`value`) between 1 and 100)
);--> statement-breakpoint
CREATE UNIQUE INDEX `event_tags_event_kind_value_uidx` ON `event_tags` (`event_id`,`kind`,`value`);--> statement-breakpoint
CREATE INDEX `event_tags_kind_value_idx` ON `event_tags` (`kind`,`value`,`event_id`);--> statement-breakpoint
CREATE TABLE `event_provider_links` (
	`id` text PRIMARY KEY NOT NULL,
	`event_id` text NOT NULL,
	`provider` text NOT NULL,
	`external_id` text NOT NULL,
	`primary_external_id` text,
	`source_url` text,
	`last_seen_at` text NOT NULL,
	`source_snapshot_id` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`source_snapshot_id`) REFERENCES `external_record_snapshots`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "event_provider_links_provider_check" CHECK(`provider` = 'solidarity'),
	CONSTRAINT "event_provider_links_identity_check" CHECK(length(trim(`external_id`)) between 1 and 255 and (`primary_external_id` is null or length(trim(`primary_external_id`)) between 1 and 255)),
	CONSTRAINT "event_provider_links_source_check" CHECK(`source_url` is null or (length(trim(`source_url`)) between 9 and 2000 and lower(`source_url`) like 'https://%')),
	CONSTRAINT "event_provider_links_seen_check" CHECK(julianday(`last_seen_at`) is not null)
);--> statement-breakpoint
CREATE UNIQUE INDEX `event_provider_links_provider_external_uidx` ON `event_provider_links` (`provider`,`external_id`);--> statement-breakpoint
CREATE INDEX `event_provider_links_event_idx` ON `event_provider_links` (`event_id`,`provider`);--> statement-breakpoint
CREATE TABLE `event_session_provider_links` (
	`id` text PRIMARY KEY NOT NULL,
	`event_session_id` text NOT NULL,
	`provider` text NOT NULL,
	`external_id` text NOT NULL,
	`primary_external_id` text,
	`paired_external_id` text,
	`last_seen_at` text NOT NULL,
	`source_snapshot_id` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`event_session_id`) REFERENCES `event_sessions`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`source_snapshot_id`) REFERENCES `external_record_snapshots`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "event_session_provider_links_provider_check" CHECK(`provider` = 'solidarity'),
	CONSTRAINT "event_session_provider_links_identity_check" CHECK(length(trim(`external_id`)) between 1 and 255 and (`primary_external_id` is null or length(trim(`primary_external_id`)) between 1 and 255) and (`paired_external_id` is null or length(trim(`paired_external_id`)) between 1 and 255)),
	CONSTRAINT "event_session_provider_links_seen_check" CHECK(julianday(`last_seen_at`) is not null)
);--> statement-breakpoint
CREATE UNIQUE INDEX `event_session_provider_links_provider_external_uidx` ON `event_session_provider_links` (`provider`,`external_id`);--> statement-breakpoint
CREATE INDEX `event_session_provider_links_session_idx` ON `event_session_provider_links` (`event_session_id`,`provider`);
