# Baseline Repository Audit

Audit date: 2026-07-09

Audit status: **approved by the project owner on 2026-07-09**

Repository commit: `98e6922f9c2893fab0ed1b6f4d79d2d95764ec29`

Audited branch: `main`

Readiness label: **not ready**

## Executive verdict

This repository is a useful Nuxt/SQLite integration prototype, but it is not yet a safe or complete fork-ready baseline. The local toolchain can install from its frozen lockfile, all 20 Vitest tests pass, migrations apply to a fresh database, and a production build succeeds. Those positive results do not cover the behavior that currently blocks readiness:

- project collection routes disclose and create private data without authentication;
- the agreed workspace ownership boundary does not exist;
- documented production environment variables are ignored by built Nuxt runtime-config consumers unless differently named `NUXT_*` variables are supplied;
- installed direct dependencies include versions with current high-severity advisories;
- optional provider modules are neither independently safe-disabled nor behaviorally tested;
- the production image and runbooks do not form an executable migration, backup, restore, and health path;
- the rendered application is a diagnostic demonstration rather than a complete baseline user journey.

No live deployment, user data, production credentials, or external Stripe, Cloudflare, Sentry, email, or model-provider accounts exist. That removes incident-containment and compatibility constraints, but it does not reduce the standard for a reusable baseline. Repairs under the approved program may make breaking schema and route changes through issue-scoped work.

Approval adopts these findings and the canonical target and authorizes conversion of the approved backlog into issue-scoped work. It is not fork-readiness or deployment approval, and this documentation step implements no repair. During the audit phase no repair Issues were created, the branch was not renamed, and application behavior was not changed.

### Historical-documentation warning

The root `README.md` and existing deployment/provider guides are preserved as historical evidence and now carry a readiness banner. They are not safe operating instructions. In particular, do not rely on their ordinary Coolify environment-variable example, provider “health” wording, environment-agnostic `api:smoke` command, caller-supplied Stripe `priceId`, deprecated AI `/compat` description, provider-wide storage diagnostics, or worker/backup commands in the current runtime image. R-006, R-010, R-011, and the relevant provider repairs must replace those instructions; deployed read-only checks use `ops:smoke` only.

## Evidence states

Every material claim uses one of these states:

- **Executed:** reproduced against commit `98e6922` in an isolated local environment.
- **Verified:** confirmed directly in source, migration SQL, generated output, or repository configuration.
- **Externally blocked:** requires an account, sandbox, deployment, device, or control plane that intentionally does not exist yet.
- **Target:** agreed future baseline behavior; it is not a claim about current implementation.

See [command-evidence.md](command-evidence.md), [inventory.md](inventory.md), [requirements-evidence-matrix.md](requirements-evidence-matrix.md), and [dependency-compatibility.md](dependency-compatibility.md) for the underlying evidence.

## Severity model

- **Blocker:** the repository cannot be called fork-ready while the condition exists.
- **High:** likely security, data-loss, financial, deployment, or verification failure; must be resolved before readiness.
- **Medium:** material correctness, privacy, maintainability, accessibility, or resilience gap.
- **Low:** documentation or workflow defect with limited direct impact.

Because the application has never been deployed, severity describes the risk a fork would inherit rather than a current production incident.

## Risk register

