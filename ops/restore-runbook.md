# Restore Runbook

## When To Use

Use this runbook when a database initialized from the exact current four-entry package, or upgraded from its exact preserved two-entry prefix, is corrupted, accidentally changed, or must be restored onto replacement infrastructure. Any other populated or ambiguous database or backup fails closed; this is not an adoption or conversion path. The repository proves the local operator and restore primitive without live credentials. When off-host backup is selected, #36 provisions the Coolify/R2 destination, private runner, private receipt sink, and off-host dead-man topology under separate infrastructure authority; #37 creates and configures the schedule and notifications, then executes and certifies upload, failure/silence/freshness, and restore behavior. A fork that omits this capability must supply a separately reviewed compatible local or alternative backup, or it has no repository-provided off-host recovery path. Restore duration is recorded as an observation; this baseline makes no RTO promise.

SQLite backup/restore covers locally persisted AI text plus File/Web citations. It does not back up, restore, replace, or delete OpenAI Files/vector stores, and Web Search creates no application-owned provider object to restore. After a database restore, separately verify the intended environment-specific project/store and reviewed Web allowlist through restricted runtime configuration before enabling either search capability. Perform corpus replacement/deletion only with the explicit operator workflow and separate operator credential; the restore job and readiness probe make no OpenAI call.

When off-host backup is selected, routine snapshots, dedicated R2 policy, retries, freshness checks, and authenticated retrieval are defined in [the off-host backup runbook](backup-runbook.md). Retrieve the exact incident-selected immutable object through that command before stopping writers. A backup-disabled fork must instead place its separately reviewed compatible recovery input through the same safe local input boundary before continuing. The fetched or supplied file is verified and published beneath `/app/data/backups`; preparation never modifies the active database.

## Restore Steps

1. Record the incident time, affected environment, selected Git commit and local image ID, persistent mount type and Docker identity/source, chosen backup identity, and last known good time. While the app container still exists, run this fail-closed preflight and keep the same shell open through the restore. These commands are for a named volume. If Coolify uses a bind mount, stop and use the separately recorded exact bind source instead.

   ```bash
   set -euo pipefail

   APP_CONTAINER='replace-with-running-coolify-container'
   DATA_VOLUME='replace-with-coolify-data-volume'
   IMAGE="$(docker inspect --format '{{.Image}}' "$APP_CONTAINER")"

   docker volume inspect "$DATA_VOLUME" >/dev/null
   VERIFIED_DATA_MOUNT="$(docker inspect --format '{{range .Mounts}}{{if eq .Destination "/app/data"}}{{.Type}} {{.Name}} {{.Destination}}{{end}}{{end}}' "$APP_CONTAINER")"
   test "$VERIFIED_DATA_MOUNT" = "volume $DATA_VOLUME /app/data"
   ```

