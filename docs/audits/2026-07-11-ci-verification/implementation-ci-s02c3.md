# CI-S02C3 migration and recovery mirror removal

## Outcome

CI-S02C3/#92 removes the broad CI contract's two raw maintenance source loaders, 14 maintenance implementation-fragment assertions, 14 exact maintenance test-title assertions, and the matching two-mutation policy test. It does not replace them with another source checker.

The actual 950-line maintenance behavior suite and 763-line maintenance executable are unchanged. The suite invokes the maintenance process against real temporary SQLite databases and owns successful fresh/repeat initialization, supported-predecessor upgrades, initialized-database rollback and corrected retry, lock/corruption/sidecar failures, backup verification, staged restore, and exact replacement rollback. The existing container journey remains distinct evidence for the packaged executable, same-image execution, non-root named-volume access, replacement persistence, and post-restore readiness.

No workflow, dependency, lockfile, product behavior, schema, SQL migration, maintenance implementation, container runner, deployment, or provider configuration changes in this tranche.

## Baseline and reduction

The base is `master` commit `416ecda17fac9a1455915d61993c13a9fb82ce17`.

| Surface                                           | Base physical/nonblank | Head physical/nonblank |    Change |
| ------------------------------------------------- | ---------------------: | ---------------------: | --------: |
| CI contract                                       |              666 / 601 |              625 / 561 | -41 / -40 |
| CI contract tests                                 |              298 / 260 |              287 / 251 |  -11 / -9 |
| Touched verification code                         |              964 / 861 |              912 / 812 | -52 / -49 |
| Maintenance behavior suite, unchanged             |              950 / 866 |              950 / 866 |     0 / 0 |
| Maintenance executable, unchanged                 |              763 / 690 |              763 / 690 |     0 / 0 |
| All custom verification scripts/tests             |        12,224 / 10,996 |        12,172 / 10,947 | -52 / -49 |
| Raw `readFileSync(` calls in the contract         |                      7 |                      5 |        -2 |
| Textual `.replace(`/`.replaceAll(` test mutations |                      8 |                      6 |        -2 |

No new wrapper, configuration, dependency, test, or handwritten infrastructure is added.

## Official basis

