CREATE TABLE `attendance` (
	`id` text PRIMARY KEY NOT NULL,
	`event_session_id` text NOT NULL,
	`person_id` text NOT NULL,
	`status` text NOT NULL,
	`source` text NOT NULL,
	`recorded_at` text NOT NULL,
	`source_snapshot_id` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`event_session_id`) REFERENCES `event_sessions`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`person_id`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`source_snapshot_id`) REFERENCES `external_record_snapshots`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "attendance_status_check" CHECK("attendance"."status" in ('attended', 'absent', 'excused', 'unknown')),
	CONSTRAINT "attendance_source_check" CHECK("attendance"."source" in ('manual', 'solidarity', 'discourse', 'import')),
	CONSTRAINT "attendance_recorded_at_check" CHECK(julianday("attendance"."recorded_at") is not null)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `attendance_session_person_uidx` ON `attendance` (`event_session_id`,`person_id`);--> statement-breakpoint
CREATE INDEX `attendance_person_recorded_idx` ON `attendance` (`person_id`,`recorded_at`);--> statement-breakpoint
CREATE TABLE `attendance_intervals` (
	`id` text PRIMARY KEY NOT NULL,
	`attendance_id` text NOT NULL,
	`checked_in_at` text NOT NULL,
	`checked_out_at` text,
	`source_snapshot_id` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`attendance_id`) REFERENCES `attendance`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`source_snapshot_id`) REFERENCES `external_record_snapshots`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "attendance_intervals_range_check" CHECK(julianday("attendance_intervals"."checked_in_at") is not null and ("attendance_intervals"."checked_out_at" is null or julianday("attendance_intervals"."checked_out_at") >= julianday("attendance_intervals"."checked_in_at")))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `attendance_intervals_attendance_checkin_uidx` ON `attendance_intervals` (`attendance_id`,`checked_in_at`);--> statement-breakpoint
CREATE TABLE `event_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`event_id` text NOT NULL,
	`status` text DEFAULT 'scheduled' NOT NULL,
	`starts_at` text NOT NULL,
	`ends_at` text,
	`timezone` text NOT NULL,
	`location` text,
	`virtual_url` text,
	`source_snapshot_id` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`source_snapshot_id`) REFERENCES `external_record_snapshots`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "event_sessions_status_check" CHECK("event_sessions"."status" in ('scheduled', 'canceled', 'completed')),
	CONSTRAINT "event_sessions_interval_check" CHECK(julianday("event_sessions"."starts_at") is not null and ("event_sessions"."ends_at" is null or julianday("event_sessions"."ends_at") >= julianday("event_sessions"."starts_at"))),
	CONSTRAINT "event_sessions_timezone_check" CHECK(length(trim("event_sessions"."timezone")) between 1 and 100),
	CONSTRAINT "event_sessions_location_check" CHECK(("event_sessions"."location" is null or length(trim("event_sessions"."location")) between 1 and 500) and ("event_sessions"."virtual_url" is null or length(trim("event_sessions"."virtual_url")) between 1 and 2000))
);
--> statement-breakpoint
CREATE INDEX `event_sessions_event_start_idx` ON `event_sessions` (`event_id`,`starts_at`);--> statement-breakpoint
CREATE INDEX `event_sessions_status_start_idx` ON `event_sessions` (`status`,`starts_at`);--> statement-breakpoint
CREATE TABLE `events` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`description` text,
	`kind` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`default_timezone` text DEFAULT 'America/Los_Angeles' NOT NULL,
	`source_snapshot_id` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`source_snapshot_id`) REFERENCES `external_record_snapshots`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "events_title_check" CHECK(length(trim("events"."title")) between 1 and 255),
	CONSTRAINT "events_kind_check" CHECK(length(trim("events"."kind")) between 1 and 100),
	CONSTRAINT "events_status_check" CHECK("events"."status" in ('active', 'archived')),
	CONSTRAINT "events_timezone_check" CHECK(length(trim("events"."default_timezone")) between 1 and 100)
);
--> statement-breakpoint
CREATE INDEX `events_status_kind_idx` ON `events` (`status`,`kind`);--> statement-breakpoint
CREATE TABLE `rsvps` (
	`id` text PRIMARY KEY NOT NULL,
	`event_session_id` text NOT NULL,
	`person_id` text NOT NULL,
	`status` text NOT NULL,
	`responded_at` text NOT NULL,
	`source_snapshot_id` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`event_session_id`) REFERENCES `event_sessions`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`person_id`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`source_snapshot_id`) REFERENCES `external_record_snapshots`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "rsvps_status_check" CHECK("rsvps"."status" in ('yes', 'no', 'maybe', 'waitlisted', 'canceled')),
	CONSTRAINT "rsvps_responded_at_check" CHECK(julianday("rsvps"."responded_at") is not null)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `rsvps_session_person_uidx` ON `rsvps` (`event_session_id`,`person_id`);--> statement-breakpoint
CREATE INDEX `rsvps_person_idx` ON `rsvps` (`person_id`,`responded_at`);--> statement-breakpoint
CREATE TABLE `budget_lines` (
	`id` text PRIMARY KEY NOT NULL,
	`budget_id` text NOT NULL,
	`position` integer NOT NULL,
	`kind` text NOT NULL,
	`category` text NOT NULL,
	`description` text NOT NULL,
	`amount` integer NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`budget_id`) REFERENCES `budgets`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "budget_lines_position_amount_check" CHECK("budget_lines"."position" >= 1 and "budget_lines"."amount" >= 0),
	CONSTRAINT "budget_lines_kind_check" CHECK("budget_lines"."kind" in ('income', 'expense')),
	CONSTRAINT "budget_lines_category_check" CHECK(length(trim("budget_lines"."category")) between 1 and 100),
	CONSTRAINT "budget_lines_description_check" CHECK(length(trim("budget_lines"."description")) between 1 and 1000)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `budget_lines_budget_position_uidx` ON `budget_lines` (`budget_id`,`position`);--> statement-breakpoint
CREATE INDEX `budget_lines_budget_kind_idx` ON `budget_lines` (`budget_id`,`kind`);--> statement-breakpoint
CREATE TABLE `budgets` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`period_start` text NOT NULL,
	`period_end` text NOT NULL,
	`currency` text DEFAULT 'USD' NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`approving_motion_id` text,
	`source_url` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`approving_motion_id`) REFERENCES `motions`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "budgets_name_check" CHECK(length(trim("budgets"."name")) between 1 and 255),
	CONSTRAINT "budgets_status_check" CHECK("budgets"."status" in ('draft', 'approved', 'superseded')),
	CONSTRAINT "budgets_currency_check" CHECK(length("budgets"."currency") = 3 and "budgets"."currency" = upper("budgets"."currency")),
	CONSTRAINT "budgets_period_check" CHECK(julianday("budgets"."period_start") is not null and julianday("budgets"."period_end") >= julianday("budgets"."period_start")),
	CONSTRAINT "budgets_source_url_check" CHECK("budgets"."source_url" is null or length(trim("budgets"."source_url")) between 1 and 2000)
);
--> statement-breakpoint
CREATE INDEX `budgets_status_period_idx` ON `budgets` (`status`,`period_start`,`period_end`);--> statement-breakpoint
CREATE TABLE `cash_ledger_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`status` text DEFAULT 'posted' NOT NULL,
	`amount` integer NOT NULL,
	`currency` text DEFAULT 'USD' NOT NULL,
	`occurred_at` text NOT NULL,
	`category` text NOT NULL,
	`description` text NOT NULL,
	`counterparty` text,
	`visibility` text NOT NULL,
	`budget_line_id` text,
	`recurring_expense_id` text,
	`source_type` text NOT NULL,
	`source_id` text,
	`source_component` text DEFAULT 'primary' NOT NULL,
	`source_snapshot_id` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`budget_line_id`) REFERENCES `budget_lines`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`recurring_expense_id`) REFERENCES `recurring_expenses`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`source_snapshot_id`) REFERENCES `external_record_snapshots`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "cash_ledger_kind_check" CHECK("cash_ledger_entries"."kind" in ('dues', 'donation', 'other_income', 'expense', 'fee', 'refund', 'dispute', 'transfer', 'adjustment')),
	CONSTRAINT "cash_ledger_status_check" CHECK("cash_ledger_entries"."status" in ('pending', 'posted', 'void')),
	CONSTRAINT "cash_ledger_amount_check" CHECK(("cash_ledger_entries"."kind" in ('dues', 'donation', 'other_income') and "cash_ledger_entries"."amount" > 0) or ("cash_ledger_entries"."kind" in ('expense', 'fee', 'refund', 'dispute') and "cash_ledger_entries"."amount" < 0) or ("cash_ledger_entries"."kind" in ('transfer', 'adjustment') and "cash_ledger_entries"."amount" <> 0)),
	CONSTRAINT "cash_ledger_currency_check" CHECK(length("cash_ledger_entries"."currency") = 3 and "cash_ledger_entries"."currency" = upper("cash_ledger_entries"."currency")),
	CONSTRAINT "cash_ledger_occurred_at_check" CHECK(julianday("cash_ledger_entries"."occurred_at") is not null),
	CONSTRAINT "cash_ledger_category_check" CHECK(length(trim("cash_ledger_entries"."category")) between 1 and 100),
	CONSTRAINT "cash_ledger_description_check" CHECK(length(trim("cash_ledger_entries"."description")) between 1 and 1000),
	CONSTRAINT "cash_ledger_counterparty_check" CHECK("cash_ledger_entries"."counterparty" is null or length(trim("cash_ledger_entries"."counterparty")) between 1 and 255),
	CONSTRAINT "cash_ledger_visibility_check" CHECK("cash_ledger_entries"."visibility" in ('public', 'members')),
	CONSTRAINT "cash_ledger_privacy_check" CHECK(("cash_ledger_entries"."kind" = 'expense' and "cash_ledger_entries"."visibility" = 'public') or ("cash_ledger_entries"."kind" in ('dues', 'donation') and "cash_ledger_entries"."visibility" = 'members') or "cash_ledger_entries"."kind" in ('other_income', 'fee', 'refund', 'dispute', 'transfer', 'adjustment')),
	CONSTRAINT "cash_ledger_source_type_check" CHECK(length(trim("cash_ledger_entries"."source_type")) between 1 and 100),
	CONSTRAINT "cash_ledger_source_identity_check" CHECK(("cash_ledger_entries"."source_id" is null and "cash_ledger_entries"."source_component" = 'primary') or ("cash_ledger_entries"."source_id" is not null and length(trim("cash_ledger_entries"."source_id")) between 1 and 255 and length(trim("cash_ledger_entries"."source_component")) between 1 and 100))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `cash_ledger_source_uidx` ON `cash_ledger_entries` (`source_type`,`source_id`,`source_component`) WHERE "cash_ledger_entries"."source_id" is not null;--> statement-breakpoint
