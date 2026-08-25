# CI-S02B runtime and integration mirror removal

## Outcome

CI-S02B/#70 removes the broad CI contract's raw reads and literal assertions for runtime configuration, startup validation, liveness/readiness, the standalone worker, the built-runtime runner, credential-free deployment smoke, and isolated mutating integration. Matching source mutations and test-title assertions are deleted instead of being rewritten elsewhere.

The executable runners remain unchanged: focused Vitest/Node tests exercise ordinary policy and failure behavior, the framework command starts a disposable real Nuxt fixture, the integration command builds and migrates a loopback-only disposable application, and the built-runtime command exercises production-build/Nitro behavior. One 60-line focused Vitest file replaces three meaningful configuration-string checks by parsing the real `.env.build` and evaluating the exported Nuxt configuration. Exact package pins and workflow entrypoints remain structured policy. This tranche changes neither application behavior nor runner orchestration.

`INT-01D` is the sole retired guarantee in this tranche. The owner explicitly decided not to add a fixture that interrupts the actual runtime or integration runner. Ordinary success and injected-failure cleanup remain required, the implementation retains best-effort catchable-signal handlers, and generic cleanup-coordinator tests still exercise handler mechanics. Those helper tests are not presented as actual-runner interruption evidence.

## Baseline and reduction

The base is `master` commit `63d18de2d7022709ad121e40f2aa9994c8afc7d4`.

| Surface                                         | Base physical/nonblank | Head physical/nonblank |          Change |
| ----------------------------------------------- | ---------------------: | ---------------------: | --------------: |
| CI contract plus tests                          |          2,917 / 2,740 |          1,714 / 1,572 | -1,203 / -1,168 |
| All custom verification scripts/tests           |        13,989 / 12,712 |        12,786 / 11,544 | -1,203 / -1,168 |
| Focused Nuxt build-policy test                  |                  0 / 0 |                60 / 54 |       +60 / +54 |
| Net touched verification code                   |          2,917 / 2,740 |          1,774 / 1,626 | -1,143 / -1,114 |
| Raw `readFileSync(` calls in the contract       |                     44 |                     23 |             -21 |
| Textual `.replace(` mutations in contract tests |                    163 |                     56 |            -107 |

