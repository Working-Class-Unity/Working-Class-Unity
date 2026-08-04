CREATE TRIGGER `user_personal_organization_after_insert`
AFTER INSERT ON `user`
BEGIN
	INSERT INTO `organization` (
		`id`,
		`name`,
		`slug`,
		`created_at`,
		`personal_owner_user_id`
	) VALUES (
		'organization_' || lower(hex(randomblob(16))),
		CASE
			WHEN trim(NEW.`name`) <> '' THEN trim(NEW.`name`) || '''s workspace'
			ELSE 'Personal workspace'
		END,
		'workspace-' || lower(hex(randomblob(16))),
		cast(unixepoch('subsecond') * 1000 as integer),
		NEW.`id`
	);
	INSERT INTO `member` (`id`, `organization_id`, `user_id`, `role`, `created_at`)
	SELECT
		'member_' || lower(hex(randomblob(16))),
		`id`,
		NEW.`id`,
		'owner',
		cast(unixepoch('subsecond') * 1000 as integer)
	FROM `organization`
	WHERE `personal_owner_user_id` = NEW.`id`;
END;
--> statement-breakpoint
CREATE TRIGGER `member_family_role_before_insert`
BEFORE INSERT ON `member`
FOR EACH ROW
WHEN NEW.`role` IS NOT (
	SELECT CASE
		WHEN `organization`.`personal_owner_user_id` IS NEW.`user_id` THEN 'owner'
		ELSE 'member'
	END
	FROM `organization`
	WHERE `organization`.`id` = NEW.`organization_id`
)
BEGIN
	SELECT RAISE(ABORT, 'member role must match family-plan owner marker');
END;
--> statement-breakpoint
CREATE TRIGGER `member_family_role_before_update`
BEFORE UPDATE OF `organization_id`, `user_id`, `role` ON `member`
FOR EACH ROW
WHEN NEW.`role` IS NOT (
	SELECT CASE
		WHEN `organization`.`personal_owner_user_id` IS NEW.`user_id` THEN 'owner'
		ELSE 'member'
	END
	FROM `organization`
	WHERE `organization`.`id` = NEW.`organization_id`
)
BEGIN
	SELECT RAISE(ABORT, 'member role must match family-plan owner marker');
END;
--> statement-breakpoint
CREATE TRIGGER `member_family_owner_after_delete`
AFTER DELETE ON `member`
FOR EACH ROW
WHEN OLD.`role` = 'owner'
	AND EXISTS (
		SELECT 1
		FROM `organization`
		WHERE `organization`.`id` = OLD.`organization_id`
			AND `organization`.`personal_owner_user_id` IS OLD.`user_id`
	)
BEGIN
	SELECT RAISE(ABORT, 'family-plan owner membership cannot be deleted directly');
END;
--> statement-breakpoint
CREATE TRIGGER `invitation_member_role_before_insert`
BEFORE INSERT ON `invitation`
FOR EACH ROW
WHEN NEW.`status` = 'pending'
	AND NEW.`role` IS NOT 'member'
BEGIN
	SELECT RAISE(ABORT, 'pending family-plan invitations must use member role');
END;
--> statement-breakpoint
CREATE TRIGGER `invitation_member_role_before_update`
BEFORE UPDATE OF `status`, `role` ON `invitation`
FOR EACH ROW
WHEN NEW.`status` = 'pending'
	AND NEW.`role` IS NOT 'member'
BEGIN
	SELECT RAISE(ABORT, 'pending family-plan invitations must use member role');
END;
--> statement-breakpoint
CREATE TRIGGER `organization_personal_owner_before_update`
BEFORE UPDATE OF `personal_owner_user_id` ON `organization`
FOR EACH ROW
WHEN OLD.`personal_owner_user_id` IS NOT NEW.`personal_owner_user_id`
BEGIN
	SELECT RAISE(ABORT, 'family-plan owner marker is immutable');
END;
--> statement-breakpoint
CREATE TRIGGER `member_family_capacity_before_insert`
BEFORE INSERT ON `member`
FOR EACH ROW
WHEN (
	SELECT COUNT(*)
	FROM `member`
	WHERE `organization_id` = NEW.`organization_id`
) >= 6
BEGIN
	SELECT RAISE(ABORT, 'family plan accepts at most six members');
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
		)
	)
BEGIN
	SELECT RAISE(ABORT, 'external family membership conflicts with personal family authority');
END;
--> statement-breakpoint
CREATE TRIGGER `invitation_external_family_authority_before_insert`
BEFORE INSERT ON `invitation`
FOR EACH ROW
WHEN NEW.`status` = 'pending'
	AND NEW.`expires_at` > cast(unixepoch('subsecond') * 1000 as integer)
	AND EXISTS (
		SELECT 1
		FROM `organization` AS `personal_organization`
		JOIN `member` AS `owner_external_member`
			ON `owner_external_member`.`user_id` = `personal_organization`.`personal_owner_user_id`
			AND `owner_external_member`.`role` = 'member'
		WHERE `personal_organization`.`id` = NEW.`organization_id`
	)
BEGIN
	SELECT RAISE(ABORT, 'covered family member cannot create outgoing invitations');
END;
--> statement-breakpoint
CREATE TRIGGER `invitation_external_family_authority_before_update`
BEFORE UPDATE OF `organization_id`, `status`, `expires_at` ON `invitation`
FOR EACH ROW
WHEN NEW.`status` = 'pending'
	AND NEW.`expires_at` > cast(unixepoch('subsecond') * 1000 as integer)
	AND EXISTS (
		SELECT 1
		FROM `organization` AS `personal_organization`
		JOIN `member` AS `owner_external_member`
			ON `owner_external_member`.`user_id` = `personal_organization`.`personal_owner_user_id`
			AND `owner_external_member`.`role` = 'member'
		WHERE `personal_organization`.`id` = NEW.`organization_id`
	)
BEGIN
	SELECT RAISE(ABORT, 'covered family member cannot create outgoing invitations');
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
BEFORE UPDATE OF `organization_id`, `status`, `cancel_at_period_end`, `reconciliation_required`, `reconciliation_reason`
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
	)
BEGIN
	SELECT RAISE(ABORT, 'covered family member personal billing requires conflict reconciliation');
END;