CREATE INDEX `cash_ledger_occurred_idx` ON `cash_ledger_entries` (`occurred_at`,`kind`);--> statement-breakpoint
CREATE INDEX `cash_ledger_budget_line_idx` ON `cash_ledger_entries` (`budget_line_id`,`occurred_at`);--> statement-breakpoint
CREATE INDEX `cash_ledger_recurring_expense_idx` ON `cash_ledger_entries` (`recurring_expense_id`,`occurred_at`);--> statement-breakpoint
CREATE TABLE `recurring_expenses` (
	`id` text PRIMARY KEY NOT NULL,
	`payee` text NOT NULL,
	`purpose` text NOT NULL,
	`category` text NOT NULL,
	`cadence` text NOT NULL,
	`cadence_interval` integer DEFAULT 1 NOT NULL,
	`expected_amount` integer NOT NULL,
	`currency` text DEFAULT 'USD' NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`effective_from` text NOT NULL,
	`effective_to` text,
	`budget_line_id` text,
	`approving_motion_id` text,
	`approval_source_url` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`budget_line_id`) REFERENCES `budget_lines`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`approving_motion_id`) REFERENCES `motions`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "recurring_expenses_payee_check" CHECK(length(trim("recurring_expenses"."payee")) between 1 and 255),
	CONSTRAINT "recurring_expenses_purpose_check" CHECK(length(trim("recurring_expenses"."purpose")) between 1 and 1000),
	CONSTRAINT "recurring_expenses_category_check" CHECK(length(trim("recurring_expenses"."category")) between 1 and 100),
	CONSTRAINT "recurring_expenses_cadence_check" CHECK("recurring_expenses"."cadence" in ('weekly', 'monthly', 'quarterly', 'annual', 'other') and "recurring_expenses"."cadence_interval" >= 1),
	CONSTRAINT "recurring_expenses_amount_check" CHECK("recurring_expenses"."expected_amount" >= 0),
	CONSTRAINT "recurring_expenses_currency_check" CHECK(length("recurring_expenses"."currency") = 3 and "recurring_expenses"."currency" = upper("recurring_expenses"."currency")),
	CONSTRAINT "recurring_expenses_status_check" CHECK("recurring_expenses"."status" in ('active', 'ended', 'canceled')),
	CONSTRAINT "recurring_expenses_interval_check" CHECK(julianday("recurring_expenses"."effective_from") is not null and ("recurring_expenses"."effective_to" is null or julianday("recurring_expenses"."effective_to") > julianday("recurring_expenses"."effective_from"))),
	CONSTRAINT "recurring_expenses_lifecycle_check" CHECK(("recurring_expenses"."status" = 'active' and "recurring_expenses"."effective_to" is null) or ("recurring_expenses"."status" in ('ended', 'canceled') and "recurring_expenses"."effective_to" is not null)),
	CONSTRAINT "recurring_expenses_source_url_check" CHECK("recurring_expenses"."approval_source_url" is null or length(trim("recurring_expenses"."approval_source_url")) between 1 and 2000)
);
--> statement-breakpoint
CREATE INDEX `recurring_expenses_status_idx` ON `recurring_expenses` (`status`,`effective_from`);--> statement-breakpoint
CREATE TABLE `agenda_items` (
	`id` text PRIMARY KEY NOT NULL,
	`meeting_event_session_id` text NOT NULL,
	`position` integer NOT NULL,
	`title` text NOT NULL,
	`description` text,
	`kind` text DEFAULT 'other' NOT NULL,
	`source_url` text,
	`source_snapshot_id` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`meeting_event_session_id`) REFERENCES `meetings`(`event_session_id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`source_snapshot_id`) REFERENCES `external_record_snapshots`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "agenda_items_position_check" CHECK("agenda_items"."position" >= 1),
	CONSTRAINT "agenda_items_title_check" CHECK(length(trim("agenda_items"."title")) between 1 and 500),
	CONSTRAINT "agenda_items_kind_check" CHECK(length(trim("agenda_items"."kind")) between 1 and 100),
	CONSTRAINT "agenda_items_source_url_check" CHECK("agenda_items"."source_url" is null or length(trim("agenda_items"."source_url")) between 1 and 2000)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `agenda_items_meeting_position_uidx` ON `agenda_items` (`meeting_event_session_id`,`position`);--> statement-breakpoint
CREATE INDEX `agenda_items_meeting_idx` ON `agenda_items` (`meeting_event_session_id`,`id`);--> statement-breakpoint
CREATE TABLE `meetings` (
	`event_session_id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`source_url` text,
	`source_snapshot_id` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`event_session_id`) REFERENCES `event_sessions`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`source_snapshot_id`) REFERENCES `external_record_snapshots`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "meetings_kind_check" CHECK("meetings"."kind" in ('general', 'steering')),
	CONSTRAINT "meetings_source_url_check" CHECK("meetings"."source_url" is null or length(trim("meetings"."source_url")) between 1 and 2000)
);
--> statement-breakpoint
CREATE INDEX `meetings_kind_session_idx` ON `meetings` (`kind`,`event_session_id`);--> statement-breakpoint
CREATE TABLE `motion_people` (
	`motion_id` text NOT NULL,
	`person_id` text NOT NULL,
	`role` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`motion_id`) REFERENCES `motions`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`person_id`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "motion_people_role_check" CHECK("motion_people"."role" in ('mover', 'seconder'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `motion_people_motion_person_role_uidx` ON `motion_people` (`motion_id`,`person_id`,`role`);--> statement-breakpoint
CREATE INDEX `motion_people_person_idx` ON `motion_people` (`person_id`,`motion_id`);--> statement-breakpoint
CREATE TABLE `motions` (
	`id` text PRIMARY KEY NOT NULL,
	`agenda_item_id` text NOT NULL,
	`position` integer NOT NULL,
	`text` text NOT NULL,
	`status` text DEFAULT 'proposed' NOT NULL,
	`source_url` text,
	`source_snapshot_id` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`agenda_item_id`) REFERENCES `agenda_items`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`source_snapshot_id`) REFERENCES `external_record_snapshots`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "motions_position_check" CHECK("motions"."position" >= 1),
	CONSTRAINT "motions_text_check" CHECK(length(trim("motions"."text")) between 1 and 10000),
	CONSTRAINT "motions_status_check" CHECK("motions"."status" in ('proposed', 'adopted', 'rejected', 'tabled', 'withdrawn', 'no_vote')),
	CONSTRAINT "motions_source_url_check" CHECK("motions"."source_url" is null or length(trim("motions"."source_url")) between 1 and 2000)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `motions_agenda_position_uidx` ON `motions` (`agenda_item_id`,`position`);--> statement-breakpoint
CREATE UNIQUE INDEX `motions_agenda_id_id_uidx` ON `motions` (`agenda_item_id`,`id`);--> statement-breakpoint
CREATE INDEX `motions_status_idx` ON `motions` (`status`,`agenda_item_id`);--> statement-breakpoint
CREATE TABLE `quorum_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`meeting_event_session_id` text,
	`vote_id` text,
	`scope` text NOT NULL,
	`eligible_member_count` integer NOT NULL,
	`eligible_present_count` integer NOT NULL,
	`total_present_count` integer NOT NULL,
	`required_count` integer NOT NULL,
	`met` integer NOT NULL,
	`basis` text NOT NULL,
	`captured_at` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`meeting_event_session_id`) REFERENCES `meetings`(`event_session_id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`vote_id`) REFERENCES `votes`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "quorum_snapshots_scope_check" CHECK("quorum_snapshots"."scope" in ('meeting', 'vote')),
	CONSTRAINT "quorum_snapshots_scope_target_check" CHECK(("quorum_snapshots"."scope" = 'meeting' and "quorum_snapshots"."meeting_event_session_id" is not null and "quorum_snapshots"."vote_id" is null) or ("quorum_snapshots"."scope" = 'vote' and "quorum_snapshots"."meeting_event_session_id" is null and "quorum_snapshots"."vote_id" is not null)),
	CONSTRAINT "quorum_snapshots_counts_check" CHECK("quorum_snapshots"."eligible_member_count" >= 0 and "quorum_snapshots"."eligible_present_count" >= 0 and "quorum_snapshots"."total_present_count" >= 0 and "quorum_snapshots"."required_count" >= 0 and "quorum_snapshots"."eligible_present_count" <= "quorum_snapshots"."eligible_member_count" and "quorum_snapshots"."eligible_present_count" <= "quorum_snapshots"."total_present_count"),
	CONSTRAINT "quorum_snapshots_result_check" CHECK(("quorum_snapshots"."met" = 1 and "quorum_snapshots"."eligible_present_count" >= "quorum_snapshots"."required_count") or ("quorum_snapshots"."met" = 0 and "quorum_snapshots"."eligible_present_count" < "quorum_snapshots"."required_count")),
	CONSTRAINT "quorum_snapshots_basis_check" CHECK(length(trim("quorum_snapshots"."basis")) between 1 and 1000),
	CONSTRAINT "quorum_snapshots_captured_at_check" CHECK(julianday("quorum_snapshots"."captured_at") is not null)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `quorum_snapshots_vote_uidx` ON `quorum_snapshots` (`vote_id`) WHERE "quorum_snapshots"."vote_id" is not null;--> statement-breakpoint