2. Temporarily suspend the approved `master` auto-deploy trigger and process restart policies, then stop migration, web, worker, any enabled private backup runner, and every other process that can open SQLite. Ensure no deployment can restart or overlap a writer. `--confirm-app-stopped` is an operator assertion, not automatic process discovery; do not supply it while any writer can restart.
3. Confirm that the chosen backup has the exact current ledger from the selected image. Place the regular file directly inside `/app/data/backups` without overwriting another path or using a symbolic link. Do not manually overwrite `app.db`, and do not separate it from `app.db-journal`, `app.db-wal`, or `app.db-shm`: SQLite documents that a [backup or restore during an active transaction can corrupt state](https://www.sqlite.org/howtocorrupt.html#_backup_or_restore_while_a_transaction_is_active).
4. Run the restore with the exact image that will serve the application:

   ```bash
   set -euo pipefail

   : "${IMAGE:?run the mount preflight first}"
   : "${APP_CONTAINER:?run the mount preflight first}"
   : "${DATA_VOLUME:?run the mount preflight first}"
   : "${VERIFIED_DATA_MOUNT:?run the mount preflight first}"
   docker volume inspect "$DATA_VOLUME" >/dev/null
   test "$VERIFIED_DATA_MOUNT" = "volume $DATA_VOLUME /app/data"
   if docker inspect "$APP_CONTAINER" >/dev/null 2>&1; then
     test "$(docker inspect --format '{{.State.Running}}' "$APP_CONTAINER")" = 'false'
   fi
   RUNNING_VOLUME_CONTAINERS="$(docker ps --quiet --filter "volume=$DATA_VOLUME")"
   test -z "$RUNNING_VOLUME_CONTAINERS"

   docker run --rm \
     --network none \
     --no-healthcheck \
     --mount "type=volume,source=$DATA_VOLUME,target=/app/data" \
     --env NUXT_DATABASE_URL=file:/app/data/app.db \
     "$IMAGE" node .output/server/maintenance.mjs restore \
     --input /app/data/backups/replace-with-known-good.db \
     --confirm-app-stopped
   ```

5. Require a zero exit and `Restore passed`. Before touching live state, the job verifies the input's recognized non-empty supported ledger/schema, copies it to a same-volume staging database, applies this image's committed migrations, requires the exact packaged migration ledger/schema, invalidates every restored session and one-time `verification` row, checkpoints/removes candidate sidecars, and verifies integrity plus foreign keys again. Users and account links remain; every person signs in again. A healthy live database receives a verified pre-restore snapshot. Corrupt, not-a-database, empty, hot-journal, or missing-main/orphan-sidecar prior state is instead retained as every existing member of its raw `app.db`/journal/WAL/SHM set in a private `0700` quarantine after installing the verified candidate; record and protect that directory for incident analysis. Busy, locked, permission, or I/O failures do not enter this recovery path and fail closed. During replacement it moves the complete state set together; injected post-install regressions prove installation/final-verification failure restores that set automatically. If automatic rollback itself fails, the job retains the named quarantine directory and exits nonzero for manual recovery.
6. Run the same network-disabled maintenance `verify` command against the restored live path; require integrity, foreign keys, and the exact packaged migration ledger.
7. Keep every writer stopped and reconcile the snapshot's state against the incident timeline: users/account links; invisible family owners, members, and invitations; user-owned projects; detached billing tombstones and current Stripe projection; R2 Files object existence/deletion; locally stored AI conversations/citations and the intended OpenAI project/corpus/Web policy; and every deletion or security event after the snapshot time. An older backup can resurrect deleted application state even though credential rows are purged. If safe reconciliation cannot be established, keep the service stopped and roll back to the verified pre-restore snapshot or another reviewed recovery candidate.
8. After accepting the restored app state, start the Coolify Compose resource from the same selected Git commit. Its one-shot migration must verify and complete before web, the one default worker, and any enabled private backup runner start against the shared `/app/data` volume.
9. Confirm public `/api/live` is `204` and the Docker/Coolify authenticated readiness probe becomes healthy; never print or place the readiness token in a URL. This availability result does not replace the exact-ledger maintenance verification from step 6.
10. Run the read-only deployment smoke, require a fresh login, and verify representative authorized reads, including replay of stored File/Web citations when present. This does not prove that an enabled corpus still exists or that live Web Search/domain filtering works. Live File/Web verification and every mutating provider/integration check belong only in the #37 isolated staging workflow.
11. Check Sentry and Coolify logs for restore-related errors, then record the restored backup key/hash, verified pre-restore snapshot or retained raw quarantine as applicable, completion time, verifier, observed data-loss window, and measured restore duration. The duration is not an RTO.

## Failure Rules

- A missing, empty, corrupt, foreign-key-invalid, wrong-app/schema, outside-backup-directory, or symbolic-link restore input fails closed. A backup output that already exists also fails; no maintenance command overwrites it.
- A database or backup without the exact current packaged ledger is unsupported and fails closed without adoption, automatic deletion, or repair.
- A restore without `--confirm-app-stopped` fails before database work.
- A candidate validation, migration-ledger, or migration failure leaves live database/journal/WAL/SHM state untouched.
- A busy/locked/inaccessible live database fails closed; confirmation never overrides an active writer or I/O failure.
- A successful restore deliberately removes restored sessions and one-time verification records before replacement. It does not claim that every post-snapshot application deletion or provider event was inferred.
- Never delete the pre-restore or off-host backup until the restored release has passed readiness and business-level verification.
- Keep local object bytes and database metadata on the same `/app/data` volume, but remember that consistent cross-system backup timing for R2/OpenAI provider state remains later work. Local user/account deletion does not delete the shared deployment-owned File Search corpus, and restoring SQLite must not mutate it or trigger Web Search.
