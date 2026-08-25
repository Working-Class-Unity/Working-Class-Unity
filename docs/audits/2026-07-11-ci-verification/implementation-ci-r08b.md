# CI-R08B passwordless and SSR ownership implementation evidence

**Status:** local implementation and independent review complete; hosted checks and merge evidence pending

**Owner approval:** `APPROVE-CI-R08-IMPLEMENTATION-V2`, supplied 2026-07-12

**Base:** `f6ffdc4775704e9e15a145b96d4198bb7b70488f` (CI-R08A merge commit, PR #105)

**Issue:** [#77](https://github.com/smallwiselabs/swl-step-by-step/issues/77)

## Outcome and boundaries

CI-R08B moves ordinary passwordless behavior out of the built-runtime runner and into the lowest layer that can exercise the application's real authentication composition. `apps/web/tests/passwordless-auth-http.test.ts` contains seven cases using production `createAuthentication`, its public `Request`/`Response` handler, the configured Drizzle adapter, the complete packaged migration set, and a temporary `better-sqlite3` database. Only transactional-email delivery is replaced at the external provider boundary.

The existing Playwright lifecycle gains one logical real-login journey. It executes once in each existing desktop and mobile Chromium project without adding another build, migration, server, project, reporter, or process lifecycle. The journey consumes a private capture envelope, follows the real mounted Nitro auth route, and checks authenticated initial-response HTML separately from the hydrated UI for both `/auth` and `/billing`. Billing is locally ready, but the journey neither clicks checkout nor claims Stripe network certification.

That journey exposed an acceptance-blocking integration defect rather than a test-harness failure: pinned Better Auth produced different server/client request URLs inside `useSession(useFetch)`, so Nuxt rendered a valid signed-in response and payload but the browser initially hydrated the signed-out branch. Auth and billing now call Better Auth's public session endpoint through a literal relative Nuxt `useFetch` request. This preserves SSR cookie forwarding and gives Nuxt one stable payload key. The obsolete unit case that exercised the broken Better Auth wrapper is removed instead of being replaced by a source assertion; the packaged initial-HTML/hydration behavior is primary.

The entire 19-case runtime auth matrix and its runtime-only capture, cookie, token, and SQLite helpers are deleted. The runtime runner still owns 33 packaged pre-listen rejections, 20 app-command origin checks, 10 read-only deployment checks, the poisoned build and output/database sentinels, telemetry-sink rejection, runtime precedence, one real migration, health transitions, deployment no-write observations, and process cleanup. The auth matrix used the already-running main server, so this slice does not reduce the runtime runner's managed-child count.

The existing `social-auth.test.ts` and `organization-provisioning.test.ts` remain the primary owners for Google and production-composed Organization provisioning/reuse. The latter now captures the first personal Organization ID/slug and requires both returning magic-link and Google sign-ins to preserve that exact identity; the deleted runtime case's reuse guarantee is therefore not reduced to a count check. Invitation behavior remains unchanged and outside this slice.

Adding the real-migration passwordless file increased parallel full-suite load enough to expose an existing five-second timeout in the separate seed-command idempotency case: two full-suite runs exceeded five seconds, and the first bounded increase to ten seconds still expired at 10.174 seconds during `ci:fast`; the same case passed alone in 2.00 seconds. Its semantic assertions and two shipped seed-command executions are unchanged. A case-local 20-second ceiling is the smallest acceptance-blocking stabilization and does not add a runner, retry, or weaker result condition.

There is no dependency, lockfile, workflow, package-command, schema, migration, new product capability, provider, or isolated-integration change. The only application-code correction is the acceptance-blocking auth/billing session-read integration above; the only unrelated-file adjustment is the documented case-local timeout required for the frozen gate to complete under the new parallel load. No source-text assertion, generic checker, test DSL, scenario engine, reporter, reusable process framework, retry, or second browser lifecycle is added.

## Official pinned basis

- Better Auth `1.6.23` documents the Nuxt boundary as `auth.handler(toWebRequest(event))`; the focused suite exercises the public handler created by the production factory rather than private internals: [pinned Nuxt integration](https://github.com/better-auth/better-auth/blob/v1.6.23/docs/content/docs/integrations/nuxt.mdx).
- Better Auth `1.6.23` documents plain storage as the default, the selected hashed-storage option, five-minute expiry, single-use redemption, and the conditional retirement of unproven legacy credentials/sessions: [pinned magic-link guide](https://github.com/better-auth/better-auth/blob/v1.6.23/docs/content/docs/plugins/magic-link.mdx).
- Better Auth documents that server-side `auth.api` calls bypass client rate limiting and that trusted client-address configuration matters, so request and redemption limits are exercised through the public handler: [pinned rate-limit guide](https://github.com/better-auth/better-auth/blob/v1.6.23/docs/content/docs/concepts/rate-limit.mdx).
- The production composition uses the matching Better Auth Drizzle adapter with SQLite; the suite applies the repository's real migrations before creating that composition: [pinned Drizzle adapter guide](https://github.com/better-auth/better-auth/blob/v1.6.23/docs/content/docs/adapters/drizzle.mdx).
- Vitest `4.1.6` recommends observable contracts with the real subject retained and only slow or external dependencies replaced. That supports replacing email delivery while keeping the configured handler and database path real: [pinned testing guidance](https://github.com/vitest-dev/vitest/blob/v4.1.6/docs/guide/learn/testing-in-practice.md).
- Playwright `1.61.1` supplies per-test trace, screenshot, and video controls. They are disabled for the bearer-link journey so a retained artifact cannot become the evidence mechanism: [pinned test-use guidance](https://github.com/microsoft/playwright/blob/v1.61.1/docs/src/test-use-options-js.md).
- Node 24's child `close` event occurs only after the child exits and its standard streams close. Dynamic capture values are therefore registered after Playwright closes and before any preserved failure is rethrown or diagnostics are emitted: [Node child-process documentation](https://nodejs.org/download/release/latest-v24.x/docs/api/child_process.html).
- Better Auth's pinned Vue client concatenates a server-relative or browser-absolute base URL into the `useFetch` request, while Nuxt `4.4.8` includes that literal request in its generated data key. [Better Auth #5358](https://github.com/better-auth/better-auth/issues/5358) remains open and reports the same signed-in SSR payload followed by undefined client data and hydration repair. The correction uses Better Auth's public session HTTP endpoint plus Nuxt's documented relative-request cookie forwarding rather than inventing a client session protocol: [pinned Vue client](https://github.com/better-auth/better-auth/blob/v1.6.23/packages/better-auth/src/client/vue/index.ts), [pinned Nuxt key generation](https://github.com/nuxt/nuxt/blob/v4.4.8/packages/nuxt/src/app/composables/fetch.ts), and [pinned `useRequestFetch`](https://github.com/nuxt/nuxt/blob/v4.4.8/docs/4.api/2.composables/use-request-fetch.md).

## Primary evidence and retained canaries

| Guarantee                                                                                          | Primary owner after CI-R08B                                                                       | Distinct browser or process evidence                                                     |
| -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Hostile auth origin and unsafe return rejection before work                                        | `passwordless-auth-http.test.ts` public-handler case                                              | Real Playwright login proves the mounted Nitro catch-all accepts the safe path           |
| Hashed five-minute storage and callback non-consumption                                            | `passwordless-auth-http.test.ts` with real migrated SQLite                                        | None; persisting the same semantic matrix in a child process added no packaging evidence |
| Concurrent single-use, replay, expiry, cookies, sessions, and hostile-origin sign-out preservation | `passwordless-auth-http.test.ts`                                                                  | One real browser session proves the built handler and cookie compose with SSR            |
| Enumeration-neutral issuance and generic delivery failure                                          | `passwordless-auth-http.test.ts`                                                                  | Browser launcher registers and scans every private capture value before diagnostics      |
| Password and OIDC registration routes absent                                                       | `passwordless-auth-http.test.ts` configured handler                                               | Existing rendered auth journey proves password controls remain absent                    |
| Conditional legacy unverified-account retirement                                                   | `passwordless-auth-http.test.ts` using verified and unverified predecessor identities             | None; this is database/auth behavior rather than a build or browser distinction          |
| Request and redemption rate identity plus before-work rejection                                    | `passwordless-auth-http.test.ts` public handler                                                   | None; the focused suite crosses the configured HTTP limiter rather than `auth.api`       |
| Google scope/state/PKCE, linking, and token non-retention                                          | Existing `social-auth.test.ts`                                                                    | Existing local route-double UI handoff only; the deleted runtime copy was not primary    |
| New-user Organization provisioning, rollback, and exact returning-sign-in identity reuse           | Strengthened `organization-provisioning.test.ts` using production composition and real migrations | None; the deleted cases repeated the same configured factory/adapter behavior            |
| Authenticated `/auth` and `/billing` initial HTML and hydration                                    | One Playwright scenario in both existing projects                                                 | This is the retained production-build/Nitro/SSR/session canary                           |

The Playwright token journey disables trace, screenshot, and video. The existing browser launcher now observes bounded full-lifetime server and Playwright output, waits for Playwright to close, reads all capture envelopes, and registers each envelope path, recipient, full URL, and raw token before scanning output, the Playwright artifact tree, or rendering diagnostics. Registration, parsing, artifact traversal, and size bounds fail closed. Diagnostics remain withheld until registration completes safely, are redacted afterward, and server output is asserted again after shutdown. This is a suite-specific extension to the existing observer, not a general monitoring subsystem.

## Reversible fault evidence

The temporary faults below were removed before the restored implementation was measured. They changed executable behavior, not source assertions.

| Temporary fault                                                              | Observed owner failure                                                                                                    |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Configure magic-link storage as plain text                                   | Only the focused hash/expiry/non-consumption case failed                                                                  |
| Permit a consumed token to be found again                                    | The focused atomic-consumption/replay checks failed                                                                       |
| Return a distinguishable response for a known recipient                      | Only the focused enumeration-neutrality case failed                                                                       |
| Retain the credential/session for the supported unverified legacy identity   | Only the focused legacy-transition case failed                                                                            |
| Trust `X-Real-IP` instead of the configured single-valued Cloudflare address | Only the focused rate-identity/before-work case failed                                                                    |
| Replace the mounted Better Auth catch-all with a `404` response              | The packaged auth/navigation and real-login cases failed                                                                  |
| Restore `authClient.useSession(useFetch)` on `/auth`                         | Raw/evolved signed-in content remained, but both real-login executions failed on the hydration warning                    |
| Force `/billing` session lookup through plain server `$fetch`                | Both real-login executions failed the signed-in initial-HTML assertion before hydrated-DOM checks                         |
| Write each issued token to server output in two chunks                       | All eight browser executions passed, then the late-registered server observer failed and printed only `[redacted]` values |

Playwright's generated failure context retained the dynamic recipient during the hydration fault. The post-close artifact scan found it after capture registration and replaced the detailed failure with the generic private-value failure, proving that disabling trace, screenshot, and video does not become the only secrecy control.

## Measured structure

Historical R-014/R-015 scenario counts remain history in their own records. These measurements describe only the CI-R08A base and current CI-R08B transition.

| Measure                                                     | CI-R08A base | CI-R08B result |      Change |
| ----------------------------------------------------------- | -----------: | -------------: | ----------: |
| `scripts/ci-runtime-smoke.mjs` physical lines               |        2,424 |          1,481 |        -943 |
| Runtime auth/security cases                                 |           19 |              0 |         -19 |
| Runtime managed child processes                             |           41 |             41 |           0 |
| Focused passwordless public-handler cases                   |            0 |              7 |          +7 |
| Logical Playwright tests                                    |            3 |              4 |          +1 |
| Playwright executions across two existing projects          |            6 |              8 |          +2 |
| New dependency, workflow job, package command, or lifecycle |            0 |              0 |           0 |
| Passwordless suite physical/nonblank lines                  |            — |      496 / 452 |           — |
| Browser launcher physical/nonblank lines                    |    365 / 340 |      484 / 456 | +119 / +116 |
| Browser spec physical/nonblank lines                        |    386 / 361 |      480 / 449 |   +94 / +88 |

The runtime matrix shared the one main packaged server and therefore removed no child process. Its structural reduction is duplicate scenario/helper deletion rather than another build or process-launch speed claim. Local restored timings are implementation samples, not speedup claims or hosted evidence.

## Commands and merge evidence

| Command                                                                                            | Purpose                                                                                                     | Final restored result                                     |
| -------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| `npm run pnpm -- --filter @smallwiselabs/web exec vitest run tests/passwordless-auth-http.test.ts` | Seven configured public-handler/Drizzle/SQLite cases and representative faults                              | 7/7 passed; 1.45 seconds                                  |
| `npm run pnpm -- run test:browser:ci`                                                              | Both-project login, initial HTML/hydration, invitation, accessibility, output/artifact secrecy, and cleanup | 8/8 passed after final ordering change                    |
| `npm run pnpm -- run test:runtime:ci`                                                              | Retained 33 pre-listen, 20 origin, 10 deployment, health/process boundaries                                 | Passed; 62.30 seconds                                     |
| `npm run pnpm -- run ci:fast`                                                                      | Frozen fast gate                                                                                            | 92 infrastructure and 195 app tests passed; 58.90 seconds |
| `npm run verify:pinned`                                                                            | Frozen full verification, coverage thresholds, and production build                                         | 22 files/195 tests passed; 75.02 seconds                  |

Three independent reviews found no remaining blocker: an authentication-layer review reran 71 focused checks and inspected the session-read correction; a security review examined capture bounds, process shutdown, diagnostic redaction, and artifact traversal; and a scope/documentation review verified the official pinned sources, issue boundary, measurements, and guarantee ownership. Their requested ordering, bound, cookie-parsing, and exact-Organization-reuse corrections are included in the restored results above.

The pull-request URL, hosted `Fast PR gate`, hosted `Full pre-merge gate`, post-merge `master` checks, final commit, and merge commit are pending. Those facts will be recorded in the issue evidence rather than treating local behavior as hosted evidence.

## Rollback and residual risk

This slice is independently revertible. One code/documentation revert restores the runtime auth matrix and removes the focused/browser ownership changes. No database rollback, data rewrite, provider coordination, package install, workflow edit, or migration is needed.

Residual risks remain deliberately bounded:

- the focused sender is a fake at the external email boundary; hosted delivery, bounce, suppression, and provider operations remain R-033;
- the rate limiter remains process-local and the baseline remains restricted to one replica until a reviewed shared limiter exists;
- the browser canary covers Chromium at the two required viewports, not cross-browser or hosted-provider behavior;
- the Billing page uses local ready configuration but does not contact Stripe or prove checkout/webhook behavior;
- capture registration is bounded to 64 envelopes, 64 KiB each, and 1 MiB total; each observed process output is bounded to 1 MiB; the Playwright artifact tree is bounded to 16 MiB; and the in-test envelope poll is bounded to 64 files of 64 KiB each. Exceeding any bound fails closed rather than silently truncating assurance;
- an unreadable or unexpected capture/artifact entry withholds diagnostics and fails the run, which favors secrecy over detailed failure output; and
- pinned Better Auth `useSession(useFetch)` still has the upstream hydration defect on session-rendering pages not changed by this acceptance slice. The invitation route retains its pre-existing integration and route-double coverage; upgrading it requires its own behavioral change/test-fixture decision rather than broadening this CI PR; and
- the semantic suite is not itself a production build. The one Playwright login owns only the distinct mounted-handler, cookie, Nitro, SSR, and hydration composition failures.
