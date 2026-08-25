# Command and Runtime Evidence

All commands were run on 2026-07-09 against commit `98e6922f9c2893fab0ed1b6f4d79d2d95764ec29`. Database and runtime-test data mutations were limited to `/tmp/swl-baseline-audit.4uUapp`; installation/build generated ignored `node_modules`, `.nuxt`, and `.output` paths in the checkout. No external service was called with credentials and no repository behavior was repaired.

## Host and checkout

| Check | Result |
| --- | --- |
| Branch | `main`, tracking `origin/main` |
| Git history | One commit: `98e6922 Initial commit` |
| Tracked files | 147 |
| Node | `v25.9.0` |
| npm | `11.12.1` |
| Declared package manager | `pnpm@11.1.2` |
| pnpm on initial PATH | Missing |
| Corepack on initial PATH | Missing |
| SQLite CLI | `3.51.0` |
| Docker CLI/daemon | Missing; image execution not reproducible on this host |
| Initial application diff | None; `.dex/` was the only untracked path |

The declared engine is `node >=24`, so Node 25 satisfies the package range but is not the same major as the Node 24 Docker image. A fork-ready baseline should pin and test the intended local/CI/runtime Node line rather than silently accepting any future major.

## Install and repository gates

| Command | Exit | Evidence |
| --- | ---: | --- |
| `npx --yes pnpm@11.1.2 install --frozen-lockfile` | 0 | Reused/installed 1,030 packages; Nuxt prepared generated types; lockfile unchanged. |
| `npx --yes pnpm@11.1.2 run verify` | 0 | Doctor, ESLint, Stylelint, CSS check, PWA check, fresh migrations, typecheck, 20 tests, and production build passed. |
| `pnpm run doctor` within verify | 0 | Presence/pattern/import-boundary checks passed. This is structural evidence, not route behavior. |
| `pnpm run lint` within verify | 0 | ESLint returned no errors. |
| `pnpm run stylelint` within verify | 0 | Stylelint returned no errors. |
| `pnpm run check:css` within verify | 0 | Scanned 14 style-bearing files. The checker covers a few regex/token rules, not all controls or contrast. |
| `pnpm run check:pwa` within verify | 0 | Manifest/service-worker source patterns passed; no browser install/update/offline simulation occurs. |
| `pnpm run db:migrate:check` within verify | 0 | Six migrations applied to a fresh temp DB; required tables/columns/triggers, integrity, and one FTS insertion passed. |
| `pnpm run typecheck` within verify | 0 | `nuxt typecheck` passed. |
| `pnpm run test` within verify | 0 | 3 files, 20 tests passed in 945 ms; test execution time 16 ms. |
| `pnpm run build` within verify | 0 | Nuxt 4.4.5, Nitro 2.13.4, Vite 7.3.3, Vue 3.5.34; node-server output 14.4 MB. Build inspection found 13 client `.map` files under `.output/public/_nuxt`; the production entry/package did not preload emitted `sentry.server.config.mjs`. |

### What `verify` does not run

- API smoke or route integration tests;
- deployment smoke, strict readiness, or production evidence validation;
- browser/E2E or accessibility automation;
- coverage or a coverage threshold;
- dependency, license, provenance, or secret scanning;
- Docker build/run, migration-in-image, or restore drills;
- GitHub Actions, branch protection, or pre-commit hooks.

Several tests assert table names, arrays, source strings, or pure helpers. The API smoke suite is behavioral but is excluded from `verify` and currently preserves unsafe anonymous project behavior.

## Dependency and readiness evidence

| Command | Exit | Evidence |
| --- | ---: | --- |
| `npx --yes pnpm@11.1.2 audit --prod --audit-level=moderate` | 1 | 21 advisories: 6 low, 12 moderate, 3 high. Direct vulnerable versions include Nuxt 4.4.5 (patched in 4.4.7 for cited high issue) and Better Auth 1.6.11 (patched in 1.6.13 for cited high issue). Applicability varies by feature/platform; upgrade and retest are still required. |
| `npx --yes pnpm@11.1.2 outdated --recursive` | 1 | 16 declared dependencies had newer releases; relevant patch updates included Nuxt 4.4.8 and Better Auth 1.6.23. H3 latest was a 2.0 release candidate, so it is not a routine stable upgrade. |
| `npx --yes pnpm@11.1.2 run ops:readiness:strict` | 1 | 30 required checks missing. |
| `npx --yes pnpm@11.1.2 run ops:readiness:strict -- --env-file=.env.production.example` | 1 | 23 required checks missing; static defaults satisfy 7 checks. The separator passes the application environment-file argument through the package script under Node 25. |
| evidence validator against blank template | 1 | Correctly refused the template: `Validate a filled evidence copy`. |
| tracked-file and one-commit credential-pattern scan | 0 | No Stripe/AWS/GitHub/Slack/private-key shaped secrets matched. This is a targeted pattern scan, not a replacement for a maintained secret scanner. |

