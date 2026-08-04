# CI-S02A1 authentication source-mirror removal

## Outcome

CI-S02A1/#88 removes the broad CI contract's direct reads of application authentication, social-login, passwordless, transactional-email, and auth-client source files and its assertions about their imports, option spellings, function names, and focused test titles. It also removes the standalone compatibility test case that read the application auth source solely to require one adapter import string.

The retained tests execute the behavior instead: focused Vitest suites use Better Auth's server API, the configured production composition, the matching Drizzle adapter, and disposable SQLite; selected built-runtime and Playwright journeys retain the production-only boundaries. Exact Better Auth and adapter package declarations and installed versions remain structured policy. Independent security review found that the original social fixture composed Better Auth separately, so this PR also extracts the production composition into a small factory used unchanged by the app and the real-SQLite provisioning suite. The resulting behavior suite rejects unsafe linking and retained provider tokens through the same options and adapter used at runtime.

The refreshed removal manifest found no direct invitation or Better Auth Organization membership source/test-title mirror in the current contract. Runtime-runner, isolated-integration, and Playwright source contracts remain unchanged for their approved owners, #70 and #90. This PR adds no invitation, membership, role, provider, or product behavior; the composition extraction exists only to close the acceptance-blocking evidence gap.

| Surface                                        | Base physical/nonblank | Head physical/nonblank |      Change |
| ---------------------------------------------- | ---------------------: | ---------------------: | ----------: |
| CI contract plus tests                         |          3,468 / 3,275 |          3,249 / 3,063 | -219 / -212 |
| All custom verification scripts/tests          |        14,540 / 13,247 |        14,321 / 13,035 | -219 / -212 |
| Auth compatibility test                        |              118 / 105 |              112 / 100 |     -6 / -5 |
| Production auth composition                    |                67 / 64 |                79 / 75 |   +12 / +11 |
| Configured-adapter provisioning test           |              407 / 365 |              414 / 370 |     +7 / +5 |
| Whole-contract validations per contract run    |                     45 |                     45 |           0 |
| Raw `readFileSync` occurrences in the contract |                     63 |                     55 |          -8 |

The base is current `master` commit `3c2b4c1`. No dependency, lockfile, workflow, runtime runner, browser runner, database schema, or migration changes belong in this tranche. The only application-code change is the behavior-preserving auth-composition extraction required by security review.

## Official basis

