# Event database backups

Backups cover the events-only SQLite database, including restricted event metadata and provider links.
They do not back up or modify Stripe subscriptions, Solidarity records, or other provider state.
Keep backups private even though the website is public.

The retired application's identity-bearing database is not a supported input to these operators.
Its one temporary rollback copy belongs to the separate [cutover](../docs/database-cutover.md),
not the ongoing event-backup rotation.

## Local backup

Use the selected release's database URL and packaged maintenance command:

```bash
node .output/server/maintenance.mjs backup
```

Or, from the repository with its configured event database:

```bash
node scripts/run-pnpm.mjs run db:backup
```

The operator uses a consistent SQLite backup, verifies integrity, foreign keys, and the packaged
migration ledger, and writes under the database directory's `backups/` folder. It refuses overwrite.
A same-volume backup helps recover an editing mistake but does not survive loss of that volume.

## Private R2 runner

The shipped Compose deployment includes `backup-runner` and requires its five private R2 inputs.
The runner uses the same image and persistent database volume as web, has no public port or domain,
and validates its configuration before waiting for an operator task. It runs the packaged off-host
operator with these inputs:

```text
BACKUP_R2_ACCOUNT_ID
BACKUP_R2_BUCKET
BACKUP_R2_ENDPOINT
BACKUP_R2_ACCESS_KEY_ID
BACKUP_R2_SECRET_ACCESS_KEY
```

The runner also receives `NUXT_DATABASE_URL=file:/app/data/app.db`. Keep the bucket private, credentials
bucket-scoped, and these values out of the web process, builds, source, logs, and screenshots. Validate
configuration before enabling an approved task:

```bash
node .output/server/off-host-backup.mjs validate-config
```

The configured task invokes:

```bash
node .output/server/off-host-backup.mjs backup
```

A consistent local snapshot is verified, written to an immutable `sqlite/v1/` object with conditional
creation, and read back completely to verify byte count and SHA-256. The local snapshot is removed
only after that verification. An ETag or successful upload status alone is not sufficient.

Record the actual approved schedule, server timezone, timeout, destination retention/lifecycle,
notifications, and independent missed-backup alert. Keep the successful receipt in a private record
that survives loss of the application host. Repository code does not provision those controls or
promise a recovery point/time.

The operator's freshness check reads provider metadata:

```bash
node .output/server/off-host-backup.mjs verify-latest --max-age-hours 12
```

The example threshold must match the approved schedule. This check does not download all bytes and
is not a substitute for successful full read-back or an independently scheduled missed-backup alert.

## Retry and fetch

If upload fails, retain the private snapshot reported by the operator. Diagnose the failure and retry
that exact file, without starting unnecessary new snapshots:

```bash
node .output/server/off-host-backup.mjs upload \
  --input /app/data/backups/sqlite-offhost-REPLACE.db
```

A matching immutable object is accepted only after verification. The command does not overwrite a
different object. If a lock remains after interruption, first prove no backup/fetch process is running
and inspect retained files before removing the lock manually.

Retrieve an incident-selected key from the successful receipt:

```bash
node .output/server/off-host-backup.mjs fetch \
  --key 'sqlite/v1/YYYY/MM/DD/sqlite-offhost-TIMESTAMP-NONCE-sha256-DIGEST.db'
```

Fetch verifies the key, byte count, hash, database identity, integrity, and foreign keys before
publishing a new private regular file under `/app/data/backups`. It does not replace `app.db`.
Use [the restore runbook](restore-runbook.md) for replacement.

## Recovery evidence and retirement

Exercise restore in an isolated disposable volume after material schema or recovery-code changes.
Use the selected image and a verified events-only backup; do not mount production or make provider
mutations. Record observed snapshot age, elapsed restore time, public-event checks, and cleanup.

Inspect actual bucket locks and lifecycle rules before declaring an old backup deleted. During the
identity-removal cutover, account for pre-existing identity-bearing copies separately; routine new
backups must contain only the verified events-only schema.
