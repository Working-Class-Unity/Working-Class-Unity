# CI-R08F process-only consolidation evidence

**Status:** implementation evidence record; live PR, hosted-check, merge, and post-merge evidence is recorded on [#77](https://github.com/smallwiselabs/swl-step-by-step/issues/77) as observed

**Issue:** [#77](https://github.com/smallwiselabs/swl-step-by-step/issues/77)

**Owner approval:** `APPROVE-CI-R08-IMPLEMENTATION-V2`, supplied 2026-07-12

**Base:** `17d4301e13ad82cb8e6973d177389d36562a8d9d` (CI-R08E merge commit, PR #109)

## Outcome

CI-R08F leaves one plain sequential Node process smoke for failures that focused Vitest, Playwright, and the real container do not establish. The public `test:runtime:ci` package command, hosted workflow job, and check name do not change.

The retained order is intentionally stateful and fail-fast:

1. build the production application once under poisoned legacy and canonical private/database values;
2. drain and inspect complete build output, recursively scan generated artifacts, and require both build-only SQLite main/WAL/SHM families to remain absent;
3. run one real migration as setup and require the exact disposable runtime database;
4. reject one missing-core configuration before TCP bind;
5. reject one enabled Better Auth telemetry escape before TCP bind or sink contact, then close the sink and recheck its final request count;
6. start one valid packaged Nitro server;
7. prove exact live `204`, build-token readiness `401`, and runtime-token readiness `200`;
8. prove the encoded hostile project command receives the exact composed origin/security response and writes no project;
9. run the unchanged 10-GET deployment CLI under a held SQLite `data_version` observer and local-object fingerprint;
10. make the database unavailable, require runtime-token readiness `503`, and require liveness to remain `204`; and
11. stop and drain all children, scan final server output, close any failure-path sink still open, and remove the disposable sandbox.

Thirty-one other packaged startup cases are deleted rather than moved. Their configuration semantics remain with focused `server-foundation.test.ts` and `module-states.test.ts`. Final review found nine exact semantics that neighboring focused errors could previously mask, so the existing `server-foundation.test.ts` case now requires the target key for missing/malformed Google configuration, missing readiness, legacy aliases, and the padded unsafe default. CI-R08F retains only the two process failures that focused in-process tests cannot prove: the packaged server exits before listening for missing core database configuration, and the installed server rejects an enabled telemetry endpoint without contacting it.

No dependency, lockfile, workflow, package command, application behavior, provider behavior, schema, migration behavior, source/config-text assertion, executable inventory, scenario registry, reporter, DSL, or new helper file is added. The existing focused suite gains grouped exact behavior assertions, and one behavior assertion is added to the existing cleanup path so a silently retained runtime sandbox fails the command.

## Primary ownership after consolidation

| Guarantee                                           | Primary semantic owner                                                                        | Distinct process evidence retained here                                                                                            |
| --------------------------------------------------- | --------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Complete runtime/configuration matrix               | focused `server-foundation.test.ts`, `module-states.test.ts`, and evaluated Nuxt-config tests | missing database and enabled telemetry escape each exit nonzero before an observed TCP bind; telemetry sink receives zero requests |
| Public/private rendered runtime configuration       | existing Playwright production journey                                                        | build stdout/stderr, generated-artifact, and build-database sentinels only                                                         |
| Health response/auth/redaction semantics            | `health-boundaries.test.ts`                                                                   | packaged build-token/runtime-token precedence plus live/ready dependency-loss transition                                           |
| Cross-origin policy matrix                          | focused H3 origin tests                                                                       | one encoded packaged project command for decoded path, middleware registration, exact composed headers, and no write               |
| Deployment endpoint semantics                       | focused route/PWA/module tests and the deployment CLI itself                                  | actual CLI child exit propagation plus same-connection SQLite and object-directory no-write observation                            |
| Container image, volume, restart, and Docker health | real container build/health worker                                                            | none; the process smoke does not duplicate container ownership                                                                     |
| Process and disposable-state cleanup                | existing managed-process helper tests plus this actual runner's success/failure paths         | every controlled fault stopped children; the retained sandbox-existence assertion catches omitted removal                          |

Historical config variants deleted from the process runner include missing auth URL/secret/readiness/app/email/Google values; strict module flags and incomplete modules; relative database and legacy/Nitro/object/public-state aliases; unsafe/padded secrets and origins; misaligned public/Sentry strings; and disabled-capture policy. None is retired: focused tests remain the primary evidence.

## Plain Node versus `node:test`

The approved comparison selects the plain sequential runner.

| Concern                | Plain sequential Node                                                                                | Built-in `node:test`                                                                                                                                | Decision                                    |
| ---------------------- | ---------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| Dependent phases       | ordinary `await` stops on the first thrown phase error                                               | awaited subtests record failure through the harness; preserving strict dependent fail-fast flow would need one large test body or app-owned control | plain Node is clearer                       |
| Cleanup                | existing coordinator aggregates operation/cleanup failures and owns sink, process trees, and sandbox | hooks run after failures but do not stop descendants, drain stdio, redact output, close the sink, or remove state                                   | `node:test` removes no cleanup concept      |
| Deadlines/cancellation | existing overall, process, HTTP, and close deadlines remain explicit                                 | a test timeout is not a replacement for cooperative cancellation or process-tree termination                                                        | retain explicit deadlines                   |
| Diagnostics            | domain labels plus bounded cross-chunk secret detection and redacted child output                    | the default reporter is not a secret boundary and its text is not a stable contract; a custom reporter is prohibited                                | retain bounded app-owned diagnostics        |
| Lifecycle              | one process and one existing cleanup coordinator                                                     | adoption adds test lifecycle, hook, reporting, and optional file-isolation semantics without replacing an owned process observer                    | do not add a lifecycle that removes nothing |

Node 24 documents subtest completion, cleanup hooks, timeout limitations, isolation, and reporter stability in the current supported-line [`node:test` guide](https://github.com/nodejs/node/blob/v24.18.0/doc/api/test.md#L95-L126), [subtest API](https://github.com/nodejs/node/blob/v24.18.0/doc/api/test.md#L1817-L1890), [cleanup hooks](https://github.com/nodejs/node/blob/v24.18.0/doc/api/test.md#L2003-L2034), [isolation model](https://github.com/nodejs/node/blob/v24.18.0/doc/api/test.md#L721-L763), and [reporter contract](https://github.com/nodejs/node/blob/v24.18.0/doc/api/test.md#L1291-L1336). The repository supports the Node 24 major line rather than pinning one patch; these sources characterize the current supported line, not an added package.

The existing local `runPhase` helper remains because its three child commands need the same overall-deadline accounting, process-group cleanup, nonzero-exit propagation, stdio-close boundary, and post-failure secret scan. Inlining that error/finally sequence three times would duplicate subtle lifecycle code without removing an external dependency or runner concept. It is not a scenario engine: it has no registry, branching policy, reporter, or assertion DSL.

## Reversible differential faults

Every temporary fault was restored. Except for the deliberate cleanup-removal fault, each failure left no matching sandbox or packaged server process. The one deliberately retained sandbox was identified and removed after the failure was observed.

| Temporary fault                                                           | Observed retained-owner failure                                                                                                                                       |
| ------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| pass the valid runtime environment to the missing-database rejection      | `Built server bound TCP before rejecting missing database configuration`                                                                                              |
| remove the telemetry variables from the production forbidden-key policy   | `Built server bound TCP before rejecting Better Auth telemetry environment escape`; the sink and child were still cleaned                                             |
| serialize the canonical build auth canary into public Nuxt runtime config | recursive artifact scan rejected `Production output retained private build canary` in the packaged Nitro output                                                       |
| write the canonical build-only database from Nuxt configuration           | exact main/WAL/SHM sentinel rejected `Build-only database sentinel was touched during production build`                                                               |
| emit the canonical build auth canary to build stdout                      | complete-output monitor rejected `production build contained forbidden output classes: canonical build auth canary`; diagnostics replaced the value with `[redacted]` |
| use the build readiness token as the valid server's runtime token         | packaged health boundary rejected `Build-token readiness expected 401, received 200`                                                                                  |
| bypass the real SQLite readiness probe                                    | dependency transition rejected `Unavailable runtime database readiness expected 503, received 200`                                                                    |
| bypass the installed cross-origin middleware                              | encoded canary rejected `expected command-origin 403, received 401` before a project write                                                                            |
| force the actual deployment CLI to exit `7` after its checks              | parent process reported `deployment smoke failed with exit 7` while closing its state observer                                                                        |
| omit runtime-sandbox removal                                              | cleanup failed with `Disposable runtime sandbox remains after cleanup`                                                                                                |
| remove the required readiness-token check                                 | focused Vitest rejected the missing exact `NUXT_READINESS_TOKEN` issue                                                                                                |
| default an absent Google enabled flag to disabled                         | focused Vitest rejected the missing exact `NUXT_SOCIAL_PROVIDERS_GOOGLE_ENABLED` issue                                                                                |
| accept uppercase Google enablement through resolution and validation      | focused Vitest rejected the missing exact `NUXT_SOCIAL_PROVIDERS_GOOGLE_ENABLED` issue                                                                                |
| remove the enabled-Google client-ID requirement                           | focused Vitest rejected the missing exact `NUXT_SOCIAL_PROVIDERS_GOOGLE_CLIENT_ID` issue                                                                              |
| remove the enabled-Google client-secret requirement                       | focused Vitest rejected the missing exact `NUXT_SOCIAL_PROVIDERS_GOOGLE_CLIENT_SECRET` issue                                                                          |
| stop trimming before the unsafe-default auth-secret comparison            | focused Vitest rejected the missing exact `NUXT_BETTER_AUTH_SECRET` issue for the padded package default                                                              |
| adopt legacy database/auth/app variables as canonical fallbacks           | focused Vitest rejected the missing exact canonical core issues                                                                                                       |
| issue a telemetry request after the former early-count boundary           | post-close observation rejected `rejected Better Auth telemetry overrides made 1 request(s)`                                                                          |
| expire the overall operation deadline immediately before sink shutdown    | the sink still closed; the command advanced to the expected `runtime liveness` deadline failure, and cleanup left no process or sandbox                               |

## Measured change

| Measurement                                                                     |      CI-R08E base | Local CI-R08F |                     Delta |
| ------------------------------------------------------------------------------- | ----------------: | ------------: | ------------------------: |
| `ci-runtime-smoke.mjs` physical/nonblank lines                                  |         900 / 840 |     694 / 638 |               -206 / -202 |
| named functions                                                                 |                33 |            28 |                        -5 |
| startup scenario registries                                                     | 1 with 33 entries |             0 | -1 registry / -33 entries |
| packaged startup rejections                                                     |                33 |             2 |                       -31 |
| managed child roots                                                             |                37 |             6 |                       -31 |
| output-monitor instances per successful command                                 |                35 |             4 |                       -31 |
| production builds                                                               |                 1 |             1 |                         0 |
| migrations                                                                      |                 1 |             1 |                         0 |
| valid packaged servers                                                          |                 1 |             1 |                         0 |
| telemetry HTTP listeners                                                        |                 1 |             1 |                         0 |
| transient port-reservation listeners                                            |                 1 |             1 |                         0 |
| deterministic HTTP actions after liveness polling                               |                17 |            16 |                        -1 |
| dependency, lockfile, workflow, package-command, product/schema/migration delta |                 0 |             0 |                         0 |

Across CI-R08A–F, the runtime runner falls from 2,466/2,315 to 694/638 physical/nonblank lines (`-1,772/-1,677`) and from 44 to 6 managed child roots. Across the complete 13-file non-documentation executable surface changed by A–F, the total falls from 6,967/6,424 to 6,401/5,854 physical/nonblank lines (`-566/-570`): the reduction includes retained application, focused Vitest, Playwright, browser-runner, and process-runner behavior rather than hiding those additions.

That reproducible 13-file set is `auth-client.ts`, `auth.vue`, `billing.vue`, `billing-webhook-http.test.ts`, `nuxt-build-policy.test.ts`, `organization-provisioning.test.ts`, `passwordless-auth-http.test.ts`, `project-organization-migration.test.ts`, `server-foundation.test.ts`, `worker-entry.test.ts`, `ci-browser-smoke.mjs`, `ci-runtime-smoke.mjs`, and `foundation.pw.mjs`, measured at V2 implementation base `6416fde1e3286557fbf7e179783c34d598385cf2` and the final working tree. Added files count as zero at base; Markdown and pure documentation/configuration files are excluded.

One equal-worktree CI-R08E baseline command completed in 32.44 seconds. Three restored CI-R08F commands after the final review corrections completed in 19.30, 16.76, and 16.63 seconds: median 16.76, 2.67-second range, and no retry. That is a 48.3% lower local median than the single equal-worktree base sample; one base sample is not presented as a stable long-term speedup.

The 694-line result crosses the owner's planning checkpoint but adds no new component. The `node:test` comparison above and the approved V2 [official-tool and maintained-alternative analysis](./research-ci-r08.md#official-and-resolved-version-basis) explain why `node:test`, Playwright `webServer`, and Nuxt test utilities cannot replace the remaining negative build, pre-listen, sink, state-observer, and process-cleanup guarantees. Compressing or moving the code would make those boundaries less clear. Future simplification should target a named retained guarantee, not the line number alone.

## Local evidence and pending gates

| Selection or command                                                        | Current observed result                                                                                                                                                                                                                                                                                                        |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| restored `test:runtime:ci`                                                  | three final runs passed with two pre-listen rejections, build-token `401`, runtime-token `200`, dependency-loss `503` plus live `204`, encoded no-write canary, and 10 deployment checks; median 16.76s, 2.67s range, no retry                                                                                                 |
| differential faults                                                         | all 19 produced their recorded expected failure or cleanup outcome and were restored                                                                                                                                                                                                                                           |
| cleanup inspection                                                          | controlled failures left no runtime process/sandbox except the deliberate omitted-removal fault; that one was removed after observation                                                                                                                                                                                        |
| `ci:fast`, `verify`, browser, container, isolated integration, supply-chain | passed on the final diff; Fast ran 92 orchestration tests and 201 app tests, Full ran 201 coverage tests plus the production build, browser and 12-check integration passed, the real container proved build/persistence/maintenance/health, and live supply-chain scans verified 1,295 packages and three reviewed advisories |
| independent final review                                                    | three final implementation, security/cleanup, and official-documentation reviews reported no blocker after their findings were corrected                                                                                                                                                                                       |
| hosted PR and post-merge checks                                             | recorded on #77 after observation; no result is forecast in this implementation record                                                                                                                                                                                                                                         |

## Rollback and residual risk

One ordinary revert restores the 31 duplicate packaged startup cases and prior helper arrangement. No schema, provider, dependency, deployment, generated-data, or product rollback is required.

Residual risk remains bounded:

- the two packaged rejections sample installed pre-listen behavior; focused tests own all other configuration variants;
- TCP polling cannot mathematically exclude a bind shorter than the observation interval;
- absent SQLite sentinel files prove only that those fresh paths were not created, not that an existing file was never opened read-only;
- the encoded project request samples packaged middleware/decoding/header composition; focused H3 tests own the full origin matrix;
- `data_version` detects commits through another connection while the held observer remains open; it does not detect reads, rolled-back writes, or arbitrary filesystem metadata operations;
- actual-runner `SIGINT`/`SIGTERM` cleanup remains explicitly unclaimed; ordinary success/failure cleanup and generic helper mechanics remain tested; and
- Node reporter/harness behavior is intentionally absent, so phase naming and sanitized diagnostics remain this script's small app-owned responsibility.

No guarantee is retired.