| ID        | Severity | Finding                                                                                                                                                                                | Evidence state                      | Required disposition                                                                                                                                                          |
| --------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SEC-001   | Blocker  | Anonymous project enumeration, creation, and caller-selected ownership                                                                                                                 | Executed + verified                 | Require session and workspace membership; derive scope server-side; replace tests that normalize the defect.                                                                  |
| TEN-001   | Blocker  | No workspace, membership, persisted role, or workspace-scoped resource model                                                                                                           | Verified                            | Add personal workspaces, memberships, roles, current-workspace resolution, FKs, and isolation tests.                                                                          |
| CFG-001   | Blocker  | Production environment contract is incompatible with Nuxt runtime overrides                                                                                                            | Executed + verified                 | Define one runtime-config naming contract, validate it at startup, and test the built image with runtime-only values.                                                         |
| DEP-001   | High     | Current audit reports 21 production advisories, including 3 high; Nuxt and Better Auth direct versions are below patched releases                                                      | Executed                            | Upgrade only in isolated compatibility PRs and rerun full/provider tests.                                                                                                     |
| SEC-002   | High     | Predictable Better Auth/upload-token fallback secret and fail-open Turnstile behavior                                                                                                  | Verified                            | Production startup must reject default/missing cryptographic config; enabled abuse controls fail closed.                                                                      |
| SEC-003   | High     | Any signed-in user can list provider-wide object keys and overwrite arbitrary normalized keys                                                                                          | Verified                            | Remove diagnostic routes from product access or require a real staff capability and enforced namespace.                                                                       |
| AI-001    | High     | Public AI relay permits caller-selected models and has no message ceiling, quota, rate limit, concurrency limit, or timeout                                                            | Executed + verified                 | Default to authenticated workspace use, server model allowlist, bounded inputs, budgets, and timeouts.                                                                        |
| PAY-001   | High     | Client authorizes its own Stripe price and checkout mode; checkout has no durable retry identity                                                                                       | Verified                            | Accept a server-owned plan key, enforce workspace billing permission, and reuse a stable provider idempotency key from a durable checkout attempt.                            |
| PAY-002   | High     | Webhook receipt, projection, and event ordering are not modeled atomically                                                                                                             | Verified                            | Use a durable transactional inbox/state machine, event-version policy, and concurrent/out-of-order tests.                                                                     |
| OPS-001   | High     | No `.dockerignore` while the build sends `COPY . .`                                                                                                                                    | Verified                            | Restrict build context and scan context/image for canary secrets.                                                                                                             |
| OPS-002   | High     | Runtime image copies only `.output`; it lacks pnpm, workspace manifests/scripts, migration SQL/tooling, and backup source required by its runbooks                                     | Verified                            | Provide a tested maintenance/migration image or predeploy job and executable restore workflow.                                                                                |
| STO-001   | High     | Partial/missing R2 config silently stores objects outside the mounted Docker volume                                                                                                    | Verified                            | Fail closed in production or use an explicit persistent local adapter under `/app/data`.                                                                                      |
| OPS-003   | High     | Deployment checklist recommends a mutating API smoke suite that creates durable users, files, projects, and billing rows                                                               | Verified                            | Split read-only deployment smoke from isolated mutating integration tests.                                                                                                    |
| PRO-001   | High     | No complete home → passwordless auth → workspace → private project → settings journey exists                                                                                           | Browser + verified                  | Build and behaviorally test the agreed reference journey before optional demos count as complete.                                                                             |
| TST-001   | High     | Passing gates omit route integration, browser/a11y, coverage, dependency/secret scans, Docker, and CI enforcement                                                                      | Executed + verified                 | Add fast PR and full merge/staging gates; convert presence assertions to behavioral evidence.                                                                                 |
| DAT-001   | Medium   | App resources lack foreign keys/domain checks; project/search writes are non-atomic; search requests execute migration DDL at runtime                                                  | Verified                            | Add explicit deletion policy, FKs/checks, and transactions/outbox; remove request-time DDL and fail readiness until committed migrations run; add upgrade/delete tests.       |
| JOB-001   | Medium   | Two concurrent claim calls can receive the same queued job; crashed `running` jobs are never reclaimed                                                                                 | Executed + verified                 | Atomic compare-and-set claim, leases, worker-token completion, recovery, and idempotency keys.                                                                                |
| RES-001   | Medium   | Upload/download/provider bodies are buffered and Stripe, Turnstile, and AI requests have no timeouts                                                                                   | Verified                            | Enforce edge/app limits, stream large bodies, bound responses, and abort slow providers.                                                                                      |
| PRV-001   | Medium   | No implemented retention/export/deletion contract; full Stripe payloads persist and raw prompts cross provider boundaries                                                              | Verified + official-doc inference   | Implement workspace data lifecycle; deliberately disable or document provider payload logging; keep prompt text out of Sentry/log duplication.                                |
| HLT-001   | Medium   | Public health leaks infrastructure; failure still returns HTTP 200 and Docker checks only `response.ok`                                                                                | Executed + verified                 | Separate minimal liveness from protected readiness and return failure status for failed dependencies.                                                                         |
| AUTH-001  | Medium   | Current password auth, fabricated role tests, and no workspace bootstrap contradict the agreed passwordless model                                                                      | Browser + verified                  | Add magic link/social providers, verified linking policy, real membership roles, and personal-workspace provisioning.                                                         |
| OBS-001   | Medium   | Production entry does not preload emitted Sentry server config; the build emits 13 client maps in public output; global scrubbing is absent                                            | Executed + verified + official docs | Start with the required server import, use hidden maps and delete them after upload so none are publicly served, scrub data, and prove events/maps in staging.                |
| STO-002   | Medium   | File checksum is caller-supplied, R2 is app-proxied/buffered, and bucket listing is single-page                                                                                        | Verified                            | Require server- or provider-verified integrity using a declared algorithm, use short-lived presigned transfers where configured, and paginate listing/cleanup.                |
| UI-001    | Medium   | Missing Reka account/workspace menu, skip link, route titles/current nav state, verified contrast/a11y gates, and some controls fall below the 44px baseline                           | Browser + verified                  | Implement app-owned primitives plus Reka menu and automated keyboard/focus/contrast/browser checks.                                                                           |
| PWA-001   | Medium   | PWA is unconditional, forces portrait, has inconsistent theme colors, and lacks real install/update evidence                                                                           | Verified                            | Make it an optional enabled module, keep shell-only offline behavior, and test target platforms.                                                                              |
| MOD-001   | Medium   | Readiness requires all provider credentials simultaneously, while Doctor supplies structural presence checks rather than executable disabled/enabled/incomplete module-state contracts | Verified                            | Add a module manifest with disabled, enabled, required-config, health, test, and UI exposure semantics.                                                                       |
| EMAIL-001 | Medium   | Passwordless email is an agreed core dependency but no email adapter, local substitute, provider contract, or tests exist                                                              | Verified absence                    | Add provider-neutral mail boundary, capture sink for local/CI, and delivery/failure/rate tests.                                                                               |
| WEB-001   | Medium   | No Content-Security-Policy is defined or tested, and app-owned cookie-authenticated commands have no explicit cross-origin/CSRF verification evidence                                  | Verified absence                    | Introduce a nonce/hash-compatible CSP from report-only to enforcement and require a tested origin/Fetch-Metadata or CSRF-token policy for every cookie-authenticated command. |
| FORM-001  | Low      | Baseline form reports “saved” but persists nothing                                                                                                                                     | Browser + verified                  | Remove the demo from product UI or state its non-persistent behavior accurately.                                                                                              |
| DOC-001   | Low      | README/checklist overstate “complete locally” and contain unsafe runtime/smoke instructions                                                                                            | Verified                            | Replace with the approved canonical guide and evidence-linked status language.                                                                                                |

