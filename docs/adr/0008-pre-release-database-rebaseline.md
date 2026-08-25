# ADR 0008: Pre-release database rebaseline

- Status: accepted
- Date: 2026-07-13
- Decision owner: baseline application
- Issue: [R-019D / #123](https://github.com/smallwiselabs/swl-step-by-step/issues/123)
- Final rebaseline: [ADR 0015](0015-final-pre-release-database-rebaseline.md) supersedes this ADR's active package identity, compatibility boundary, and rollback mechanics; this ADR remains the historical record of the first clean baseline
- Supersedes: the active-migration-chain and predecessor-compatibility portions of [ADR 0002](0002-better-auth-organization-workspace-authority.md), [ADR 0003](0003-family-plan-entitlements-and-user-owned-data.md), [ADR 0004](0004-owner-member-family-plan-boundary.md), and [ADR 0005](0005-immediate-account-deletion-and-billing-detachment.md), plus ADR 0003's project-slug decision
- Historical package before ADR 0015: the two entries in this ADR were the supported initialization baseline; [ADR 0009](0009-direct-stripe-family-plan-authority.md) added forward migrations `0002` through `0004`, [ADR 0010](0010-remove-local-search-and-fts.md) added forward Search-removal migrations `0005` and `0006`, [ADR 0011](0011-private-files-local-and-r2-lifecycle.md) added Files migration `0007`, [ADR 0012](0012-direct-openai-responses-and-local-history.md) added private AI migration `0008`, [ADR 0013](0013-deployment-owned-openai-file-search.md) recorded its first disposable-state regeneration with durable File Search citations, and [ADR 0014](0014-server-owned-openai-web-search.md) recorded the final disposable-state regeneration with durable Web citations before the #151 rebaseline
- Search-removal amendment: ADR 0010 supersedes this ADR's final-schema FTS/Search requirements without rewriting the historical initialization entries

## Context

The owner confirmed that this repository is a blank, pre-release baseline: there is no production or staging database with user/application data, and no downstream fork database whose development migration history has been promised support. Replaying thirteen obsolete development transitions in every future fork would preserve compatibility with state that has never become a supported deployment while making initialization and recovery harder to reason about.

The approved product model is now settled enough to establish its first supported database baseline. Projects are private, user-owned records identified by immutable IDs. A project name is display content, not an identifier; duplicate names are valid and no project slug belongs in the canonical schema or API.

## Decision

Replace the active `0000`–`0012` development chain with two migrations produced through the exact pinned Drizzle toolchain:

1. `0000_pre_release_baseline.sql` is generated from the current relational schema with `drizzle-kit@0.31.10`.
2. `0001_runtime_invariants.sql` is generated as a custom migration and contains the SQLite behavior Drizzle Kit does not model in its relational snapshot: the external-content FTS5 table and synchronization triggers, automatic personal-organization provisioning, and family-plan role/owner/invitation guards.

The old entries were removed from the active journal using the pinned kit's journal-aware `drop` command before generating the new baseline. Drizzle's official `generate` workflow compares the declared schema with the last snapshot and writes SQL plus snapshot metadata; its supported `--custom` mode creates an empty migration for application-authored SQL. `drizzle-kit check` validates the resulting snapshot history. No custom squashing tool, migration parser, or compatibility framework is introduced.

The former SQL and snapshots remain available in Git history, and dated ADR/audit records remain historical evidence. They are not active migrations and are not a promise to initialize or upgrade a database created before this ADR.

Implementation status (2026-07-14): `0000`/`0001` remain the first supported initialized state. R-024A follows this ADR's forward-migration rule with transactionally applied `0002` organization billing and custom `0003` family-capacity invariants. R-024A2 adds forward `0004` strict family/billing authority, so the active package contains five entries. This does not rebaseline again or add compatibility for the superseded development chain.

Search-removal status (2026-07-14): R-029S-R/[#140](https://github.com/smallwiselabs/swl-step-by-step/issues/140) follows the same forward-migration rule with custom `0005` removal of the historical Search runtime objects and generated `0006` removal of the relational projection table. At that status, the seven-entry package still replayed `0000`/`0001` on a fresh database, but its final schema contained no Search or FTS objects.

Files status (2026-07-15): R-025/[#32](https://github.com/smallwiselabs/swl-step-by-step/issues/32) follows that forward-only rule with `0007`, preserving ready predecessor rows as readable but integrity-unverified, converting incompatible pending uploads into expiry-aware cleanup candidates, and adding the current Files integrity/lifecycle constraints and indexes. The eight-entry package at that status still used `0000`/`0001` as its initialization baseline; it did not rewrite history or accept the superseded development chain.

AI status before ADR 0015 (2026-07-16): R-026/[#33](https://github.com/smallwiselabs/swl-step-by-step/issues/33) followed the same rule with `0008`, adding private user-owned conversations/messages, idempotent bounded generation attempts, one transient per-owner generation lease, and minimized daily usage buckets. That nine-entry package still used `0000`/`0001` as its initialization baseline and added no compatibility for the superseded development chain.

File Search amendment (2026-07-16): the owner confirmed that every database and backup carrying the first Issue #33 form of `0008` is disposable and explicitly approved folding [Issue #148](https://github.com/smallwiselabs/swl-step-by-step/issues/148)'s durable file-citation table into a regenerated `0008` rather than adding `0009`. The pinned Drizzle drop/generate workflow replaces SQL, snapshot, and journal identity together. Maintenance rejects the former hash without mutation, and reset requires every writer stopped plus removal of the confirmed-valueless database and sidecars. This is a narrow pre-persistent-staging exception to the normal forward-only rule. [Issue #151](https://github.com/smallwiselabs/swl-step-by-step/issues/151) owns the final full rebaseline after #148 and #149; once that baseline or any valuable data exists, later schema changes are forward-only again.

Web Search amendment (2026-07-16): while that same owner-confirmed disposable window remains open, [Issue #149](https://github.com/smallwiselabs/swl-step-by-step/issues/149) again regenerates only the last `0008` from snapshot `0007`, now with both File and Web citation tables. Both superseded exact `0008` identities fail closed and receive no automatic adoption, mutation, or deletion path. This is the final schema-affecting optional AI issue before #151 establishes the clean baseline and permanently ends the exception.

## Canonical project boundary

The clean baseline stores a project with an immutable ID, server-derived `owner_user_id`, name, and timestamps. The owner foreign key remains restrictive and the owner index remains. There is no project slug, owner-and-slug uniqueness constraint, slug conflict behavior, or slug field in project create/update/response DTOs. Two projects owned by the same user may have the same name.

Every project read or write still predicates on the authenticated user ID. Removing the slug changes naming and lookup mechanics; it does not weaken private-record authorization or make family-plan membership a project authority.

## Initialization, compatibility, and recovery

- A fresh deployment must apply and verify the exact packaged baseline before the application is started as ready. A successful initialization must remain repeat-idempotent. Database migrations seed no user or administrator account; Better Auth creates people only after initialization succeeds.
- A first-ever migration failure remains fail-closed. Automatic same-path recovery is not required. Resetting that failed first-initialization state requires the application to be fully stopped and confirmation that no migration completed and no user or application data exists.
- A pre-existing initialized SQLite database with an empty ledger, only the internal `0000` entry, a partial/foreign schema, an obsolete development ledger, or another ambiguous state must not be adopted or deleted automatically. The two-entry baseline is the first supported initialized state; `0001` installs forward-only triggers and is not a compatibility backfill for rows created at the internal prefix. Because this repository has no valuable deployment data, an operator may discard an unsupported pre-rebaseline database after stopping the application and every writer and confirming that it contains no valuable user or application data; completed obsolete development migrations do not prohibit that explicit reset. A truly fresh path—absent, or zero-length with no sidecars—remains the valid initialization case.
- In either approved reset case, the operator discards the database together with its associated `-wal`, `-shm`, and `-journal` files, then initializes a fresh database.
- A database or backup created from the former `0000`–`0012` chain is unsupported after this rebaseline. It must not be restored into or upgraded by the new active chain.
- The implementation rollback for this rebaseline, before the commit becomes the supported baseline, is Git revert plus disposal/reinitialization of the confirmed-blank database; no successful down migration is required.
- Outside the explicitly approved Issue #148/#149 disposable-development window, later schema changes use forward transactional migrations that preserve existing data, fail closed, and support corrected idempotent retry after a failed upgrade. Issue #151 closes that window permanently before persistent staging or backup compatibility begins.

Existing lock, corruption, sidecar, backup, verification, restore, and container-persistence guarantees continue for databases initialized from the recognized baseline. SQLite documents that rollback journals and WAL files carry atomicity/recovery state and that the shared-memory file belongs to its associated WAL, which is why reset and restore procedures treat the database and sidecars as one unit.

## Consequences

- Future forks initialize directly into the approved schema instead of replaying abandoned workspace, role, project-ownership, slug, and lifecycle transitions.
- There is no compatibility or rollback code for pre-rebaseline databases. Unexpected state fails closed and requires an explicit operator decision.
- Dated ADRs 0002–0005 still explain why the current Organization, private-data, owner/member, and deletion boundaries exist. Only their migration-history/predecessor claims—and the project-slug decision—are superseded.
- [R-022 / #30](https://github.com/smallwiselabs/swl-step-by-step/issues/30) remains a separate project-UI issue and depends on this database/API boundary.
- Fresh/repeat initialization, exact schema/index/constraint/foreign-key integrity, FTS behavior, name-only project CRUD/search, unsupported-state rejection, and retained operational recovery boundaries are proved behaviorally against temporary SQLite databases. No source-text or documentation checker is added.

## Evidence and official sources

- [Drizzle Kit `generate` documentation](https://orm.drizzle.team/docs/drizzle-kit-generate)
- [Drizzle Kit custom-migration documentation](https://orm.drizzle.team/docs/kit-custom-migrations)
- [Drizzle Kit `check` documentation](https://orm.drizzle.team/docs/drizzle-kit-check)
- [Pinned `drizzle-kit@0.31.10` journal-aware `drop` implementation](https://github.com/drizzle-team/drizzle-orm/blob/drizzle-kit%400.31.10/drizzle-kit/src/cli/commands/drop.ts)
- [Pinned `drizzle-kit@0.31.10` migration preparation](https://github.com/drizzle-team/drizzle-orm/blob/drizzle-kit%400.31.10/drizzle-kit/src/migrationPreparator.ts)
- [Pinned `drizzle-orm@0.45.2` SQLite migrator source](https://github.com/drizzle-team/drizzle-orm/blob/273c78071d4841b497f5144734b38294df7ec64b/drizzle-orm/src/sqlite-core/dialect.ts)
- [SQLite FTS5 external-content tables](https://www.sqlite.org/fts5.html#external_content_tables)
- [SQLite trigger contract](https://www.sqlite.org/lang_createtrigger.html)
- [SQLite transactions](https://www.sqlite.org/lang_transaction.html)
- [SQLite foreign keys](https://www.sqlite.org/foreignkeys.html)
- [SQLite database sidecar files](https://www.sqlite.org/tempfiles.html)
