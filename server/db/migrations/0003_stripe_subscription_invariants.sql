UPDATE `billing_checkout_attempts`
SET
	`state` = 'reconciliation_required',
	`updated_at` = CURRENT_TIMESTAMP
WHERE `cadence` IS NULL
	AND `state` IN ('pending', 'open');
--> statement-breakpoint
UPDATE `billing_subscriptions`
SET
	`reconciliation_required` = 1,
	`reconciliation_reason` = CASE
		WHEN `reconciliation_reason` IS NULL THEN 'legacy_family_cadence_unknown'
		ELSE `reconciliation_reason`
	END,
	`revision` = `revision` + 1,
	`updated_at` = CURRENT_TIMESTAMP
WHERE `plan_key` = 'family'
	AND `cadence` IS NULL
	AND `status` NOT IN ('none', 'canceled', 'incomplete_expired');
--> statement-breakpoint
DROP TRIGGER `member_family_capacity_before_insert`;
--> statement-breakpoint
CREATE TRIGGER `member_family_capacity_before_insert`
BEFORE INSERT ON `member`
FOR EACH ROW
WHEN NEW.`role` = 'member'
	AND (
		(
			SELECT COUNT(*)
			FROM `member`
			WHERE `organization_id` = NEW.`organization_id`
		)
		+
		(
			SELECT COUNT(*)
			FROM `invitation` AS `reserved_invitation`
			WHERE `reserved_invitation`.`organization_id` = NEW.`organization_id`
				AND `reserved_invitation`.`status` = 'pending'
				AND `reserved_invitation`.`expires_at` > cast(unixepoch('subsecond') * 1000 as integer)
				AND `reserved_invitation`.`id` IS NOT (
					SELECT `matching_invitation`.`id`
					FROM `invitation` AS `matching_invitation`
					JOIN `user` AS `joining_user`
						ON lower(trim(`matching_invitation`.`email`)) = lower(trim(`joining_user`.`email`))
					WHERE `matching_invitation`.`organization_id` = NEW.`organization_id`
						AND `matching_invitation`.`status` = 'pending'
						AND `matching_invitation`.`expires_at` > cast(unixepoch('subsecond') * 1000 as integer)
						AND `joining_user`.`id` = NEW.`user_id`
					ORDER BY `matching_invitation`.`created_at`, `matching_invitation`.`id`
					LIMIT 1
				)
		)
	) >= 6
BEGIN
	SELECT RAISE(ABORT, 'family plan accepts at most six members');
END;
--> statement-breakpoint
CREATE TRIGGER `member_family_capacity_before_update`
BEFORE UPDATE OF `organization_id`, `user_id`, `role` ON `member`
FOR EACH ROW
WHEN NEW.`role` = 'member'
	AND (
		(
			SELECT COUNT(*)
			FROM `member`
			WHERE `organization_id` = NEW.`organization_id`
				AND `id` <> OLD.`id`
		)
		+
		(
			SELECT COUNT(*)
			FROM `invitation` AS `reserved_invitation`
			WHERE `reserved_invitation`.`organization_id` = NEW.`organization_id`
				AND `reserved_invitation`.`status` = 'pending'
				AND `reserved_invitation`.`expires_at` > cast(unixepoch('subsecond') * 1000 as integer)
				AND `reserved_invitation`.`id` IS NOT (
					SELECT `matching_invitation`.`id`
					FROM `invitation` AS `matching_invitation`
					JOIN `user` AS `joining_user`
						ON lower(trim(`matching_invitation`.`email`)) = lower(trim(`joining_user`.`email`))
					WHERE `matching_invitation`.`organization_id` = NEW.`organization_id`
						AND `matching_invitation`.`status` = 'pending'
						AND `matching_invitation`.`expires_at` > cast(unixepoch('subsecond') * 1000 as integer)
						AND `joining_user`.`id` = NEW.`user_id`
					ORDER BY `matching_invitation`.`created_at`, `matching_invitation`.`id`
					LIMIT 1
				)
		)
	) >= 6