## Blocker evidence

### SEC-001 — project authorization is broken

`GET /api/projects` calls an unscoped repository list without a session, and `POST /api/projects` validates a body containing `ownerId` without authentication. The smoke suite explicitly relies on that behavior.

- Source at audited commit `875c2e1`: [collection read](https://github.com/smallwiselabs/swl-step-by-step/blob/875c2e1d0f7dbb17c92ab2c4b4fbec7eeb4cec5c/apps/web/server/api/projects/index.get.ts#L4), [collection create](https://github.com/smallwiselabs/swl-step-by-step/blob/875c2e1d0f7dbb17c92ab2c4b4fbec7eeb4cec5c/apps/web/server/api/projects/index.post.ts#L10), [client-owned field](https://github.com/smallwiselabs/swl-step-by-step/blob/875c2e1d0f7dbb17c92ab2c4b4fbec7eeb4cec5c/apps/web/server/db/schema/projects.validation.ts#L5), [unscoped repository](https://github.com/smallwiselabs/swl-step-by-step/blob/875c2e1d0f7dbb17c92ab2c4b4fbec7eeb4cec5c/apps/web/server/db/repositories/projects.ts#L6), [smoke contract](https://github.com/smallwiselabs/swl-step-by-step/blob/875c2e1d0f7dbb17c92ab2c4b4fbec7eeb4cec5c/scripts/api-smoke.mjs#L59).
- Runtime proof: anonymous `GET` returned `200` with 7 project rows; anonymous `POST` returned `201` and preserved `ownerId: "forged-owner"`.
- Impact: a caller can enumerate all projects, reserve global slugs, forge ownership, and inject searchable data into another identity's scope.
- Target proof: anonymous requests return 401; member requests operate only in current workspace; cross-workspace tests deny list/read/write; request bodies cannot carry ownership.

### TEN-001 — the agreed tenant boundary is absent

Projects, files, and billing rows contain user/owner strings rather than workspace FKs. The permission helper reads role-like fields that the auth schema and Better Auth configuration do not persist or populate.

- Source: [projects](../../../apps/web/server/db/schema/projects.ts#L4), [files](../../../apps/web/server/db/schema/files.ts#L6), [billing](../../../apps/web/server/db/schema/billing.ts#L4), [hypothetical roles](../../../apps/web/server/utils/auth/permissions.ts#L17).
- Impact: collaboration, ownership transfer, workspace billing, invitations, and reliable cross-tenant isolation require a redesign in every fork.
- Target proof: each new user gets a personal workspace and owner membership; every private repository requires a workspace scope; all private route tests include cross-workspace negative cases.

### CFG-001 — documented runtime variables fail in the built app

Nuxt runtime config is initialized from differently named environment variables such as `DATABASE_URL` in `nuxt.config.ts`. Nuxt documents that this works at build time but does not override a built server at runtime; runtime overrides must match the `NUXT_*` property path.

- Source: [runtime config](../../../apps/web/nuxt.config.ts#L38), [database consumer](../../../apps/web/server/db/client.ts#L6), [documented environment](../../../.env.production.example#L9), [Docker environment](../../../Dockerfile#L26).
- Official requirement: [Nuxt runtime config environment variables](https://nuxt.com/docs/4.x/guide/going-further/runtime-config#environment-variables).
- Runtime proof: with only documented `DATABASE_URL=file:/tmp/.../app.db`, the built server opened a different relative database, `/api/health` returned HTTP 200 and called it connected, and `/api/projects` failed with `no such table: projects`. Supplying `NUXT_DATABASE_URL` corrected the route. Likewise, the webhook returned `503 Stripe webhook secret is not configured` until `NUXT_STRIPE_WEBHOOK_SECRET` was supplied.
- Target proof: a built image starts with runtime-only configuration using the documented keys, resolves one database path across auth/app/jobs/migrations, and rejects partial configuration before listening.

## High-risk themes

### Configuration is advisory rather than enforced

The readiness script is useful but is not part of `verify` or application startup. Better Auth and upload-token signing share a public fallback string, while Turnstile returns success when unconfigured. Cloudflare requires server-side validation for an enabled Turnstile deployment and supplies dedicated test keys, so tests do not require a fail-open production path. See [auth secret](../../../apps/web/server/utils/auth/index.ts#L8), [upload secret](../../../apps/web/server/services/storage/file-tokens.ts#L59), [Turnstile fallback](../../../apps/web/server/services/security/turnstile.ts#L10), and [Cloudflare validation guidance](https://developers.cloudflare.com/turnstile/get-started/server-side-validation/).

### Provider adapters lack application policy

The Stripe, AI, storage, and Turnstile adapters demonstrate connectivity, but the application does not yet enforce plan catalogs, workspace permissions, model allowlists, quotas, provider timeouts, retention, or independent module states. Cloudflare AI Gateway logs request and response data by default, so the agreed application-held conversation history must be paired with an explicit provider logging decision. See [AI request forwarding](../../../apps/web/server/services/ai/ai-gateway.ts#L19), [AI Gateway logging](https://developers.cloudflare.com/ai-gateway/observability/logging/), and [Stripe server-owned pricing guidance](https://docs.stripe.com/checkout/quickstart).

### Deployment documentation cannot be executed by the runtime image

The final Docker stage contains only `.output`, but the runbooks instruct operators to use pnpm scripts and migration/backup source that are not present. The local storage fallback resolves below `/app/apps/web/data/objects`, while only `/app/data` is mounted. The health check accepts any 2xx even when the body says `fail`. See [Dockerfile](../../../Dockerfile#L20), [deployment runbook](../../../docs/deployment.md#L26), and [restore runbook](../../../ops/restore-runbook.md#L7).

## Positive controls worth retaining

- Frozen install, ESLint, Stylelint, typecheck, migration check, all 20 tests, and production build pass.
- Server/provider/database directory boundaries are generally clear.
- SQLite enables foreign-key enforcement and WAL for file databases.
- Fresh migrations verify integrity, required tables, FTS triggers, and a real FTS insertion.
- The backup command uses SQLite's online backup API and checks the copy; the isolated audit backup passed integrity.
- Stripe webhook HMAC/timestamp comparison is constant-time at source level.
- Authenticated file list/download and project detail routes perform current user ownership checks.
- Error helpers redact fields whose keys look sensitive.
- PWA service worker avoids API caching and limits fallback to navigation.
- Semantic forms, visible labels, focus-visible styles, responsive grids, and explicit async-state components provide a reasonable frontend starting point.
- Non-mutating deployment smoke checks exist and passed in non-strict local mode.

These controls should be extended, not treated as evidence that the unsafe routes or missing baseline journey are acceptable.

## External verification status

The following are intentionally **not verified** because no external accounts or deployment exist:

- Better Auth social-provider and email delivery behavior;
- Stripe sandbox catalog, Checkout redirects, webhook destination/API version, payment failure/cancellation, and reconciliation;
- R2 presigned upload/download, CORS, lifecycle, versioning, and least-privilege credentials;
- Turnstile hostname/action validation and edge WAF/rate rules;
- AI Gateway/provider authentication, model behavior, budgets, logging/retention, and failure modes;
- Sentry server/client events, source maps, scrubbing, alerts, and retention;
- Coolify image build, persistent volume, health interpretation, migrations, backups, restore, and staging promotion;
- iOS/Android installation and mobile browser behavior.

Readiness must remain **not ready** until the repository blockers/high findings are resolved and the exact `master` commit passes the staging evidence gate.

## Audit package

- [Command and runtime evidence](command-evidence.md)
- [Route, entity, authorization, and module inventory](inventory.md)
- [Requirements-to-implementation-to-test matrix](requirements-evidence-matrix.md)
- [Dependency and official-document compatibility](dependency-compatibility.md)
- [Approved dependency-ordered repair backlog](repair-backlog.md)
- [Canonical baseline contract](../../baseline/README.md)
- [Route and server-boundary guide](../../baseline/routes-and-server-boundaries.md)
- [CSS and interface guide](../../baseline/css-and-interface.md)
- [Verification and operations guide](../../baseline/verification-and-operations.md)
