# Stripe Membership Synchronization Runbook

## Scope and safety boundary

The packaged operator reads a complete Stripe account snapshot and imports membership, identity, invoice, payment, refund, dispute, discount, and actual dues-revenue data into the shared SQLite database. It never writes to Stripe. It is separate from the application billing integration and must not receive `NUXT_STRIPE_SECRET_KEY` or any other application/provider credential.

This is a full reconciliation input, not a Stripe change feed. Each run pages through all customers, products, prices, subscriptions and items, invoices and lines, invoice payments, charges, refunds, and disputes. Changed provider objects are retained as raw private snapshots; no automatic retention purge is included. An object omitted by Stripe is not interpreted as a deletion. Measure the first representative run before enabling the daily schedule and revisit the design if its duration or retained history becomes operationally excessive.

## Dedicated restricted key and fixed binding

Create a separate Stripe restricted key for this synchronization service. Follow Stripe's [restricted-key guidance](https://docs.stripe.com/keys/restricted-api-keys) and grant Read access only for the resources used by the operator: Customers, Products/Prices, Subscriptions/Items, Invoices/Lines/Invoice Payments, Charges, Refunds, Disputes, and any Coupon read permission required for expanded discounts. Grant no write permission and no Checkout, Customer Portal, webhook, or subscription-mutation permission. Prove the allowed reads and representative denied writes in a Stripe sandbox, then inspect Stripe request logs to remove any unused permission.

Configure these values only on the `stripe-sync-runner` in Coolify:

```text
NUXT_DATABASE_URL=file:/app/data/app.db
WCU_STRIPE_MEMBERSHIP_SYNC_KEY=rk_live_REDACTED
WCU_STRIPE_MEMBERSHIP_SYNC_MODE=live
WCU_MEMBERSHIP_GRANDFATHERED_BEFORE=YYYY-MM-DDTHH:MM:SS.000Z
```

Use `mode=test` with an `rk_test_*` key in isolated staging and `mode=live` with an `rk_live_*` key in production. The operator rejects a mode/key mismatch. Keep the key Runtime-enabled and Build-disabled. Keep all three synchronization values out of `.env.production.example`, Git, image build arguments, shared logs, Sentry, screenshots, and evidence. The non-secret mode and cutoff remain runner-only to prevent accidental drift.

Choose the cutoff once at production cutover so subscriptions that began before it are grandfathered as current active members. The first apply attempt binds both mode and cutoff in SQLite before provider work begins. Later runs fail if either changes, even when that first attempt failed; changing the binding requires a separately reviewed data-migration decision, not an environment edit. Complete the dry-run and configuration review before the first apply.

## Runner and first certification

The Compose service is an inert, same-image, same-volume task target. It exposes no port, has no HTTP health check, pins `NODE_ENV=production`, and validates its database, schema, mode, cutoff, and key shape before sleeping. Production mode rejects command-line database, cutoff, and observation-time overrides. Migration, web, worker, and backup runner explicitly receive empty synchronization values; the synchronization runner explicitly receives empty application and backup credentials.

Before the first production apply:

1. Deploy the selected commit with the three runner values configured and require the runner to stay healthy after `--validate-config`.
2. Require a recent verified off-host SQLite backup.
3. Run the packaged command without `--apply` once in the runner. It performs the complete Stripe read and prints only aggregate counts, issue-code counts, and calculated revenue without changing SQLite.
4. Investigate nonzero issue counts. Ambiguous identities are expected to remain unlinked for organizer review; the receipt never prints the Stripe object IDs involved.
5. Record the measured duration and retained-snapshot growth. Set a timeout with reasonable headroom and keep it shorter than the schedule interval.
6. Run one manual apply and verify its import batch, membership/standing results, redacted status, and repeat idempotence before enabling the schedule.

Commands inside `stripe-sync-runner`:

```bash
node .output/server/import-stripe-membership.mjs --validate-config
node .output/server/import-stripe-membership.mjs
node .output/server/import-stripe-membership.mjs --apply
```

## Daily Coolify task

Coolify scheduled commands run inside the selected existing container; target only `stripe-sync-runner`. Start with:

```text
Schedule: 17 3 * * *
Command: node .output/server/import-stripe-membership.mjs --apply
Timeout: 1800 seconds, only after the measured first run establishes adequate headroom
```

Record the Coolify server timezone. Enable success and failure notifications and keep task output private. Add an independent freshness alert when no completed synchronization has been recorded for 26 hours; a scheduler that never starts a task may not generate a task-failure event. Coolify documents the [existing-container task model](https://next.coolify.io/docs/core/automation/scheduled-tasks/overview) and available [notification events](https://coolify.io/docs/knowledge-base/notifications/).

The operator permits only one apply at a time through `/app/data/.stripe-membership-sync.lock`. SQLite waits at most five seconds for another writer and the import acquires its write transaction immediately after the provider fetch. The provider fetch never holds a SQLite transaction. Normal failures release the lock and leave a redacted failure status; an abrupt kill or container interruption deliberately leaves the lock fail-closed.

## Receipts, failures, and retry

Successful private output contains the local import-batch ID plus aggregate fetched, snapshot, identity, membership, revenue, and issue-code counts. It excludes Stripe object IDs, people, emails, raw provider responses, and credentials. The latest redacted state, including the last successful completion time across later failures, is stored under `membership.stripe-sync-status.v1`; the immutable mode/cutoff binding is stored under `membership.stripe-sync-binding.v1`. Actionable issue codes and provider object IDs are retained privately under `membership.stripe-sync-issues.v1` for authorized organizer review but never copied to task output. Normal import history remains in `import_batches` and provider data remains in the normalized Stripe tables and `external_record_snapshots`.

Failure output uses one bounded code:

- `configuration_invalid`: required values, timestamp, key shape, database, schema, or stored state is invalid;
- `binding_changed`: configured Stripe mode or grandfathering cutoff differs from the first apply attempt;
- `overlap_detected`: the private lock already exists;
- `database_busy`: SQLite remained busy or locked beyond the bounded wait;
- `stripe_fetch_failed`: Stripe could not supply the complete snapshot;
- `import_failed`: preflight or atomic SQLite import failed;
- `lock_cleanup_failed`: the private lock could not be removed after the operation.

For an ordinary failure, investigate the private notification and redacted database status, correct the cause, confirm no deployment/migration/restore is active, and rerun the same packaged `--apply` command. Do not retry indefinitely.

If `.stripe-membership-sync.lock` remains, first prove no importer process or Coolify task is still running and inspect the latest redacted status/import batch. Retain any incident evidence needed privately. Only then remove the exact empty directory `/app/data/.stripe-membership-sync.lock` and retry. Never automate stale-lock adoption or remove any broader path.
