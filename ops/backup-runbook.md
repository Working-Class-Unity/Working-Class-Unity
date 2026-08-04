# Off-host SQLite Backup Runbook

## Scope

This runbook creates and retrieves private database backups. It does not back up local Files bytes, OpenAI vector stores, Stripe, email, Sentry, or other provider state. A snapshot containing active Files rows is publishable only when those rows have one matching persisted R2 Files binding; active local Files makes the SQLite-only operation fail closed.

The repository tests the commands with local provider doubles. Issue [#36](https://github.com/smallwiselabs/swl-step-by-step/issues/36) provisions the private bucket/token/policies, persistent Coolify runner, private off-host receipt sink, and independently scheduled dead-man monitor under separate owner authority. [#37](https://github.com/smallwiselabs/swl-step-by-step/issues/37) creates and configures the real task/notifications, then executes and records scheduling, upload, failure/silence/freshness, restore, data-loss-window, and duration evidence. No local test uses an R2 credential or makes a provider call.

## Private R2 destination

Create one dedicated private R2 Standard bucket for each application and environment. It must be different from every user Files bucket and have:

- no `r2.dev` access, public/custom domain, or CORS policy;
- one Object Read & Write token scoped only to this bucket for the backup operator;
- a separate operator/admin identity for bucket policy, token, Bucket Lock, and lifecycle changes;
- a 30-day Bucket Lock for prefix `sqlite/v1/`;
- lifecycle expiration after 35 days for the same prefix.

The runner never uses the Files module's `NUXT_CLOUDFLARE_R2_*` values and contains no delete command. R2 supplies TLS transport and Cloudflare-managed AES-256 encryption at rest; Cloudflare documents GCM as its preferred mode. The baseline does not claim client-side encryption.

## Coolify runner and schedule

Current Coolify Scheduled Tasks execute inside an existing container. They are not one-shot isolated jobs. Off-host backup is an optional deployment capability: forks may omit it and accept or replace the resulting recovery boundary, while persistent baseline staging/production explicitly enables it. Set `COMPOSE_PROFILES=backup` for both Coolify build and runtime so the shared application image is built before cutover and the private `backup-runner` starts from it after migration. The enabled service has:

- the selected Git commit and resulting local image ID used by web and worker;
- the same writable `/app/data` volume;
- no port, domain, or inherited HTTP health check;
- init-backed signal forwarding and an inert long-running command;
- the ordinary app runtime values plus the five backup-only values below.

```text
NUXT_DATABASE_URL=file:/app/data/app.db
BACKUP_R2_ACCOUNT_ID=32-lowercase-hex-account-id
BACKUP_R2_BUCKET=dedicated-private-backup-bucket
BACKUP_R2_ENDPOINT=https://ACCOUNT_ID.r2.cloudflarestorage.com
BACKUP_R2_ACCESS_KEY_ID=private-runner-value
BACKUP_R2_SECRET_ACCESS_KEY=private-runner-value
```

Use the exact documented default, EU, or FedRAMP account endpoint for the bucket jurisdiction. The backup runner validates all five values before becoming stable. Because reviewed Coolify injects one shared resource `.env` into every service, Compose explicitly overrides the keys to empty on migration, web, and worker and substitutes their configured values only into the runner. Keep them Runtime-only and Build-disabled. Keep real values out of the blank `.env.production.example` contract, Nuxt runtime configuration, image build arguments, logs, Sentry, screenshots, and repository evidence. With the profile disabled, omit all five values and do not configure the task.

Target the private runner with this Coolify Scheduled Task:

```text
Schedule: 17 */6 * * *
Command: node .output/server/off-host-backup.mjs backup
Timeout: 1800 seconds
```

Record the Coolify server timezone. Enable both failure and success notifications, but keep command output private. Maintenance may emit its bounded verification status; the final successful operator receipt line contains the immutable object key, byte count, and SHA-256. Deliver that receipt to a private off-host operations record that survives loss of the Coolify host and control-plane database. The routine local snapshot is removed only after R2 has returned the complete object and its bytes have been hashed successfully.

Configure an off-host dead-man monitor whose scheduler and state do not share the Coolify application host. It must alert when the expected success signal is missing, even when Coolify emits neither a success nor a failure event. The packaged read-only metadata check is:

```bash
node .output/server/off-host-backup.mjs verify-latest --max-age-hours 12
```

Run it with the backup-runner environment as a provider metadata check, not as a substitute for the off-host dead-man or the successful task's full byte read-back. It selects the newest syntactically valid key from the current/previous UTC date prefixes and requires matching size, format, and SHA-256 metadata; it does not download and hash those bytes again. Metadata older than 12 hours is an incident. While scheduling and R2 are healthy, the six-hour cadence means a host loss may discard approximately six hours of database changes. During a backup outage, exposure grows until recovery. These are operational observations and thresholds, not an RPO or availability promise.

## Manual backup and retry

Run the same packaged command manually inside the private runner when a scheduled execution needs confirmation:

```bash
node .output/server/off-host-backup.mjs backup
```

The command uses SQLite's Online Backup API while web/worker may remain active. It verifies the exact copied snapshot, uploads one immutable conditional object with provider-validated `Content-MD5`, and performs a full R2 read-back/SHA-256 comparison. The SDK performs no hidden retry. An uncertain PUT is accepted only when the exact immutable object can be read and fully verified.

On failure, the command prints the basename of a retained private snapshot. Investigate the provider/task failure, then retry that exact regular file:

```bash
node .output/server/off-host-backup.mjs upload \
  --input /app/data/backups/sqlite-offhost-REPLACE.db
```

Success removes the local retry file. The same key is idempotent only when its complete remote bytes match. The command never overwrites a local or remote object.

If `.off-host-backup.lock` remains after an uncatchable process/container interruption or a reported private-cleanup failure, first prove that no backup/fetch process is running, inspect and retain any local snapshot or hidden stage needed for incident analysis, and only then remove the lock explicitly. Never automate stale-lock adoption.

## Retrieve a selected backup

Use the exact key and SHA-256 from the successful-task record, not merely the newest-looking object in the bucket. While the backup runner has network access and before stopping the app, retrieve it with:

```bash
node .output/server/off-host-backup.mjs fetch \
  --key 'sqlite/v1/YYYY/MM/DD/sqlite-offhost-TIMESTAMP-NONCE-sha256-DIGEST.db'
```

The command validates the namespace/date/digest, refuses overwrite, streams into a private hidden file, checks byte count and SHA-256, verifies the recognized database ledger/schema plus integrity/foreign keys and off-host Files coverage, and only then publishes a regular `0600` file directly below `/app/data/backups`. It does not touch `app.db`.

Keep the complete object key, hash, chosen incident time, and resulting local basename in the private incident record. Do not include database bytes, provider errors, credentials, user data, or raw object metadata in shared evidence.

## Restore

Continue with [the restore runbook](restore-runbook.md). In summary:

1. Temporarily suspend the approved `master` auto-deploy trigger and every restart policy.
2. Stop migration, web, worker, any enabled backup runner, and every SQLite writer. Prove none can restart or still uses the volume.
3. Run the exact selected image's network-disabled `maintenance.mjs restore --confirm-app-stopped` against the fetched file.
4. Require isolated validation/migration, exact schema/ledger, integrity, foreign keys, and the successful staged replacement. Restored sessions and one-time verification records are deliberately invalidated before replacement.
5. Keep all writers stopped while reconciling users/accounts, family state, projects, billing/tombstones, R2 Files objects, AI/provider configuration, and deletions/security events after the snapshot time.
6. Start the Compose resource only after the restored database is eligible. Require its one-shot migration to complete before web, worker, and any enabled backup runner start. Users must sign in again.

Record elapsed restore time as an observation. Do not turn it into an RTO commitment.

## Drills and retention consequences

Perform one isolated restore drill each month and after a material schema, maintenance-image, or storage-boundary change:

1. Select the exact immutable key/SHA-256 from the private off-host successful-task record, and record the source Git commit, local image ID, and drill start time.
2. Create a new empty disposable encrypted volume or equivalent private replacement environment. Do not mount the staging or production volume, expose a public route, or supply application/provider credentials other than the bucket-scoped backup credential needed for fetch.
3. Use the selected immutable image's `off-host-backup.mjs fetch` command to place the verified object under the disposable volume's `/app/data/backups` directory.
4. Remove backup network credentials from the next process and run the same image's network-disabled `maintenance.mjs restore --confirm-app-stopped` into the empty volume, followed by `maintenance.mjs verify`.
5. Keep the replacement isolated while checking the recognized ledger/schema, integrity, foreign keys, session/one-time-verification invalidation, representative family/project/billing data, R2 Files reconciliation, and every enabled module's documented recovery boundary. Do not make mutating provider calls from the drill.
6. Record the observed snapshot age/data-loss window, elapsed duration, safe redacted result, and cleanup authorization. Destroy the disposable restored data and volume only after the evidence is retained and no investigation requires them.

Issue #36 explicitly enables the backup profile for persistent staging and provisions the bucket, runner, private off-host receipt sink, and dead-man topology. Issue #37 creates and configures the task and notifications, then executes and certifies the first real scheduled upload/download/restore, Bucket Lock/lifecycle behavior, task notification, silent-scheduler alert, object inventory, enabled-provider reconciliation, observed data-loss window, and measured duration.

An older backup can resurrect data deleted after its snapshot, including accounts, projects, conversations, invitations, file metadata, and stale billing projections. Backup retention therefore limits claims of immediate physical erasure. Sessions and one-time verification credentials are purged during restore, but operators must reconcile every other post-snapshot deletion and provider event before serving traffic.