The readiness script currently requires all provider modules together. That contradicts the agreed independent optional-module contract; the future validator must condition requirements on explicit module enablement.

## Isolated database and runtime

The audit used `DATABASE_URL=file:/tmp/swl-baseline-audit.4uUapp/app.db`.

| Check | Result |
| --- | --- |
| `pnpm run db:migrate` | Passed; migrations applied successfully. |
| `pnpm run db:seed` | Passed; seeded the baseline project. |
| `pnpm run worker` | Passed and exited after one poll: `Worker found no queued jobs`. |
| `pnpm run db:backup -- --database-url=... --output=...` | Passed; 249,856-byte backup; `Integrity: ok`. |
| Independent backup inspection | SQLite `integrity_check` returned `ok`; 21 tables; 8 projects at inspection time. |

### Job claim concurrency proof

The race was reproduced with this exact local-fixture command:

```sh
DATABASE_URL=file:/tmp/swl-baseline-audit.4uUapp/app.db npx --yes pnpm@11.1.2 --filter @smallwiselabs/web exec tsx -e 'import { enqueueJob, claimNextJob } from "./server/services/jobs/job-queue.ts"; void (async () => { const queued = await enqueueJob({ type: "audit.race.repro", payload: { audit: true } }); const [left, right] = await Promise.all([claimNextJob("audit-worker-left"), claimNextJob("audit-worker-right")]); console.log(JSON.stringify({ queuedId: queued.id, left: left && { id: left.id, lockedBy: left.lockedBy }, right: right && { id: right.id, lockedBy: right.lockedBy }, sameJob: left?.id === right?.id }, null, 2)); })();'
```