BEGIN
	SELECT RAISE(ABORT, 'family plan accepts at most six members');
END;
--> statement-breakpoint
CREATE TRIGGER `invitation_family_capacity_before_insert`
BEFORE INSERT ON `invitation`
FOR EACH ROW
WHEN NEW.`status` = 'pending'
	AND NEW.`expires_at` > cast(unixepoch('subsecond') * 1000 as integer)
	AND (
		(
			SELECT COUNT(*)
			FROM `member`
			WHERE `organization_id` = NEW.`organization_id`
		)
		+
		(
			SELECT COUNT(*)
			FROM `invitation`
			WHERE `organization_id` = NEW.`organization_id`
				AND `status` = 'pending'
				AND `expires_at` > cast(unixepoch('subsecond') * 1000 as integer)
		)
	) >= 6
BEGIN
	SELECT RAISE(ABORT, 'family plan accepts at most six members');
END;
--> statement-breakpoint
CREATE TRIGGER `invitation_family_capacity_before_update`
BEFORE UPDATE OF `organization_id`, `status`, `expires_at` ON `invitation`
FOR EACH ROW
WHEN NEW.`status` = 'pending'
	AND NEW.`expires_at` > cast(unixepoch('subsecond') * 1000 as integer)
	AND (
		(
			SELECT COUNT(*)
			FROM `member`
			WHERE `organization_id` = NEW.`organization_id`
		)
		+
		(
			SELECT COUNT(*)
			FROM `invitation`
			WHERE `organization_id` = NEW.`organization_id`
				AND `status` = 'pending'
				AND `expires_at` > cast(unixepoch('subsecond') * 1000 as integer)
				AND `id` <> OLD.`id`
		)
	) >= 6
BEGIN
	SELECT RAISE(ABORT, 'family plan accepts at most six members');
END;
--> statement-breakpoint
CREATE TRIGGER `billing_checkout_cadence_before_insert`
BEFORE INSERT ON `billing_checkout_attempts`
FOR EACH ROW
WHEN NEW.`state` IN ('pending', 'open')
	AND NEW.`cadence` IS NULL
BEGIN
	SELECT RAISE(ABORT, 'open billing checkout requires a recognized cadence');
END;
--> statement-breakpoint
CREATE TRIGGER `billing_checkout_cadence_before_update`
BEFORE UPDATE OF `plan_key`, `cadence`, `state` ON `billing_checkout_attempts`
FOR EACH ROW
WHEN NEW.`state` IN ('pending', 'open')
	AND NEW.`cadence` IS NULL
BEGIN
	SELECT RAISE(ABORT, 'open billing checkout requires a recognized cadence');
END;
--> statement-breakpoint
CREATE TRIGGER `billing_subscription_offering_before_insert`
BEFORE INSERT ON `billing_subscriptions`
FOR EACH ROW
WHEN NEW.`reconciliation_required` = 0
	AND (
		NEW.`status` = 'ambiguous'
		OR (
			NEW.`status` NOT IN ('none', 'canceled', 'incomplete_expired')
			AND (NEW.`plan_key` IS NULL OR NEW.`cadence` IS NULL)
		)
	)
BEGIN
	SELECT RAISE(ABORT, 'live billing requires a recognized offering or reconciliation');
END;
--> statement-breakpoint
CREATE TRIGGER `billing_subscription_offering_before_update`
BEFORE UPDATE OF `plan_key`, `cadence`, `status`, `reconciliation_required`, `reconciliation_reason`
ON `billing_subscriptions`
FOR EACH ROW
WHEN NEW.`reconciliation_required` = 0
	AND (
		NEW.`status` = 'ambiguous'
		OR (
			NEW.`status` NOT IN ('none', 'canceled', 'incomplete_expired')
			AND (NEW.`plan_key` IS NULL OR NEW.`cadence` IS NULL)
		)
	)
