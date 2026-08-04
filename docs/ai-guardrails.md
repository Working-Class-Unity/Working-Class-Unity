# AI-Assisted Development Guardrails

## Principle

AI-assisted changes must be boxed in by deterministic checks, explicit acceptance criteria, browser verification for UI work, and production feedback after release. Avoid broad prompts like "make it good"; give agents boundaries and evidence requirements.

## Stable Commands

Run these from the repository root:

```bash
pnpm run doctor
pnpm run format:check
pnpm run test:tooling
pnpm run check:supply-chain
pnpm run scan:supply-chain
pnpm run lint
pnpm run stylelint
pnpm run db:migrate:check
pnpm run typecheck
pnpm run test
pnpm run build
pnpm run test:runtime
pnpm run test:browser
pnpm run api:smoke
pnpm run test:container-build
pnpm run test:container-health
pnpm run ops:smoke -- --base-url=http://localhost:3000
npm run verify:pinned
```

`npm run verify:pinned` obtains the exact pnpm version declared by the repository and runs the full local verification without depending on Corepack or a global pnpm install. `pnpm run check` covers formatting, the toolchain and local tooling policies, supply-chain policy, framework security, lint, Stylelint, fresh migration verification, typecheck, and ordinary tests. `pnpm run verify` adds the live supply-chain scan, production build, runtime, browser, isolated API, and disposable Docker boundaries.

`pnpm run format:check` enforces pinned Prettier on the current local change set. `pnpm run test:runtime` invokes the built-runtime and read-only deployment smoke while a SQLite observer and local-provider fingerprint prove no state changed. `pnpm run api:smoke` is a self-contained mutating runner: it refuses arguments and ambient app/provider variables, builds and starts only on loopback with a fresh named temporary database and runtime working directory, records its local fixtures, then removes them on ordinary success or failure. This working directory is filesystem state, not a tenant `Workspace`; provider-account certification remains isolated staging work. Cleanup uses Node's [`mkdtemp`](https://nodejs.org/docs/latest-v24.x/api/fs.html#fsmkdtempsyncprefix-options) and recursive [`rm`](https://nodejs.org/docs/latest-v24.x/api/fs.html#fsrmsyncpath-options).

`pnpm run check:supply-chain` rejects ranged installable dependencies, manifest/lock importer drift, missing or weaker-than-SHA-512 registry integrity, unreviewed scanner configuration or baseline files, mutable scanner pins, and vulnerability exceptions that are broad, stale, duplicate, expired, or longer than 45 days. `pnpm run scan:supply-chain` adds the live OSV, Gitleaks, canary, and pnpm registry-signature evidence. Do not add broad Gitleaks ignores or `gitleaks:allow`; the one historical documentation false positive is an exact reviewed fingerprint in `.gitleaksignore`. Advisory exceptions require an exact package/version tuple with an owner, reason, review date, short expiry, and follow-up Issue in `security/supply-chain-policy.json`.

`pnpm run stylelint` runs pinned maintained standard CSS and Vue configurations against global CSS and Vue single-file components. Its app policy requires Vue rules to live in the `components` layer and rejects `!important`. The former repository CSS regex scanner and its syntax/bookkeeping policies are retired; rendered focus, contrast, target-size, reduced-motion, and responsive outcomes belong to the existing Playwright journey. CSS changes still require browser verification at desktop, 320–390px, and 200% text size as applicable.

## Agent Task Template

Use this structure for implementation tasks:

```text
Goal:
Files likely involved:
Constraints:
Acceptance checks:
Commands to run:
Manual/browser checks:
Do not change:
```

Good task:

```text
Add R2 upload request and completion routes.
Use server/services/storage only.
Validate content type and size.
Do not expose R2 credentials to the client.
Run npm run verify:pinned and the applicable API smoke suite.
Manually test upload success, invalid content type, and unauthorized upload.
```

Bad task:

```text
Make uploads work and clean up the code.
```

## UI Verification

For UI changes:

- Run lint, typecheck, tests, and build.
- Open the page in a browser.
- Check desktop and mobile widths.
- Verify loading, empty, error, and success states.
- Verify keyboard navigation for interactive controls.
- Capture screenshots for review when layout changed.

## Production Feedback

After release:

- Watch Sentry for new errors.
- Check Coolify logs.
- Check DigitalOcean metrics and alerts.
- Check Cloudflare security events for WAF and rate-limit behavior.
- Add a regression test or checklist item for every preventable production bug.

## Dex Workflow

Use dex for long-running implementation plans:

1. Create a parent task for the feature or guide.
2. Create subtasks for each chapter, module, or deliverable.
3. Start work with the relevant task context visible.
4. Complete tasks with a short result and verification evidence.
5. Keep the final summary tied to the completed task tree.
