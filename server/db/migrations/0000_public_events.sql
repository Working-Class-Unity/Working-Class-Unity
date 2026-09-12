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
	CONSTRAINT "event_provider_links_provider_check" CHECK("event_provider_links"."provider" = 'solidarity'),
	CONSTRAINT "event_provider_links_identity_check" CHECK(length(trim("event_provider_links"."external_id")) between 1 and 255 and ("event_provider_links"."primary_external_id" is null or length(trim("event_provider_links"."primary_external_id")) between 1 and 255)),
	CONSTRAINT "event_provider_links_source_check" CHECK("event_provider_links"."source_url" is null or (length(trim("event_provider_links"."source_url")) between 9 and 2000 and lower("event_provider_links"."source_url") like 'https://%')),
	CONSTRAINT "event_provider_links_seen_check" CHECK(julianday("event_provider_links"."last_seen_at") is not null)
);
--> statement-breakpoint
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
	CONSTRAINT "event_session_provider_links_provider_check" CHECK("event_session_provider_links"."provider" = 'solidarity'),
	CONSTRAINT "event_session_provider_links_identity_check" CHECK(length(trim("event_session_provider_links"."external_id")) between 1 and 255 and ("event_session_provider_links"."primary_external_id" is null or length(trim("event_session_provider_links"."primary_external_id")) between 1 and 255) and ("event_session_provider_links"."paired_external_id" is null or length(trim("event_session_provider_links"."paired_external_id")) between 1 and 255)),
	CONSTRAINT "event_session_provider_links_seen_check" CHECK(julianday("event_session_provider_links"."last_seen_at") is not null)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `event_session_provider_links_provider_external_uidx` ON `event_session_provider_links` (`provider`,`external_id`);--> statement-breakpoint