BEGIN
	SELECT RAISE(ABORT, 'live billing requires a recognized offering or reconciliation');
END;
--> statement-breakpoint
CREATE TRIGGER `billing_transition_correlation_before_insert`
BEFORE INSERT ON `billing_subscription_transitions`
FOR EACH ROW
WHEN NOT EXISTS (
	SELECT 1
	FROM `billing_subscriptions`
	WHERE `id` = NEW.`billing_subscription_id`
		AND `organization_id` = NEW.`organization_id`
		AND `revision` = NEW.`captured_billing_revision`
		AND `plan_key` = NEW.`source_plan_key`
		AND `cadence` = NEW.`source_cadence`
)
BEGIN
	SELECT RAISE(ABORT, 'billing transition must match the captured subscription revision');
END;
--> statement-breakpoint
CREATE TRIGGER `family_join_correlation_before_insert`
BEFORE INSERT ON `family_join_attempts`
FOR EACH ROW
WHEN NEW.`target_organization_id` IS NULL
	OR NEW.`invitation_id` IS NULL
	OR NOT EXISTS (
		SELECT 1
		FROM `organization`
		WHERE `id` = NEW.`personal_organization_id`
			AND `personal_owner_user_id` = NEW.`recipient_user_id`
	)
	OR NOT EXISTS (
		SELECT 1
		FROM `billing_subscriptions`
		WHERE `id` = NEW.`personal_billing_subscription_id`
			AND `organization_id` = NEW.`personal_organization_id`
			AND `revision` = NEW.`captured_personal_billing_revision`
			AND `plan_key` = 'personal'
			AND `cadence` IS NOT NULL
	)
	OR NOT EXISTS (
		SELECT 1
		FROM `invitation`
		JOIN `user`
			ON lower(trim(`invitation`.`email`)) = lower(trim(`user`.`email`))
		WHERE `invitation`.`id` = NEW.`invitation_id`
			AND `invitation`.`organization_id` = NEW.`target_organization_id`
			AND `invitation`.`status` = 'pending'
			AND `invitation`.`expires_at` > cast(unixepoch('subsecond') * 1000 as integer)
			AND `user`.`id` = NEW.`recipient_user_id`
	)
BEGIN
	SELECT RAISE(ABORT, 'Family join attempt must match current invitation and Personal billing authority');
END;
--> statement-breakpoint
CREATE TRIGGER `billing_account_deletion_correlation_before_insert`
BEFORE INSERT ON `billing_account_deletion_requests`
FOR EACH ROW
WHEN NOT EXISTS (
		SELECT 1
		FROM `organization`
		WHERE `id` = NEW.`organization_id`
			AND `personal_owner_user_id` = NEW.`user_id`
	)
	OR NOT EXISTS (
		SELECT 1
		FROM `billing_customers`
		WHERE `id` = NEW.`billing_customer_id`
			AND `organization_id` = NEW.`organization_id`
			AND `stripe_customer_id` = NEW.`expected_stripe_customer_id`
	)
	OR (
		NEW.`billing_subscription_id` IS NOT NULL
		AND NOT EXISTS (
			SELECT 1
			FROM `billing_subscriptions`
			WHERE `id` = NEW.`billing_subscription_id`
				AND `organization_id` = NEW.`organization_id`
				AND `billing_customer_id` = NEW.`billing_customer_id`
				AND `stripe_subscription_id` = NEW.`expected_stripe_subscription_id`
				AND `revision` = NEW.`captured_billing_revision`
		)
	)
BEGIN
	SELECT RAISE(ABORT, 'billing deletion request must match the captured owner and Stripe projection');
