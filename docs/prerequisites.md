# Prerequisites

This baseline assumes the project can move from local development to a small production deployment without changing its core architecture. Confirm these before building an app on top of it.

## Accounts

- Git provider account, usually GitHub.
- DigitalOcean account for Droplets and persistent storage planning.
- Coolify instance on a server you control.
- Cloudflare account for DNS/CDN/WAF and only the provider boundaries used by the deployed fork. Off-host database backup needs its own private R2 bucket and bucket-scoped Object Read & Write token. When optional Files also uses R2, it needs a second private bucket and separate token; local Files needs neither.
- Stripe account with one application-owned Product, five distinct recurring Prices (Personal weekly/monthly/annual and Family monthly/annual), one explicit reviewed Billing Portal configuration, a webhook endpoint at `/api/webhooks/stripe`, and Smart Retries configured for eight attempts over no more than 14 days when Billing is enabled. Local development may keep Billing disabled and needs no Stripe account.
- Sentry organization and Nuxt project.
- Transactional email provider and sending domain for staging/production. Local verification uses the capture transport and requires no provider account.
- Google Cloud project, OAuth web client, and consent-screen ownership only when Google sign-in will be enabled. The baseline stays startable with Google disabled and no account.
- OpenAI API organization/project, API billing, and a project service-account key only when AI will be enabled. File Search additionally needs a deployment-owned vector store in that environment's project and a separate operator credential only while running the explicit corpus command. Web Search additionally needs a reviewed deployment-owned allowlist of one through 100 public domains. A ChatGPT subscription does not include API usage; local tests and AI-disabled forks require no OpenAI account, key, vector store, domain policy, or paid call.

## Local Tools

- Node.js `>=24.11.0 <25.0.0`; `.nvmrc` selects the supported Node 24 line.
- npm, which is bundled with standard Node.js distributions and the official Node image.
- pnpm 11.1.2, invoked either through the repository runner or installed separately at that exact version. Corepack is not required.
- Git CLI.
- Standard `tar` extraction on macOS or Linux for the checksum-verified Gitleaks release. The executable scanner contract currently supports x64 and arm64 on those two operating systems.
- SQLite CLI for local database inspection and debugging.
- Code editor with TypeScript and ESLint integration. Add Stylelint integration once handwritten CSS becomes large enough to justify it.

Run the local prerequisite and project checks with:

```bash
node scripts/supply-chain-scan.mjs all
npm run bootstrap
npm run verify:pinned
```

Run the live supply-chain gate before the first application dependency install. It uses Node built-ins plus checksum-pinned scanner binaries, so a clean checkout does not need `node_modules` first.

`npm run bootstrap` and `npm run verify:pinned` both use
`scripts/run-pnpm.mjs`. The runner reads `packageManager` and uses
`npm exec --package=pnpm@<exact-version>` so a clean machine does not need
Corepack or a global pnpm install. If pnpm 11.1.2 is already on `PATH`, direct
`pnpm run ...` commands are also supported.

Local verification reads `.nvmrc`, runs the dependency, secret, and signature scanners before application dependency installation, bootstraps through the exact pnpm runner, and then runs the deterministic gates. Use `pnpm run check` during ordinary development and `pnpm run verify` before a release or handoff. The runner's own exact-version `pnpm@11.1.2` download through npm is the documented bootstrap trust root and is not covered by pnpm's later registry-signature audit.

## Knowledge

A junior developer working in this starter should be comfortable with semantic HTML, basic accessibility expectations, Vue single-file components, Nuxt routing and server routes, SQL basics, environment variables, secrets, and reading deployment logs.

## Environment Contract

`.env.example` is the local development configuration contract. `.env.production.example` is the production/Coolify contract and includes production-safe defaults for the Nitro target and persistent SQLite path. Copy the right template for the environment you are configuring, then keep real values out of source control.

Database-backup credentials are absent from `.env.example` and Nuxt runtime configuration; `.env.production.example` lists only their blank deployment-contract names. Off-host backup is an optional Compose capability. Forks that omit it need neither `COMPOSE_PROFILES=backup` nor any backup value. Persistent baseline staging/production enables the profile for build and runtime and supplies the five Runtime-only, Build-disabled `BACKUP_R2_*` values documented in [the backup runbook](../ops/backup-runbook.md). Reviewed Coolify injects the resource `.env` into every service, so Compose overrides those keys to empty on migration, web, and worker and maps their configured values only into the backup runner, whose startup validates them before any operator can run. Local development and ordinary builds/tests require none.

Root operational scripts load the repository-root `.env` with Node 24's `--env-file-if-exists`; values already exported by the shell take precedence. The Nuxt production build does not load that file. Use root-relative local defaults from the `apps/web` working directory. For example:

```dotenv
NUXT_DATABASE_URL=file:../../data/app.db
NUXT_READINESS_TOKEN=local-readiness-token-change-me-32-chars
NUXT_BETTER_AUTH_SECRET=local-development-secret-change-me-32-chars
NUXT_BETTER_AUTH_URL=http://localhost:3000
NUXT_SOCIAL_PROVIDERS_GOOGLE_ENABLED=false
NUXT_SOCIAL_PROVIDERS_GOOGLE_CLIENT_ID=
NUXT_SOCIAL_PROVIDERS_GOOGLE_CLIENT_SECRET=
NUXT_EMAIL_TRANSPORT=capture
NUXT_EMAIL_FROM="SmallWiseLabs Base App <no-reply@example.test>"
NUXT_EMAIL_CAPTURE_DIRECTORY=../../data/email-capture
NUXT_PUBLIC_APP_URL=http://localhost:3000
```

`NUXT_READINESS_TOKEN` is private runtime configuration and is required in every environment. Replace the committed local sample with a unique production value of at least 32 characters; do not put it in `NUXT_PUBLIC_*`, a URL, or a Coolify UI health-check path.

Capture messages are private test artifacts, not a development mailbox. The directory is resolved from the web server's working directory, and each JSON file contains the recipient and complete bearer authentication or invitation URL. Keep the directory out of source control, logs, and shared artifacts, and remove captures when they are no longer needed. Production instead selects `NUXT_EMAIL_TRANSPORT=smtp` and supplies the exact SMTP fields in `.env.production.example`; a resolved send is only sender/transport acceptance, while real inbox delivery remains R-033 staging evidence.

`NUXT_SOCIAL_PROVIDERS_GOOGLE_ENABLED` is independently required and must be exact lowercase `true` or `false`. False requires no Google credentials and exposes no Google control. True additionally requires both the client ID and private client secret before listen. Configure the web client's redirect URI as the exact application origin plus `/api/auth/callback/google`; real consent/callback/denial/unlink/relink/revocation evidence remains R-033.

The six `NUXT_MODULES_<ID>_ENABLED` values are required and must be lowercase `true` or `false`. Provider values are required only when their module is enabled. Exact `false` is healthy-disabled across routes, direct services, workers, UI, and protected readiness, even if stale provider values remain; remove stale values and unused aliases instead of treating them as an alternate state signal. Missing, malformed, or Nuxt-mismatched flags are incomplete and fail startup/readiness.

AI-ready configuration uses exact `openai@6.47.0` and requires private `NUXT_OPENAI_API_KEY`, `NUXT_OPENAI_PROJECT_ID`, and `NUXT_OPENAI_MODEL=gpt-5.6-luna`. Private subordinate `NUXT_OPENAI_FILE_SEARCH_ENABLED` and `NUXT_OPENAI_WEB_SEARCH_ENABLED` switches are always required and default to exact `false`; neither can be true while AI is disabled. AI can be ready with either capability false. File Search true additionally requires one trimmed `NUXT_OPENAI_FILE_SEARCH_VECTOR_STORE_ID` for that environment's deployment-owned corpus. Web Search true additionally requires one through 100 canonical comma-separated ASCII hostnames in `NUXT_OPENAI_WEB_SEARCH_ALLOWED_DOMAINS`; do not include schemes, paths, ports, credentials, wildcards, IP addresses, whitespace, trailing dots, duplicates, or redundant subdomains already covered by an allowed parent. Keep runtime and operator credentials separate: `OPENAI_CORPUS_OPERATOR_API_KEY` and `OPENAI_CORPUS_PROJECT_ID` belong only in the environment of the explicitly invoked corpus command, never Nuxt/Coolify runtime configuration. Keep keys server-only, bind each persistent environment to a separate OpenAI project, and configure API spend/rate controls before provider certification. Readiness validates configuration and SQLite but never calls OpenAI, retrieves a store, searches files/the web, or validates live domain behavior. Local tests inject deterministic fakes and incur no charge; keep AI, File Search, and Web Search disabled and omit provider values unless a capability is deliberately being configured. Issue #37 owns live model, corpus, Web domain/citation, cost, retention, permission, third-party, and deletion certification. See [the OpenAI guide](openai.md).

Billing-ready configuration requires `NUXT_MODULES_JOBS_ENABLED=true` and the private `NUXT_STRIPE_SECRET_KEY`, `NUXT_STRIPE_WEBHOOK_SECRET`, `NUXT_STRIPE_PORTAL_CONFIGURATION_ID`, `NUXT_STRIPE_PERSONAL_WEEKLY_PRICE_ID`, `NUXT_STRIPE_PERSONAL_MONTHLY_PRICE_ID`, `NUXT_STRIPE_PERSONAL_ANNUAL_PRICE_ID`, `NUXT_STRIPE_FAMILY_MONTHLY_PRICE_ID`, and `NUXT_STRIPE_FAMILY_ANNUAL_PRICE_ID`. All five Price IDs must be distinct. The exact `stripe@22.3.1` server SDK owns provider transport and signature verification. The client selects only an allowlisted application tier/cadence and never supplies a Price ID or quantity; no provider secret belongs in `NUXT_PUBLIC_*`. Billing also requires exactly one supervised worker built from the web's selected commit and Dockerfile against the same SQLite volume. The conditional account link and `/account/billing` page use the role-oriented backend under `/api/account/billing`; the webhook remains `/api/webhooks/stripe`. An unpaid fork keeps Billing disabled, needs no Stripe account or credential, and renders no billing UI. Do not use module disablement as a substitute for decommissioning an existing live provider subscription.
