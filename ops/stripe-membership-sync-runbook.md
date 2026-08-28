# Stripe Account Membership Synchronization Runbook

## Scope and safety boundary

The packaged account-link synchronizer reads Stripe and updates only `account_stripe_memberships`. It never writes to Stripe and never creates an account, person, membership, standing period, invoice, provider snapshot, or historical billing row. The separately packaged historical importer is preserved for its existing operator contract, but it is not an authorization or synchronization path for Stripe-first accounts and is never invoked by `stripe-sync-runner`.

Each run does two bounded jobs:

1. Retrieve every already-linked Subscription by its exact stored ID and refresh its local status projection after validating the exact customer, subscription, Price, quantity, and tier.
2. List active subscriptions for the explicitly configured legacy $10 and $27 Prices and adopt one only when its expanded Stripe customer email matches exactly one existing verified account.

Tier is never inferred from amount, product name, local membership, or standing. Missing legacy tier metadata is allowed because the exact configured legacy Price supplies the tier; conflicting metadata fails closed. Supporter is never adopted through a legacy Price and remains account-only when an existing Supporter link is refreshed.

The default is a dry-run. `--apply` writes all planned changes in one immediate SQLite transaction after every Stripe read succeeds. Database uniqueness still prevents one customer or subscription from belonging to multiple accounts. Missing accounts, ambiguous normalized emails, multiple subscriptions for one account, deletion-pending accounts, and identifier conflicts are skipped and counted; the operator does not guess or create a recovery path.

## Dedicated restricted key and exact Price mapping

Create a separate Stripe restricted key with Read access only to Customers and Subscriptions. Grant no write, Checkout, Customer Portal, webhook, invoice, payment, or subscription-mutation permission. Prove representative reads and denied writes in a Stripe sandbox before production use.

Configure these values only on `stripe-sync-runner` in Coolify:

```text
NUXT_DATABASE_URL=file:/app/data/app.db
WCU_STRIPE_MEMBERSHIP_SYNC_KEY=rk_live_REDACTED
WCU_STRIPE_MEMBERSHIP_SYNC_MODE=live
WCU_STRIPE_LEGACY_DUES10_PRICE_IDS=membership-10-1month
WCU_STRIPE_LEGACY_DUES27_PRICE_IDS=solidarity-27-1month
```

Use `mode=test` with an `rk_test_*` key in isolated staging and `mode=live` with an `rk_live_*` key in production. Comma-separated Price IDs are supported only when more than one exact historical Price for a tier has been reviewed. IDs must be nonempty, distinct across tiers, and already trimmed. Keep the restricted key Runtime-enabled and Build-disabled. Keep all four runner-only values out of `.env.production.example`, Git, image arguments, shared logs, Sentry, screenshots, and evidence.

## First certification and adoption

The Compose service is an inert, same-image, same-volume task target. It exposes no port, disables the web health check, validates its database/schema/key/mode/Price boundary, and then sleeps.

Before the first production apply:

1. Deploy the selected commit with the four runner values and confirm `--validate-config` succeeds without contacting Stripe.
2. Require a recent verified off-host SQLite backup.
3. Run without `--apply`. Review the aggregate fetched, planned-link, and issue counts. The receipt contains no email, account ID, Stripe object ID, or provider response.
4. Resolve configuration errors before continuing. Do not turn unmatched or ambiguous accounts into automatic account creation; use a separately approved organizer workflow.
5. Run one manual apply, confirm both paid tiers receive identical access and Supporter remains account-only, then run the same apply again and verify it creates no duplicate links.

Commands inside `stripe-sync-runner`:

```bash
node .output/server/sync-stripe-membership-links.mjs --validate-config
node .output/server/sync-stripe-membership-links.mjs
node .output/server/sync-stripe-membership-links.mjs --apply
```

## Daily resync backstop

Signed Stripe webhooks remain the normal status-update path. The operator is a daily read-only backstop for missed events and for the initial legacy adoption:

```text
Schedule: 17 3 * * *
Command: node .output/server/sync-stripe-membership-links.mjs --apply
Timeout: set only after measuring the first representative run
```

Target only `stripe-sync-runner`, record the Coolify server timezone, and enable private success/failure notifications. The operator permits only one apply at a time through `/app/data/.stripe-membership-sync.lock`; SQLite waits at most five seconds for another writer. Provider reads never hold a SQLite transaction. A normal failure releases the lock, while an abrupt kill leaves it fail-closed.

Successful output contains only mode and aggregate fetched/link/issue counts. Link freshness is stored per row in `last_verified_at`; no sync receipt or reconciliation table is created.

Failure output uses one bounded code:

- `configuration_invalid`: required values, Price mapping, database, schema, key shape, or local-only options are invalid;
- `overlap_detected`: another apply owns the private lock;
- `database_busy`: SQLite stayed busy beyond the bounded wait;
- `stripe_fetch_failed`: Stripe could not supply every required Subscription read;
- `import_failed`: validation or the atomic SQLite apply failed;
- `lock_cleanup_failed`: the private lock could not be removed after the operation.

For a normal failure, correct the cause and retry once after proving no migration, restore, deployment, or other sync is running. Do not retry indefinitely. If the lock remains, first prove no operator process or Coolify task is still active. Only then remove the exact empty directory `/app/data/.stripe-membership-sync.lock`; never automate stale-lock adoption or remove a broader path.