END;
--> statement-breakpoint
CREATE TRIGGER `billing_subscription_deletion_request_before_delete`
BEFORE DELETE ON `billing_subscriptions`
FOR EACH ROW
BEGIN
	UPDATE `billing_account_deletion_requests`
	SET
		`billing_subscription_id` = NULL,
		`expected_stripe_subscription_id` = NULL,
		`state` = 'reconciliation_required',
		`reason` = 'subscription_projection_removed',
		`cancellation_confirmed_at` = NULL,
		`revision` = `revision` + 1,
		`updated_at` = CURRENT_TIMESTAMP
	WHERE `billing_subscription_id` = OLD.`id`
		AND `state` <> 'cancellation_confirmed';
	UPDATE `billing_account_deletion_requests`
	SET
		`billing_subscription_id` = NULL,
		`expected_stripe_subscription_id` = NULL,
		`revision` = `revision` + 1,
		`updated_at` = CURRENT_TIMESTAMP
	WHERE `billing_subscription_id` = OLD.`id`
		AND `state` = 'cancellation_confirmed';
END;
--> statement-breakpoint
CREATE TRIGGER `member_external_family_authority_before_insert`
BEFORE INSERT ON `member`
FOR EACH ROW
WHEN NEW.`role` = 'member'
	AND (
		NOT EXISTS (
			SELECT 1
			FROM `organization`
			WHERE `id` = NEW.`organization_id`
				AND `personal_owner_user_id` IS NOT NULL
		)
		OR NOT EXISTS (
			SELECT 1
			FROM `organization`
			WHERE `personal_owner_user_id` = NEW.`user_id`
		)
		OR EXISTS (
			SELECT 1
			FROM `organization` AS `target_organization`
			JOIN `member` AS `target_owner_external_member`
				ON `target_owner_external_member`.`user_id` = `target_organization`.`personal_owner_user_id`
				AND `target_owner_external_member`.`role` = 'member'
			WHERE `target_organization`.`id` = NEW.`organization_id`
		)
		OR EXISTS (
			SELECT 1
			FROM `organization` AS `personal_organization`
			JOIN `member` AS `owned_member`
				ON `owned_member`.`organization_id` = `personal_organization`.`id`
				AND `owned_member`.`role` = 'member'
			WHERE `personal_organization`.`personal_owner_user_id` = NEW.`user_id`
		)
		OR EXISTS (
			SELECT 1
			FROM `organization` AS `personal_organization`
			JOIN `invitation` AS `owned_invitation`
				ON `owned_invitation`.`organization_id` = `personal_organization`.`id`
				AND `owned_invitation`.`status` = 'pending'
				AND `owned_invitation`.`expires_at` > cast(unixepoch('subsecond') * 1000 as integer)
			WHERE `personal_organization`.`personal_owner_user_id` = NEW.`user_id`
		)
		OR EXISTS (
			SELECT 1
			FROM `organization` AS `personal_organization`
			JOIN `billing_checkout_attempts` AS `owned_checkout`
				ON `owned_checkout`.`organization_id` = `personal_organization`.`id`
				AND `owned_checkout`.`state` IN ('pending', 'open', 'reconciliation_required')
			WHERE `personal_organization`.`personal_owner_user_id` = NEW.`user_id`
		)
		OR EXISTS (
			SELECT 1
			FROM `organization` AS `personal_organization`
			JOIN `billing_subscriptions` AS `owned_subscription`
				ON `owned_subscription`.`organization_id` = `personal_organization`.`id`
			WHERE `personal_organization`.`personal_owner_user_id` = NEW.`user_id`
				AND (
					`owned_subscription`.`cancel_at_period_end` = 1
					OR `owned_subscription`.`reconciliation_required` = 1
					OR `owned_subscription`.`status` NOT IN ('none', 'canceled', 'incomplete_expired')
				)
				AND NOT (
					`owned_subscription`.`plan_key` = 'personal'
					AND `owned_subscription`.`cadence` IS NOT NULL
					AND `owned_subscription`.`status` = 'active'
					AND `owned_subscription`.`cancel_at_period_end` = 1
					AND `owned_subscription`.`reconciliation_required` = 0
					AND `owned_subscription`.`current_period_end` IS NOT NULL
					AND EXISTS (
						SELECT 1
						FROM `family_join_attempts` AS `join_attempt`
						WHERE `join_attempt`.`recipient_user_id` = NEW.`user_id`
							AND `join_attempt`.`target_organization_id` = NEW.`organization_id`
							AND `join_attempt`.`personal_billing_subscription_id` = `owned_subscription`.`id`
							AND `join_attempt`.`personal_paid_through` = `owned_subscription`.`current_period_end`
							AND `join_attempt`.`state` IN (
								'renewal_off_confirmed',
								'membership_pending',
								'completed'
							)
					)
				)
		)
	)
