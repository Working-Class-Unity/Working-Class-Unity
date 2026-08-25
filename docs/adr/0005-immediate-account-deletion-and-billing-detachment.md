# ADR 0005: Immediate account deletion and billing detachment

- Status: accepted
- Date: 2026-07-11
- Decision owner: baseline application
- Issue: [R-018C / #80](https://github.com/smallwiselabs/swl-step-by-step/issues/80)
- Builds on: [ADR 0003](0003-family-plan-entitlements-and-user-owned-data.md) and [ADR 0004](0004-owner-member-family-plan-boundary.md)
- Pre-release database amendment: [ADR 0008](0008-pre-release-database-rebaseline.md) supersedes this ADR's active-migration-chain and predecessor-compatibility decisions; the account-lifecycle and minimized-retention decisions remain accepted
- Stripe implementation amendment: [ADR 0009](0009-direct-stripe-family-plan-authority.md) implements the deferred direct-SDK, organization billing, ordering, correlation, and deletion-race decisions; this ADR's minimization and local hard-delete decisions remain accepted subject to the #169 precondition below
- Subscription-cancellation amendment: [#169](https://github.com/smallwiselabs/baseline/issues/169) supersedes this ADR's earlier statements that account deletion performs no Stripe I/O or that continuing Stripe billing cannot delay identity deletion. A billing owner must complete the cancellation-before-deletion protocol below.
- Search-removal amendment: [ADR 0010](0010-remove-local-search-and-fts.md) supersedes Search-specific projection cleanup and indexing-race decisions; immediate account deletion and canonical private-data cleanup remain accepted
- Files implementation amendment: [ADR 0011](0011-private-files-local-and-r2-lifecycle.md) removes synchronous storage work from the account HTTP path and implements bounded replay-safe local/R2 reconciliation; this ADR's empty cleanup payload and no-retained-key decisions remain accepted, while #169 now gates local identity deletion for Stripe-backed owners

## Context

The baseline has one approved destructive product operation: a signed-in person deletes their own account. If that person owns a family-plan group, the group and its derived entitlements end immediately for everyone. Invitees are independent people, so their identities, personal groups, sessions, and user-owned records must remain.

An application-managed Stripe subscription must not continue after the application identity that owns it disappears. Provider cancellation can have an indeterminate result, so a timeout or connection failure cannot safely be treated as either success or failure. The application must retain the authenticatable user until Stripe cancellation is confirmed, while minimizing any identity-free continuity retained after local deletion.

Better Auth `1.6.23` supplies a hard-delete server endpoint, a 24-hour default fresh-session check, and `beforeDelete`/`afterDelete` callbacks. Its internal delete is sequential, however, and the baseline's synchronous `better-sqlite3` adapter intentionally has Better Auth transactions disabled. The application therefore needs a small coordination boundary without a lifecycle framework or second queue.

## Decision

- Expose only `DELETE /api/account`. It authenticates before input validation and strictly accepts `{ "confirmation": "DELETE" }` with no extra authority fields.
- Set Better Auth `session.freshAge` explicitly to 86,400 seconds. Before any provider effect, the app command independently requires a session inside that freshness window. Its eventual `auth.api.deleteUser` call uses an empty body, so Better Auth rechecks the same freshness boundary and no password, token, callback, or email-verification path can bypass it.
- Enable Better Auth deletion for server use but disable `/delete-user` and `/delete-user/callback` at its HTTP router. Native Organization deletion remains disabled. Clients cannot bypass the app command.
- For a Stripe-backed billing owner, durably record the cancellation request before dispatch, cancel the exact subscription immediately with `invoice_now: false` and `prorate: false`, and then retrieve it from Stripe. Continue only after the retrieval confirms cancellation. This path neither issues an automatic refund nor deletes the Stripe Customer.
- If cancel or retrieval is ambiguous, keep the user, credentials, sessions, owned organization, and private data. The existing worker may claim the durable request and retry only exact-subscription cancellation plus retrieval. It must never invoke Better Auth deletion, delete the user, or treat the durable request as standing deletion authorization. After the worker confirms cancellation, the person must return with another fresh session and the exact `{ "confirmation": "DELETE" }` command before local deletion can run.
- Once no Stripe cancellation is required or confirmed cancellation is durably visible, run one synchronous `BEGIN IMMEDIATE` transaction from Better Auth's documented `beforeDelete` callback. It writes only the minimum detached provider continuity still justified, deletes current user-owned application rows, the caller's owned organization, caller memberships/invitations elsewhere, outstanding caller magic links, sessions, accounts, and the user. It first clears surviving invitee sessions' stale `activeOrganizationId` pointer. The hook itself performs no Stripe, local-storage, R2, or OpenAI I/O.
- Delete project search projections through their existing triggers, then projects. Project projection writes are a single conditional `INSERT ... SELECT`: a route paused across deletion cannot recreate title/body metadata after its relational project is gone. Project cleanup uses relational ownership only; stale project metadata cannot delete another user's projection.
- Give file metadata a cascading live-user foreign key, delete it in the same transaction, and commit an empty `files.cleanup-orphans` job through the existing queue after the latest valid upload capability plus one minute, capped by the application-owned 15-minute capability lifetime. Perform no storage I/O on the account HTTP path. After streaming, a local upload rechecks the exact pending row and expiry immediately before hard-link publication and rechecks authoritative state again before removing its authenticated two-link crash marker; deletion or expiry removes temporary/new bytes. R2 uses one exact persisted-and-signed expiry plus conditional immutable PUT and delayed reconciliation for the corresponding provider race. The account transaction retains no filename, object key, account ID, or provider cursor; it retains only the non-secret singleton storage binding and a global not-before watermark so another cleanup chain cannot reconcile the removed rows while a capability remains usable. Generic successor cleanup jobs may persist only a bounded phase plus an opaque provider continuation token.
- Keep recovery inside the existing queue. Workers claim only job types whose handlers are currently available, so Files-disabled runs do not consume attempts. One SQLite `UPDATE ... RETURNING` claims a due or five-minute-stale lease; unique lock tokens prevent a replaced worker from completing reclaimed work. Each cleanup attempt handles one bounded provider page and remains replay-safe below the lease. File cleanup jobs use the queue's maximum signed-32-bit attempt budget so a prolonged provider outage or configuration repair does not silently abandon physical-byte deletion; ordinary queue backoff still bounds request rate. ADR 0011 implements local/R2 pagination and retry; #37 retains real provider certification.
- Preserve `app_settings` and unrelated jobs because current production code has no user-owned records in those tables. At this ADR's adoption, AI and intake routes persisted no user history. [ADR 0012](0012-direct-openai-responses-and-local-history.md), [ADR 0013](0013-deployment-owned-openai-file-search.md), and [ADR 0014](0014-server-owned-openai-web-search.md) now add private local AI state and require the deletion transaction to remove its conversations, messages, File/Web citations, attempts, transient per-owner generation lease, and usage buckets without an OpenAI call. Every future persistent module must add its own deletion behavior and tests before shipping.
- Let Better Auth continue after the hook. Its repeated session/account/user deletes are idempotent no-ops, and it emits the session-cookie expirations. Do not use `afterDelete`: a failure there would occur after identity removal and could not be retried truthfully.

## Detached billing record

Create a detached row only for a locally projected external subscription that still needs provider reconciliation at deletion. The row contains only:

- an application-random opaque ID;
- provider and provider subscription/customer references;
- provider status and optional provider status expiry;
- status-update and deletion timestamps;
- fixed purpose `external_billing_reconciliation`;
- a provider-owned lifecycle policy key and optional future purge timestamp.

It contains no user ID, email or email hash, name, profile, organization, price choice, receipt/JWS, webhook payload, OAuth credential, session, verification value, prompt, file, project, or private content. A customer row without a subscription creates no detached record, and a subscription first reported after deletion cannot invent the unknown account-deletion timestamp. Re-registration by the same email creates a new Better Auth user and personal group and never queries or claims this table. Any future restoration requires independent provider-ownership proof.

Migration `0012` adds cascading live-user foreign keys to current Stripe customer/subscription and file projections, removes full webhook payload storage, and adds the constrained detached table. It rejects orphaned predecessor billing/file rows before changing schema, so repair and retry are explicit. Late status events match exact subscription references first and recheck after a missing-user result; stale user metadata cannot recreate a live billing projection or entitlement. Operational verification checks the exact minimized columns, foreign keys, indexes, and retention constraints before accepting a current-ledger database or restore.

R-024 still owns the official Stripe SDK, durable checkout attempts that preserve the true deletion-time correlation for an in-flight subscription, organization subscription/seat policy, event ordering, terminal-status mapping, and exact provider purge periods. A future Apple integration owns signed-data verification, `originalTransactionId`, App Store status mapping, and its purge policy. ADR 0011 owns paginated R2 cleanup, while #37 owns real provider evidence. This ADR does not invent those provider implementations.

Implementation status recorded on 2026-07-15: ADR 0009/R-024A supplied the direct official SDK, organization-owned current snapshot, durable Checkout attempt, provider ordering, deletion-race rechecks, and minimized detached continuity. Its durable correlation deliberately extended the earlier subscription-only rule: an unresolved Checkout attempt or a known customer could retain one identity-free continuity record when no subscription was projected, rather than stranding provider billing that could appear after deletion. ADR 0011/R-025 made Files cleanup fully asynchronous from the account route and partitioned current and legacy managed-prefix reconciliation into bounded replay-safe work. At that date, immediate deletion performed no Stripe, local-storage, or R2 call. #169 supersedes the no-Stripe portion with the cancellation-before-deletion protocol above; the local-storage/R2 statement and the need for #37 provider certification remain unchanged.

Local/fake storage evidence proves capability expiry, structured upload races, bounded pagination, partial provider failure, retry, and delayed reconciliation. It does not prove a real R2 token, CORS policy, late provider write, listing behavior, or deployed worker convergence; #37 must certify those controls before an R2-enabled deployment claims provider byte deletion. Once the Stripe precondition is satisfied and the local transaction commits, identity, metadata, authorization, and app access disappear together. Physical provider deletion converges only while the configured storage and worker are available.

## Interruption and idempotency

- A failure or process stop before SQLite commit rolls the whole local deletion back, leaving the authoritative session available for retry.
- A Stripe timeout, connection failure, or unconfirmed cancellation stops before local deletion. The durable cancellation request remains retryable, and the user's identity and private state remain intact.
- A worker may make cancellation converge, but it cannot consume the user's confirmation or delete local identity. Local deletion still requires a later fresh, exact `DELETE` command.
- After commit, every session and the user are already absent. Losing the HTTP response leaves only an unusable browser cookie, not access.
- Concurrent calls serialize at SQLite; a call that already authenticated but arrives second performs no duplicate retained work.
- Active, ambiguous, or unconfirmed Stripe billing blocks local identity deletion and never supplies application access. Confirmed cancellation permits the separately authorized local transaction.

## Rejected alternatives

### Ownership transfer, successor selection, or grace period

Rejected by product decision. The owner deleting their account ends the family plan immediately; invitees keep only their independent accounts and private records.

### Soft-deleting the Better Auth user

Rejected as a post-cancellation or indefinite state because it would retain an authenticatable identity, credentials, verification values, and personal profile merely for billing history. Temporary retention while an exact Stripe cancellation result is ambiguous is instead required to avoid deleting identity while billing may continue.

### Generic lifecycle registry or workflow engine

Rejected because the existing durable queue can carry the narrowly typed Stripe cancellation-reconciliation job and Files cleanup. No generic lifecycle registry, second queue, or standing worker authority to delete users is needed.

### Full webhook payload retention

Rejected because duplicate handling needs only the provider event ID/type/timestamp, while raw payloads can contain identity, metadata, and customer details.

## Evidence and official sources

- [Pinned Better Auth user-deletion documentation](https://github.com/better-auth/better-auth/blob/v1.6.23/docs/content/docs/concepts/users-accounts.mdx#delete-user)
- [Pinned Better Auth deletion route](https://github.com/better-auth/better-auth/blob/v1.6.23/packages/better-auth/src/api/routes/update-user.ts)
- [Pinned Better Auth internal adapter](https://github.com/better-auth/better-auth/blob/v1.6.23/packages/better-auth/src/db/internal-adapter.ts)
- [Apple account-deletion guidance](https://developer.apple.com/support/offering-account-deletion-in-your-app)
- [Apple original transaction identifier](https://developer.apple.com/documentation/appstoreserverapi/originaltransactionid)
- [Stripe cancel-subscription API](https://docs.stripe.com/api/subscriptions/cancel)
- [Stripe retrieve-subscription API](https://docs.stripe.com/api/subscriptions/retrieve)
- [FTC information-minimization guidance](https://www.ftc.gov/business-guidance/resources/protecting-personal-information-guide-business)
- [SQLite transactions](https://www.sqlite.org/lang_transaction.html)
- [SQLite `RETURNING`](https://www.sqlite.org/lang_returning.html)
- [SQLite schema table](https://www.sqlite.org/schematab.html)
- [SQLite foreign keys](https://www.sqlite.org/foreignkeys.html)
- [Pinned `better-sqlite3` transaction API](https://github.com/WiseLibs/better-sqlite3/blob/v12.10.0/docs/api.md#transactionfunction---function)
- [Drizzle custom migrations](https://orm.drizzle.team/docs/drizzle-kit-generate#custom-migrations)
