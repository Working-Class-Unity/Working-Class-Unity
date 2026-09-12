# Restore the event database

Use the selected release's packaged maintenance operator to restore a verified events-only database.
The operator validates database identity, stages the candidate, checks integrity and foreign keys,
and replaces the active SQLite state only after candidate validation. It refuses the retired
application database; conversion is covered by the [cutover guide](../docs/database-cutover.md).

Restore is a separately authorized incident operation. Reading this guide or running local tests
does not authorize replacing production data.

## Prepare

1. Record the incident, selected commit/image, exact persistent database volume, backup identity/hash,
   and expected rollback boundary in the private operations record.
2. Obtain the selected backup through [authenticated fetch](backup-runbook.md), or provide an already
   verified private local backup. Put the regular file directly under `/app/data/backups`; do not
   overwrite another file or use a symbolic link.
3. Pause deployment and restart triggers, on-demand event sync, the backup task, web, and every other
   process using the database. Prove they cannot restart during replacement. The stopped-app flag
   below is an operator assertion, not process discovery.
4. Use the exact selected image, the verified volume mount, and
   `NUXT_DATABASE_URL=file:/app/data/app.db`. Run maintenance with network disabled and without
   Stripe, Solidarity, backup-provider, or Sentry credentials.

## Restore and verify

Inside that isolated maintenance invocation:

```bash
node .output/server/maintenance.mjs restore \
  --input /app/data/backups/REPLACE-WITH-VERIFIED-EVENT-BACKUP.db \
  --confirm-app-stopped
node .output/server/maintenance.mjs verify
```

Require both commands to succeed. The candidate must match the recognized events-only ledger/schema
and pass integrity and foreign-key checks. An existing healthy database receives a pre-restore backup.
If corrupt state is quarantined, retain the reported private quarantine for incident review.
Never manually overwrite a live SQLite main file or detach it from its journal/WAL/SHM sidecars.

Before restarting:

- Confirm representative event/session identities, dates, reschedules, and hybrid pairs.
- Confirm canceled/hidden events and `audience-members` still have the intended classification.
- Reconcile event edits since the snapshot with Solidarity through a fresh preview; restoring an
  older database can restore event metadata that was later changed or retired.
- Keep Stripe subscriptions and Solidarity personal records untouched. Event restore has no account
  deletion, membership reconciliation, email, or provider cancellation step.

Start the same selected Compose release after accepting the restored database. Its migration gate
must finish before web and any enabled backup runner. Check `/api/live`, private readiness, public
pages, the public calendar, and restricted-event exclusion; then resume approved tasks. Record the
result, observed data-loss window, and elapsed time without presenting them as availability guarantees.

## Failure handling

An unsupported schema, invalid backup, wrong location, symbolic link, active writer, or failed candidate
verification must stop the operation. Do not bypass validation or use normal migration to adopt an
old application backup. Keep writers stopped while resolving an uncertain replacement and retain
reported recovery files until verification is complete. If recovery requires the retired image and
identity-bearing database, treat that as an explicit rollback incident rather than an events-only restore.