- Vitest `4.1.6` documents ordinary [`vitest run`](https://github.com/vitest-dev/vitest/blob/v4.1.6/docs/guide/index.md) discovery and execution. The repository uses the complete discovered suite in Fast and the complete instrumented suite in Full rather than a filename or test-title inventory.
- Better Auth `1.6.23` documents the [Organization server API](https://github.com/better-auth/better-auth/blob/v1.6.23/docs/content/docs/plugins/organization.mdx) used by the focused provisioning and invitation fixtures.
- Better Auth's matching [Drizzle adapter package](https://github.com/better-auth/better-auth/tree/v1.6.23/packages/drizzle-adapter) remains exercised with actual Drizzle and temporary SQLite state.
- Drizzle documents the [`better-sqlite3` connection](https://orm.drizzle.team/docs/sqlite/get-started-sqlite) used by those fixtures. Real adapter/database outcomes, not an import substring, are the retained integration evidence.

## Preserved guarantees and primary evidence

| Guarantee                                                                                               | Primary behavioral owner by distinct failure mode                                                                                                                       | Representative distinct failure retained                                                                                   |
| ------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `AUTH-01A`: magic-link issuance remains enumeration-neutral and delivery failure remains generic        | Built-runtime issuance owns response parity and leakage; `server-foundation.test.ts` owns capture publication, permissions, and normalized failure                      | Known/unknown responses diverge, recipient/path/token leaks, or delivery details escape                                    |
| `AUTH-01B`: tokens remain hashed, bounded, expiring, and single use                                     | Real-SQLite built-runtime redemption                                                                                                                                    | Raw storage, replay, expiry acceptance, or simultaneous double redemption                                                  |
| `AUTH-01C`: hostile origins and return paths fail before consuming valid state                          | `server-foundation.test.ts` owns input rejection; built runtime owns live-token/session preservation; `cross-origin-policy.test.ts` owns app commands                   | External return, hostile origin, valid-token consumption, or session loss                                                  |
| `AUTH-01D`: Google retains exact scope/state/PKCE and safe linking/token behavior                       | `social-auth.test.ts` owns handler detail; `organization-provisioning.test.ts` owns actual production composition/adapter wiring; built probes own the production build | Scope or ID-token expansion, missing state/PKCE, unsafe linking, or token retention                                        |
| `AUTH-01E`: rate limits use the approved identity and reject before sender/token work                   | Built-runtime rate probes                                                                                                                                               | Forwarding-header bypass, missing retry metadata, sender work, or token consumption after `429`                            |
| `AUTH-01F`: personal Organization provisioning is atomic and idempotent through Better Auth and Drizzle | `organization-provisioning.test.ts` against temporary migrated SQLite                                                                                                   | Partial identity/organization/member state, duplicate provisioning, retry drift, or adapter bypass                         |
| `AUTH-01G`: invitation privacy, roles, state, expiry, limits, and terminal races fail closed            | Four `workspace-invitation-*.test.ts` suites divide management, recipient, HTTP, and email failures; Playwright owns only browser-material handoff                      | Anonymous/foreign disclosure, stale authority, wrong recipient, replay, ambiguous delivery, or an in-process terminal race |
| `WS-01`: current persisted membership and role—not active selection—authorize workspace access          | `workspace-context.test.ts` owns persisted resolution; `workspace-http.test.ts` owns HTTP concealment; `organization-access.test.ts` owns capabilities                  | Foreign/revoked access, stale role/capability, active-organization authority, or distinguishable concealed scope           |
| Matching Better Auth and adapter versions remain exact and functional                                   | Parsed manifest/installed-version assertions plus disposable adapter initialization                                                                                     | Declaration/resolution drift or adapter initialization failure                                                             |

The same 13-file focused selection contains 126 tests on both base and head: removing the adapter-import string case and adding the production-composition behavior case are count-neutral. Runtime is measured below rather than inferred from an earlier, narrower 11-file head run.

## Removal manifest

- raw CI-contract loads for the auth client, auth security policy, auth server, social policy, social behavior test, provider manifest, passwordless policy, and transactional-email implementation;
- literal Better Auth, social-provider, passwordless, email, and auth-client implementation fragments;
- exact application auth/security imports, option spellings, helper calls, and error/test-title strings;
- matching source mutations and error-message assertions in `ci-contract.test.mjs`;
- the compatibility test's `readFileSync` of `server/utils/auth/index.ts` and its exact dedicated-adapter import assertion.

The adapter import spelling is implementation detail. Actual application startup and provisioning still initialize the configured adapter; the parsed direct dependency and installed-version assertions retain the reviewed package boundary.

## Explicitly outside this tranche

- built-runtime auth and Organization scenario strings remain for #70's runner/source-contract removal;
- isolated-integration workspace fixture strings remain for #70;
- Playwright auth and invitation spec fragments remain for #90;
- runtime environment-template declarations, startup/configuration mirrors, and operations-evidence policy remain with #70 or their existing operations owner;
- module-state and hostile-origin source mirrors remain for #89.

No replacement source checker, filename inventory, test-title assertion, or generic policy framework is added. The absence of a current invitation/Organization application mirror is recorded rather than manufacturing a deletion.

## Runtime and commands

Base measurements on current `master` under Node 24:

| Measurement                                            |                       Base |                       Head |
| ------------------------------------------------------ | -------------------------: | -------------------------: |
| Warm `node --test scripts/ci-contract.test.mjs` median |     0.47s across five runs |     0.43s across five runs |
| Focused auth/Organization/invitation/migration Vitest  | 13 files, 126 tests, 2.64s | 13 files, 126 tests, 2.71s |

Focused evidence:

```text
pnpm --filter @smallwiselabs/web exec vitest run \
  tests/auth-compatibility.test.ts \
  tests/server-foundation.test.ts \
  tests/cross-origin-policy.test.ts \
  tests/social-auth.test.ts \
  tests/organization-provisioning.test.ts \
  tests/organization-access.test.ts \
  tests/workspace-context.test.ts \
  tests/workspace-http.test.ts \
  tests/workspace-invitation-email.test.ts \
  tests/workspace-invitation-http.test.ts \
  tests/workspace-invitation-management.test.ts \
  tests/workspace-invitation-recipient.test.ts \
  tests/data-layer.test.ts
node --test scripts/ci-contract.test.mjs
```

Representative fault evidence was run only against materially distinct behavior and then restored:

- allowing an external auth return path, disabling verified-email linking, replacing the approved client-IP header, and weakening capture-file permissions made their focused server tests fail;
- removing production token-stripping hooks exposed the provider tokens in SQLite, while weakening the production linking policy changed the existing local user's verification state; the configured-adapter suite rejected both faults;
- changing the configured magic-link storage from hashed to plain made the production-built, migrated-SQLite runtime journey fail when it could not find the required verification state;
- changing the client auth base path made four of six desktop/mobile production-built Playwright cases fail at the signed-out session boundary.

The focused suites passed again after all fault fixtures were removed. These canaries demonstrate that the retained evidence executes behavior; they are not committed mutation tests.

Local frozen and production-boundary evidence:

```text
ci:fast                         passed in 49.46s
verify:pinned                   passed in 70.70s
test:runtime:ci                 passed in 39.85s (19 auth/security checks)
test:browser:ci                 passed in 28.65s (6 cases; 12 Axe scans)
ci-contract.test.mjs            passed (28/28)
focused Vitest                  passed (13 files; 126/126)
```

The focused base/head wall times were 5.53s/5.01s in separate clean worktrees. That single pair is observational; the deterministic result is equal discovery with one implementation-string case replaced by one production-composition behavior case.

Hosted evidence for implementation commit `2f23a0a`:

| Hosted check                                                                                                                       | Result and observed job time |
| ---------------------------------------------------------------------------------------------------------------------------------- | ---------------------------: |
| [Fast PR gate](https://github.com/smallwiselabs/swl-step-by-step/actions/runs/29175090530)                                         |              passed in 2m38s |
| [Full CI / verify](https://github.com/smallwiselabs/swl-step-by-step/actions/runs/29175090531/job/86602729284)                     |              passed in 2m37s |
| [Full CI / built runtime](https://github.com/smallwiselabs/swl-step-by-step/actions/runs/29175090531/job/86602729292)              |              passed in 1m46s |
| [Full CI / browser and accessibility](https://github.com/smallwiselabs/swl-step-by-step/actions/runs/29175090531/job/86602729314)  |              passed in 1m48s |
| [Full CI / container build and health](https://github.com/smallwiselabs/swl-step-by-step/actions/runs/29175090531/job/86602729298) |              passed in 1m53s |
| [Full CI / isolated integration](https://github.com/smallwiselabs/swl-step-by-step/actions/runs/29175090531/job/86602729283)       |              passed in 1m04s |
| [Full pre-merge gate](https://github.com/smallwiselabs/swl-step-by-step/actions/runs/29175090531/job/86602910853)                  |                 passed in 4s |

The pull-request head must remain green at merge. The evidence-only commit containing this table reruns the same hosted checks.

## Residual risk and rollback

- Test-file deletion is no longer opposed by a second source/title inventory. Native discovery, behavioral review, and required gates own test presence.
- Exact internal helper/import spelling may change without a CI failure. That is intentional when the public behavior, package declarations, adapter initialization, and security failure modes remain intact.
- The retained runtime/integration/browser source contracts remain brittle until #70/#90; this tranche does not claim they are simplified.
- Better Auth and Drizzle upgrades still require explicit compatibility, migration, and security review against the newly selected versions.

Reverting the CI-S02A1 merge restores the deleted mirrors and adapter import-string assertion and inlines the unchanged auth composition again. There is no data migration, generated state, provider configuration, dependency, or lockfile change.
