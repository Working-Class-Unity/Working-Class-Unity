# CI-R08D worker-entry implementation evidence

**Status:** local implementation, differential fault proof, frozen gates, and independent review complete; publication and hosted evidence pending

**Issue:** [#77](https://github.com/smallwiselabs/swl-step-by-step/issues/77)

**Owner approval:** `APPROVE-CI-R08-IMPLEMENTATION-V2`, supplied 2026-07-12

**Base:** `62e03c0a8e49a5ff1750548f140c83b49b166185` (CI-R08C merge commit, PR #107)

## Outcome

The standalone worker command and its two current cleanup mappings now have one focused behavioral owner. `worker-entry.test.ts` contains three cases and uses ordinary Vitest, Node, Drizzle, `better-sqlite3`, the public pinned TSX CLI, and the real `server/worker.ts` entry. It adds no worker DSL, reusable process wrapper, generic fixture, checker, reporter, or lifecycle framework.

The Jobs-disabled case invokes Node with the package-export-resolved `tsx/cli` and the actual worker entry through shell-free `execFile`. It supplies explicit `NODE_ENV=production` and `CI=true`, removes ambient Vitest `TEST`, and otherwise scrubs conflicting runtime keys, matching the deleted runtime children's production configuration branch rather than inheriting the test process. It points the database beneath a dedicated nonexistent directory and requires exact clean output, empty standard error, and no creation of that directory. This detects a broken standalone TSX command, a configuration-resolution failure, or database initialization before the disabled boundary.

The two Jobs-ready cases use the same explicit production-mode environment, apply the packaged migrations to temporary SQLite databases, reset Vitest's evaluated-module cache, and await an import of the real worker entry. The cache case queues `cache.cleanup`, proves the expired row is removed while the unexpired row remains, and requires one successful attempt with no error or retained lock. The Files case enables the local driver, places a real orphan object on disk, queues `files.cleanup-orphans`, and requires deletion plus the same exact queue completion state.

The three corresponding TSX children and runner-only database/job fixture assertions are deleted from `ci-runtime-smoke.mjs`. The built-runtime runner still owns its distinct production-build and process guarantees: 33 pre-listen rejections, public liveness, protected `200`/`401`/`503` readiness, one encoded origin canary, 10 deployment checks, and the existing build/output/database/telemetry/runtime-precedence/no-write/cleanup observations.

The migrations in the focused suite are test setup only. CI-R08D does not claim migration recovery, fresh-initialization atomicity, or container persistence evidence and does not change Drizzle, migration SQL, schema, product behavior, worker behavior, package commands, dependencies, or workflows.

## Evidence ownership transition

| Guarantee                                                               | Primary owner after CI-R08D                                                                                                            | Wider owner retained                                                       | Deleted duplicate                                                                   |
| ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Jobs-disabled standalone entry exits before database initialization     | `worker-entry.test.ts`: one real public pinned-TSX CLI process, exact output, empty standard error, and no database-directory creation | `module-states.test.ts` retains the wider disabled/incomplete/ready matrix | Jobs-disabled TSX child and its database-family assertion in `ci-runtime-smoke.mjs` |
| `cache.cleanup` is present at the real entry and completes exactly once | `worker-entry.test.ts`: awaited real-entry import, actual migrations, temporary SQLite, expired/fresh rows, and released queue lock    | existing queue/service tests retain general claiming, lease, and retry     | cache TSX child plus runtime job-enqueue/result helpers                             |
| `files.cleanup-orphans` is present at the real entry and completes once | `worker-entry.test.ts`: awaited real-entry import, actual local object, temporary SQLite, object removal, and released queue lock      | account-deletion tests retain lifecycle scheduling, service, and recovery  | Files TSX child plus runtime job-enqueue/result helpers                             |

This is one semantic owner per command/mapping guarantee. The real child is retained only for the standalone command/configuration/no-open boundary; the handler cases do not launch another process because their named failures are observable through the actual entry import and real SQLite/filesystem side effects.

## Reversible differential faults

All temporary faults below were removed before the restored results and measurements.

| Temporary fault                                            | Observed owner failure                                                                |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| throw from the real Jobs-disabled branch before its output | only the standalone command case failed; both real-entry mapping cases remained green |
| remove the real `cache.cleanup` entry mapping              | only the cache case failed, and the expired cache row remained                        |
| remove the real `files.cleanup-orphans` entry mapping      | only the Files case failed, and the local orphan object remained                      |

The restored focused suite passed 3/3. These faults exercise the production entry boundary itself; no source-name, import-name, test-title, migration-text, or table-name assertion substitutes for behavior.

## Official pinned basis

- Node 24 documents that [`child_process.execFile`](https://nodejs.org/download/release/latest-v24.x/docs/api/child_process.html#child_processexecfilefile-args-options-callback) starts the executable directly without a shell by default and supports explicit working directory, environment, encoding, timeout, and output bounds. Node also documents promisifying it to receive `stdout` and `stderr`. The suite uses that standard API directly for one bounded process case.
- TSX `4.22.3` documents [`tsx ./file.ts` in package scripts](https://github.com/privatenumber/tsx/blob/v4.22.3/docs/getting-started.md#using-it-in-packagejsonscripts), and its exact [package metadata](https://github.com/privatenumber/tsx/blob/v4.22.3/package.json#L21-L55) maps both the binary and public `tsx/cli` export to `dist/cli.mjs`. The suite resolves the public export through Node package resolution rather than hard-coding a `node_modules` path.
- Vitest `4.1.6` documents that [`vi.resetModules()`](https://github.com/vitest-dev/vitest/blob/v4.1.6/docs/api/vi.md#L380-L414) clears evaluated modules so later dynamic imports reevaluate them, while static imports and mocks have separate behavior. Each case restores stubs/mocks and resets modules independently before the next awaited entry import.
- Drizzle's official [runtime-migration guidance](https://orm.drizzle.team/docs/migrations#option-4) supports applying committed migrations at runtime or as setup. In exact `0.45.2`, the [`better-sqlite3` migrator](https://github.com/drizzle-team/drizzle-orm/blob/0.45.2/drizzle-orm/src/better-sqlite3/migrator.ts#L5-L10) delegates to the synchronous SQLite dialect, whose [migration implementation](https://github.com/drizzle-team/drizzle-orm/blob/0.45.2/drizzle-orm/src/sqlite-core/dialect.ts#L936-L995) creates/reads the ledger and wraps pending statements and ledger inserts in `BEGIN`/`COMMIT` with `ROLLBACK` on error. That source supports fixture setup here; it does not make this suite recovery evidence, and ledger-table creation occurs before the transaction.
- SQLite documents that [foreign-key enforcement is connection-local and disabled by default](https://www.sqlite.org/foreignkeys.html#fk_enable), so setup explicitly enables it. SQLite also documents the [main, `-wal`, and `-shm` files associated with WAL](https://www.sqlite.org/wal.html#the_wal_file) while warning that [temporary-file behavior is not an application contract](https://www.sqlite.org/tempfiles.html). The disabled case therefore observes noncreation of its dedicated parent directory rather than adding another durable sidecar inventory.

## Measured change

| Measurement                                                                   |  Base | Local implementation | Delta |
| ----------------------------------------------------------------------------- | ----: | -------------------: | ----: |
| `ci-runtime-smoke.mjs` physical lines                                         | 1,366 |                1,270 |   -96 |
| `ci-runtime-smoke.mjs` nonblank lines                                         | 1,280 |                1,188 |   -92 |
| focused worker-entry suite physical/nonblank lines                            |     — |            193 / 173 |     — |
| affected executable files physical lines                                      | 1,366 |                1,463 |   +97 |
| affected executable files nonblank lines                                      | 1,280 |                1,361 |   +81 |
| built-runtime managed child processes                                         |    41 |                   38 |    -3 |
| focused cases                                                                 |     0 |                    3 |    +3 |
| worker-entry child processes per ordinary or coverage suite run               |     0 |                    1 |    +1 |
| dependencies, lockfile, workflow, package-command, product, schema, migration |     0 |                    0 |     0 |

The runtime reduction removes the `disabledWorkerDatabasePath` setup, three worker invocations, `assertDatabaseFamilyUntouched`, `enqueueRuntimeWorkerProofJobs`, `enqueueRuntimeWorkerProofJob`, and `assertRuntimeWorkerProofs`. The focused suite uses two in-process migrated databases for its enabled mappings and one child only for the distinct standalone-command boundary. LOC is a measured maintenance signal, not an acceptance ceiling.

## Restored local commands and pending publication evidence

| Command                                                                                                               | Result                                                                                                                                                  |
| --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm exec --yes --package=pnpm@11.1.2 -- pnpm --filter @smallwiselabs/web exec vitest run tests/worker-entry.test.ts` | 3/3 passed after the production-mode parity and cleanup corrections; Vitest duration 1.72 seconds                                                       |
| the same focused command with `tests/account-deletion.test.ts tests/module-states.test.ts`                            | 3 files/25 tests passed; Vitest duration 1.88 seconds                                                                                                   |
| `npm exec --yes --package=pnpm@11.1.2 -- pnpm --filter @smallwiselabs/web test`                                       | 24 files/200 tests passed; Vitest duration 5.54 seconds                                                                                                 |
| `npm run pnpm -- run test:runtime:ci`                                                                                 | restored runner passed 33 pre-listen cases, liveness, `200`/`401`/`503` readiness, one encoded origin canary, and 10 deployment checks in 35.06 seconds |
| `npm run pnpm -- run ci:fast`                                                                                         | 92 infrastructure and 200 application tests passed in 51.69 seconds                                                                                     |
| `npm run verify:pinned`                                                                                               | 24 files/200 coverage tests, native thresholds, and the production Nuxt/Nitro build passed in 73.68 seconds                                             |

Formatting, syntax, and diff checks passed. Independent code and security/recovery reviews each found the initial test-mode environment weaker than the deleted production children; the suite was corrected to use explicit production/CI mode and scrub Vitest's `TEST` key. Security review then requested suite-local cleanup around fixture-construction failure; that correction also passed focused lint/tests. Both reviewers returned unqualified approval on the final diff. Publication and hosted checks remain to be recorded as observed evidence; no hosted result or runtime is forecast in this local record.

## Rollback and residual risk

One ordinary code/documentation revert restores the three runtime TSX children and their runner-only helpers and removes the focused suite. It requires no database, schema, migration, dependency, provider, workflow, deployment, or product action.

Residual risk remains bounded:

- the enabled handler mappings are exercised through Vitest's awaited import of the real production entry, not through two additional operating-system processes;
- the one real TSX process covers standalone package resolution, command execution, configuration, stable disabled output, and the pre-database boundary only;
- the focused migrations create faithful temporary fixtures but do not own migration rollback, retry, recovery, backup, restore, or container persistence;
- the local Files driver proves the entry-to-service mapping and real filesystem effect, not R2 or hosted-provider behavior; and
- wider concurrency, lease expiry, retries, account deletion, and service behavior remain with their existing focused owners rather than being copied into this entry suite.

No guarantee is retired.