CREATE INDEX `quorum_snapshots_meeting_captured_idx` ON `quorum_snapshots` (`meeting_event_session_id`,`captured_at`);--> statement-breakpoint
CREATE TABLE `vote_casts` (
	`id` text PRIMARY KEY NOT NULL,
	`vote_id` text NOT NULL,
	`option_id` text NOT NULL,
	`person_id` text NOT NULL,
	`cast_at` text NOT NULL,
	`source_snapshot_id` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`vote_id`) REFERENCES `votes`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`source_snapshot_id`) REFERENCES `external_record_snapshots`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`vote_id`,`option_id`) REFERENCES `vote_options`(`vote_id`,`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`vote_id`,`person_id`) REFERENCES `vote_eligibility_snapshots`(`vote_id`,`person_id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "vote_casts_cast_at_check" CHECK(julianday("vote_casts"."cast_at") is not null)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `vote_casts_vote_person_uidx` ON `vote_casts` (`vote_id`,`person_id`);--> statement-breakpoint
CREATE INDEX `vote_casts_person_idx` ON `vote_casts` (`person_id`,`cast_at`);--> statement-breakpoint
CREATE TABLE `vote_eligibility_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`vote_id` text NOT NULL,
	`person_id` text NOT NULL,
	`membership_id` text,
	`standing_status` text NOT NULL,
	`captured_at` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`vote_id`) REFERENCES `votes`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`person_id`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`person_id`,`membership_id`) REFERENCES `memberships`(`person_id`,`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "vote_eligibility_standing_check" CHECK("vote_eligibility_snapshots"."standing_status" in ('good', 'grace')),
	CONSTRAINT "vote_eligibility_captured_at_check" CHECK(julianday("vote_eligibility_snapshots"."captured_at") is not null)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `vote_eligibility_vote_person_uidx` ON `vote_eligibility_snapshots` (`vote_id`,`person_id`);--> statement-breakpoint
CREATE INDEX `vote_eligibility_person_idx` ON `vote_eligibility_snapshots` (`person_id`,`vote_id`);--> statement-breakpoint
CREATE TABLE `vote_options` (
	`id` text PRIMARY KEY NOT NULL,
	`vote_id` text NOT NULL,
	`code` text NOT NULL,
	`label` text NOT NULL,
	`position` integer NOT NULL,
	`counts_toward_decision` integer DEFAULT true NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`vote_id`) REFERENCES `votes`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "vote_options_code_check" CHECK(length(trim("vote_options"."code")) between 1 and 100),
	CONSTRAINT "vote_options_label_check" CHECK(length(trim("vote_options"."label")) between 1 and 500),
	CONSTRAINT "vote_options_position_check" CHECK("vote_options"."position" >= 1)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `vote_options_vote_id_id_uidx` ON `vote_options` (`vote_id`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `vote_options_vote_code_uidx` ON `vote_options` (`vote_id`,`code`);--> statement-breakpoint
CREATE UNIQUE INDEX `vote_options_vote_position_uidx` ON `vote_options` (`vote_id`,`position`);--> statement-breakpoint
CREATE TABLE `votes` (
	`id` text PRIMARY KEY NOT NULL,
	`agenda_item_id` text NOT NULL,
	`motion_id` text,
	`position` integer NOT NULL,
	`round` integer DEFAULT 1 NOT NULL,
	`question` text NOT NULL,
	`decision_rule` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`outcome` text,
	`opened_at` text,
	`closed_at` text,
	`source_url` text,
	`source_snapshot_id` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`agenda_item_id`) REFERENCES `agenda_items`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`source_snapshot_id`) REFERENCES `external_record_snapshots`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`agenda_item_id`,`motion_id`) REFERENCES `motions`(`agenda_item_id`,`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "votes_position_round_check" CHECK("votes"."position" >= 1 and "votes"."round" >= 1),
	CONSTRAINT "votes_question_check" CHECK(length(trim("votes"."question")) between 1 and 10000),
	CONSTRAINT "votes_decision_rule_check" CHECK(length(trim("votes"."decision_rule")) between 1 and 500),
	CONSTRAINT "votes_status_check" CHECK("votes"."status" in ('draft', 'open', 'closed', 'canceled')),
	CONSTRAINT "votes_outcome_check" CHECK("votes"."outcome" is null or "votes"."outcome" in ('passed', 'failed', 'tied', 'recorded')),
	CONSTRAINT "votes_lifecycle_check" CHECK(("votes"."status" = 'draft' and "votes"."opened_at" is null and "votes"."closed_at" is null and "votes"."outcome" is null) or ("votes"."status" = 'open' and "votes"."opened_at" is not null and julianday("votes"."opened_at") is not null and "votes"."closed_at" is null and "votes"."outcome" is null) or ("votes"."status" = 'closed' and "votes"."opened_at" is not null and "votes"."closed_at" is not null and julianday("votes"."closed_at") >= julianday("votes"."opened_at") and "votes"."outcome" is not null) or ("votes"."status" = 'canceled' and "votes"."outcome" is null and ("votes"."opened_at" is null or julianday("votes"."opened_at") is not null) and ("votes"."closed_at" is null or ("votes"."opened_at" is not null and julianday("votes"."closed_at") >= julianday("votes"."opened_at"))))),
	CONSTRAINT "votes_source_url_check" CHECK("votes"."source_url" is null or length(trim("votes"."source_url")) between 1 and 2000)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `votes_agenda_position_uidx` ON `votes` (`agenda_item_id`,`position`);--> statement-breakpoint
CREATE UNIQUE INDEX `votes_motion_round_uidx` ON `votes` (`motion_id`,`round`) WHERE "votes"."motion_id" is not null;--> statement-breakpoint
CREATE INDEX `votes_status_idx` ON `votes` (`status`,`opened_at`);--> statement-breakpoint
CREATE TABLE `member_disclosures` (
	`id` text PRIMARY KEY NOT NULL,
	`membership_id` text NOT NULL,
	`kind` text NOT NULL,
	`disclosed` integer NOT NULL,
	`details` text,
	`effective_from` text NOT NULL,
	`effective_to` text,
	`source_snapshot_id` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`membership_id`) REFERENCES `memberships`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`source_snapshot_id`) REFERENCES `external_record_snapshots`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "member_disclosures_kind_check" CHECK("member_disclosures"."kind" in ('law_enforcement', 'supervisor', 'human_resources', 'landlord', 'nonprofit_leadership')),
	CONSTRAINT "member_disclosures_details_check" CHECK("member_disclosures"."details" is null or length(trim("member_disclosures"."details")) between 1 and 2000),
	CONSTRAINT "member_disclosures_interval_check" CHECK(julianday("member_disclosures"."effective_from") is not null and ("member_disclosures"."effective_to" is null or julianday("member_disclosures"."effective_to") > julianday("member_disclosures"."effective_from")))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `member_disclosures_one_current_kind_uidx` ON `member_disclosures` (`membership_id`,`kind`) WHERE "member_disclosures"."effective_to" is null;--> statement-breakpoint
CREATE INDEX `member_disclosures_membership_idx` ON `member_disclosures` (`membership_id`,`effective_from`);--> statement-breakpoint
CREATE TABLE `membership_attestations` (
	`id` text PRIMARY KEY NOT NULL,
	`membership_id` text NOT NULL,
	`connection_kind` text NOT NULL,
	`code_of_conduct_version` text NOT NULL,
	`attested_at` text NOT NULL,
	`superseded_at` text,
	`source_snapshot_id` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`membership_id`) REFERENCES `memberships`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`source_snapshot_id`) REFERENCES `external_record_snapshots`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "membership_attestations_connection_check" CHECK("membership_attestations"."connection_kind" in ('resides', 'works', 'studies', 'worships')),
	CONSTRAINT "membership_attestations_code_check" CHECK(length(trim("membership_attestations"."code_of_conduct_version")) between 1 and 100),
	CONSTRAINT "membership_attestations_interval_check" CHECK(julianday("membership_attestations"."attested_at") is not null and ("membership_attestations"."superseded_at" is null or julianday("membership_attestations"."superseded_at") > julianday("membership_attestations"."attested_at")))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `membership_attestations_one_current_uidx` ON `membership_attestations` (`membership_id`) WHERE "membership_attestations"."superseded_at" is null;--> statement-breakpoint
CREATE INDEX `membership_attestations_membership_idx` ON `membership_attestations` (`membership_id`,`attested_at`);--> statement-breakpoint
CREATE TABLE `membership_policies` (
	`id` text PRIMARY KEY NOT NULL,
	`effective_from` text NOT NULL,
	`effective_to` text,
	`dues_grace_days` integer NOT NULL,
	`required_general_meetings` integer NOT NULL,
	`attendance_window_months` integer NOT NULL,
	`source_url` text,
	`source_snapshot_id` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`source_snapshot_id`) REFERENCES `external_record_snapshots`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "membership_policies_values_check" CHECK("membership_policies"."dues_grace_days" between 0 and 365 and "membership_policies"."required_general_meetings" between 1 and 12 and "membership_policies"."attendance_window_months" between 1 and 60),
	CONSTRAINT "membership_policies_interval_check" CHECK(julianday("membership_policies"."effective_from") is not null and ("membership_policies"."effective_to" is null or julianday("membership_policies"."effective_to") > julianday("membership_policies"."effective_from")))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `membership_policies_one_current_uidx` ON `membership_policies` ((1)) WHERE "membership_policies"."effective_to" is null;--> statement-breakpoint
CREATE UNIQUE INDEX `membership_policies_effective_from_uidx` ON `membership_policies` (`effective_from`);--> statement-breakpoint
CREATE TABLE `membership_standing_periods` (
	`id` text PRIMARY KEY NOT NULL,
	`membership_id` text NOT NULL,
	`policy_id` text NOT NULL,
	`status` text NOT NULL,
	`dues_status` text NOT NULL,
	`attendance_status` text NOT NULL,
	`eligibility_status` text NOT NULL,
	`conduct_status` text NOT NULL,
	`grace_ends_at` text,
	`effective_from` text NOT NULL,
	`effective_to` text,
	`source_snapshot_id` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`membership_id`) REFERENCES `memberships`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`policy_id`) REFERENCES `membership_policies`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`source_snapshot_id`) REFERENCES `external_record_snapshots`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "membership_standing_status_check" CHECK("membership_standing_periods"."status" in ('pending', 'good', 'grace', 'not_good')),
	CONSTRAINT "membership_standing_factor_check" CHECK("membership_standing_periods"."dues_status" in ('met', 'unmet', 'pending', 'not_applicable') and "membership_standing_periods"."attendance_status" in ('met', 'unmet', 'pending', 'not_applicable') and "membership_standing_periods"."eligibility_status" in ('met', 'unmet', 'pending', 'not_applicable') and "membership_standing_periods"."conduct_status" in ('met', 'unmet', 'pending', 'not_applicable')),
	CONSTRAINT "membership_standing_consistency_check" CHECK(("membership_standing_periods"."status" = 'good' and "membership_standing_periods"."dues_status" in ('met', 'not_applicable') and "membership_standing_periods"."attendance_status" in ('met', 'not_applicable') and "membership_standing_periods"."eligibility_status" in ('met', 'not_applicable') and "membership_standing_periods"."conduct_status" in ('met', 'not_applicable')) or ("membership_standing_periods"."status" = 'grace' and "membership_standing_periods"."dues_status" = 'unmet' and "membership_standing_periods"."attendance_status" in ('met', 'not_applicable') and "membership_standing_periods"."eligibility_status" in ('met', 'not_applicable') and "membership_standing_periods"."conduct_status" in ('met', 'not_applicable')) or ("membership_standing_periods"."status" = 'not_good' and 'unmet' in ("membership_standing_periods"."dues_status", "membership_standing_periods"."attendance_status", "membership_standing_periods"."eligibility_status", "membership_standing_periods"."conduct_status")) or ("membership_standing_periods"."status" = 'pending' and 'pending' in ("membership_standing_periods"."dues_status", "membership_standing_periods"."attendance_status", "membership_standing_periods"."eligibility_status", "membership_standing_periods"."conduct_status"))),
	CONSTRAINT "membership_standing_grace_check" CHECK(("membership_standing_periods"."status" = 'grace' and "membership_standing_periods"."grace_ends_at" is not null and julianday("membership_standing_periods"."grace_ends_at") > julianday("membership_standing_periods"."effective_from")) or ("membership_standing_periods"."status" <> 'grace' and "membership_standing_periods"."grace_ends_at" is null)),
	CONSTRAINT "membership_standing_interval_check" CHECK(julianday("membership_standing_periods"."effective_from") is not null and ("membership_standing_periods"."effective_to" is null or julianday("membership_standing_periods"."effective_to") > julianday("membership_standing_periods"."effective_from")))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `membership_standing_one_current_uidx` ON `membership_standing_periods` (`membership_id`) WHERE "membership_standing_periods"."effective_to" is null;--> statement-breakpoint
CREATE UNIQUE INDEX `membership_standing_membership_from_uidx` ON `membership_standing_periods` (`membership_id`,`effective_from`);--> statement-breakpoint
CREATE INDEX `membership_standing_status_idx` ON `membership_standing_periods` (`status`,`effective_from`);--> statement-breakpoint
CREATE TABLE `memberships` (
	`id` text PRIMARY KEY NOT NULL,
	`person_id` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`applied_at` text NOT NULL,
	`started_at` text,
	`attendance_requirement_starts_at` text,
	`ended_at` text,
	`end_reason` text,
	`source_snapshot_id` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`person_id`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`source_snapshot_id`) REFERENCES `external_record_snapshots`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "memberships_status_check" CHECK("memberships"."status" in ('pending', 'active', 'ended')),
	CONSTRAINT "memberships_end_reason_check" CHECK("memberships"."end_reason" is null or "memberships"."end_reason" in ('resigned', 'expelled', 'deceased', 'withdrawn', 'ineligible', 'duplicate', 'other')),
	CONSTRAINT "memberships_lifecycle_check" CHECK(("memberships"."status" = 'pending' and "memberships"."started_at" is null and "memberships"."ended_at" is null and "memberships"."end_reason" is null) or ("memberships"."status" = 'active' and "memberships"."started_at" is not null and julianday("memberships"."started_at") >= julianday("memberships"."applied_at") and "memberships"."ended_at" is null and "memberships"."end_reason" is null) or ("memberships"."status" = 'ended' and "memberships"."ended_at" is not null and "memberships"."end_reason" is not null and (("memberships"."started_at" is null and "memberships"."end_reason" in ('withdrawn', 'ineligible', 'duplicate') and julianday("memberships"."ended_at") >= julianday("memberships"."applied_at")) or ("memberships"."started_at" is not null and julianday("memberships"."started_at") >= julianday("memberships"."applied_at") and julianday("memberships"."ended_at") >= julianday("memberships"."started_at"))))),
	CONSTRAINT "memberships_dates_check" CHECK(julianday("memberships"."applied_at") is not null and ("memberships"."attendance_requirement_starts_at" is null or ("memberships"."started_at" is not null and julianday("memberships"."attendance_requirement_starts_at") >= julianday("memberships"."started_at"))))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `memberships_one_open_person_uidx` ON `memberships` (`person_id`) WHERE "memberships"."ended_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX `memberships_person_id_id_uidx` ON `memberships` (`person_id`,`id`);--> statement-breakpoint
CREATE INDEX `memberships_status_idx` ON `memberships` (`status`,`started_at`);--> statement-breakpoint
CREATE TABLE `membership_dues_prices` (
	`price_id` text PRIMARY KEY NOT NULL,
	`membership_class` text DEFAULT 'standard' NOT NULL,
	`effective_from` text,
	`effective_to` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`price_id`) REFERENCES `stripe_prices`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "membership_dues_prices_class_check" CHECK("membership_dues_prices"."membership_class" = 'standard'),
	CONSTRAINT "membership_dues_prices_interval_check" CHECK(("membership_dues_prices"."effective_from" is null or julianday("membership_dues_prices"."effective_from") is not null) and ("membership_dues_prices"."effective_to" is null or ("membership_dues_prices"."effective_from" is not null and julianday("membership_dues_prices"."effective_to") > julianday("membership_dues_prices"."effective_from"))))
);
--> statement-breakpoint
CREATE TABLE `membership_dues_subscriptions` (
	`id` text PRIMARY KEY NOT NULL,
	`membership_id` text NOT NULL,
	`subscription_id` text NOT NULL,
	`effective_from` text NOT NULL,
	`effective_to` text,
	`source_snapshot_id` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`membership_id`) REFERENCES `memberships`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`subscription_id`) REFERENCES `stripe_subscriptions`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`source_snapshot_id`) REFERENCES `external_record_snapshots`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "membership_dues_subscriptions_interval_check" CHECK(julianday("membership_dues_subscriptions"."effective_from") is not null and ("membership_dues_subscriptions"."effective_to" is null or julianday("membership_dues_subscriptions"."effective_to") > julianday("membership_dues_subscriptions"."effective_from")))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `membership_dues_subscriptions_subscription_from_uidx` ON `membership_dues_subscriptions` (`subscription_id`,`effective_from`);--> statement-breakpoint
CREATE UNIQUE INDEX `membership_dues_subscriptions_one_current_uidx` ON `membership_dues_subscriptions` (`subscription_id`) WHERE "membership_dues_subscriptions"."effective_to" is null;--> statement-breakpoint
CREATE INDEX `membership_dues_subscriptions_membership_idx` ON `membership_dues_subscriptions` (`membership_id`,`effective_from`);--> statement-breakpoint
CREATE TABLE `stripe_balance_transactions` (
	`id` text PRIMARY KEY NOT NULL,
	`payout_id` text,
	`source_type` text NOT NULL,
	`source_id` text NOT NULL,
	`reporting_category` text NOT NULL,
	`amount` integer NOT NULL,
	`fee` integer NOT NULL,
	`net` integer NOT NULL,
	`currency` text NOT NULL,
	`available_at` text,
	`provider_created_at` text,
	`source_snapshot_id` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`payout_id`) REFERENCES `stripe_payouts`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`source_snapshot_id`) REFERENCES `external_record_snapshots`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "stripe_balance_transactions_id_check" CHECK("stripe_balance_transactions"."id" glob 'txn_*'),
	CONSTRAINT "stripe_balance_transactions_net_check" CHECK("stripe_balance_transactions"."net" = "stripe_balance_transactions"."amount" - "stripe_balance_transactions"."fee"),
	CONSTRAINT "stripe_balance_transactions_currency_check" CHECK(length("stripe_balance_transactions"."currency") = 3 and "stripe_balance_transactions"."currency" = upper("stripe_balance_transactions"."currency")),
	CONSTRAINT "stripe_balance_transactions_dates_check" CHECK(("stripe_balance_transactions"."available_at" is null or julianday("stripe_balance_transactions"."available_at") is not null) and ("stripe_balance_transactions"."provider_created_at" is null or julianday("stripe_balance_transactions"."provider_created_at") is not null))
);
--> statement-breakpoint
CREATE INDEX `stripe_balance_transactions_payout_idx` ON `stripe_balance_transactions` (`payout_id`,`available_at`);--> statement-breakpoint
CREATE INDEX `stripe_balance_transactions_source_idx` ON `stripe_balance_transactions` (`source_type`,`source_id`);--> statement-breakpoint
CREATE TABLE `stripe_charges` (
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
	CONSTRAINT "stripe_charges_id_check" CHECK("stripe_charges"."id" glob 'ch_*'),
	CONSTRAINT "stripe_charges_status_check" CHECK("stripe_charges"."status" in ('pending', 'succeeded', 'failed')),
	CONSTRAINT "stripe_charges_revenue_check" CHECK("stripe_charges"."revenue_category" in ('dues', 'donation', 'other', 'unclassified')),
	CONSTRAINT "stripe_charges_amount_check" CHECK("stripe_charges"."amount" >= 0 and "stripe_charges"."amount_captured" >= 0 and "stripe_charges"."amount_captured" <= "stripe_charges"."amount" and "stripe_charges"."amount_refunded" >= 0 and "stripe_charges"."amount_refunded" <= "stripe_charges"."amount_captured"),
	CONSTRAINT "stripe_charges_currency_check" CHECK(length("stripe_charges"."currency") = 3 and "stripe_charges"."currency" = upper("stripe_charges"."currency")),
	CONSTRAINT "stripe_charges_provider_created_check" CHECK("stripe_charges"."provider_created_at" is null or julianday("stripe_charges"."provider_created_at") is not null)
);
--> statement-breakpoint
CREATE INDEX `stripe_charges_customer_created_idx` ON `stripe_charges` (`customer_id`,`provider_created_at`);--> statement-breakpoint
CREATE INDEX `stripe_charges_invoice_idx` ON `stripe_charges` (`invoice_id`);--> statement-breakpoint
CREATE INDEX `stripe_charges_revenue_idx` ON `stripe_charges` (`revenue_category`,`status`,`provider_created_at`);--> statement-breakpoint
CREATE TABLE `stripe_customers` (
	`id` text PRIMARY KEY NOT NULL,
	`person_id` text,
	`email` text,
	`phone` text,
	`default_currency` text,
	`provider_created_at` text,
	`source_snapshot_id` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`person_id`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`source_snapshot_id`) REFERENCES `external_record_snapshots`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "stripe_customers_id_check" CHECK("stripe_customers"."id" glob 'cus_*'),
	CONSTRAINT "stripe_customers_currency_check" CHECK("stripe_customers"."default_currency" is null or length("stripe_customers"."default_currency") = 3 and "stripe_customers"."default_currency" = upper("stripe_customers"."default_currency")),
	CONSTRAINT "stripe_customers_provider_created_check" CHECK("stripe_customers"."provider_created_at" is null or julianday("stripe_customers"."provider_created_at") is not null)
);
--> statement-breakpoint
CREATE INDEX `stripe_customers_person_idx` ON `stripe_customers` (`person_id`);--> statement-breakpoint
CREATE TABLE `stripe_discount_applications` (
	`id` text PRIMARY KEY NOT NULL,
	`customer_id` text NOT NULL,
	`subscription_id` text,
	`invoice_id` text,
	`coupon_id` text NOT NULL,
	`promotion_code_id` text,
	`amount_off` integer,
	`percent_off_basis_points` integer,
	`currency` text,
	`duration` text NOT NULL,
	`starts_at` text NOT NULL,
	`ends_at` text,
	`source_snapshot_id` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`customer_id`) REFERENCES `stripe_customers`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`subscription_id`) REFERENCES `stripe_subscriptions`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`invoice_id`) REFERENCES `stripe_invoices`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`source_snapshot_id`) REFERENCES `external_record_snapshots`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "stripe_discount_applications_target_check" CHECK("stripe_discount_applications"."subscription_id" is not null or "stripe_discount_applications"."invoice_id" is not null),
	CONSTRAINT "stripe_discount_applications_value_check" CHECK(("stripe_discount_applications"."amount_off" is not null and "stripe_discount_applications"."amount_off" >= 0 and "stripe_discount_applications"."percent_off_basis_points" is null and "stripe_discount_applications"."currency" is not null and length("stripe_discount_applications"."currency") = 3 and "stripe_discount_applications"."currency" = upper("stripe_discount_applications"."currency")) or ("stripe_discount_applications"."amount_off" is null and "stripe_discount_applications"."percent_off_basis_points" between 1 and 10000 and "stripe_discount_applications"."currency" is null)),
	CONSTRAINT "stripe_discount_applications_duration_check" CHECK("stripe_discount_applications"."duration" in ('once', 'repeating', 'forever')),
	CONSTRAINT "stripe_discount_applications_interval_check" CHECK(julianday("stripe_discount_applications"."starts_at") is not null and ("stripe_discount_applications"."ends_at" is null or julianday("stripe_discount_applications"."ends_at") > julianday("stripe_discount_applications"."starts_at")))
);
--> statement-breakpoint
CREATE INDEX `stripe_discount_applications_subscription_idx` ON `stripe_discount_applications` (`subscription_id`,`starts_at`);--> statement-breakpoint
CREATE INDEX `stripe_discount_applications_invoice_idx` ON `stripe_discount_applications` (`invoice_id`);--> statement-breakpoint
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
);
--> statement-breakpoint
CREATE INDEX `stripe_disputes_charge_idx` ON `stripe_disputes` (`charge_id`,`status`);--> statement-breakpoint
CREATE TABLE `stripe_invoice_lines` (
	`id` text PRIMARY KEY NOT NULL,
	`invoice_id` text NOT NULL,
	`subscription_item_id` text,
	`price_id` text,
	`product_id` text,
	`description` text,
	`amount` integer NOT NULL,
	`currency` text NOT NULL,
	`period_start` text,
	`period_end` text,
	`source_snapshot_id` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`invoice_id`) REFERENCES `stripe_invoices`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`subscription_item_id`) REFERENCES `stripe_subscription_items`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`price_id`) REFERENCES `stripe_prices`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`product_id`) REFERENCES `stripe_products`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`source_snapshot_id`) REFERENCES `external_record_snapshots`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "stripe_invoice_lines_id_check" CHECK(length(trim("stripe_invoice_lines"."id")) between 1 and 255),
	CONSTRAINT "stripe_invoice_lines_currency_check" CHECK(length("stripe_invoice_lines"."currency") = 3 and "stripe_invoice_lines"."currency" = upper("stripe_invoice_lines"."currency")),
	CONSTRAINT "stripe_invoice_lines_period_check" CHECK(("stripe_invoice_lines"."period_start" is null and "stripe_invoice_lines"."period_end" is null) or ("stripe_invoice_lines"."period_start" is not null and "stripe_invoice_lines"."period_end" is not null and julianday("stripe_invoice_lines"."period_end") >= julianday("stripe_invoice_lines"."period_start")))
);
--> statement-breakpoint
CREATE INDEX `stripe_invoice_lines_invoice_idx` ON `stripe_invoice_lines` (`invoice_id`,`price_id`);--> statement-breakpoint
CREATE TABLE `stripe_invoices` (
	`id` text PRIMARY KEY NOT NULL,
	`customer_id` text NOT NULL,
	`subscription_id` text,
	`status` text NOT NULL,
	`currency` text NOT NULL,
	`subtotal` integer NOT NULL,
	`total` integer NOT NULL,
	`amount_due` integer NOT NULL,
	`amount_paid` integer NOT NULL,
	`amount_remaining` integer NOT NULL,
	`period_start` text,
	`period_end` text,
	`paid_at` text,
	`payment_intent_id` text,
	`provider_created_at` text,
	`source_snapshot_id` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`customer_id`) REFERENCES `stripe_customers`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`subscription_id`) REFERENCES `stripe_subscriptions`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`source_snapshot_id`) REFERENCES `external_record_snapshots`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "stripe_invoices_id_check" CHECK("stripe_invoices"."id" glob 'in_*'),
	CONSTRAINT "stripe_invoices_status_check" CHECK("stripe_invoices"."status" in ('draft', 'open', 'paid', 'void', 'uncollectible')),
	CONSTRAINT "stripe_invoices_currency_check" CHECK(length("stripe_invoices"."currency") = 3 and "stripe_invoices"."currency" = upper("stripe_invoices"."currency")),
	CONSTRAINT "stripe_invoices_amount_check" CHECK("stripe_invoices"."amount_due" >= 0 and "stripe_invoices"."amount_paid" >= 0 and "stripe_invoices"."amount_remaining" >= 0),
	CONSTRAINT "stripe_invoices_period_check" CHECK(("stripe_invoices"."period_start" is null and "stripe_invoices"."period_end" is null) or ("stripe_invoices"."period_start" is not null and "stripe_invoices"."period_end" is not null and julianday("stripe_invoices"."period_end") >= julianday("stripe_invoices"."period_start"))),
	CONSTRAINT "stripe_invoices_dates_check" CHECK(("stripe_invoices"."paid_at" is null or julianday("stripe_invoices"."paid_at") is not null) and ("stripe_invoices"."provider_created_at" is null or julianday("stripe_invoices"."provider_created_at") is not null))
);
--> statement-breakpoint
CREATE INDEX `stripe_invoices_customer_status_idx` ON `stripe_invoices` (`customer_id`,`status`,`provider_created_at`);--> statement-breakpoint
CREATE INDEX `stripe_invoices_subscription_idx` ON `stripe_invoices` (`subscription_id`,`period_start`);--> statement-breakpoint
CREATE TABLE `stripe_payouts` (
	`id` text PRIMARY KEY NOT NULL,
	`status` text NOT NULL,
	`amount` integer NOT NULL,
	`currency` text NOT NULL,
	`arrival_at` text,
	`provider_created_at` text,
	`source_snapshot_id` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`source_snapshot_id`) REFERENCES `external_record_snapshots`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "stripe_payouts_id_check" CHECK("stripe_payouts"."id" glob 'po_*'),
	CONSTRAINT "stripe_payouts_amount_check" CHECK("stripe_payouts"."amount" >= 0),
	CONSTRAINT "stripe_payouts_currency_check" CHECK(length("stripe_payouts"."currency") = 3 and "stripe_payouts"."currency" = upper("stripe_payouts"."currency")),
	CONSTRAINT "stripe_payouts_dates_check" CHECK(("stripe_payouts"."arrival_at" is null or julianday("stripe_payouts"."arrival_at") is not null) and ("stripe_payouts"."provider_created_at" is null or julianday("stripe_payouts"."provider_created_at") is not null))
);
--> statement-breakpoint
CREATE INDEX `stripe_payouts_status_arrival_idx` ON `stripe_payouts` (`status`,`arrival_at`);--> statement-breakpoint
CREATE TABLE `stripe_prices` (
	`id` text PRIMARY KEY NOT NULL,
	`product_id` text NOT NULL,
	`lookup_key` text,
	`active` integer NOT NULL,
	`currency` text NOT NULL,
	`unit_amount` integer,
	`recurring_interval` text,
	`recurring_interval_count` integer,
	`source_snapshot_id` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`product_id`) REFERENCES `stripe_products`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`source_snapshot_id`) REFERENCES `external_record_snapshots`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "stripe_prices_id_check" CHECK(length(trim("stripe_prices"."id")) between 1 and 255),
	CONSTRAINT "stripe_prices_currency_check" CHECK(length("stripe_prices"."currency") = 3 and "stripe_prices"."currency" = upper("stripe_prices"."currency")),
	CONSTRAINT "stripe_prices_amount_check" CHECK("stripe_prices"."unit_amount" is null or "stripe_prices"."unit_amount" >= 0),
	CONSTRAINT "stripe_prices_recurring_check" CHECK(("stripe_prices"."recurring_interval" is null and "stripe_prices"."recurring_interval_count" is null) or ("stripe_prices"."recurring_interval" in ('day', 'week', 'month', 'year') and "stripe_prices"."recurring_interval_count" >= 1))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `stripe_prices_lookup_key_uidx` ON `stripe_prices` (`lookup_key`) WHERE "stripe_prices"."lookup_key" is not null;--> statement-breakpoint
CREATE INDEX `stripe_prices_product_idx` ON `stripe_prices` (`product_id`,`active`);--> statement-breakpoint
CREATE TABLE `stripe_products` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`active` integer NOT NULL,
	`source_snapshot_id` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`source_snapshot_id`) REFERENCES `external_record_snapshots`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "stripe_products_id_check" CHECK("stripe_products"."id" glob 'prod_*'),
	CONSTRAINT "stripe_products_name_check" CHECK(length(trim("stripe_products"."name")) between 1 and 255)
);
--> statement-breakpoint
CREATE INDEX `stripe_products_active_idx` ON `stripe_products` (`active`,`name`);--> statement-breakpoint
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
);
--> statement-breakpoint
CREATE INDEX `stripe_refunds_charge_idx` ON `stripe_refunds` (`charge_id`,`status`);--> statement-breakpoint
CREATE TABLE `stripe_subscription_items` (
	`id` text PRIMARY KEY NOT NULL,
	`subscription_id` text NOT NULL,
	`price_id` text NOT NULL,
	`quantity` integer DEFAULT 1 NOT NULL,
	`source_snapshot_id` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`subscription_id`) REFERENCES `stripe_subscriptions`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`price_id`) REFERENCES `stripe_prices`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`source_snapshot_id`) REFERENCES `external_record_snapshots`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "stripe_subscription_items_id_check" CHECK("stripe_subscription_items"."id" glob 'si_*'),
	CONSTRAINT "stripe_subscription_items_quantity_check" CHECK("stripe_subscription_items"."quantity" >= 1)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `stripe_subscription_items_subscription_price_uidx` ON `stripe_subscription_items` (`subscription_id`,`price_id`);--> statement-breakpoint
CREATE INDEX `stripe_subscription_items_price_idx` ON `stripe_subscription_items` (`price_id`,`subscription_id`);--> statement-breakpoint
CREATE TABLE `stripe_subscriptions` (
	`id` text PRIMARY KEY NOT NULL,
	`customer_id` text NOT NULL,
	`status` text NOT NULL,
	`current_period_start` text,
	`current_period_end` text,
	`cancel_at_period_end` integer DEFAULT false NOT NULL,
	`cancel_at` text,
	`canceled_at` text,
	`ended_at` text,
	`provider_created_at` text,
	`source_snapshot_id` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`customer_id`) REFERENCES `stripe_customers`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`source_snapshot_id`) REFERENCES `external_record_snapshots`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "stripe_subscriptions_id_check" CHECK("stripe_subscriptions"."id" glob 'sub_*'),
	CONSTRAINT "stripe_subscriptions_status_check" CHECK("stripe_subscriptions"."status" in ('incomplete', 'incomplete_expired', 'trialing', 'active', 'past_due', 'canceled', 'unpaid', 'paused')),
	CONSTRAINT "stripe_subscriptions_period_check" CHECK(("stripe_subscriptions"."current_period_start" is null and "stripe_subscriptions"."current_period_end" is null) or ("stripe_subscriptions"."current_period_start" is not null and "stripe_subscriptions"."current_period_end" is not null and julianday("stripe_subscriptions"."current_period_end") > julianday("stripe_subscriptions"."current_period_start"))),
	CONSTRAINT "stripe_subscriptions_dates_check" CHECK(("stripe_subscriptions"."cancel_at" is null or julianday("stripe_subscriptions"."cancel_at") is not null) and ("stripe_subscriptions"."canceled_at" is null or julianday("stripe_subscriptions"."canceled_at") is not null) and ("stripe_subscriptions"."ended_at" is null or julianday("stripe_subscriptions"."ended_at") is not null) and ("stripe_subscriptions"."provider_created_at" is null or julianday("stripe_subscriptions"."provider_created_at") is not null))
);
--> statement-breakpoint
CREATE INDEX `stripe_subscriptions_customer_status_idx` ON `stripe_subscriptions` (`customer_id`,`status`);--> statement-breakpoint
CREATE TABLE `people` (
	`id` text PRIMARY KEY NOT NULL,
	`first_name` text,
	`last_name` text,
	`display_name` text,
	`preferred_contact_method` text,
	`whatsapp_enabled` integer DEFAULT false NOT NULL,
	`archived_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	CONSTRAINT "people_first_name_check" CHECK("people"."first_name" is null or ("people"."first_name" = trim("people"."first_name") and length("people"."first_name") between 1 and 100)),
	CONSTRAINT "people_last_name_check" CHECK("people"."last_name" is null or ("people"."last_name" = trim("people"."last_name") and length("people"."last_name") between 1 and 100)),
	CONSTRAINT "people_display_name_check" CHECK("people"."display_name" is null or ("people"."display_name" = trim("people"."display_name") and length("people"."display_name") between 1 and 100)),
	CONSTRAINT "people_preferred_contact_check" CHECK("people"."preferred_contact_method" is null or "people"."preferred_contact_method" in ('email', 'text')),
	CONSTRAINT "people_archived_at_check" CHECK("people"."archived_at" is null or julianday("people"."archived_at") is not null)
);
--> statement-breakpoint
CREATE INDEX `people_name_idx` ON `people` (`last_name`,`first_name`);--> statement-breakpoint
CREATE TABLE `person_accounts` (
	`person_id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`linked_at` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`person_id`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "person_accounts_linked_at_check" CHECK(julianday("person_accounts"."linked_at") is not null)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `person_accounts_user_id_uidx` ON `person_accounts` (`user_id`);--> statement-breakpoint
CREATE TABLE `person_contacts` (
	`id` text PRIMARY KEY NOT NULL,
	`person_id` text NOT NULL,
	`kind` text NOT NULL,
	`value` text NOT NULL,
	`normalized_value` text NOT NULL,
	`is_primary` integer DEFAULT false NOT NULL,
	`verified_at` text,
	`source_snapshot_id` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`person_id`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`source_snapshot_id`) REFERENCES `external_record_snapshots`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "person_contacts_kind_check" CHECK("person_contacts"."kind" in ('email', 'phone')),
	CONSTRAINT "person_contacts_value_check" CHECK(length(trim("person_contacts"."value")) between 1 and 320 and length(trim("person_contacts"."normalized_value")) between 1 and 320),
	CONSTRAINT "person_contacts_verified_at_check" CHECK("person_contacts"."verified_at" is null or julianday("person_contacts"."verified_at") is not null)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `person_contacts_person_kind_value_uidx` ON `person_contacts` (`person_id`,`kind`,`normalized_value`);--> statement-breakpoint
CREATE UNIQUE INDEX `person_contacts_one_primary_uidx` ON `person_contacts` (`person_id`,`kind`) WHERE "person_contacts"."is_primary" = 1;--> statement-breakpoint
CREATE INDEX `person_contacts_normalized_idx` ON `person_contacts` (`kind`,`normalized_value`);--> statement-breakpoint
CREATE TABLE `provider_identities` (
	`id` text PRIMARY KEY NOT NULL,
	`person_id` text,
	`provider` text NOT NULL,
	`external_id` text NOT NULL,
	`lookup_key` text,
	`state` text DEFAULT 'unlinked' NOT NULL,
	`linked_at` text,
	`last_synced_at` text,
	`source_snapshot_id` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`person_id`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`source_snapshot_id`) REFERENCES `external_record_snapshots`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "provider_identities_provider_check" CHECK("provider_identities"."provider" in ('stripe', 'solidarity', 'discourse', 'pocketbase')),
	CONSTRAINT "provider_identities_state_check" CHECK("provider_identities"."state" in ('unlinked', 'active', 'inactive')),
	CONSTRAINT "provider_identities_link_check" CHECK(("provider_identities"."state" = 'unlinked' and "provider_identities"."person_id" is null and "provider_identities"."linked_at" is null) or ("provider_identities"."state" in ('active', 'inactive') and "provider_identities"."person_id" is not null and "provider_identities"."linked_at" is not null and julianday("provider_identities"."linked_at") is not null)),
	CONSTRAINT "provider_identities_external_check" CHECK(length(trim("provider_identities"."external_id")) between 1 and 255 and ("provider_identities"."lookup_key" is null or length(trim("provider_identities"."lookup_key")) between 1 and 255)),
	CONSTRAINT "provider_identities_synced_at_check" CHECK("provider_identities"."last_synced_at" is null or julianday("provider_identities"."last_synced_at") is not null)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `provider_identities_provider_external_uidx` ON `provider_identities` (`provider`,`external_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `provider_identities_provider_lookup_uidx` ON `provider_identities` (`provider`,`lookup_key`) WHERE "provider_identities"."lookup_key" is not null;--> statement-breakpoint
CREATE INDEX `provider_identities_person_idx` ON `provider_identities` (`person_id`,`provider`);--> statement-breakpoint
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
	CONSTRAINT "external_record_snapshots_identity_check" CHECK(length(trim("external_record_snapshots"."object_type")) between 1 and 100 and length(trim("external_record_snapshots"."external_id")) between 1 and 255),
	CONSTRAINT "external_record_snapshots_hash_check" CHECK(length(trim("external_record_snapshots"."payload_hash")) between 16 and 128),
	CONSTRAINT "external_record_snapshots_payload_check" CHECK(json_valid("external_record_snapshots"."raw_payload")),
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
	CONSTRAINT "import_batches_provider_check" CHECK("import_batches"."provider" in ('stripe', 'solidarity', 'discourse', 'pocketbase')),
	CONSTRAINT "import_batches_status_check" CHECK("import_batches"."status" in ('pending', 'completed', 'failed')),
	CONSTRAINT "import_batches_started_at_check" CHECK(julianday("import_batches"."started_at") is not null),
	CONSTRAINT "import_batches_completion_check" CHECK(("import_batches"."status" = 'pending' and "import_batches"."completed_at" is null) or ("import_batches"."status" in ('completed', 'failed') and "import_batches"."completed_at" is not null and julianday("import_batches"."completed_at") >= julianday("import_batches"."started_at"))),
	CONSTRAINT "import_batches_record_count_check" CHECK("import_batches"."record_count" is null or "import_batches"."record_count" >= 0),
	CONSTRAINT "import_batches_checksum_check" CHECK("import_batches"."source_checksum" is null or length(trim("import_batches"."source_checksum")) between 16 and 128)
);
--> statement-breakpoint
CREATE INDEX `import_batches_provider_started_idx` ON `import_batches` (`provider`,`started_at`);
--> statement-breakpoint
INSERT INTO `membership_policies` (`id`, `effective_from`, `dues_grace_days`, `required_general_meetings`, `attendance_window_months`) VALUES ('wcu-policy-2026-04-02', '2026-04-02T00:00:00.000Z', 60, 1, 12);
--> statement-breakpoint
INSERT INTO `stripe_products` (`id`, `name`, `active`) VALUES ('prod_PhJCFImeXD5okX', 'Membership Dues', 1), ('prod_PhIiDVN6omCZf0', 'Solidarity Dues', 1);
--> statement-breakpoint
INSERT INTO `stripe_prices` (`id`, `product_id`, `active`, `currency`, `unit_amount`, `recurring_interval`, `recurring_interval_count`) VALUES ('membership-10-1month', 'prod_PhJCFImeXD5okX', 1, 'USD', 1000, 'month', 1), ('solidarity-27-1month', 'prod_PhIiDVN6omCZf0', 1, 'USD', 2700, 'month', 1);
--> statement-breakpoint
INSERT INTO `membership_dues_prices` (`price_id`, `membership_class`) VALUES ('membership-10-1month', 'standard'), ('solidarity-27-1month', 'standard');