Both calls returned job ID `1`; the returned worker IDs differed and `sameJob` was `true`. The final row contained only the later worker lock. This executes the race represented by the separate select/update sequence in [job-queue.ts](../../../apps/web/server/services/jobs/job-queue.ts#L37).

## Built-server and HTTP evidence

The built Nitro output ran locally on `127.0.0.1:3109` against the isolated database. With `AUDIT_TMP` set to the isolated temporary directory and `REPO_ROOT` set to the checkout, the recorded local-only startup was:

```sh
env NODE_ENV=production HOST=127.0.0.1 PORT=3109 DATABASE_URL="file:$AUDIT_TMP/app.db" NUXT_DATABASE_URL="file:$AUDIT_TMP/app.db" BETTER_AUTH_URL=http://127.0.0.1:3109 NUXT_BETTER_AUTH_URL=http://127.0.0.1:3109 NUXT_PUBLIC_APP_URL=http://127.0.0.1:3109 BETTER_AUTH_SECRET=audit-only-better-auth-secret-1234567890 NUXT_BETTER_AUTH_SECRET=audit-only-better-auth-secret-1234567890 NUXT_STRIPE_WEBHOOK_SECRET=whsec_audit_only_local_secret node "$REPO_ROOT/apps/web/.output/server/index.mjs"
```

The displayed secrets are non-production audit fixtures.

### Deployment smoke

| Command | Exit | Result |
| --- | ---: | --- |
| `DEPLOYMENT_SMOKE_BASE_URL=http://127.0.0.1:3109 npx --yes pnpm@11.1.2 run ops:smoke` | 0 | 9/9 checks passed: shell, health, observability test page, manifest, offline page, service worker, and three private-route 401 checks. |
| `DEPLOYMENT_SMOKE_BASE_URL=http://127.0.0.1:3109 npx --yes pnpm@11.1.2 run ops:smoke:strict` | 1 | Health status was `degraded`, as expected with external modules disabled/unconfigured. |

### API smoke

The first run failed on the webhook with HTTP 503 even though `STRIPE_WEBHOOK_SECRET` was present in the invoking environment. The built app's runtime-config property required `NUXT_STRIPE_WEBHOOK_SECRET`. After the built server was restarted with that override, all 12 smoke scenarios passed with:

```sh
API_SMOKE_BASE_URL=http://127.0.0.1:3109 STRIPE_WEBHOOK_SECRET=whsec_audit_only_local_secret npx --yes pnpm@11.1.2 run api:smoke
```

This suite creates durable fixtures and is reproducible only against a disposable local/integration database and provider sandbox. It is not a deployment or production smoke command.

This is not merely a test harness discrepancy; it confirms CFG-001.

### Anonymous boundary probes

| Request | Status | Observed behavior |
| --- | ---: | --- |
| `GET /api/projects` | 200 | Returned an array containing 7 project rows. |
| `POST /api/projects` with `ownerId: forged-owner` | 201 | Created the row and returned the forged owner unchanged. |
| `POST /api/ai/chat` | 503 | Reached provider configuration handling rather than returning 401. |
| `GET /api/files` | 401 | Correct anonymous boundary. |
| `GET /api/billing` | 401 | Correct anonymous boundary. |
| `GET /api/storage/objects` | 401 | Correct anonymous boundary; cross-tenant defect begins after sign-in. |
| `GET /api/search?q=audit` | 401 | Correct anonymous boundary. |

The three decisive public probes were rerun with this exact command (the project count grows after each mutating smoke run, but the authorization result does not change):

```sh
node --input-type=module -e 'const base="http://127.0.0.1:3109"; const list=await fetch(base+"/api/projects"); const listBody=await list.json(); const create=await fetch(base+"/api/projects",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({name:"Audit Forged Owner Probe",slug:"audit-forged-owner-"+Date.now(),ownerId:"forged-owner"})}); const createBody=await create.json(); const ai=await fetch(base+"/api/ai/chat",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({messages:[{role:"user",content:"probe"}]})}); console.log(JSON.stringify({listStatus:list.status,listCount:listBody.projects?.length,createStatus:create.status,createdOwner:createBody.project?.ownerId,aiStatus:ai.status},null,2));'
```

### Production runtime-config proof

A second built server received only the documented ordinary environment names, including a valid `DATABASE_URL`. It did **not** receive `NUXT_DATABASE_URL`. From a nested directory below `AUDIT_TMP`, it started with:

```sh
env NODE_ENV=production HOST=127.0.0.1 PORT=3110 DATABASE_URL="file:$AUDIT_TMP/app.db" BETTER_AUTH_URL=http://127.0.0.1:3110 NUXT_PUBLIC_APP_URL=http://127.0.0.1:3110 BETTER_AUTH_SECRET=audit-only-better-auth-secret-1234567890 STRIPE_WEBHOOK_SECRET=whsec_audit_only_local_secret node "$REPO_ROOT/apps/web/.output/server/index.mjs"
```

The exact health/projects/webhook probe was:

```sh
node --input-type=module -e 'const base="http://127.0.0.1:3110"; const health=await fetch(base+"/api/health"); const healthBody=await health.json(); const projects=await fetch(base+"/api/projects"); const projectsText=await projects.text(); const webhook=await fetch(base+"/api/billing/webhook",{method:"POST",headers:{"content-type":"application/json"},body:"{}"}); const webhookText=await webhook.text(); console.log(JSON.stringify({healthStatus:health.status,sqlite:healthBody.checks?.find((x)=>x.name==="SQLite"),projectsStatus:projects.status,projectsBody:projectsText.slice(0,200),webhookStatus:webhook.status,webhookBody:webhookText.slice(0,200)},null,2));'
```

- `/api/health` returned HTTP 200 and claimed SQLite was operational at a different relative path.
- `/api/projects` returned HTTP 500 with `SqliteError: no such table: projects`.
- Supplying `NUXT_DATABASE_URL` made the built application use the intended migrated database.

Nuxt's current documentation explicitly warns that setting runtime-config defaults from differently named environment variables works at build time and breaks runtime overrides. See [Nuxt runtime config](https://nuxt.com/docs/4.x/guide/going-further/runtime-config#environment-variables).

## Browser evidence

The locally built app was inspected in the Codex in-app browser at a 390 × 844 viewport.

| Surface | Observation |
| --- | --- |
| `/` | One `h1`, one `main`, labeled navigation and regions; no horizontal overflow; public UI displayed the absolute SQLite path. |
| Mobile width | `innerWidth` 390 and document `scrollWidth` 375; no horizontal overflow. Brand link measured 36px high; top navigation links measured 40px high, below the stated 44px touch target. |
| `/auth` | One form with email and password; no social/magic-link control; no browser console warnings/errors. |
| `/billing` | Signed-out state was understandable; the form exposes a free-form Stripe price ID; no console warnings/errors. |
| `/observability-client-test` | Public page renders a missing-token status; no console warnings/errors. |

This was not a screen-reader test, automated axe run, real mobile-device run, or PWA installation test. Those remain staging/acceptance evidence.

## Docker and external evidence

Docker was not installed, so image build/run was not executed. Static inspection is still conclusive for missing `.dockerignore`, runtime contents, volume path, and health-check semantics. Those claims must be rechecked by actually building the repaired production image.

No external accounts exist, so Stripe, R2, Turnstile, AI Gateway, Sentry, email, Coolify, DNS/WAF, and real-device checks are marked externally blocked rather than failed.

## Repository impact of the audit

- `node_modules`, `.nuxt`, and `.output` were generated under ignored paths.
- Isolated data and backup files were written under `/tmp/swl-baseline-audit.4uUapp`.
- Audit documentation and Dex tracking are the only intended versionable changes.
- No application, test, migration, runtime, branch, remote, Issue, or PR was changed.
