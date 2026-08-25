# ADR 0015: Final pre-release database rebaseline

- Status: accepted
- Date: 2026-07-16
- Decision owner: baseline application
- Issue: [#151](https://github.com/smallwiselabs/swl-step-by-step/issues/151)
- Supersedes: the active migration-package identity, predecessor compatibility, and rollback mechanics recorded by [ADR 0008](0008-pre-release-database-rebaseline.md) through [ADR 0014](0014-server-owned-openai-web-search.md)
- Preserves: the product, authorization, deletion, provider, privacy, and operational decisions in those ADRs and every dated audit as historical evidence
- Forward-migration amendment: [ADR 0017](0017-stripe-personal-family-subscriptions.md)/[#169](https://github.com/smallwiselabs/baseline/issues/169) preserves the two entries decided here as the exact supported starting prefix and appends generated `0002_stripe_subscription_persistence.sql` plus custom `0003_stripe_subscription_invariants.sql`. The current package has four entries and exactly 30 triggers; references below to two entries or 16 triggers describe this ADR's dated package, not the current final ledger.
- Pre-staging rebaseline exception: before any persistent staging database existed, the owner confirmed that no database or backup contained valuable data and approved regenerating the unpublished `0002`/`0003` suffix to absorb the deletion fence and remove temporary `0004`. This one-time exception does not change the preserved `0000`/`0001` prefix or permit rewriting migration history after valuable data exists.

## Context

The repository is still a blank, pre-release baseline. No production or persistent-staging database, backup, or downstream fork contains data that this development migration package has promised to preserve. The owner explicitly confirmed that current databases do not matter and approved one final reset before persistent staging and backup compatibility begin.

The active development package had accumulated nine entries and two exceptional regenerations of its final `0008` identity while Files, billing, private AI conversations, File Search citations, Web Search citations, and Search removal were still being settled. Replaying those intermediate states in every future fork would preserve unsupported development history, obscure the actual final schema, and make database verification and recovery harder to reason about.

This is an intentional compatibility break, not a data migration. It must not become a generic migration squasher, an automatic reset path, or a precedent for rewriting history after valuable data exists.

## Decision

Replace the entire active `0000` through `0008` SQL, snapshot, and journal identity with exactly two entries produced through the repository's pinned Drizzle toolchain:

1. Generated `0000_pre_release_baseline.sql` creates the complete current relational schema directly. It includes the approved Better Auth Organization-backed family-plan model, private user-owned projects and Files, organization-owned billing state, private AI conversations and attempts, separate File and Web citation tables, jobs/cache/settings, current checks, foreign keys, indexes, and cascades. It contains no retired application Search table, FTS table, or Search synchronization object.
2. Custom `0001_runtime_invariants.sql` contains only the current SQLite behavior that Drizzle's relational snapshot cannot express. It installs automatic personal-organization provisioning; owner/member and invitation role guards; personal-owner marker protection; the six-person accepted-member limit; and the reciprocal member, invitation, Checkout, and subscription guards that prevent simultaneous external-family and personal-family billing authority. It does not recreate retired Search/FTS behavior or temporary predecessor-repair objects.

The custom entry is registered through Drizzle Kit's documented `generate --custom` workflow. The journal and snapshots are generated package metadata, not handwritten compatibility declarations. No custom parser, generic squashing utility, migration DSL, or executable documentation checker is added.

The current relational schema still requires Better Auth's opaque, unique internal `organization.slug`. That compatibility field is not a visible workspace route or application-data authority. Projects remain addressed by immutable ID and have no project slug; Organization membership remains an invisible family-plan/entitlement relationship and never grants access to another person's private records.

The former SQL and snapshots remain available in Git history. ADRs 0008 through 0014 retain the reasoning and implementation-time evidence for the features they introduced, but their migration numbers, active-package identities, predecessor transitions, and disposable-window rollback instructions are historical after this ADR. Dated files under `docs/audits/` are not rewritten.

## Supported initialization and compatibility boundary

- A truly fresh database applies both packaged entries and verifies the complete ledger and schema before web or worker startup. Repeating the same maintenance operation is idempotent.
- The new two-entry package is the only supported initialized baseline at this commit. Every database or backup carrying any former development-package identity—including the prior `0000`/`0001`, any `0002` through `0008` prefix, either superseded `0008`, a foreign or empty ledger beside pre-existing state, or another ambiguous schema—is unsupported. It is never adopted, upgraded, repaired, reset, or deleted automatically.
- The internal one-entry prefix is not a supported running state. A failure during first initialization remains fail-closed; the same path is not silently retried or treated as fresh.
- An operator may discard a known valueless pre-release database only after stopping the application and every writer, confirming that it contains no valuable user or application data, and removing the main database with its `-wal`, `-shm`, and `-journal` sidecars. A failed first-ever initialization additionally requires confirmation that no migration completed. Unknown or possibly valuable state is preserved for investigation.
- Backups are data and are never removed by runtime or maintenance code. A former-package backup is not a compatible restore input even when its SQLite contents are internally valid.
- Once this baseline is merged, every later schema change is a forward transactional migration. Later migrations preserve supported initialized data, fail closed on unknown state, and support corrected retry after a failed upgrade. There is no further disposable-last-migration exception.

## Required invariants and verification

Fresh/repeat initialization, maintenance verification, backup verification, restore validation, application tests, and container evidence must agree on the final observable schema. Verification includes the generated tables, checks, foreign keys, cascades, and indexes plus all 16 custom triggers:

- `user_personal_organization_after_insert`;
- `member_family_role_before_insert` and `member_family_role_before_update`;
- `member_family_owner_after_delete`;
- `invitation_member_role_before_insert` and `invitation_member_role_before_update`;
- `organization_personal_owner_before_update`;
- `member_family_capacity_before_insert`;
- member, invitation, billing Checkout, and billing subscription external-family-authority guards for both insert and update.

Verification also requires the exact predicates of the partial unique `member_one_external_family_uidx` and `billing_checkout_attempts_one_open_uidx`. It must reject a schema that has the expected ledger but omits or weakens any of these authority objects. The final schema must contain no Search table, Search FTS table, or Search synchronization trigger.

Behavioral tests must prove the resulting authorization and lifecycle guarantees, not merely object names: atomic personal-family provisioning, owner/member-only roles, owner preservation, accepted-member capacity, reciprocal one-family/billing authority, private-resource ownership and concealment, billing minimization, Files integrity/expiry/deletion, AI idempotency/quota/concurrency/citations, clear/conversation/account deletion, and absence of retired Search behavior. Account deletion is retested against the generated foreign-key ordering and custom triggers because a schema-equivalent-looking rebaseline can still change destructive behavior.

Maintenance evidence covers fresh and repeat initialization; exact current-ledger verification; the unsupported internal prefix; generic empty, foreign, drifted, and forged ledgers; the exact complete former nine-entry package; integrity and foreign keys; compatible same-image backup/restore; sidecars; corruption and locks; and no mutation of rejected state. Tests use disposable SQLite and local provider fakes. They make no live provider call and require no provider credential.

## Rollback and recovery

Before this commit becomes the supported baseline and before any valuable data exists, rollback is code rollback followed by explicit disposal and fresh initialization of the confirmed-valueless database and its sidecars. There is no down migration and no conversion between old and new package identities.

After a database has been initialized from this baseline or contains valuable state, an older image must not run against it. Recovery uses a forward repair or a backup whose exact ledger is compatible with the selected image. Restoring a former development-package backup into the new baseline is unsupported.

## Consequences and residual risks

- Future forks initialize directly into the settled schema through two auditable entries instead of replaying abandoned transitions.
- Generated `billing_subscriptions` now places `cancel_at_period_end` in canonical declared-schema order instead of the old `ALTER`-appended final position. Its name, type, default, constraints, and behavior are unchanged, and the repository has no positional SQL consumer.
- Package identity becomes a permanent compatibility root before persistent staging. #35 owns the local off-host mechanism and explicit schedule/retention/data-loss policy without an RPO or RTO promise. Under separate infrastructure authority, #36 provisions persistent staging, the backup destination/runner, private off-host receipt sink, independently scheduled dead-man monitor, and release ordering; #37 creates and configures the task and notifications, then executes and certifies scheduled backup/restore behavior and measured duration. This repository does not claim either external result yet.
- Human error could misclassify a valuable database or backup as disposable. The implementation therefore fails closed and leaves disposal outside runtime and maintenance commands.
- A generated-schema omission, custom-trigger transcription error, or incomplete verifier could weaken authorization or deletion guarantees. Full-schema and behavior tests, including every strict family/billing authority guard, are required.
- Generated SQL names or ordering may change with toolchain upgrades. Exact package identity and behavioral evidence must be regenerated and reviewed together; a dependency upgrade is not assumed compatible.
- Old backups remain unsupported and must be quarantined or removed only through an explicit operator decision. There is no automatic cleanup or down migration.
- Existing provider/product compatibility semantics already present in the declared schema remain unchanged. This rebaseline does not silently redesign Files storage bindings, OpenAI behavior, billing, authentication, or account deletion.

## Evidence and official sources

- [Drizzle Kit `generate` documentation](https://orm.drizzle.team/docs/drizzle-kit-generate)
- [Drizzle Kit custom-migration documentation](https://orm.drizzle.team/docs/kit-custom-migrations)
- [Drizzle Kit `check` documentation](https://orm.drizzle.team/docs/drizzle-kit-check)
- [Pinned `drizzle-kit@0.31.10` migration preparation](https://github.com/drizzle-team/drizzle-orm/blob/drizzle-kit%400.31.10/drizzle-kit/src/migrationPreparator.ts)
- [Pinned `drizzle-orm@0.45.2` SQLite migrator](https://github.com/drizzle-team/drizzle-orm/blob/273c78071d4841b497f5144734b38294df7ec64b/drizzle-orm/src/better-sqlite3/migrator.ts)
- [SQLite transactions](https://www.sqlite.org/lang_transaction.html)
- [SQLite triggers](https://www.sqlite.org/lang_createtrigger.html)
- [SQLite foreign keys](https://www.sqlite.org/foreignkeys.html)
- [SQLite database sidecar files](https://www.sqlite.org/tempfiles.html)
- [SQLite backup API](https://www.sqlite.org/backup.html)