The implementation commit is `3fa6b55dc129102fe1045e127d19223aa4f233f6` in [pull request #98](https://github.com/smallwiselabs/swl-step-by-step/pull/98). Runner files, workflows, manifests, dependencies, lockfiles, schemas, migrations, and provider code remain byte-identical.

## Official basis

- [Nuxt 4.4.8 runtime config](https://nuxt.com/docs/4.x/guide/going-further/runtime-config) documents the private/public boundary, matching `NUXT_` runtime overrides, and why differently named environment defaults become build-time-only. A production build/start probe—not an implementation string—owns the distinct post-build behavior.
- [Nuxt 4.4.8 server middleware and plugins](https://nuxt.com/docs/4.x/directory-structure/server) documents auto-registration, middleware execution before routes, and Nitro plugin registration. The built runner retains whole-server composition evidence because an ordinary imported helper test cannot establish the installed routing, middleware, and process-listen outcome.
- Vitest `4.1.6` documents ordinary [`vitest run`](https://github.com/vitest-dev/vitest/blob/v4.1.6/docs/guide/index.md) discovery and execution. Focused suites call the real runtime, readiness, module, auth, and workspace policies rather than proving their filenames or test titles.
- Node 24's [`util.parseEnv`](https://nodejs.org/docs/latest-v24.x/api/util.html#utilparseenvcontent) parses the committed dotenv file into structured key/value data. The focused test requires the result to remain empty instead of searching for particular variable names.
- The pinned `@sentry/nuxt` `10.53.1` [Vite source-map implementation](https://github.com/getsentry/sentry-javascript/blob/10.53.1/packages/nuxt/src/vite/sourceMaps.ts) makes `sourcemaps.disable` the switch for creating the Sentry build plugins. The evaluated-config test protects the app's necessary local upload gate; it does not claim a successful hosted upload, which remains R-028 staging evidence.
- The pinned Better Auth `1.6.23` [Organization documentation](https://github.com/better-auth/better-auth/blob/v1.6.23/docs/content/docs/plugins/organization.mdx) defines the server API used by the focused Organization behavior. Literal scenario names in a runner are not evidence of that behavior.
- Node 24 documents [`mkdtempSync`](https://nodejs.org/docs/latest-v24.x/api/fs.html#fsmkdtempsyncprefix-options), recursive [`rmSync`](https://nodejs.org/docs/latest-v24.x/api/fs.html#fsrmsyncpath-options), and [signal events](https://nodejs.org/docs/latest-v24.x/api/process.html#signal-events). Installing `SIGINT`/`SIGTERM` listeners changes Node's default exit behavior, while `SIGKILL` cannot be handled. These are mechanics and limitations; they do not prove that this repository's actual runner cleans up when interrupted.
- SQLite documents that [`PRAGMA data_version`](https://www.sqlite.org/pragma.html#pragma_data_version) must be compared on the same connection and changes for commits by other connections. The retained built-runtime observer uses that executable boundary around deployment smoke.
- Stripe's [webhook-signature documentation](https://docs.stripe.com/webhooks/signature) defines signature verification over the raw body. The local signed fixture remains deterministic behavior evidence, not hosted Stripe certification.
- Nuxt's official [redirect-encoding advisory fixed in `4.4.6`](https://github.com/nuxt/nuxt/security/advisories/GHSA-fx6j-w5w5-h468) and [`4.4.7`](https://github.com/nuxt/nuxt/releases/tag/v4.4.7) release notes are the upstream basis for the route-rule, NuxtLink, redirect, and path-normalization regressions in the pinned fixture; [`4.4.8`](https://github.com/nuxt/nuxt/releases/tag/v4.4.8) records the later macOS socket fix. The executable fixture, not its placement or helper names, owns `FW-01`.

## Primary executable owners

| Guarantee/failure mode               | Primary executable owner                                                                                             | Distinct failure retained                                                                                                                                                                                |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `RT-01A` build secrecy               | Parsed `.env.build` policy plus poisoned production build and artifact/log scans in `ci-runtime-smoke.mjs`           | A committed build assignment is accepted, or a build-time canary/secret reaches `.output`, captured process output, or retained state.                                                                   |
| Build-tool configuration             | `nuxt-build-policy.test.ts` evaluates the exported Nuxt config under four build-environment combinations             | Nitro environment expansion is enabled, or Sentry upload is enabled without both the exact Observability flag and an auth token.                                                                         |
| `RT-01B` pre-listen rejection        | Focused runtime-policy tests for parsing; built runner for the production process/listen boundary                    | An invalid production configuration binds TCP or contacts the bounded telemetry sink before rejection. Ordinary imports cannot prove the installed server's externally observable listen behavior.       |
| `RT-01C` runtime override            | Built-server probes using deliberately different build and runtime sentinels                                         | Compiled Nitro uses a build fallback, ignores the approved runtime value, or exposes a private value through a response/log.                                                                             |
| `RT-02A` liveness                    | `health-boundaries.test.ts` for policy plus the built `/api/live` probe                                              | Auto-registered production routing/middleware changes the exact public, bodyless, dependency-independent response.                                                                                       |
| `RT-02B` readiness                   | `health-boundaries.test.ts` plus built authenticated `200`/`401`/`503` probes                                        | Production composition leaks details, accepts the wrong credential, or reports ready while the disposable dependency fails.                                                                              |
| `RT-02C` module/provider transitions | Focused module-state/service tests plus selected built worker/middleware probes                                      | The production build serializes stale state, calls a disabled provider, misorders auto-discovered middleware, or runs a disabled/ready worker differently from focused policy.                           |
| `AUTH-01` / `WS-01` runner mirrors   | Focused auth, Organization, workspace, and invitation suites; only production-composition journeys remain built      | A Better Auth production plugin, real migrated SQLite trigger, or returning-sign-in integration differs from separately composed focused behavior. Scenario labels and fixture counts are not authority. |
| `MOD-01` / `ORG-01` runner mirrors   | `module-states.test.ts`, `cross-origin-policy.test.ts`, and the distinct installed-Nitro probes recorded by CI-S02A2 | Built route decoding, middleware auto-registration, real signed-webhook exemption, or no-write rejection fails while imported policy tests remain green.                                                 |
| `INT-01A` isolation                  | `isolated-api-smoke.test.mjs` and `isolated-smoke-policy.mjs`                                                        | A non-loopback target, ambient provider credential, or non-disposable path is accepted before state creation.                                                                                            |
| `INT-01B` fixture journey            | The actual `isolated-api-smoke.mjs` + `api-smoke.mjs` command                                                        | Production build/migration or a local Files/Search/signed-webhook mutation is skipped or produces the wrong persisted fixture outcome.                                                                   |
| `INT-01C` ordinary cleanup/redaction | Isolation failure tests, actual successful runner cleanup, and output assertions                                     | Ordinary success or injected failure leaves owned state, or diagnostics reveal a secret/error value.                                                                                                     |
| `DEP-01` read-only deployment smoke  | `deployment-smoke.test.mjs` plus the actual runtime observer/fingerprint                                             | A shipped probe uses a mutating/credentialed method, ignores module state, changes SQLite through another connection, or changes local provider state.                                                   |
| `FW-01` pinned framework behavior    | `framework-security-smoke.mjs` for resolved-package and rendered-framework behavior; helper tests for the harness    | The resolved packages regress route-rule, unsafe-link, redirect-encoding, or path-normalization behavior; separately, bounded readiness or child cleanup in the repository harness fails.                |

## Deleted mirror families

- canonical runtime-path inventories and literal Nuxt/runtime-validator implementation fragments;
- exact environment-template, build-environment, production-evidence, startup-plugin, readiness-route/policy, liveness-route, standalone-worker, and focused-test strings;
- built-runtime scenario names, helper names, call order, case counts, fixture counts, auth/workspace strings, timeout spellings, and artifact-scan tokens;
- deployment-smoke implementation/method/helper strings and deployment test titles;
- isolated-runner/client/policy function names, sandbox/path expressions, cleanup wiring, fixture-count strings, and isolation test titles;
- matching `.replace()` mutations and error-message assertions in `ci-contract.test.mjs`.

No removed fragment is replaced with a new source-text assertion. The three retained build policies use Node's dotenv parser and the evaluated Nuxt config object. The refreshed manifest found no remaining raw `FW-01` source/test-title mirror to remove; its executable fixture and structured caller wiring stay unchanged. Browser, Docker/container, and migration/maintenance mirrors remain assigned to #90–#92.

## Explicitly retired `INT-01D`

CI no longer claims that sending `SIGINT` or `SIGTERM` to the actual built-runtime or isolated-integration command proves complete child-process and temporary-state cleanup. The old contract checked only that cleanup wiring text existed; generic coordinator tests exercised a helper with a synthetic process target. Neither established the actual-runner outcome.

The accepted risk is that an interrupted CI or local command can leave a temporary directory or child process until operating-system or manual cleanup. The risk does not broaden the runner's authority: it still refuses ambient/remote targets before creating state, and ordinary success/failure cleanup remains behaviorally required. The catchable-signal implementation is retained as best effort but is not a documented merge-gate guarantee. No source assertion or new interruption framework replaces the retired check.

## Runtime, faults, and gates

| Measurement                                               |                                    Base |                                    Head |
| --------------------------------------------------------- | --------------------------------------: | --------------------------------------: |
| Warm `ci-contract.test.mjs` median, five runs             |                                   0.47s |                                   0.24s |
| Equal-worktree focused readiness/runtime-policy selection |              17 Node + 19 Vitest passed |              17 Node + 19 Vitest passed |
| Focused Nuxt build-policy evaluation                      |                                     n/a |                     6/6 passed in 0.23s |
| `test:framework-security`                                 | 5 helper tests + 19 smoke checks passed | 5 helper tests + 19 smoke checks passed |
| `test:runtime:ci`                                         |                                  48.19s |                                  49.08s |
| `test:integration:ci`                                     |                                  22.57s |                                  22.27s |

Representative faults were applied one at a time and restored:

- a real liveness status/body leak failed `health-boundaries.test.ts`; changing only the internal status call while returning `null` left H3's observed `204` unchanged, confirming the deleted literal assertion protected an implementation spelling rather than a distinct response guarantee;
- allowing `POST` in the deployment helper failed its focused unsafe-method case;
- disabling ordinary isolated-runner cleanup failed the injected-failure fixture with the exact leftover sandbox;
- injecting an ordinary failure after the built integration child became live exited nonzero, removed the `swl-isolated-api-smoke-*` sandbox/database/provider tree from a dedicated `TMPDIR`, and left no matching child process;
- adding a committed dotenv assignment failed the structured `parseEnv` result; enabling Nitro environment expansion and unconditionally enabling Sentry upload failed four evaluated-config cases;
- neutralizing the module middleware call failed the built runner when `/api/billing` returned `401` instead of the installed disabled-module `404`;
- neutralizing the startup plugin's direct validation call did not weaken the built runner because another installed composition path still rejected every invalid configuration before listen. The removed exact-call assertion therefore did not represent an independently necessary product behavior.

`INT-01D` receives no interruption fault fixture because it is explicitly retired; its accepted risk is recorded above.

The retained executable matrices already supply representative adversarial cases for the remaining modes: 33 invalid pre-listen configurations; wrong readiness credentials and dependency loss; non-loopback and ambient-provider isolation refusal; disabled and ready worker jobs; and unsafe framework link, redirect, and path payloads.

Final local Node 24 gates:

| Gate                                                                 | Result                                                                                         |
| -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| CI contract                                                          | 25/25 passed                                                                                   |
| Focused deployment/isolation/framework helpers                       | 17/17 passed                                                                                   |
| Focused readiness/module behavior                                    | 19/19 passed                                                                                   |
| Focused Nuxt build policy                                            | 6/6 passed                                                                                     |
| `ci:fast`                                                            | passed in 63.37s; 91 infrastructure tests and 186 application tests                            |
| `verify:pinned`                                                      | passed in about 70s; 91 infrastructure tests, 186 coverage tests, and production build         |
| `test:runtime:ci`                                                    | passed in 49.08s; 33 startup rejections, 20 origin, 10 deployment, and 19 auth/security checks |
| `test:integration:ci`                                                | passed in 22.27s; 12 checks and exact disposable fixture counts                                |
| Three independent code, behavior/security, and documentation reviews | clean after the focused build-policy and active-child-cleanup evidence corrections             |

Hosted implementation-commit evidence:

| Check                                                                                                                              |          Result |
| ---------------------------------------------------------------------------------------------------------------------------------- | --------------: |
| [Fast PR gate](https://github.com/smallwiselabs/swl-step-by-step/actions/runs/29177325001/job/86608664154)                         | passed in 2m43s |
| [Full CI / verify](https://github.com/smallwiselabs/swl-step-by-step/actions/runs/29177324991/job/86608664066)                     | passed in 2m39s |
| [Full CI / built runtime](https://github.com/smallwiselabs/swl-step-by-step/actions/runs/29177324991/job/86608664071)              | passed in 1m44s |
| [Full CI / browser and accessibility](https://github.com/smallwiselabs/swl-step-by-step/actions/runs/29177324991/job/86608664065)  | passed in 1m54s |
| [Full CI / container build and health](https://github.com/smallwiselabs/swl-step-by-step/actions/runs/29177324991/job/86608664072) |  passed in 2m4s |
| [Full CI / isolated integration](https://github.com/smallwiselabs/swl-step-by-step/actions/runs/29177324991/job/86608664070)       |   passed in 53s |
| [Full pre-merge gate](https://github.com/smallwiselabs/swl-step-by-step/actions/runs/29177324991/job/86608833028)                  |    passed in 3s |

Final-head and post-merge `master` results plus the merge commit belong in the pull-request/issue comments and final program report because they cannot be committed by the commit they verify.

## Retained duplication and #77

This deletion tranche deliberately leaves `ci-runtime-smoke.mjs` and the other executable runners structurally unchanged. Some built scenarios may overlap focused tests, but deciding which can move or disappear requires the separately approved CI-R08/#77 research: scenario-by-scenario failure mapping, runtime/LOC evidence, and a second implementation approval. #70 neither decomposes the runner nor claims that its current scenario set is minimal.

The materially distinct production-build/Nitro failures above explain why the built runner remains. #77 may later recommend a smaller design; any rewrite or new handwritten infrastructure approaching 500 lines requires the owner's separate approval.

## Rollback and residual risk

Reverting the CI-S02B merge restores the literal mirrors and mutation fixtures. It requires no database, provider, dependency, or generated-artifact rollback.

After this change, renaming or refactoring runtime, readiness, worker, deployment, or integration internals will not fail merely because an old string disappeared. That is intentional. A behavioral regression must be caught by its focused or executable owner, so review must notice an entirely new untested boundary. Browser/container/migration source mirrors remain brittle until #90–#92, and runtime scenario duplication remains until the approval-gated #77 research. Actual-runner interruption cleanup is an explicitly accepted residual risk, not missing acceptance evidence.