BEGIN
	SELECT RAISE(ABORT, 'external family membership conflicts with personal family authority');
END;
--> statement-breakpoint
CREATE TRIGGER `member_external_family_authority_before_update`
BEFORE UPDATE OF `organization_id`, `user_id`, `role` ON `member`
FOR EACH ROW
WHEN NEW.`role` = 'member'
	AND (
		NOT EXISTS (
			SELECT 1
			FROM `organization`
			WHERE `id` = NEW.`organization_id`
				AND `personal_owner_user_id` IS NOT NULL
		)
		OR NOT EXISTS (
			SELECT 1
			FROM `organization`
			WHERE `personal_owner_user_id` = NEW.`user_id`
		)
		OR EXISTS (
			SELECT 1
			FROM `organization` AS `target_organization`
			JOIN `member` AS `target_owner_external_member`
				ON `target_owner_external_member`.`user_id` = `target_organization`.`personal_owner_user_id`
				AND `target_owner_external_member`.`role` = 'member'
			WHERE `target_organization`.`id` = NEW.`organization_id`
		)
		OR EXISTS (
			SELECT 1
			FROM `organization` AS `personal_organization`
			JOIN `member` AS `owned_member`
				ON `owned_member`.`organization_id` = `personal_organization`.`id`
				AND `owned_member`.`role` = 'member'
			WHERE `personal_organization`.`personal_owner_user_id` = NEW.`user_id`
		)
		OR EXISTS (
			SELECT 1
			FROM `organization` AS `personal_organization`
			JOIN `invitation` AS `owned_invitation`
				ON `owned_invitation`.`organization_id` = `personal_organization`.`id`
				AND `owned_invitation`.`status` = 'pending'
				AND `owned_invitation`.`expires_at` > cast(unixepoch('subsecond') * 1000 as integer)
			WHERE `personal_organization`.`personal_owner_user_id` = NEW.`user_id`
		)
		OR EXISTS (
			SELECT 1
			FROM `organization` AS `personal_organization`
			JOIN `billing_checkout_attempts` AS `owned_checkout`
				ON `owned_checkout`.`organization_id` = `personal_organization`.`id`
				AND `owned_checkout`.`state` IN ('pending', 'open', 'reconciliation_required')
			WHERE `personal_organization`.`personal_owner_user_id` = NEW.`user_id`
		)
		OR EXISTS (
			SELECT 1
			FROM `organization` AS `personal_organization`
			JOIN `billing_subscriptions` AS `owned_subscription`
				ON `owned_subscription`.`organization_id` = `personal_organization`.`id`
			WHERE `personal_organization`.`personal_owner_user_id` = NEW.`user_id`
				AND (
					`owned_subscription`.`cancel_at_period_end` = 1
					OR `owned_subscription`.`reconciliation_required` = 1
					OR `owned_subscription`.`status` NOT IN ('none', 'canceled', 'incomplete_expired')
				)
				AND NOT (
					`owned_subscription`.`plan_key` = 'personal'
					AND `owned_subscription`.`cadence` IS NOT NULL
					AND `owned_subscription`.`status` = 'active'
					AND `owned_subscription`.`cancel_at_period_end` = 1
					AND `owned_subscription`.`reconciliation_required` = 0
					AND `owned_subscription`.`current_period_end` IS NOT NULL
					AND EXISTS (
						SELECT 1
						FROM `family_join_attempts` AS `join_attempt`
						WHERE `join_attempt`.`recipient_user_id` = NEW.`user_id`
							AND `join_attempt`.`target_organization_id` = NEW.`organization_id`
							AND `join_attempt`.`personal_billing_subscription_id` = `owned_subscription`.`id`
							AND `join_attempt`.`personal_paid_through` = `owned_subscription`.`current_period_end`
							AND `join_attempt`.`state` IN (
								'renewal_off_confirmed',
								'membership_pending',
								'completed'
							)
					)
				)
		)
	)
