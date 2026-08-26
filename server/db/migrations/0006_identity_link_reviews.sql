CREATE TABLE `identity_link_reviews` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`reason` text NOT NULL,
	`identifier_hash` text NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`resolved_person_id` text,
	`resolved_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`resolved_person_id`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "identity_link_reviews_reason_check" CHECK("identity_link_reviews"."reason" in ('ambiguous_verified_email', 'conflicting_verified_email', 'phone_match_requires_verified_email', 'conflicting_verified_identifiers')),
	CONSTRAINT "identity_link_reviews_hash_check" CHECK("identity_link_reviews"."identifier_hash" not glob '*[^0-9a-f]*' and length("identity_link_reviews"."identifier_hash") = 64),
	CONSTRAINT "identity_link_reviews_resolution_check" CHECK(("identity_link_reviews"."status" = 'open' and "identity_link_reviews"."resolved_person_id" is null and "identity_link_reviews"."resolved_at" is null) or ("identity_link_reviews"."status" = 'resolved' and "identity_link_reviews"."resolved_person_id" is not null and "identity_link_reviews"."resolved_at" is not null and julianday("identity_link_reviews"."resolved_at") is not null))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `identity_link_reviews_one_open_user_uidx` ON `identity_link_reviews` (`user_id`) WHERE "identity_link_reviews"."status" = 'open';--> statement-breakpoint
CREATE INDEX `identity_link_reviews_status_idx` ON `identity_link_reviews` (`status`,`created_at`);