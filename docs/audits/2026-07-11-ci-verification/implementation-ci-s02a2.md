# CI-S02A2 module-state and hostile-origin mirror removal

## Outcome

CI-S02A2/#89 removes the broad CI contract's direct reads and literal assertions for the optional-module manifest, public-state helper, request middleware, request-path helper, app-command origin policy, Sentry module gates, and the focused tests that execute those boundaries. Matching mutation fixtures are removed rather than replaced with another source checker.

The module manifest also carried file, service, dependency, integration, and test-scope inventories that production never read. Those bookkeeping fields and their duplicate expected arrays are removed. Runtime policy remains: seven module identities, flags, provider requirements, health states, exclusive API prefixes, and exact UI routes.

| Surface                                        | Base physical/nonblank | Head physical/nonblank |      Change |
| ---------------------------------------------- | ---------------------: | ---------------------: | ----------: |
| CI contract plus tests                         |          3,249 / 3,063 |          2,917 / 2,740 | -332 / -323 |
| All custom verification scripts/tests          |        14,321 / 13,035 |        13,989 / 12,712 | -332 / -323 |
| Runtime module-policy manifest                 |              313 / 308 |              213 / 208 | -100 / -100 |
| Focused module-state test                      |              620 / 569 |              560 / 512 |   -60 / -57 |
| Focused hostile-origin test                    |              388 / 349 |              390 / 351 |     +2 / +2 |
| Raw `readFileSync` occurrences in the contract |                     55 |                     44 |         -11 |

The base is `master` commit `2af54b6456d43458b5f8a130f1973428eb81acc1`. There is no dependency, lockfile, workflow, provider, schema, migration, runtime-runner, browser-runner, or deployment change.

## Official basis