BEGIN
	SELECT RAISE(ABORT, 'external family membership conflicts with personal family authority');
END;
--> statement-breakpoint
CREATE TRIGGER `billing_checkout_external_family_authority_before_insert`
BEFORE INSERT ON `billing_checkout_attempts`
FOR EACH ROW
WHEN NEW.`state` IN ('pending', 'open')
	AND EXISTS (
		SELECT 1
		FROM `organization` AS `personal_organization`
		JOIN `member` AS `owner_external_member`
			ON `owner_external_member`.`user_id` = `personal_organization`.`personal_owner_user_id`
			AND `owner_external_member`.`role` = 'member'
		WHERE `personal_organization`.`id` = NEW.`organization_id`
	)
BEGIN
	SELECT RAISE(ABORT, 'covered family member cannot reserve personal billing checkout');
END;
--> statement-breakpoint
CREATE TRIGGER `billing_checkout_external_family_authority_before_update`
BEFORE UPDATE OF `organization_id`, `state` ON `billing_checkout_attempts`
FOR EACH ROW
WHEN NEW.`state` IN ('pending', 'open')
	AND EXISTS (
		SELECT 1
		FROM `organization` AS `personal_organization`
		JOIN `member` AS `owner_external_member`
			ON `owner_external_member`.`user_id` = `personal_organization`.`personal_owner_user_id`
			AND `owner_external_member`.`role` = 'member'
		WHERE `personal_organization`.`id` = NEW.`organization_id`
	)
BEGIN
	SELECT RAISE(ABORT, 'covered family member cannot reserve personal billing checkout');
END;
--> statement-breakpoint
CREATE TRIGGER `billing_subscription_external_family_authority_before_insert`
BEFORE INSERT ON `billing_subscriptions`
FOR EACH ROW
WHEN EXISTS (
		SELECT 1
		FROM `organization` AS `personal_organization`
		JOIN `member` AS `owner_external_member`
			ON `owner_external_member`.`user_id` = `personal_organization`.`personal_owner_user_id`
			AND `owner_external_member`.`role` = 'member'
		WHERE `personal_organization`.`id` = NEW.`organization_id`
	)
	AND NOT (
		(
			NEW.`status` IN ('none', 'canceled', 'incomplete_expired')
			AND NEW.`cancel_at_period_end` = 0
			AND NEW.`reconciliation_required` = 0
		)
		OR (
			NEW.`reconciliation_required` = 1
			AND NEW.`reconciliation_reason` IS NOT NULL
		)
	)
BEGIN
	SELECT RAISE(ABORT, 'covered family member personal billing requires conflict reconciliation');
