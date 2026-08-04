# CI-R08C HTTP-authority implementation evidence

**Status:** local implementation, fault proof, frozen gates, and independent review complete; publication and hosted evidence pending

**Issue:** [#77](https://github.com/smallwiselabs/swl-step-by-step/issues/77)

**Owner approval:** `APPROVE-CI-R08-IMPLEMENTATION-V2`, supplied 2026-07-12

**Base:** `ecae8190485c8f5761469eb89caf61e959f79327` (CI-R08B merge commit, PR #106)

## Outcome

Ordinary app-command origin semantics remain owned by the existing focused H3 policy suite. Webhook authority now has two focused real-H3 HTTP cases that compose the actual cross-origin middleware and actual webhook route with the current app-owned signature verifier, the packaged migration folder, Drizzle's `better-sqlite3` migrator, and a temporary SQLite database.

The valid case signs a deliberately noncanonical JSON string and sends those exact bytes with hostile `Origin`, `Referer`, and Fetch Metadata. It therefore fails if route code parses and reserializes the payload before signature verification. The invalid case supplies hostile metadata, a session-shaped cookie, and private payload/signature values; it requires the application-contract `403`, no `CROSS_ORIGIN_REQUEST_BLOCKED` label, no private value in the response, and no billing-event write. The `403` is this application's current contract, not a status prescribed by Stripe.

The built-runtime runner retains one `/%61pi/projects` canary. It catches the distinct production-build failures that a manually composed H3 test cannot: packaged Nuxt/Nitro route decoding, origin-middleware registration, stable cache/vary and baseline error-security headers, and rejection before a project write. The complete runtime origin matrix and four runtime webhook deliveries are deleted.

The isolated API subsystem is unchanged. Its canonical packaged webhook journey continues to own Nitro route/config/signature acceptance, local billing projection, and duplicate idempotency. Because that fixture signs canonical `JSON.stringify(event)` output, it does not independently prove arbitrary raw-body preservation; the noncanonical focused H3 case owns exact-byte rewrite detection. No encoded packaged webhook is added.

## Evidence ownership transition

| Guarantee                                                                                                                                         | Primary owner after CI-R08C                                                                              | Distinct packaged owner                                                                    | Deleted duplicate                                                           |
| ------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------- |
| unsafe command families, accepted/rejected signals, exact exemptions/neighbors, encoded routes, case sensitivity, redaction, and middleware order | existing `cross-origin-policy.test.ts` real-H3 behavior                                                  | one encoded hostile-project canary for installed middleware/decoded route/headers/no write | remaining runtime origin matrix                                             |
| hostile browser metadata cannot replace the exact webhook signature authority                                                                     | `billing-webhook-http.test.ts` with actual middleware, route, verifier, migrations, and temporary SQLite | canonical isolated built webhook journey only                                              | runtime no-origin, hostile-metadata, and encoded-hostile webhook deliveries |
| invalid signature plus session state fails under webhook authority and writes nothing                                                             | `billing-webhook-http.test.ts`                                                                           | none; another packaged invalid-signature case would duplicate authority                    | runtime invalid-signature case                                              |
| canonical packaged webhook route/config/signature acceptance, projection, and duplicate idempotency                                               | unchanged `api-smoke.mjs` through `isolated-api-smoke.mjs`                                               | this is the packaged owner                                                                 | none                                                                        |

Pinned Nitro `2.13.4` launches its Node output through its own runtime. The focused suite uses pinned H3's Node adapter, so it is described as real H3 rather than as Nitro composition evidence.

## Reversible differential faults

All temporary faults below were removed before the restored results and measurements.

| Temporary fault                                                          | Observed owner failure                                                                                                                                              |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| remove the exact `POST /api/billing/webhook` exemption                   | both focused webhook cases failed: the valid request received origin `403` instead of `200`, and the invalid response was mislabeled `CROSS_ORIGIN_REQUEST_BLOCKED` |
| bypass `verifyStripeWebhookSignature`                                    | the invalid focused case failed because the route processed the event and returned `200` instead of the app-contract `403`                                          |
| broaden the exemption with `pathname.startsWith('/api/billing/webhook')` | the existing origin owner failed the exact `/webhooks` neighbor and encoded-neighbor requests at HTTP `200` instead of `403`                                        |
| parse and `JSON.stringify` the raw body before signature verification    | the deliberately noncanonical valid payload failed with `403` instead of `200`, proving exact-byte ownership                                                        |
| add a production-only early return to `02-cross-origin`                  | the focused H3 origin/webhook selection remained green at 12/12, while the packaged canary failed with `401` instead of the expected origin `403`                   |
| skip `checkout.session.completed` projection                             | the unchanged isolated journey passed its 11 earlier checks, then failed the billing case with `expected local billing customer projection`                         |

These faults cover each primary owner and the two distinctly retained packaged boundaries. No source inspection substitutes for them.

## Official pinned basis

- H3 `1.15.11` decodes the incoming path before application layers, routes with `event.path`, reads request headers, exposes the raw body, and adapts an H3 app to a Node listener: [app dispatch](https://github.com/h3js/h3/blob/v1.15.11/src/app.ts), [router](https://github.com/h3js/h3/blob/v1.15.11/src/router.ts), [raw body](https://github.com/h3js/h3/blob/v1.15.11/src/utils/body.ts), [request helpers](https://github.com/h3js/h3/blob/v1.15.11/src/utils/request.ts), and [Node adapter](https://github.com/h3js/h3/blob/v1.15.11/src/adapters/node.ts).
- Stripe requires the unchanged UTF-8 request body, `Stripe-Signature` header, and endpoint secret for verification and recommends its official libraries: [Stripe webhook signature guidance](https://docs.stripe.com/webhooks/signature). This PR tests the repository's current app-owned verifier; it does not claim Stripe SDK use.
- Vitest `4.1.6` recommends testing observable inputs, outputs, errors, and side effects rather than implementation details, and keeping the real subject under test while replacing only external or uncontrollable dependencies: [pinned testing guidance](https://github.com/vitest-dev/vitest/blob/v4.1.6/docs/guide/learn/testing-in-practice.md).
- Drizzle `0.45.2` exposes the selected synchronous `better-sqlite3` migrator used to apply the actual migration folder: [pinned migrator source](https://github.com/drizzle-team/drizzle-orm/blob/0.45.2/drizzle-orm/src/better-sqlite3/migrator.ts) and [SQLite connection guide](https://orm.drizzle.team/docs/sqlite/get-started-sqlite).
- Nitro `2.13.4` identifies `.output/server/index.mjs` as its ready-to-run Node entry and implements that outer Node runtime separately from the focused H3 adapter: [pinned Node-runtime guide](https://github.com/nitrojs/nitro/blob/v2.13.4/docs/2.deploy/10.runtimes/1.node.md) and [pinned runtime source](https://github.com/nitrojs/nitro/blob/v2.13.4/src/presets/node/runtime/node-server.ts).

## Measured change

| Measurement                                                                  |        Base |    Implementation |                 Delta |
| ---------------------------------------------------------------------------- | ----------: | ----------------: | --------------------: |
| `ci-runtime-smoke.mjs` physical lines                                        |       1,481 |             1,366 |                  -115 |
| `ci-runtime-smoke.mjs` nonblank lines                                        |       1,390 |             1,280 |                  -110 |
| focused webhook suite physical/nonblank lines                                |           — |         167 / 151 |                     — |
| affected executable files physical lines                                     |       1,481 |             1,533 |                   +52 |
| affected executable files nonblank lines                                     |       1,390 |             1,431 |                   +41 |
| runtime app-command origin checks                                            |          20 | 1 packaged canary | -19 duplicate samples |
| runtime webhook deliveries                                                   |           4 |                 0 |  -4 duplicate samples |
| isolated API implementation physical/nonblank lines                          | 1,111 / 984 |         unchanged |                     0 |
| dependency, workflow, package-command, schema, migration, or product changes |           0 |                 0 |                     0 |

The isolated implementation count is the current 710/616-line `api-smoke.mjs` plus 401/368-line `isolated-api-smoke.mjs`; the audit's older per-file inventory remains a historical baseline. LOC is a measured maintenance signal, not an acceptance ceiling. The new focused file uses ordinary Vitest, H3, Drizzle, SQLite, and Node APIs and adds no DSL, process lifecycle, reporter, checker, or framework.

## Restored commands and pending publication evidence

| Command                                           | Result                                                                                                |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| focused origin plus webhook H3 selection          | 12/12 passed after all focused and packaged-origin faults were restored                               |
| focused webhook/origin/signature review selection | 57/57 passed under Node 24 during independent review                                                  |
| ordinary application suite                        | 23 files/197 tests passed; 9.04 seconds                                                               |
| `npm run pnpm -- run test:integration:ci`         | 12 isolated checks passed after the projection fault was restored                                     |
| `npm run pnpm -- run test:runtime:ci`             | passed with 33 pre-listen rejections, one encoded origin canary, and 10 read-only deployment checks   |
| `npm run pnpm -- run ci:fast`                     | 92 infrastructure and 197 application tests passed; 55.23 seconds                                     |
| `npm run verify:pinned`                           | 23 files/197 coverage tests, native thresholds, and production Nuxt/Nitro build passed; 78.88 seconds |

Formatting, syntax, and diff checks passed. Independent code/security/scope review found no blocker or high-priority defect and corrected the isolated-fixture raw-body overclaim before publication. The pull-request URL, hosted checks, final commit, and merge commit remain pending; those must be recorded as observed evidence rather than forecast here.

## Rollback and residual risk

One ordinary code/documentation revert restores the runtime origin and webhook matrices and removes the focused webhook suite. It requires no database, schema, provider, dependency, deployment, or migration action.

Residual risk remains bounded:

- the repository still uses its app-owned Stripe protocol/signature code; direct official Stripe SDK integration remains outside CI-R08C;
- the focused server is real H3 but not the outer Nitro Node runtime, which is why the packaged project canary and isolated canonical webhook remain;
- the isolated signature and provider state are deterministic local fixtures, not a Stripe sandbox or hosted delivery;
- the single packaged project canary samples only its named bundle/registration/decoding/header/no-write failures; the focused suite owns the broader policy matrix; and
- no real Stripe event ordering, account, product, webhook endpoint, or network behavior is certified by this PR.

No guarantee is retired.
