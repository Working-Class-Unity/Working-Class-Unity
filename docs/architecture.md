# WCU architecture

Working Class Unity is one Nuxt 4 application at the repository root. It is intentionally a
monolith: the browser application, Nitro API, SQLite data layer, background worker, and narrow
provider adapters are versioned and deployed together.

This document describes the WCU rebuild. Imported Baseline ADRs and audits are source history, as
explained in [`README.md`](README.md).

## Code boundaries

- `app/` contains the Vue UI and authenticated page shell.
- `server/api/` contains HTTP handlers. Private handlers authenticate before reading user input or
  private data.
- `server/db/schema/index.ts` exports the complete Drizzle schema; repositories keep SQL out of
  handlers and pages.
- `server/services/` owns application behavior and external-provider adapters.
- `server/utils/` owns server-only request, authentication, configuration, and security helpers.
- `shared/` contains client-safe contracts and constants.
- `server/worker.ts` runs persisted, replay-safe background jobs from the same build and SQLite
  database as the web process.

There is one application package and no shared-package extraction layer. A later open-source split
can copy this root application without first untangling a Baseline monorepo.

## Identity and authorization

Better Auth provides email magic-link authentication. Password, social/OAuth, account-linking,
Organization, invitation, and workspace features are disabled or absent. Registration is open;
creating an account does not grant paid membership.

The identity row has a required display name, optional avatar URL, and server-owned `user | admin`
role. SQLite enforces the role set and defaults new rows to `user`. WCU has no public profile or
member directory in this foundation. The minimal administrator role is separate from future paid
membership and has no broad Better Auth admin-plugin surface.

Private Files and AI records are authorized directly by the immutable authenticated user ID. There
is no group, Family, Organization, or project authority that can grant another person access.

Account deletion requires an exact confirmation from a fresh authenticated session. Purchaser
Billing must first reach its durable Stripe proof boundary. The final local deletion transaction
then removes Billing state, AI content, Files metadata and cleanup work, Better Auth credentials,
sessions, verification records, and the user. Provider ambiguity fails closed without deleting the
identity or private data.

## SQLite data

The rebuild starts from a fresh database and one `0000_wcu_initial` migration. It is not compatible
with the legacy WCU or Baseline database. The migration currently creates 21 application tables:

- Better Auth user, session, account, and verification records.
- App settings and the persistent job queue.
- Private Files metadata.
- Private AI conversations, messages, citations, attempts, leases, and usage buckets.
- Seven purchaser-owned Billing tables.

Ten SQLite triggers enforce purchaser/customer/subscription relationships and Billing transition
and deletion proof invariants that ordinary foreign keys cannot express. The migration check
applies the package to a fresh temporary database, reapplies it, verifies the exact ledger/table/
trigger inventory, checks the default user role and purchaser columns, and runs SQLite integrity
and foreign-key checks.

## Files and backups

Files are private and stored through an application adapter. Local storage supports development;
Cloudflare R2 is the production provider. Upload capabilities are short-lived, metadata is
owner-scoped, deletion immediately conceals the record, and persisted jobs clean up provider
objects. Driver and bucket identity are data bindings, not settings to change casually after a
database is initialized.

For direct browser transfers, WCU's Content Security Policy allows only the exact configured R2
bucket S3 origin. The hosted bucket must separately allow the exact WCU application origin and the
methods and request headers used by its presigned PUT, HEAD, and GET capabilities. That CORS policy
is part of deferred hosted-provider certification, not an application credential.

SQLite backups use a separate operator-only R2 path, bucket, and credentials. Backup credentials
do not enter Nuxt runtime configuration or ordinary web/worker processes. The Files bucket and
backup bucket must remain separate.

User R2 uploads are not automatically copied to OpenAI. OpenAI File Search uses a separate,
deployment-owned vector store and corpus.

## AI

Authenticated users own private text conversations persisted in SQLite. The OpenAI adapter uses
the Responses API with local history, `store: false`, bounded input/output/history, one in-flight
generation per user, and the retained Baseline daily-attempt limit until WCU deliberately redesigns
quotas.

Each request offers two server-controlled built-in tools:

- File Search against one deployment-owned vector store, which may contain no files initially.
- Web Search restricted to a deployment-owned domain allowlist that callers cannot override.

Tool choice is automatic and at most one built-in tool call is allowed per response. File citations
are minimized to titles. Web citations retain bounded HTTPS URL/title/span data, and production UI
must render them visibly and clickably before launch. Missing OpenAI credentials or search policy
fails at the provider boundary; deterministic tests make no live OpenAI call.

## Billing and email

Stripe state belongs to the purchasing user. Routes never accept a user, customer, subscription,
or Price identifier from the browser; the server derives purchaser identity from the session and
maps stable application offerings to private configured Prices. Webhooks use the exact raw body and
official Stripe signature verification before minimized, idempotent processing.

The imported purchaser Billing engine temporarily retains Baseline's five-offering catalog. WCU's
one-membership/two-payment-amount catalog is a deliberate follow-up after the rest of this
foundation is verified. No Billing state currently authorizes paid pages.

Transactional email has one application message contract. Local development and tests write
private capture files; production sends through Resend. Stripe notification retries pass a stable
idempotency key to Resend, while one-time magic-link sends do not invent a retry identity.

## Runtime and deployment

Identity, Files, AI, Billing, email, jobs, Turnstile, observability, and backups are application
capabilities, not product switches. Runtime configuration validates their provider settings and
rejects retired switch variables so stale deployment configuration cannot silently change product
shape. Deterministic local substitutes remain available where a live provider is inappropriate.

Nuxt Security owns browser headers and Content Security Policy. Application middleware protects
unsafe app API requests with an exact configured-origin policy; Better Auth, Stripe webhooks, and
operational observability routes retain their own narrower authentication boundaries. Turnstile is
required for magic-link issuance. Sentry is initialized only with complete production settings and
continues to use privacy filtering at the app boundary.

The Docker/Coolify shape uses one selected build for migration, web, worker, backup, and Stripe membership synchronization commands.
The web and worker share one persistent `/app/data` volume and must not run against different
database revisions. Migration completes before long-lived processes start. Coolify supplies one
shared resource environment to every Compose service, so provider values intentionally withheld
from migration and backup operators use the reserved unset `${WCU_CLEARED_ENVIRONMENT:-}`
indirection instead of literal empty YAML values. `WCU_CLEARED_ENVIRONMENT` must never be configured.
The current branch has no hosted credentials and is not approved for cutover; provider
certification and the WCU UI remain pre-launch work.