CREATE INDEX `event_session_provider_links_session_idx` ON `event_session_provider_links` (`event_session_id`,`provider`);--> statement-breakpoint
CREATE TABLE `event_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`event_id` text NOT NULL,
	`title` text,
	`status` text DEFAULT 'scheduled' NOT NULL,
	`delivery_mode` text DEFAULT 'in_person' NOT NULL,
	`starts_at` text NOT NULL,
	`ends_at` text,
	`timezone` text NOT NULL,
	`location_name` text,
	`location` text,
	`virtual_url` text,
	`rsvp_url` text,
	`source_snapshot_id` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`source_snapshot_id`) REFERENCES `external_record_snapshots`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "event_sessions_title_check" CHECK("event_sessions"."title" is null or length(trim("event_sessions"."title")) between 1 and 255),
	CONSTRAINT "event_sessions_status_check" CHECK("event_sessions"."status" in ('scheduled', 'canceled', 'completed')),
	CONSTRAINT "event_sessions_delivery_check" CHECK("event_sessions"."delivery_mode" in ('in_person', 'virtual', 'hybrid')),
	CONSTRAINT "event_sessions_interval_check" CHECK(julianday("event_sessions"."starts_at") is not null and ("event_sessions"."ends_at" is null or julianday("event_sessions"."ends_at") >= julianday("event_sessions"."starts_at"))),
	CONSTRAINT "event_sessions_timezone_check" CHECK(length(trim("event_sessions"."timezone")) between 1 and 100),
	CONSTRAINT "event_sessions_location_name_check" CHECK("event_sessions"."location_name" is null or length(trim("event_sessions"."location_name")) between 1 and 255),
	CONSTRAINT "event_sessions_location_check" CHECK(("event_sessions"."location" is null or length(trim("event_sessions"."location")) between 1 and 500) and ("event_sessions"."virtual_url" is null or length(trim("event_sessions"."virtual_url")) between 1 and 2000)),
	CONSTRAINT "event_sessions_rsvp_url_check" CHECK("event_sessions"."rsvp_url" is null or (length(trim("event_sessions"."rsvp_url")) between 9 and 2000 and lower("event_sessions"."rsvp_url") like 'https://%'))
);
--> statement-breakpoint
CREATE INDEX `event_sessions_event_start_idx` ON `event_sessions` (`event_id`,`starts_at`);--> statement-breakpoint
CREATE INDEX `event_sessions_status_start_idx` ON `event_sessions` (`status`,`starts_at`);--> statement-breakpoint
CREATE TABLE `event_tags` (
	`event_id` text NOT NULL,
	`kind` text NOT NULL,
	`value` text NOT NULL,
	`source_snapshot_id` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`source_snapshot_id`) REFERENCES `external_record_snapshots`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "event_tags_kind_check" CHECK("event_tags"."kind" in ('event', 'campaign')),
	CONSTRAINT "event_tags_value_check" CHECK("event_tags"."value" = trim("event_tags"."value") and length("event_tags"."value") between 1 and 100)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `event_tags_event_kind_value_uidx` ON `event_tags` (`event_id`,`kind`,`value`);--> statement-breakpoint
CREATE INDEX `event_tags_kind_value_idx` ON `event_tags` (`kind`,`value`,`event_id`);--> statement-breakpoint
CREATE TABLE `events` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`description` text,
	`kind` text NOT NULL,
	`visibility` text DEFAULT 'hidden' NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`default_timezone` text DEFAULT 'America/Los_Angeles' NOT NULL,
	`event_page_url` text,
	`source_snapshot_id` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`source_snapshot_id`) REFERENCES `external_record_snapshots`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "events_title_check" CHECK(length(trim("events"."title")) between 1 and 255),
	CONSTRAINT "events_kind_check" CHECK("events"."kind" in ('meeting', 'action', 'learning', 'social')),
	CONSTRAINT "events_visibility_check" CHECK("events"."visibility" in ('hidden', 'public', 'members')),
	CONSTRAINT "events_status_check" CHECK("events"."status" in ('active', 'archived')),
	CONSTRAINT "events_timezone_check" CHECK(length(trim("events"."default_timezone")) between 1 and 100),
	CONSTRAINT "events_page_url_check" CHECK("events"."event_page_url" is null or (length(trim("events"."event_page_url")) between 9 and 2000 and lower("events"."event_page_url") like 'https://%'))
);
--> statement-breakpoint
CREATE INDEX `events_status_kind_idx` ON `events` (`status`,`kind`);--> statement-breakpoint
CREATE INDEX `events_visibility_status_category_idx` ON `events` (`visibility`,`status`,`kind`);--> statement-breakpoint
CREATE TABLE `external_record_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`import_batch_id` text NOT NULL,
	`object_type` text NOT NULL,
	`external_id` text NOT NULL,
	`observed_at` text NOT NULL,
	`payload_hash` text NOT NULL,
	`raw_payload` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`import_batch_id`) REFERENCES `import_batches`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "external_record_snapshots_identity_check" CHECK("external_record_snapshots"."object_type" in ('solidarity.event', 'solidarity.session') and length(trim("external_record_snapshots"."external_id")) between 1 and 255),
	CONSTRAINT "external_record_snapshots_hash_check" CHECK(length(trim("external_record_snapshots"."payload_hash")) between 16 and 128),
	CONSTRAINT "external_record_snapshots_payload_check" CHECK(json_valid("external_record_snapshots"."raw_payload") and json_type("external_record_snapshots"."raw_payload") = 'object'),
	CONSTRAINT "external_record_snapshots_observed_at_check" CHECK(julianday("external_record_snapshots"."observed_at") is not null)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `external_record_snapshots_batch_object_uidx` ON `external_record_snapshots` (`import_batch_id`,`object_type`,`external_id`);--> statement-breakpoint
CREATE INDEX `external_record_snapshots_external_idx` ON `external_record_snapshots` (`object_type`,`external_id`,`observed_at`);--> statement-breakpoint
CREATE TABLE `import_batches` (
	`id` text PRIMARY KEY NOT NULL,
	`provider` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`source_name` text,
	`source_checksum` text,
	`started_at` text NOT NULL,
	`completed_at` text,
	`record_count` integer,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	CONSTRAINT "import_batches_provider_check" CHECK("import_batches"."provider" = 'solidarity'),
	CONSTRAINT "import_batches_status_check" CHECK("import_batches"."status" in ('pending', 'completed', 'failed')),
	CONSTRAINT "import_batches_started_at_check" CHECK(julianday("import_batches"."started_at") is not null),
	CONSTRAINT "import_batches_completion_check" CHECK(("import_batches"."status" = 'pending' and "import_batches"."completed_at" is null) or ("import_batches"."status" in ('completed', 'failed') and "import_batches"."completed_at" is not null and julianday("import_batches"."completed_at") >= julianday("import_batches"."started_at"))),
	CONSTRAINT "import_batches_record_count_check" CHECK("import_batches"."record_count" is null or "import_batches"."record_count" >= 0),
	CONSTRAINT "import_batches_checksum_check" CHECK("import_batches"."source_checksum" is null or length(trim("import_batches"."source_checksum")) between 16 and 128)
);
--> statement-breakpoint
CREATE INDEX `import_batches_provider_started_idx` ON `import_batches` (`provider`,`started_at`);