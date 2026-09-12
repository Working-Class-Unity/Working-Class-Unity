# Deployment

The public WCU website deploys as one Nuxt/Nitro web process with an events-only SQLite database.
The Compose definition contains `migrate`, `web`, and `backup-runner`. It has no account,
billing, email, or event-sync background worker.

## Image and persistent data

Build with the repository's pinned Node and pnpm versions. The final image contains the standalone
Nuxt output and the packaged maintenance, event import/sync, legacy-event-copy, and off-host backup
operators produced by `server/build-operators.mjs`.

Keep a persistent volume mounted at `/app/data`, with database URL `file:/app/data/app.db`. Web and
maintenance use the same selected image and event database. The one-shot migration service must
finish successfully before web and the backup runner start. Readiness is not a substitute
for the migration gate.

A normal migration initializes or verifies the current events-only schema. It deliberately refuses
the retired application ledger. The first deployment of this version therefore requires the
[separate database cutover](database-cutover.md); do not point it at the old database and retry migration.

## Runtime configuration

Use `.env.production.example` and the exact validation in `server/utils/runtime.ts` as the contract.
The web process needs:

- `NUXT_PUBLIC_APP_NAME` and `NUXT_PUBLIC_APP_URL` for public identity and canonical URLs;
- `NUXT_DATABASE_URL` for the persistent event database;
- `NUXT_READINESS_TOKEN` for the private readiness probe;
- optional paired Sentry settings described in [observability](observability.md).

The public application URL is an origin; production uses HTTPS except for loopback verification.
Credentials remain runtime-only except for the separately scoped Sentry build upload token. There
are no `MODULES_*` switches, Stripe runtime credentials, Better Auth secret, Resend/Twilio inputs,
OpenAI credentials, or user-file R2 inputs. Remove retired values from deployment configuration
when carrying out the approved cutover. The events operator uses a local organizer browser session;
Solidarity credentials are not deployed.

Start the web output with the Sentry preload retained by the image:

```bash
node --import ./.output/server/sentry.server.config.mjs .output/server/index.mjs
```

Sentry makes no provider calls when unconfigured. The shipped Compose deployment requires all five
`BACKUP_R2_*` inputs for its backup runner; see [the backup runbook](../ops/backup-runbook.md).
The standalone web process does not require R2 credentials. Keep them restricted to the runner,
outside the web environment and image build arguments.

## Release verification

Run `node scripts/run-pnpm.mjs run verify` for the code candidate. Confirm the selected commit,
image, persistent volume, migration result, and actual deployed configuration before release.
Deployment and production data conversion require their own authorization.

After deployment, check:

1. `/api/live` returns `204` and the private readiness check returns `200` with `status: ready`.
2. Public pages, all supported languages, navigation, and the calendar load.
3. Membership and Solidarity choices open the existing hosted Stripe pages; Manage subscription
   opens the Stripe portal. Link verification does not require making a payment.
4. RSVP links open the intended Solidarity pages, and member-tagged events appear nowhere public.
5. Public metadata and discovery files resolve through the CDN, and configured observability and
   event backups remain operational.

Use [the deployment checklist](../ops/deployment-checklist.md) and keep operational evidence private.
Routine event updates use [on-demand sync](solidarity-event-sync.md), not application redeployment.
