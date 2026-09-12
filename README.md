# Working Class Unity

This repository runs the public Working Class Unity website: campaigns, Know Your Rights guides,
bylaws, organization information, and an events calendar. Nuxt 4, Vue 3, and Nitro serve the site;
SQLite and Drizzle store event metadata imported from Solidarity.

Joining and subscription management happen on Stripe-hosted pages. The website offers the existing
$10/month Membership and $27/month Solidarity links, with equal membership benefits. It has no
website accounts, login, free-user tier, local membership authorization, billing webhook, or
transactional email service.

Solidarity owns event authoring, RSVP forms, and attendance. The website links to Solidarity for
RSVPs and imports only event metadata through an operator-run process. Events tagged
`audience-members` stay classified that way and are excluded from every public listing.

## Local development

Use the supported Node 24 version and exact `pnpm@11.1.2` pinned by the repository toolchain.
The repository runner can obtain pnpm without a global installation.

```bash
cp .env.example .env
node scripts/run-pnpm.mjs install --frozen-lockfile
node scripts/run-pnpm.mjs run db:migrate
node scripts/run-pnpm.mjs run dev
```

Review `.env.example` before configuring a deployed environment. A new database starts empty; use
an events-only import to populate its calendar. There is no background application worker.

## Verification

```bash
node scripts/run-pnpm.mjs run check
node scripts/run-pnpm.mjs run verify
```

`check` runs the repository checks. `verify` adds the production build and packaged runtime,
browser, API, and container checks. Tests use disposable state. They do not certify the current
Stripe payment links, Solidarity dashboard, Sentry project, R2 bucket, or deployed Coolify resource.

## Live data and deployment

This is a live website. A code change does not authorize changing production data or deploying it.
The public-site database is an events-only schema. Normal migration refuses the retired application
database; conversion copies an explicit allowlist of event metadata into a new file.

A separately approved cutover keeps one private temporary rollback backup, verifies the new database
and public site, and then retires the old identity-bearing database and rollback copy. Never run the
retired account-deletion flow: it can cancel real Stripe subscriptions. Existing Stripe subscriptions
remain in Stripe throughout this change.

Docker/Coolify runs one web service after a migration gate, with a separate private R2 backup runner.
The shipped Compose deployment requires the backup runner's R2 credentials. See
[deployment](docs/deployment.md), [database conversion](docs/database-cutover.md),
and the [backup runbook](ops/backup-runbook.md).

## Documentation

Start with [the documentation index](docs/README.md). It links the architecture, interface contract,
Solidarity event workflow, and operational guides. Historical account, billing, AI, and Files
architecture remains in Git history and is not part of this application.