END;
--> statement-breakpoint
CREATE TRIGGER `billing_subscription_external_family_authority_before_update`
BEFORE UPDATE OF `organization_id`, `status`, `plan_key`, `cadence`, `current_period_end`, `cancel_at_period_end`, `reconciliation_required`, `reconciliation_reason`
ON `billing_subscriptions`
FOR EACH ROW
WHEN EXISTS (
		SELECT 1
		FROM `organization` AS `personal_organization`
		JOIN `member` AS `owner_external_member`
			ON `owner_external_member`.`user_id` = `personal_organization`.`personal_owner_user_id`
			AND `owner_external_member`.`role` = 'member'
		WHERE `personal_organization`.`id` = NEW.`organization_id`
	)
	AND NOT (
		(
			NEW.`status` IN ('none', 'canceled', 'incomplete_expired')
			AND NEW.`cancel_at_period_end` = 0
			AND NEW.`reconciliation_required` = 0
		)
		OR (
			NEW.`reconciliation_required` = 1
			AND NEW.`reconciliation_reason` IS NOT NULL
		)
		OR (
			NEW.`plan_key` = 'personal'
			AND NEW.`cadence` IS NOT NULL
			AND NEW.`status` = 'active'
			AND NEW.`cancel_at_period_end` = 1
			AND NEW.`reconciliation_required` = 0
			AND NEW.`current_period_end` IS NOT NULL
			AND EXISTS (
				SELECT 1
				FROM `organization` AS `personal_organization`
				JOIN `member` AS `external_membership`
					ON `external_membership`.`user_id` = `personal_organization`.`personal_owner_user_id`
					AND `external_membership`.`role` = 'member'
				JOIN `family_join_attempts` AS `join_attempt`
					ON `join_attempt`.`recipient_user_id` = `personal_organization`.`personal_owner_user_id`
					AND `join_attempt`.`target_organization_id` = `external_membership`.`organization_id`
					AND `join_attempt`.`personal_billing_subscription_id` = NEW.`id`
					AND `join_attempt`.`personal_paid_through` = NEW.`current_period_end`
					AND `join_attempt`.`state` IN ('membership_pending', 'completed')
				WHERE `personal_organization`.`id` = NEW.`organization_id`
			)
		)
	)
BEGIN
	SELECT RAISE(ABORT, 'covered family member personal billing requires conflict reconciliation');
END;
--> statement-breakpoint
CREATE TRIGGER `member_current_family_manager_authority_before_insert`
BEFORE INSERT ON `member`
FOR EACH ROW
WHEN NEW.`role` = 'member'
	AND EXISTS (
		SELECT 1
		FROM `invitation` AS `accepted_invitation`
		JOIN `user` AS `joining_user`
			ON lower(trim(`accepted_invitation`.`email`)) = lower(trim(`joining_user`.`email`))
		WHERE `accepted_invitation`.`organization_id` = NEW.`organization_id`
			AND `accepted_invitation`.`status` = 'accepted'
			AND `accepted_invitation`.`role` = 'member'
			AND `joining_user`.`id` = NEW.`user_id`
	)
	AND NOT EXISTS (
		SELECT 1
		FROM `organization` AS `target_organization`
		JOIN `member` AS `target_owner`
			ON `target_owner`.`organization_id` = `target_organization`.`id`
			AND `target_owner`.`user_id` = `target_organization`.`personal_owner_user_id`
			AND `target_owner`.`role` = 'owner'
		JOIN `billing_subscriptions`
			ON `billing_subscriptions`.`organization_id` = `target_organization`.`id`
		JOIN `billing_customers`
			ON `billing_customers`.`id` = `billing_subscriptions`.`billing_customer_id`
			AND `billing_customers`.`organization_id` = `billing_subscriptions`.`organization_id`
		WHERE `target_organization`.`id` = NEW.`organization_id`
			AND `target_organization`.`billing_deletion_pending` = 0
			AND `billing_subscriptions`.`status` = 'active'
			AND `billing_subscriptions`.`plan_key` = 'family'
			AND `billing_subscriptions`.`cadence` IN ('monthly', 'annual')
			AND `billing_subscriptions`.`stripe_subscription_id` IS NOT NULL
			AND `billing_subscriptions`.`stripe_subscription_item_id` IS NOT NULL
			AND `billing_subscriptions`.`stripe_price_id` IS NOT NULL
			AND `billing_subscriptions`.`current_period_start` IS NOT NULL
			AND `billing_subscriptions`.`current_period_end` IS NOT NULL
			AND unixepoch(`billing_subscriptions`.`current_period_end`) > unixepoch('subsecond')
			AND `billing_subscriptions`.`last_verified_at` IS NOT NULL
			AND `billing_subscriptions`.`cancel_at_period_end` = 0
			AND `billing_subscriptions`.`grace_invoice_id` IS NULL
			AND `billing_subscriptions`.`grace_started_at` IS NULL
			AND `billing_subscriptions`.`grace_ends_at` IS NULL
			AND `billing_subscriptions`.`reconciliation_required` = 0
			AND NOT EXISTS (
				SELECT 1
				FROM `billing_subscription_transitions`
				WHERE `billing_subscription_transitions`.`organization_id` = `billing_subscriptions`.`organization_id`
					AND `billing_subscription_transitions`.`state` IN (
						'pending',
						'action_required',
						'scheduled',
						'reconciliation_required'
					)
			)
			AND NOT EXISTS (
				SELECT 1
				FROM `billing_checkout_attempts`
				WHERE `billing_checkout_attempts`.`organization_id` = `billing_subscriptions`.`organization_id`
					AND `billing_checkout_attempts`.`state` IN ('pending', 'open', 'reconciliation_required')
			)
			AND NOT EXISTS (
				SELECT 1
				FROM `billing_account_deletion_requests`
				WHERE `billing_account_deletion_requests`.`organization_id` = `billing_subscriptions`.`organization_id`
					AND `billing_account_deletion_requests`.`state` IN ('pending', 'reconciliation_required')
			)
	)