- [Nuxt 4 server middleware](https://nuxt.com/docs/4.x/directory-structure/server#server-middleware) documents auto-discovery and execution before server routes, but does not promise application middleware filename order. The pinned Nitro `2.13.4` [directory scanner](https://github.com/nitrojs/nitro/blob/039b841669cd0641e54b443cba875b6552b24e05/src/core/scan.ts) explains the current numbered convention. CI therefore protects effective order in the built server instead of freezing filenames in source text.
- Vitest `4.1.6` documents ordinary [`vitest run`](https://github.com/vitest-dev/vitest/blob/v4.1.6/docs/guide/index.md) discovery and execution. The focused suites import and execute the real policy, middleware, provider boundaries, and Sentry configuration.
- The [OWASP CSRF Prevention Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html) supports safe-method separation, Fetch Metadata checks, and Origin/Referer verification. Exact exemptions and the stricter same-origin-only choices remain application policy and are exercised directly.

## Primary behavior by guarantee

| Guarantee                              | One primary behavioral owner by distinct failure mode                                                                                                                                                                                        |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `MOD-01` classification                | `module-states.test.ts` executes disabled-with-stale-config, every required-config omission, invalid/mismatched flags, ready state, and hostile public-state input.                                                                          |
| `MOD-01` service safety                | `module-states.test.ts` calls the real billing, files, AI, Turnstile, Sentry, Search, and Jobs boundaries and proves disabled no-call/no-mutation behavior plus deterministic ready doubles.                                                 |
| `MOD-01` readiness                     | `health-boundaries.test.ts` proves only manifest-defined disabled/ready states are healthy without provider reads.                                                                                                                           |
| `MOD-01` installed production boundary | Built runtime retains public-state serialization, auto-discovered middleware order, decoded-route handling, stable disabled errors, and separate-process worker behavior because ordinary Vitest does not establish those build/Nitro modes. |
| `ORG-01` classification and exemptions | `cross-origin-policy.test.ts` executes safe/unsafe methods, API scope, exact Better Auth/provider/capability exemptions, neighboring paths, and fully/partially encoded routes.                                                              |
| `ORG-01` rejection                     | The same focused suite executes accepted and rejected request-source signals and proves a session-shaped cookie cannot authorize a hostile Origin; rejected responses are redacted, non-cacheable, correctly varied, and stop the handler.   |
| `ORG-01` installed production boundary | Built runtime retains actual Nitro route decoding, middleware auto-registration, project non-mutation, hostile proxy-header resistance, and the real Stripe signature exemption.                                                             |

The focused `server/routes` unsafe-method inventory remains. It is not source-token matching: it is the only evidence that a new mutating non-API Nitro route cannot silently bypass the `/api` origin policy.

## Removal manifest

- eleven raw file reads plus the middleware filename enumeration for module/Sentry policy, helpers, and focused tests;
- literal manifest fields, file paths, function/import names, helper expressions, middleware filenames/order, request-path expressions, command routes, header strings, and focused-test titles;
- matching `.replace()` mutations and expected error-message assertions;
- module manifest `serviceBoundaries`, `surfaceFiles`, `testScopes`, `coreDependencies`, and `integrations` bookkeeping;
- duplicate expected service/file inventories and source-token/file-presence scans in `module-states.test.ts`.

Shared Nuxt/runtime validation, readiness, worker, built-runtime, deployment, and isolated-integration mirrors remain assigned to #70. Browser, container, and migration mirrors remain assigned to #90–#92. No source assertion was moved to a different file.

## Runtime and fault evidence

| Measurement                                   |               Base |               Head |
| --------------------------------------------- | -----------------: | -----------------: |
| Warm `ci-contract.test.mjs` median, five runs |              0.42s |              0.41s |
| Focused module/origin median, three runs      |              2.51s |              2.50s |
| Focused discovery                             | 2 files / 23 tests | 2 files / 23 tests |

Temporary faults were applied one at a time and restored:

- ignoring module validation issues failed four focused classification/Sentry cases;
- broad prefix matching failed the `/api/billing-example` collision case;
- accepting `Sec-Fetch-Site: same-site` failed the signal matrix;
- broadening the Stripe webhook exemption failed both the neighbor and encoded-neighbor cases;
- removing the rejected-response no-store header failed the focused middleware response case;
- making the server preload read client runtime config threw at the boundary, while making the client read process environment produced the stale process DSN instead of the client sentinel;
- neutralizing the module gate still allowed focused helper imports, but the production-built runtime failed when `/api/billing` returned `401` instead of the required disabled `404`. This is the distinct failure that justifies retaining the built scenario.

## Gates

Local Node 24 evidence:

| Gate                                                   |                                                                                                       Result |
| ------------------------------------------------------ | -----------------------------------------------------------------------------------------------------------: |
| CI contract plus deployment-smoke tests                |                                                                                                 33/33 passed |
| Focused module-state, hostile-origin, and health tests |                                                                                                 29/29 passed |
| `ci:fast`                                              |                                                                  passed in 58.63s; 180/180 application tests |
| `verify:pinned`                                        |                                                passed in 85.63s; 180/180 coverage tests and production build |
| `test:runtime:ci`                                      | passed in 49.15s; 33 startup rejections, 20 origin checks, 10 deployment checks, and 19 auth/security checks |
| `test:browser:ci`                                      |                                                                 passed in 39.65s; 6/6 cases and 12 Axe scans |

The first browser attempt reported one aborted Nuxt build-metadata request in Chromium while five other cases passed. An unchanged rerun passed all six; no runner relaxation or product change was made. Hosted head and post-merge `master` must both be green before completion.

Hosted implementation-commit evidence for `0ef75d9`:

| Hosted check                                                                                                                       |          Result |
| ---------------------------------------------------------------------------------------------------------------------------------- | --------------: |
| [Fast PR gate](https://github.com/smallwiselabs/swl-step-by-step/actions/runs/29176142143/job/86605612426)                         | passed in 2m25s |
| [Full CI / verify](https://github.com/smallwiselabs/swl-step-by-step/actions/runs/29176142148/job/86605612378)                     | passed in 2m37s |
| [Full CI / built runtime](https://github.com/smallwiselabs/swl-step-by-step/actions/runs/29176142148/job/86605612366)              | passed in 1m40s |
| [Full CI / browser and accessibility](https://github.com/smallwiselabs/swl-step-by-step/actions/runs/29176142148/job/86605612383)  | passed in 1m55s |
| [Full CI / container build and health](https://github.com/smallwiselabs/swl-step-by-step/actions/runs/29176142148/job/86605612373) | passed in 1m56s |
| [Full CI / isolated integration](https://github.com/smallwiselabs/swl-step-by-step/actions/runs/29176142148/job/86605612362)       |   passed in 57s |
| [Full pre-merge gate](https://github.com/smallwiselabs/swl-step-by-step/actions/runs/29176142148/job/86605802479)                  |    passed in 4s |

## Residual risk and rollback

- Exact internal helpers, imports, filenames, and test titles can now change without a contract failure. That is intentional when behavior remains green.
- Adding a new optional-module surface now requires an explicit behavior test rather than updating an exhaustive file inventory. Review must notice an entirely untested new surface; there is no generic discovery checker.
- Ready-state provider behavior is deterministic local evidence unless a provider-specific staging issue certifies a real account. This change does not broaden that claim.
- Shared runtime/integration and browser/container/migration source mirrors remain brittle until #70 and #90–#92.

Reverting the CI-S02A2 merge restores the mirrors and dead inventories. There is no data migration, provider state, generated artifact, or dependency rollback.
