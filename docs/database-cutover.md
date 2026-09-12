# Retiring the application database

The public-site release uses a fresh events-only database. Conversion copies allowed event metadata
into a new file; it does not migrate users, contacts, sessions, membership, governance, RSVP,
attendance, billing, AI, or upload records.

This is a manual production cutover requiring separate approval. Developing or reviewing the
converter does not authorize opening, replacing, or deleting production data.

## Copy contract

```bash
node scripts/run-pnpm.mjs run db:copy:legacy-events \
  --source /private/cutover/legacy.db \
  --destination /private/cutover/events.db
```

The equivalent packaged command is `node .output/server/copy-legacy-events.mjs` with the same flags.
Supply `--source` before `--destination`. Use a standalone, consistent SQLite backup in DELETE
journal mode, with no `-wal`, `-shm`, or `-journal` sidecars. The old release's packaged maintenance
backup command produces a suitable standalone file. Do not pass the live database or a merely
closed WAL-mode database: the converter rejects WAL-mode headers and sidecars before opening the
source, so even source sidecar files remain untouched. It then reads the source in a consistent
read-only transaction.

The destination must be new; existing database files or sidecars are refused. The converter builds
and verifies a fresh private destination before publishing it with mode `0600`.

It copies the event/session fields, canonical tags, provider links, and safe per-event/session
provenance needed for later sync. Raw mixed import snapshots and old import batches are not copied.
The resulting database contains an events-only import receipt. The verifier compares copied
non-provenance fields and checks SQLite integrity and foreign keys.

Hybrid events require sufficient safe per-half metadata to reconstruct the full occurrence and its
links. If the source cannot establish an exact match, conversion stops with a recapture requirement.
Obtain a reviewed events-only
capture from Solidarity rather than guessing pair identities or copying arbitrary legacy payloads.
`audience-members` is preserved and remains excluded from public output.

## Approved production sequence

1. Record the selected old and new release images, active database/volume, and intended private
   rollback location. Pause deployments, event sync, and every database writer. Stop and remove the
   retired `worker` and `stripe-sync-runner` containers and disable their scheduled tasks before
   installing the new database. Removing their Compose definitions alone can leave orphan containers;
   prove none can still access the volume or restart.
2. Before changing the release, use the old release's packaged maintenance backup command to create
   one private, consistent temporary rollback backup of the retired database. Use that standalone
   DELETE-mode file without sidecars as the conversion source. Do not create routine new
   identity-bearing backups or place this copy in the public application tree.
3. Run the converter to a new destination. Review its result and verify event counts, field
   preservation, hybrid identities, restricted audiences, integrity, and foreign keys.
4. Verify the new release against the new database before replacing the active path. Confirm that
   no retired tables or mixed personal snapshots reached it and that public pages and event sync
   use the expected metadata.
5. With writers stopped, switch the deployment to the new database through the reviewed operational
   procedure. Keep the database and any SQLite sidecars together; do not overwrite a live database
   with shell copy commands. Start only the new release's migration, web, and backup runner.
6. Check public behavior, readiness, event filtering, hosted payment/management links, and the
   ability to preview the next events-only sync. Record acceptance in the private cutover receipt.
7. After verification, retire the old identity-bearing database, sidecars, temporary exports, and
   rollback backup under the approved cutover. Inspect existing local/off-host copies and actual
   retention controls before claiming removal. The rollback copy is temporary, not a new archive.

After cutover, retire only the Stripe webhook endpoint owned by this website so Stripe does not
continue delivering events to removed routes. Confirm its exact destination before changing provider
configuration; other organization integrations remain untouched. This is a separately authorized
cutover action, not something performed by the converter.

Existing Stripe subscriptions remain in Stripe. Never invoke the old account-deletion service as a
cleanup method: its cancellation behavior is incompatible with this cutover. Removing the old web
integration also does not remove or alter Solidarity people, RSVP, or organizing records.

If verification fails before acceptance, keep the public release stopped and use the recorded
rollback procedure. Normal `db:migrate` is not a fallback converter, and current restore accepts
only an events-only database. A rollback to the old image/database is an explicit incident action.