BEGIN
	SELECT RAISE(ABORT, 'Family membership requires current manager billing authority');
END;
--> statement-breakpoint
CREATE TRIGGER `family_join_open_subscription_correlation_before_update`
BEFORE UPDATE OF `billing_customer_id`, `stripe_subscription_id`, `stripe_subscription_item_id`, `stripe_price_id`
ON `billing_subscriptions`
FOR EACH ROW
WHEN (
	NEW.`billing_customer_id` IS NOT OLD.`billing_customer_id`
	OR NEW.`stripe_subscription_id` IS NOT OLD.`stripe_subscription_id`
	OR NEW.`stripe_subscription_item_id` IS NOT OLD.`stripe_subscription_item_id`
	OR NEW.`stripe_price_id` IS NOT OLD.`stripe_price_id`
)
	AND EXISTS (
		SELECT 1
		FROM `family_join_attempts`
		WHERE `personal_billing_subscription_id` = OLD.`id`
			AND `state` IN (
				'pending',
				'renewal_stop_pending',
				'renewal_off_confirmed',
				'membership_pending',
				'reconciliation_required'
			)
	)
BEGIN
	SELECT RAISE(ABORT, 'open family join attempt requires immutable Stripe subscription correlation');
END;
--> statement-breakpoint
CREATE TRIGGER `family_join_open_customer_correlation_before_update`
BEFORE UPDATE OF `stripe_customer_id` ON `billing_customers`
FOR EACH ROW
WHEN NEW.`stripe_customer_id` IS NOT OLD.`stripe_customer_id`
	AND EXISTS (
		SELECT 1
		FROM `family_join_attempts`
		JOIN `billing_subscriptions`
			ON `billing_subscriptions`.`id` = `family_join_attempts`.`personal_billing_subscription_id`
		WHERE `billing_subscriptions`.`billing_customer_id` = OLD.`id`
			AND `family_join_attempts`.`state` IN (
				'pending',
				'renewal_stop_pending',
				'renewal_off_confirmed',
				'membership_pending',
				'reconciliation_required'
			)
	)
BEGIN
	SELECT RAISE(ABORT, 'open family join attempt requires immutable Stripe customer correlation');
END;
