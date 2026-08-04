# CI-S04 Doctor and duplicate-entrypoint implementation

## Outcome

CI-S04/#73 reduces Doctor from an exhaustive repository/source inventory to one effective security behavior: representative private local artifacts must be ignored by the repository `.gitignore`. It removes the second in-process CI-contract evaluation, toolchain re-evaluation, 150-file inventory, package/dependency/environment/documentation/test-title assertions, exact `.gitignore` line inventory, and raw source walk.

The one genuine application import boundary moves to the pinned ESLint engine. Static imports and re-exports of `@aws-sdk/client-s3` outside the object-storage adapter use core `no-restricted-imports`; precise core `no-restricted-syntax` selectors cover literal CommonJS and dynamic imports. The absent `gateway.ai.cloudflare.com` substring check is retired because it did not validate the configured AI gateway or any executable boundary.

The dedicated Better Auth compatibility command is also removed. The test remains unchanged and is discovered once by the complete ordinary Vitest suite in Fast and once by the complete instrumented Vitest suite in Full.

| Surface                                             | Base physical/nonblank | Head physical/nonblank |      Change |
| --------------------------------------------------- | ---------------------: | ---------------------: | ----------: |
| Doctor                                              |              599 / 546 |                45 / 37 | -554 / -509 |
| CI contract plus tests                              |          3,523 / 3,326 |          3,468 / 3,275 |   -55 / -51 |
| All custom verification scripts/tests               |        15,149 / 13,807 |        14,540 / 13,247 | -609 / -560 |
| ESLint configuration                                |                  3 / 2 |                34 / 32 |   +31 / +30 |
| Combined changed verification/configuration surface |        15,152 / 13,809 |        14,574 / 13,279 | -578 / -530 |

No dependency, lockfile, workflow, application runtime, provider behavior, database schema, or migration changes.

## Official basis

- Git documents [`check-ignore --stdin`](https://git-scm.com/docs/git-check-ignore), verbose source reporting, index-aware behavior, and ignored/non-ignored exit status. Doctor validates effective repository behavior rather than freezing `.gitignore` text.
- Pinned ESLint `10.3.0` documents that [`no-restricted-imports`](https://github.com/eslint/eslint/blob/v10.3.0/docs/src/rules/no-restricted-imports.md) covers static imports and re-exports but deliberately excludes dynamic imports.
- Pinned ESLint `10.3.0` documents precise ESTree selectors through [`no-restricted-syntax`](https://github.com/eslint/eslint/blob/v10.3.0/docs/src/rules/no-restricted-syntax.md), which owns the literal `ImportExpression` boundary.
- Nuxt ESLint documents appending project flat-config objects with [`withNuxt(...)`](https://eslint.nuxt.com/packages/module).
- Vitest's ordinary `vitest run` discovery and the repository's native coverage configuration both include the compatibility test under the standard test glob; no frozen filename inventory is added.

## Preserved guarantees and primary evidence

| Guarantee                                                                                                           | One primary evidence owner                                                              | Representative distinct failure                                                                                                 |
| ------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Private `.env`, SQLite, log, and filled production-evidence paths remain untracked and resist ordinary Git addition | Narrow Doctor using `git check-ignore --verbose --stdin`                                | Removing the root `*.db-shm` rule or force-tracking a representative path makes Doctor fail                                     |
| Node 24/pnpm 11.1.2 declarations agree across executable files                                                      | Existing `toolchain-contract.test.mjs` plus the portable runner                         | Existing adjacent-Node and non-exact-pnpm fixtures fail                                                                         |
| Workflow/gate entrypoints remain reachable                                                                          | Existing parsed CI-contract tests and actual workflow workers                           | Existing missing/reordered gate mutations fail                                                                                  |
| AWS SDK access remains behind the object-storage adapter                                                            | Pinned ESLint static, CommonJS, and dynamic-import rules                                | Temporary static re-export, literal `require()`, and literal dynamic-import canaries fail; the adapter and non-import text pass |
| Better Auth compatibility still runs in both required application suites                                            | The unchanged compatibility behavior test discovered by ordinary/native-coverage Vitest | Its actual adapter initialization and unsafe-protocol rejection assertions remain primary; no command-string mirror remains     |
| Changed files retain pinned formatting                                                                              | Existing formatter command and focused formatter tests                                  | Existing malformed/range-resolution fixtures fail closed                                                                        |

## Explicit retirements

- required-file inventories, unused-path preservation, root-directory shape, and exact browser-test file counts;
- package-script and dependency presence inventories not tied to a direct caller;
- environment-template field/default inventories;
- README, documentation, source-fragment, and test-title presence checks;
- local SQLite CLI warnings and alternate-lockfile bookkeeping;
- exact `.gitignore` lines beyond the retained private-artifact outcomes;
- Doctor's duplicate toolchain and whole CI-contract execution;
- the dedicated Better Auth test alias and its exact command/order/reachability assertions;
- the raw Cloudflare-hostname substring check;
- raw string/comment matches for the AWS SDK. ESLint now rejects executable imports without rejecting documentation text.

Inactive support files and development templates may now drift without a CI failure until an executable consumer uses them. That is intentional: direct build, lint, typecheck, migration, workflow, supply-chain, and behavioral tests own consequential requirements.

## Runtime and commands

The old Doctor's warm direct runtime was 0.10-0.11 seconds. In the paired base Fast run, the duplicate Better Auth Vitest process itself reported 0.913 seconds before process-launch overhead. The narrow Doctor remains in each gate; the separate auth process and duplicate Doctor source-graph/toolchain work are gone.

One same-workstation, warm-dependency Fast comparison used the exact base tree and head under Node 24:

| Command                       |   Base |   Head |                           Observed change |
| ----------------------------- | -----: | -----: | ----------------------------------------: |
| `npm run pnpm -- run ci:fast` | 61.13s | 51.43s |                           -9.70s (-15.9%) |
| `npm run verify:pinned`       |      — | 66.81s | head passed coverage and production build |

The Fast pair is one observation, not a durable benchmark: migration, framework-process, analyzer, and test timings varied within the runs, so the full 9.70-second difference is not attributed solely to this patch. The deterministic critical-path reduction is one complete focused Vitest launch plus Doctor's duplicate source-graph and toolchain evaluations. GitHub worker timing is recorded in the pull request after hosted checks complete.

Focused evidence:

```text
pnpm run doctor
pnpm run check:toolchain
pnpm run check:ci
pnpm run lint
pnpm --filter @smallwiselabs/web exec vitest run tests/auth-compatibility.test.ts
```

Frozen gates:

```text
npm run pnpm -- run ci:fast
npm run verify:pinned
```

## Residual risk and rollback

- `git add -f` can deliberately track a private path outside Doctor's representative set; review and secret scanning remain necessary.
- Computed import or `require()` module names cannot be resolved by static lint.
- Test-file deletion is not protected by a filename inventory. Like every behavioral test, the compatibility suite relies on review and native test discovery rather than a second source-text assertion.
- Environment examples and inactive support files no longer have exhaustive presence checks; actual startup/runtime/build callers remain fail-closed.

Reverting the CI-S04 merge restores the former Doctor and focused alias. There is no data migration, generated state, provider configuration, dependency, or lockfile change.
