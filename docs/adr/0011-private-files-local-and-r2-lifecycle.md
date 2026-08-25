# ADR 0011: Private Files lifecycle across local storage and Cloudflare R2

- Status: accepted
- Date: 2026-07-15
- Decision owner: baseline application
- Issue: [R-025 / #32](https://github.com/smallwiselabs/swl-step-by-step/issues/32)
- Final rebaseline: [ADR 0015](0015-final-pre-release-database-rebaseline.md) supersedes this ADR's migration number and predecessor/rollback mechanics; its Files ownership, integrity, storage-binding, cleanup, and provider decisions remain accepted
- Builds on: [ADR 0003](0003-family-plan-entitlements-and-user-owned-data.md), [ADR 0005](0005-immediate-account-deletion-and-billing-detachment.md), and [ADR 0008](0008-pre-release-database-rebaseline.md)

## Context

Files is an optional private-data module for a small personal/family application. A fork may leave it disabled with no storage experience or credentials. When enabled, each file belongs to one authenticated person; invisible family-plan membership may grant paid entitlement but never file access. There is no generic sharing or ACL framework.

The application needs one lifecycle that works against persistent local storage and Cloudflare R2 without exposing provider keys as authorization. Browser-to-R2 transfers use R2's S3-compatible API through the exact pinned AWS SDK. Cloudflare documentation remains authoritative for R2 compatibility; the AWS SDK's exact source is evidence only for how that client signs and serializes requests.

## Decision

### Module and authorization boundary

- Retain the public optional-module states `disabled`, `incomplete`, and `ready`; `local` and `r2` are ready-state drivers, not additional public states. Disabled Files performs no database, filesystem, queue, signer, or provider work. Incomplete enabled configuration fails before listen/readiness.
- Require Jobs whenever Files is enabled. Web readiness proves configuration and current database availability, not worker liveness or deletion convergence; production runs the same-image worker against the same database and local-object volume.
- Expose only owner-scoped resource routes: bounded metadata list, upload initiation, one minimized metadata read, completion, download, and delete. Local-only `PUT /api/files/:id/content` remains inside the app-command origin gate and also requires the authenticated owner plus a short-lived signed capability; local download requires the owner and its short-lived capability. Remove low-level `/api/storage/**` list/write diagnostics; the product has no staff authorization model.
- Predicate every file read or mutation on both immutable file ID and the authenticated user's persisted ID. Valid IDs use the server-generated `file_<UUID>` shape. Any unknown value accepted by the bounded 1-through-128-character path schema, including a foreign or deleted ID, shares a concealed `404`; overlong path parameters and malformed request bodies or queries return a minimized `400` without a provider call. Family-plan membership and Better Auth `activeOrganizationId` are irrelevant.
- Return minimized file DTOs. Never expose owner ID, bucket, object key, internal integrity state, or deletion state. Original filename is display metadata only; new provider keys use the opaque server-generated shape `files/v1/<file-id>`.

### Upload and integrity

- Accept a known byte size from 1 through 25 MiB, a normalized media type, and canonical base64 `Content-MD5`. MD5 is message-integrity evidence, not authentication or a collision-resistant identity. ETag is opaque and is never assumed to be MD5.
- Create a pending row and 15-minute upload expiry before issuing a capability. Commit a cleanup wake-up for expiry plus one minute before returning that capability; if queue persistence fails, remove the pending row and return no capability. R2 signs PUT and HEAD from the same signing instant used for the persisted expiry, rejects any signer response whose expiries differ, and removes the pending row if signing finishes after that instant has expired. The PUT binds the declared `Content-Length`, `Content-Type`, `Content-MD5`, `If-None-Match: *`, `Content-Disposition: attachment`, and `Cache-Control: private, no-store`; `If-None-Match: *` prevents a still-valid capability from overwriting an existing object. Browsers derive the forbidden `Content-Length` header from the exact request body rather than allowing application JavaScript to set it.
- Configure the exact S3 client with `region: "auto"`, `requestChecksumCalculation: "WHEN_REQUIRED"`, standard retry mode, three total attempts, and a 30-second operation abort. The checksum setting prevents the SDK's automatic unsupported full-object CRC32 query parameters while retaining the explicitly signed R2-supported `Content-MD5` contract.
- Re-authenticate and owner-scope completion. The server performs its own trusted HEAD and compares provider length and media type before conditionally changing `pending` to `ready`; a client HEAD result is diagnostic only. Completion is idempotent for an already-ready owner row.
- Treat every presigned URL as a reusable bearer capability until its expiry. R2 download GETs expire after 60 seconds. A deleted file becomes inaccessible through the app immediately, but a previously issued download URL may remain usable for at most that residual window.

### Driver behavior

- Persist one singleton storage binding for each initialized Files database: driver and bucket for local, plus the normalized account-and-jurisdiction endpoint for R2. Compare every configured adapter and row bucket with that binding before provider work; mismatch fails closed without deleting bytes or metadata. A predecessor binding records only its bucket. The fixed historical local bucket `local` may be adopted by the colocated local driver, but no bucket name alone can establish an account- and jurisdiction-scoped R2 resource; every legacy-to-R2 selection fails closed until a separately designed stopped-writer migration supplies and verifies that identity. Disabling Files leaves the binding intact. Switching local/R2 driver, R2 bucket, account, or jurisdiction requires a separately designed stopped-writer object migration with inventory, copy verification, deliberate cutover, and tested rollback; this baseline supplies no provider-migration command.
- Local storage lives beside the validated SQLite database, under the same explicit persistent mount. Validate the capability and current pending owner row before consuming bytes; stream into a contained temporary file while enforcing the byte bound and computing MD5. After the stream is verified, re-read the exact pending row and require its persisted expiry to remain in the future immediately before hard-link publication, then recheck authoritative pending/ready state before removing the authenticated temporary marker. A rejected check removes the new target; a crash between link and marker removal leaves the recognizable two-link artifact for reconciliation. Temporary names carry an application HMAC so cleanup never claims unknown files. Each local listing invocation removes at most 100 authenticated publication remnants: multiple-hard-link remnants immediately and single-link crash remnants after the 15-minute capability lifetime plus one minute; fresh live uploads and unknown/forged artifacts remain untouched. The worker separately requests and processes at most five managed records or objects per cleanup invocation. Local listing uses an encrypted, prefix-bound HMAC-order cursor whose decrypted payload contains no object key, and hard-fails after 10,000 filesystem entries to bound lease-overrun risk. Larger local namespaces require a separately reviewed inventory design.
- R2 accepts only the configured Cloudflare HTTPS account endpoint, including the documented jurisdiction-specific EU or FedRAMP variants, and one Object Read & Write token scoped to the application bucket. Do not use a public bucket or custom domain. Browser transfers require an exact-origin CORS policy for the methods and signed headers the application actually sends.
- Use Cloudflare's supported `ListObjectsV2` continuation token as opaque state. Reconciliation lists only the app-managed `files/v1/` prefix plus the narrowly validated historical `users/` key shape needed for upgrade cleanup. Nonconforming predecessor artifacts under `users/` are preserved and skipped; an object returned outside the requested prefix or a provider entry without a key fails closed. The adapter accepts requests up to 100 objects and rejects oversized or duplicate provider pages; each cleanup invocation requests only five.
- Classify deterministic integrity/signature/configuration failures separately from bounded transient retries. Inspect per-object multi-delete failures. No provider payload, credential, key, filename, continuation token, or raw exception is returned to clients or retained as a job diagnostic.

### Deletion and recovery

- File delete makes the metadata unavailable and commits existing queue work without waiting for provider I/O. Provider deletion waits until the upload capability has expired plus one minute so a live PUT cannot recreate an object after cleanup.
- Account deletion still removes authentication, family authority, and file metadata in its synchronous SQLite transaction. It commits an empty `files.cleanup-orphans` job and a global reconciliation not-before watermark but performs no storage-provider call on the HTTP path; an unavailable R2/local driver cannot delay or roll back identity deletion. Every cleanup chain honors that watermark, so removal of the owner rows cannot make a still-usable upload capability look orphaned early.
- Partition reconciliation into four replay-safe bounded phases below the existing nonrenewed five-minute job lease: expired pending metadata, deleted metadata/bytes, current `files/v1/` reconciliation, and legacy `users/` reconciliation. Each invocation claims or lists at most five objects. With a 30-second provider-operation deadline and sequential single-object deletion, one list plus five deletes has a three-minute ceiling, leaving two minutes for database work, scheduling, and shutdown. Persist only bounded application-owned phase/cursor state when needed; provider continuation tokens remain opaque. A mutation pass is followed by a clean verification pass from the beginning because deleting objects while walking a listing must not assume cursor stability.
- Preserve ordinary cleanup wake-ups at upload-capability expiry plus one minute. After the singleton storage binding exists, the Files-ready worker runs a throttled SQLite `IMMEDIATE` check before claiming work to maintain one viable full-root `{}` cleanup on a 24-hour safety cadence. Only another viable full root deduplicates that check; continuous queue traffic, non-root/cursor jobs, exhausted queued roots, and terminal roots cannot suppress the recurring root. Recurring full sweeps remove an R2 PUT that began before presign expiry but completed after the ordinary sweep, without assuming a provider upload-completion bound. Worker outage delays physical cleanup.
- Retry provider outages through the existing queue with the maximum signed-32-bit attempt budget. Process provider deletions one object at a time within each five-object worker page so one permanent failure retains its locator without starving successful siblings. Before mutating any orphan on a cursor-bearing page, durably enqueue a delayed phase-root verification and discard that cursor; a root page with no successful deletion uses ordinary queue retry. This makes scheduling failure or a crash after partial provider mutation restart-safe. Immediate authorization removal is guaranteed; physical-byte deletion converges when the configured storage and worker recover. Real late-write, listing, retry, CORS, and deletion behavior remains staging certification under #37.

### Migration and compatibility

- Add forward migration `0007`; do not rewrite `0000` through `0006` or dated audits. The table gains canonical nullable `content_md5`, `upload_expires_at`, status/size/deletion/timestamp checks, and owner/status/cursor plus status/expiry indexes while preserving the owner foreign-key cascade and unique object key.
- Preserve existing ready rows with `content_md5 = NULL` as legacy, readable, unverified data. Do not manufacture an integrity claim or delete those bytes. Existing pending rows cannot satisfy the new upload contract, so migrate them to deleted cleanup candidates with the historical 15-minute window derived from creation time and enqueue their cleanup wake-up. Persist a legacy single-bucket binding for predecessor rows; refuse the upgrade transaction if they span multiple buckets rather than inventing a provider identity.
- Prove fresh application, exact `0006` upgrade with representative rows, transactional failure without an advanced ledger, operator correction, and successful retry. After `0007` applies, rollback means disabling Files or restoring the verified pre-migration backup; an older image must not run against the advanced ledger.

## Consequences

- A no-Files fork remains healthy and carries no active storage experience. A local Files fork needs no Cloudflare account, while an R2 fork needs only one bucket-scoped object credential and an operational Jobs worker.
- An initialized Files deployment cannot change its driver, bucket, or normalized R2 account/jurisdiction endpoint through configuration alone. Credential rotation may preserve the same bound provider identity, but provider relocation needs its own approved data-migration boundary.
- Local capabilities, listing cursors, and authenticated temporary-artifact names derive domain-separated keys from the Better Auth secret. Secret rotation intentionally invalidates outstanding capabilities/cursors; a cleanup pass must run before rotation or operators must separately inspect and remove pre-rotation crash artifacts, because the new secret will not authenticate their names.
- Direct single-part upload is sufficient for the 25 MiB application maximum. Multipart/TUS, public buckets, provider-key UI, generic ACLs, malware scanning, quota management, Files UI, and feature-specific sharing remain out of scope.
- Local deterministic tests can prove signing inputs, ownership, integrity, migrations, pagination, retry, and cleanup state machines without provider charges. They cannot certify Cloudflare account policy, deployed CORS, R2 propagation/error presentation, or browser/provider interaction; #37 owns that persistent-staging evidence.
- Local publication syncs each temporary file before immutable linking, but the test boundary proves process/container restart persistence rather than abrupt host-power-loss durability of directory entries. Production local storage therefore still relies on the mounted filesystem and provider's durability guarantees; persistent-volume failure and recovery evidence belongs with staging/backup certification.
- Forward migration preserves legacy ready R2 objects without rewriting their stored response metadata. New uploads bind attachment and private/no-store metadata, while #37 must verify legacy download presentation and any provider migration needed before a deployment treats predecessor R2 data as certified.

## Rejected alternatives

### Family-plan or workspace ownership

Rejected because paid entitlement and private-resource authorization are intentionally independent. Sharing will require a real feature-specific relationship.

### Provider key as capability or user-visible path

Rejected because object keys are storage locators, not authorization. Embedding owner IDs or filenames also leaks unnecessary metadata.

### Proxy every R2 byte through Nitro

Rejected because short-lived presigned operations keep credentials server-side while avoiding application-memory buffering. Server authentication and persisted owner checks still gate issuance and completion.

### Generic storage service, multipart framework, or custom SigV4

Rejected for this bounded 25 MiB baseline. The exact official SDK supplies the maintained signing, retries, and S3 protocol boundary.

### Synchronous provider deletion during account deletion

Rejected because an unavailable provider must not preserve an authenticatable identity or turn a committed deletion into an uncertain retry. Durable bounded cleanup owns eventual byte removal.

## Open-source comparison

The design also compared current pinned snapshots of mature storage implementations. [Twenty's upload initiation](https://github.com/twentyhq/twenty/blob/7f8a1da27a9f37c01c24656c21348b32ea7d7cc6/packages/twenty-server/src/engine/core-modules/file/file-upload/services/file-upload.service.ts#L64-L181) informed creating pending metadata before issuing a presigned or local-token target, while its separate [completion path](https://github.com/twentyhq/twenty/blob/7f8a1da27a9f37c01c24656c21348b32ea7d7cc6/packages/twenty-server/src/engine/core-modules/file/file-upload/services/file-upload.service.ts#L279-L379) informed trusted storage verification before state promotion; its [local driver](https://github.com/twentyhq/twenty/blob/7f8a1da27a9f37c01c24656c21348b32ea7d7cc6/packages/twenty-server/src/engine/core-modules/file-storage/drivers/local.driver.ts#L33-L161) informed contained persistent local storage. [Supabase Storage](https://github.com/supabase/storage/blob/5515031184790581b1ab1e33a05923f84289eaad/src/storage/object.ts#L825-L897) reinforced authorization before signing, while its [S3-compatible listing pagination](https://github.com/supabase/storage/blob/5515031184790581b1ab1e33a05923f84289eaad/src/storage/object.ts#L606-L708) reinforced bounded cursor handling. [Outline](https://github.com/outline/outline/blob/8170639085963919945138328bc4d199b11fd781/server/models/helpers/AttachmentHelper.ts#L23-L35) reinforced server-owned key construction, while its inclusion of user ID and sanitized filename in the key also demonstrated why this baseline deliberately uses only the opaque file ID after its fixed prefix. Their workspace-wide access, generic bucket/RLS ACLs, and multipart/TUS/general-storage scope are deliberately not adopted. These projects are architectural comparisons, not authority for Cloudflare R2 behavior.

## Evidence and official sources

- [Cloudflare R2 presigned URLs](https://developers.cloudflare.com/r2/api/s3/presigned-urls/)
- [Cloudflare R2 S3 API compatibility](https://developers.cloudflare.com/r2/api/s3/api/)
- [Cloudflare R2 CORS](https://developers.cloudflare.com/r2/buckets/cors/)
- [Cloudflare R2 API tokens](https://developers.cloudflare.com/r2/api/tokens/)
- [Cloudflare R2 consistency](https://developers.cloudflare.com/r2/reference/consistency/)
- [Exact AWS SDK v3.1045.0 presigner source](https://github.com/aws/aws-sdk-js-v3/blob/v3.1045.0/packages/s3-request-presigner/src/presigner.ts)
- [AWS SDK data-integrity configuration](https://docs.aws.amazon.com/sdkref/latest/guide/feature-dataintegrity.html)
- [SQLite transactions](https://www.sqlite.org/lang_transaction.html)
- [Drizzle Kit generated migrations](https://orm.drizzle.team/docs/drizzle-kit-generate)