- SQLite documents that database reads and writes occur in transactions, that only one write transaction can exist at once, and that lock contention may return `SQLITE_BUSY` in its [transaction documentation](https://www.sqlite.org/lang_transaction.html). Its [locking documentation](https://www.sqlite.org/lockingv3.html) explains rollback journals, hot-journal recovery, and writer exclusion; its [WAL documentation](https://www.sqlite.org/wal.html) explains the associated `-wal` and `-shm` state. The repository proves its own lock, rollback, and sidecar policy by executing those states.
- SQLite's [`integrity_check`](https://www.sqlite.org/pragma.html#pragma_integrity_check) checks low-level structure and several constraints but explicitly does not find foreign-key errors. [`foreign_key_check`](https://www.sqlite.org/pragma.html#pragma_foreign_key_check) reports each foreign-key violation. Both outcomes remain executable evidence; their exact source spelling is not a contract.
- SQLite's [Online Backup API](https://www.sqlite.org/backup.html) defines the snapshot primitive. The exact pinned [better-sqlite3 `12.10.0` backup API](https://github.com/WiseLibs/better-sqlite3/blob/v12.10.0/docs/api.md#backupdestination-options---promise) returns a promise, rejects on failure, and writes an ordinary SQLite database. Repository-specific destination confinement, identity, permissions, verification, and restore behavior remain app-owned.
- Drizzle's unversioned [migration overview](https://orm.drizzle.team/docs/migrations) describes reading migration files and history before applying pending migrations. Exact version behavior is grounded in the pinned [`0.45.2` migrator](https://github.com/drizzle-team/drizzle-orm/blob/0.45.2/drizzle-orm/src/migrator.ts#L22-L59) and [SQLite dialect](https://github.com/drizzle-team/drizzle-orm/blob/0.45.2/drizzle-orm/src/sqlite-core/dialect.ts#L936-L995), not assumed from current documentation. That dialect creates the migration ledger table before `BEGIN`; only pending migration SQL and ledger inserts are inside the rollback block.

These sources define maintained primitives. They do not prove the application's ledger identity, schema validation, symlink/path confinement, quarantine, replacement, or stopped-writer policy; the retained executable tests do.

## Primary behavior by guarantee

| Guarantee/failure mode  | Primary executable owner                                                                                       | Distinct failure caught                                                                                                     |
| ----------------------- | -------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `DB-01A` initialization | Actual successful fresh/repeat migration, verification, and container readiness against temporary SQLite       | Invalid initialization reports ready or a successful repeat drifts                                                          |
| `DB-01B` recovery       | Index-collision and aborting-trigger initialized-upgrade faults, state observations, correction, retry, repeat | Partial initialized schema/data/ledger commit, duplicate retry, or failure to recover a recognized supported predecessor    |
| `DB-01C` fail-closed    | Actual exclusive writer, corrupt/FK-invalid database, corrupt-live quarantine, and orphan-sidecar cases        | Unsafe replacement, accepted corruption, discarded WAL/SHM/journal state, or destructive partial result                     |
| `DB-01D` persistence    | Actual backup/verification/staged-restore/replacement rollback plus the existing container volume journey      | Invalid snapshot acceptance, wrong restored rows, lost prior state, failed packaged persistence, or unhealthy restore ready |

SQL read from the packaged migration folder and executed by SQLite remains behavioral evidence. Structured package/caller policy also remains: `db:migrate:check` stays in Fast and Full, `container-maintenance.test.mjs` stays in `check:ci`, and the root maintenance entrypoints retain the existing structured optional-environment policy.

## Deletion manifest

Removed:

- raw loads of `apps/web/server/maintenance.mjs` and `scripts/container-maintenance.test.mjs`;
- literal import, helper, call-order, PRAGMA, option, path, permission, sidecar, and quarantine fragments;
- 14 exact maintenance test titles;
- the policy case that text-mutated `foreign_key_check` and `--confirm-app-stopped`.

Retained:

- all real maintenance process/database tests and the actual maintenance executable;
- actual packaged SQL execution, temporary SQLite databases, data fixtures, locks, corruption, sidecars, backup files, and replacement rollback;
- the actual container persistence/readiness journey;
- structured migration caller and package-entrypoint policy.

No exact function/import/PRAGMA spelling, test title, scenario count, or source fragment is a merge-gate guarantee after this change.

## Runtime, faults, gates, and review

Node 24 local measurements compare this tranche with its exact base. Runtime noise dominates a deletion that removes only raw text reads and string loops.

| Measurement                                                             |   Base |   Head |
| ----------------------------------------------------------------------- | -----: | -----: |
| Contract plus complete maintenance behavior selection                   | 23.54s | 25.03s |
| Six representative executable fresh/upgrade/recovery/lock/restore cases |      — | 11.89s |

The complete selection passed 38/38 tests: 18 structured contract cases and 20 real maintenance cases. A second focused run passed six representative executable cases:

- fresh migration plus repeat idempotence;
- supported-predecessor index-collision rollback, correction, clean forward retry, and repeat;
- verified backup plus unsafe-destination rejection;
- corrupt and foreign-key-invalid restore rejection with live state unchanged;
- a real exclusive writer blocking restore;
- injected post-install failure restoring the prior database, WAL, SHM, and journal exactly.

These are real process/database faults, not source-text mutations. A separate controlled run against the copied actual executable, pinned Drizzle `0.45.2`, packaged migrations, and temporary SQLite confirmed that an injected first-ever migration failure left only an empty `__drizzle_migrations` table and that same-path retry then failed closed. The owner explicitly retired automatic recovery for that pre-initialization case; no product behavior changes in this tranche. `ci:fast` and `verify:pinned` pass on Node 24, and two independent final reviews are clean after the evidence boundary was corrected. Hosted checks and final merge evidence remain pending at this commit.

## Rollback and residual risk

Reverting the CI-S02C3 merge restores only the two raw reads, implementation/title loops, and mutation case. It requires no dependency, database, schema, migration, container, provider, deployment, or generated-artifact rollback.

- Renaming or refactoring maintenance internals or test titles can now merge when executable outcomes remain correct. That is intentional.
- The official primitives do not prove custom ledger, schema, path, quarantine, replacement, or stopped-writer policy. Review and the retained executable suite own new application-specific boundaries.
- The exact maintenance scenario inventory is not frozen. A newly introduced failure mode needs proportionate behavior evidence, not a title assertion.
- The existing 950-line suite, 763-line executable, and 511-line container-health runner are unchanged and grandfathered. This deletion does not approve expanding or rewriting them; any future 500+ design requires separate evidence and owner approval.
- Pinned Drizzle leaves an empty ledger table outside its migration transaction when the first migration fails, so same-path retry remains fail-closed. The owner [explicitly retired automatic recovery](https://github.com/smallwiselabs/swl-step-by-step/issues/92#issuecomment-4950073444) for a database proven to have never initialized and contain no user or application data; [#101](https://github.com/smallwiselabs/swl-step-by-step/issues/101) is closed as not planned. With every writer stopped, the operator may discard that disposable database and its `-wal`, `-shm`, and `-journal` state together. Empty-ledger state is never sufficient for automatic deletion or adoption, and any ambiguous or pre-existing state remains fail-closed.
- The controlled first-failure run characterizes current fail-closed behavior, but #92's deletion-only scope adds no durable regression test for empty-ledger handling or the no-seeded-account review invariant. The retained automatic evidence covers successful fresh/repeat initialization, readiness, and initialized-database recovery; this evidence boundary is explicit.
