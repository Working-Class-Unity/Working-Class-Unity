# Working Class Unity

This branch is the standalone rebuild of the Working Class Unity website. It starts from a
reviewed Baseline snapshot without importing Baseline's Git ancestry, then removes the Baseline
product model that WCU does not need.

The rebuild is a pre-launch foundation. It deliberately has only a minimal interface; WCU will not
launch it until the application UI is designed and the hosted integrations are certified.

## Current foundation

- Nuxt 4, Vue 3, Nitro, SQLite, and Drizzle in one root application package.
- Open registration through email magic links only.
- Private accounts with a display name, optional avatar, and an operator-assigned `user | admin`
  role. New accounts are non-members; membership authorization comes later.
- Private, user-owned file storage through local storage or Cloudflare R2.
- Private, user-owned OpenAI conversations with deployment-owned File Search and allowlisted Web
  Search available to the server. Private R2 files are not automatically indexed into OpenAI.
- Purchaser-owned Stripe Billing. The final one-membership/two-price WCU catalog is deferred until
  the rest of the foundation is complete.
- Resend transactional email, SQLite-backed jobs, Sentry observability, and separate R2 database
  backups.
- A Docker/Coolify deployment shape with one web process, one worker, a migration gate, and an
  off-host backup process.

Family workspaces, generic Projects, invitations, social login, passwords, and runtime product
switches are not part of WCU.

The rebuild decisions and exact source boundary are recorded in
[`docs/wcu-rebuild-provenance.md`](docs/wcu-rebuild-provenance.md). Agent working rules are in
[`AGENTS.md`](AGENTS.md).

## Local development

Use Node 24 and the exact `pnpm@11.1.2` package manager pinned in `package.json`. The repository
runner can obtain the pinned pnpm version without a global install.

```bash
nvm use
cp .env.example .env
node scripts/run-pnpm.mjs install --frozen-lockfile
node scripts/run-pnpm.mjs run db:migrate
node scripts/run-pnpm.mjs run dev
```

If Node 24 is already active, the `nvm use` line is unnecessary. Review `.env.example` rather
than copying its local-only values into a deployed environment. Local and test email uses the
private capture transport; production uses Resend.

The app and worker share one SQLite database, so run the worker in another terminal when testing
queued work:

```bash
node scripts/run-pnpm.mjs run worker
```

## Verification

The main local checks are:

```bash
node scripts/run-pnpm.mjs run db:migrate:check
node scripts/run-pnpm.mjs run typecheck
node scripts/run-pnpm.mjs run lint
node scripts/run-pnpm.mjs run stylelint
node scripts/run-pnpm.mjs run test
node scripts/run-pnpm.mjs run build
```

`npm run verify:pinned` runs the complete pinned verification pipeline, including tooling,
supply-chain, runtime, browser, API, and container checks. Network-backed provider certification is
separate: deterministic tests do not prove that WCU's Resend, Stripe, OpenAI, R2, Sentry, or
Coolify credentials and hosted configuration are correct.

## Database and deployment

The rebuild assumes a fresh pre-launch database. Its single initial migration is the complete WCU
schema; it is not an upgrade path for the legacy WCU site or a Baseline database. Do not point the
rebuild at either existing database.

Production is intended for Coolify with private runtime configuration, a persistent `/app/data`
volume, and the migration service completing before web or worker startup. Credentials are not
committed and are intentionally deferred in this branch. The existing WCU domains and subdomains
remain an external DNS/cutover concern; this branch does not recreate the old site's integrations.

## Imported documentation

The Baseline ADRs, audit evidence, and detailed guides under `docs/` remain useful source history,
but many describe removed Baseline behavior. They are not WCU requirements unless the provenance
ledger or current code explicitly ports them. See [`docs/README.md`](docs/README.md) before relying
on an imported document.
