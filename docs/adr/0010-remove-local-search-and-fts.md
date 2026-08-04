# ADR 0010: Remove local Search and FTS from the baseline

- Status: accepted
- Date: 2026-07-14
- Decision owner: baseline application
- Issue: [R-029S-R / #140](https://github.com/smallwiselabs/swl-step-by-step/issues/140)
- Final rebaseline: [ADR 0015](0015-final-pre-release-database-rebaseline.md) supersedes this ADR's migration numbers and predecessor/rollback mechanics; the decision to omit Local Search and every Search/FTS object remains accepted
- Supersedes: the Search-specific decisions in [ADR 0003](0003-family-plan-entitlements-and-user-owned-data.md), [ADR 0005](0005-immediate-account-deletion-and-billing-detachment.md), and [ADR 0008](0008-pre-release-database-rebaseline.md)

## Context

The owner removed Local Search from this small personal/family application baseline. Projects remain canonical, private, user-owned records, but the baseline no longer needs a derived relational Search projection, SQLite FTS5 objects, a Search API, or an optional Search module. Keeping those layers would add schema, lifecycle, configuration, and verification work to every fork even when the product has no search experience.

The repository already has a supported initialized database history. `0000_pre_release_baseline.sql` and `0001_runtime_invariants.sql` therefore remain the initialization baseline, including the historical creation of Search objects in `0001`. Removing or rewriting those entries would change the recognized migration history promised after ADR 0008.

## Decision

- Remove the Search API, repository, runtime module/configuration, project projection hooks, account-deletion coupling, relational projection schema, and FTS5 virtual/shadow tables and synchronization triggers. The final application and schema expose no Local Search capability.
- Use ordinary forward migrations rather than another rebaseline. Custom `0005` drops the Search synchronization triggers and FTS5 virtual table; generated `0006` drops the relational projection table. The resulting package contains seven entries and no Search object in its final schema.
- Keep migrations `0000` through `0004`, their snapshots, Git history, and dated evidence unchanged. A fresh database may transiently create the historical Search objects while replaying the package, then removes them before initialization verifies successfully.
- Preserve canonical user-owned projects and all unrelated identity, family-plan, billing, files, cache, jobs, backup, restore, locking, corruption, sidecar, and container-persistence guarantees. Family-plan membership still grants no private-project access.
- Treat the former `NUXT_MODULES_SEARCH_ENABLED` value as irrelevant input. It is no longer a documented configuration key, module state, compatibility boundary, or rejection case.
- Add no replacement search engine, generic projection/index framework, source-text assertion, table-name scanner, or documentation checker. A fork that needs search chooses and authorizes it as product-specific work.

## Migration and recovery

The configured pinned Drizzle SQLite migrator applies pending migration SQL and ledger inserts in one transaction. Upgrade evidence begins from the recognized five-entry predecessor, preserves canonical and unrelated rows, removes every Search/FTS object, reaches ledger seven, passes integrity and foreign-key checks, and remains repeat-idempotent.

An injected foreign-key obstruction at generated `0006` must roll the package back to ledger five, including restoration of the runtime objects removed by `0005`. Removing only that obstruction and retrying the same package must succeed. Before an upgrade, Git revert is sufficient. After ledger seven applies, operators must not redeploy the older five-entry package; restoring Search would require a separately reviewed forward migration and reindex.

## Consequences

- `/api/search`, Search module state, Search configuration, derived Search rows, and Search-specific lifecycle behavior are absent.
- Account deletion continues to remove canonical caller-owned data without a Search-specific cleanup step.
- Backup, verification, restore, and container gates certify the seven-entry final schema and existing canonical data. Compatible older recognized prefixes upgrade through the packaged forward migrations.
- Dated audits and earlier ADR/migration text remain evidence of the decisions and implementation that existed when recorded; they are not current capability claims.

## Official sources

- [Drizzle Kit generated migrations](https://orm.drizzle.team/docs/drizzle-kit-generate)
- [Drizzle Kit custom migrations](https://orm.drizzle.team/docs/kit-custom-migrations)
- [Pinned Drizzle Kit `0.31.10` migration preparation](https://github.com/drizzle-team/drizzle-orm/blob/drizzle-kit%400.31.10/drizzle-kit/src/migrationPreparator.ts)
- [Pinned Drizzle ORM `0.45.2` SQLite migrator](https://github.com/drizzle-team/drizzle-orm/blob/273c78071d4841b497f5144734b38294df7ec64b/drizzle-orm/src/sqlite-core/dialect.ts#L936-L995)
- [SQLite `DROP TABLE`](https://www.sqlite.org/lang_droptable.html)
- [SQLite `DROP TRIGGER`](https://www.sqlite.org/lang_droptrigger.html)
- [SQLite FTS5 external-content tables](https://www.sqlite.org/fts5.html#external_content_tables)
