# ADR 0016: Private R2 SQLite backups and isolated recovery

- Status: accepted
- Date: 2026-07-16
- Amended: 2026-07-29 for the optional Compose profile and Coolify-safe runner-only credentials
- Decision owner: baseline application
- Issue: [#35](https://github.com/smallwiselabs/swl-step-by-step/issues/35)
- Certification dependencies: [#36](https://github.com/smallwiselabs/swl-step-by-step/issues/36) and [#37](https://github.com/smallwiselabs/swl-step-by-step/issues/37)

## Context

The production baseline keeps SQLite and optional local Files bytes on one persistent `/app/data` volume. That survives ordinary container replacement but not host, volume, or operator loss. The repository already has a hardened same-image maintenance entry that uses SQLite's Online Backup API, makes the result standalone, and verifies integrity, foreign keys, migration identity, and exact application schema. It did not previously move those bytes to a separate failure domain.

This is a two-person, pre-release baseline. It needs an understandable recovery policy, but it does not promise an RTO or availability SLA. The implementation must remain testable without an R2 account, credentials, provider traffic, or charges. Backup storage is an operations boundary and must not reuse the optional user Files bucket, credentials, routes, authorization, or module state.

## Decision

Use the existing verified SQLite snapshot plus the already-pinned official `@aws-sdk/client-s3@3.1045.0` to store one immutable object in a dedicated private Cloudflare R2 backup bucket for each application and environment.

The packaged `off-host-backup.mjs` operator is separate from Nuxt runtime configuration, web routes, readiness, the background application worker, and the Files adapter. Only an explicitly invoked operator command reads non-empty `BACKUP_R2_*` values, constructs an SDK client, or can make an R2 request. Ordinary app startup, disabled modules, web, and worker receive explicit empty overrides for those names and create no backup provider object.

The deployment topology uses one normal Git-connected Coolify Compose resource. Off-host backup is selected through the standard `backup` Compose profile: forks may omit it, while persistent baseline staging/production enables it for build and runtime. Coolify builds one selected-commit application image for the one-shot migration, web, worker, and any enabled private `backup-runner`; they share `/app/data`. Reviewed Coolify `v4.1.2` injects one shared resource `.env` into every service and replaces literal empty service values with matching resource values, so non-runners map the five backup keys through the reserved unset-or-empty `${BASELINE_BACKUP_ENV_EMPTY:-}` indirection and the runner alone overrides them with configured values; Compose `environment` takes precedence over `env_file` even when empty. The runner validates those values before becoming stable, exposes no port or domain, disables the inherited web health check, and uses init plus an inert long-lived command because Scheduled Tasks execute through `docker exec` inside an existing service container. The backup values remain Build-disabled and outside Nuxt runtime configuration; only the explicit operator consumes them. Coolify stops the old Compose containers before the one-shot migration gates every enabled long-lived service.

No schema migration, app route, UI, public module switch, application job type, or custom scheduler is added.

## Snapshot and publication lifecycle

1. Require all five backup-only settings before touching the database or local backup directory. Validate the bucket, account, and endpoint shape before constructing an SDK client or making a provider request.
2. Acquire an exclusive private lock below `/app/data/backups`. A catchable exit removes it; removal failure changes a would-be success to failure and marks private cleanup for inspection. A lock left by an uncatchable interruption or failed cleanup is never adopted or deleted automatically; an operator must inspect the retained snapshot and process state.
3. Run the exact image's existing SQLite Online Backup command. The source and published snapshot must both pass integrity, foreign keys, the exact current migration ledger, and exact packaged schema checks.
4. Refuse off-host publication if the copied database contains active `pending` or `ready` Files rows without one valid matching persisted R2 Files binding. A SQLite object cannot recover local Files bytes. Deleted metadata does not require byte recovery. Real R2 object inventory and cross-system recovery remain deployed certification work.
5. Hash the private local snapshot with MD5 and SHA-256. Support one single-part object only. R2 documents a 5 GiB single-part provider limit; the application conservatively fails closed at `5 GiB - 5 MiB` to keep request overhead away from that hard boundary.
6. Build a server-owned key under `sqlite/v1/YYYY/MM/DD/` containing the UTC creation time, a random nonce, and the complete SHA-256. The operator accepts no arbitrary destination key.
7. Configure the pinned SDK with `requestChecksumCalculation: "WHEN_REQUIRED"`, `maxAttempts: 1`, a bounded abort deadline, and a silent SDK logger. Upload with exact `Content-Length`, provider-validated base64 `Content-MD5`, and `If-None-Match: *`. The application never issues R2 delete or overwrite commands.
8. After a successful, rejected, timed-out, or otherwise ambiguous PUT, reconcile only by reading the immutable key through R2's strongly consistent S3 API. Require exact metadata, count every downloaded byte, and independently calculate SHA-256. Do not infer integrity from ETag. An exact existing object is idempotent success; missing or different bytes fail closed.
9. Delete the same-host routine snapshot only after complete remote read-back verification. A failed or uncertain operation retains the private local snapshot for explicit retry.

The restore download is a separate networked command. It accepts only a syntactically valid immutable key, checks its SHA-256-bearing receipt and metadata, writes a new `0600` hidden staging file, hashes all downloaded bytes, runs compatible-ledger/schema/integrity/foreign-key and off-host coverage verification, and only then hard-links a non-overwriting regular file beneath `/app/data/backups`. It never modifies the active database.

The existing credential-free, network-disabled `maintenance.mjs restore --confirm-app-stopped` remains the only operation that can replace the active database. It verifies and migrates an isolated candidate before the swap, invalidates all restored sessions and one-time `verification` rows, verifies again, and then performs its existing rollback/quarantine-safe replacement. Users and account links survive; everyone signs in again.

## Backup policy

The baseline operating policy is:

- schedule at minute 17 every six hours (`17 */6 * * *`) in the recorded server timezone;
- treat newest-object metadata older than 12 hours as a freshness incident; this metadata check is not the full byte verification performed before a successful upload receipt is emitted;
- use R2 Standard storage;
- apply a 30-day Bucket Lock to `sqlite/v1/` and a 35-day lifecycle expiration;
- retain Coolify execution history and safe success/failure notifications, and copy each successful immutable key/SHA-256 receipt into a private off-host record that survives loss of the Coolify host;
- inspect metadata freshness through the packaged read-only `verify-latest --max-age-hours 12` command, while an off-host dead-man service independently detects a silent Coolify host or scheduler;
- perform a monthly isolated restore drill into a new empty disposable volume, and another drill after a material schema, image-maintenance, or storage-boundary change.

While the scheduler and provider are healthy, a loss can discard up to approximately six hours of database changes. A failed or silent schedule makes that exposure grow until repaired; 12 hours is the incident threshold, not a guaranteed RPO. Restore duration is recorded as an observation. There is no RTO promise.

Bucket Lock, lifecycle, public-access policy, and token creation use an operator/admin identity unavailable to the runner. The runner gets one Object Read & Write token scoped only to its dedicated bucket because R2 does not offer an ordinary write-without-delete token. The code still exposes no delete path. The bucket has no `r2.dev` access, custom domain, or CORS policy. R2 supplies TLS in transit and Cloudflare-managed AES-256 encryption at rest; Cloudflare documents GCM as its preferred mode. This baseline does not add client-side encryption or another key-recovery lifecycle.

## Recovery and data semantics

Restoring an older relational snapshot intentionally moves local application state backward. It can resurrect recently deleted users, projects, conversations, invitations, file metadata, and old billing projections. Retained backups therefore limit any claim of immediate physical erasure. The restore purges credential-bearing sessions and one-time verification rows, but it cannot infer every post-snapshot deletion or provider event.

Before serving traffic, the operator keeps every writer stopped and reconciles:

- users, account links, invisible family owners/members/invitations, and user-owned projects;
- detached billing tombstones and the current Stripe projection against authoritative provider state without replaying raw payloads;
- R2 Files metadata against actual object existence and deletion history;
- locally stored AI conversations and citations, plus the intended deployment-owned OpenAI project/corpus and Web policy when enabled;
- any deletion or security incident record created after the selected snapshot.

Local Files with active objects are not a complete production recovery configuration for this SQLite-only mechanism. A fork that needs persistent local Files backup must add a separately designed object archive with consistent inventory, restoration, and deletion semantics. OpenAI vector stores, Stripe state, email-provider state, Sentry state, and R2 Files bytes are not embedded in the SQLite object.

## Alternatives considered

The comparison uses current official sources and pinned or exact reviewed releases; these projects provide context rather than code to copy.

- Direct `@aws-sdk/client-s3@3.1045.0` is selected. It is already an exact dependency, supports Node 24, adds no binary or provider framework, and exposes the conditional Put/Get behavior needed for an independently verifiable plain SQLite object.
- `rclone v1.74.4` is a mature, multi-contributor R2 client and the strongest runner-up. It adds a broad multi-provider binary and another patch/distribution lifecycle for behavior the pinned SDK already supplies.
- `restic v0.19.1` provides excellent client-side encryption, deduplication, and checks, but adds a repository password, opaque repository/index/lock/cache state, and forget/prune operations. Its mutable repository lifecycle conflicts with the simple immutable Bucket Lock and provider lifecycle policy.
- `Litestream v0.5.14` is a strong choice for near-continuous SQLite replication. It adds a long-lived replication daemon, LTX/compaction state, a second retention model, and a different restore path without a product requirement for a low recovery-point objective.
- A host systemd timer launching a one-shot container would give stronger per-run isolation, but it adds host-specific scheduling and monitoring beside Coolify. It remains a deployment alternative if the private Coolify runner cannot be certified.

## Security and residual risks

- SHA-256 in the immutable key proves downloaded byte integrity, not who created a new key. Recovery must use the exact key and digest from the successful full-read task receipt copied to the private off-host record; a newly injected object is not selected by timestamp alone.
- Cloudflare-managed encryption does not conceal data from an authorized R2 principal. Client-side authenticated encryption would need its own key generation, rotation, escrow, disaster recovery, and loss testing.
- The bucket token can technically delete objects that Bucket Lock does not protect. A separate control-plane identity, 30-day lock, no delete code, and 35-day lifecycle limit but do not eliminate credential compromise.
- The app and enabled backup runner share a host volume and runtime UID. A fully compromised web or worker process can tamper with shared database bytes or deny service before publication, while a compromised runner can additionally use its bucket-scoped credential. The separate service environment, bucket/token, Bucket Lock, exact database verification, hashes, random name, and remote immutability reduce rather than eliminate those risks.
- A catchable interruption normally cleans staged bytes and the operator lock. Any cleanup failure is surfaced without replacing the primary operation error and requires inspection. An uncatchable stop may leave a private local snapshot, hidden stage, or lock for investigation; it never overwrites the remote object or active database.
- The single-part size ceiling requires a separately approved multipart or hosted-database design before the database approaches it.
- Coolify task notifications and an in-runner `verify-latest` invocation do not detect a silent scheduler or host. #36 provisions the off-host dead-man and private receipt sink; #37 certifies both failure paths.
- Provider lifecycle deletion may occur after its configured threshold, and locked objects remain until the lock permits lifecycle action.

## Rollback

Disable the Coolify schedule and remove the `backup` profile to stop all off-host calls without changing app runtime. Existing immutable R2 objects and local database state remain untouched. A code rollback may remove the operator bundle, but it must not run an older image against an incompatible database ledger. Recovery from a failed restore uses the maintenance command's verified pre-restore backup or retained raw quarantine while every writer remains stopped; serving an unverified candidate is never the rollback.

## Certification boundary

Local tests use injected SDK request handlers and in-memory/local fakes. They make no live R2 call and incur no charge. #36 explicitly enables the profile and provisions the real private bucket/token, jurisdiction endpoint, lock/lifecycle rules, Coolify Compose runner, volume identity, immutable digest, private off-host receipt sink, independently scheduled dead-man monitor, and stop ordering under separate infrastructure authority. #37 creates and configures the task/notification topology, then executes and certifies failure/silence/freshness behavior, full upload/download, R2 Files reconciliation, isolated restore, observed data-loss window, and measured duration.

## Official and upstream evidence

- [Cloudflare R2 AWS SDK for JavaScript example](https://developers.cloudflare.com/r2/examples/aws/aws-sdk-js-v3/)
- [Cloudflare R2 S3 API compatibility](https://developers.cloudflare.com/r2/api/s3/api/)
- [Cloudflare R2 limits](https://developers.cloudflare.com/r2/platform/limits/)
- [Cloudflare R2 consistency](https://developers.cloudflare.com/r2/reference/consistency/)
- [Cloudflare R2 data security](https://developers.cloudflare.com/r2/reference/data-security/)
- [Cloudflare R2 token scopes](https://developers.cloudflare.com/r2/api/tokens/)
- [Cloudflare R2 Bucket Locks](https://developers.cloudflare.com/r2/buckets/bucket-locks/)
- [Cloudflare R2 lifecycle rules](https://developers.cloudflare.com/r2/buckets/object-lifecycles/)
- [AWS SDK data-integrity configuration](https://docs.aws.amazon.com/sdkref/latest/guide/feature-dataintegrity.html)
- [Pinned AWS SDK S3 client `v3.1045.0`](https://github.com/aws/aws-sdk-js-v3/tree/v3.1045.0/clients/client-s3)
- [SQLite Online Backup API](https://sqlite.org/backup.html)
- [Pinned `better-sqlite3 v12.10.0` backup API](https://github.com/WiseLibs/better-sqlite3/blob/v12.10.0/docs/api.md#backupdestination-options---promise)
- [Coolify `v4.1.2` scheduled-task source](https://github.com/coollabsio/coolify/blob/v4.1.2/app/Jobs/ScheduledTaskJob.php)
- [Coolify cron syntax](https://coolify.io/docs/knowledge-base/cron-syntax)
- [Coolify notifications](https://coolify.io/docs/knowledge-base/notifications/)
- [rclone R2 guide](https://developers.cloudflare.com/r2/examples/rclone/)
- [restic retention and prune](https://restic.readthedocs.io/en/stable/060_forget.html)
- [Litestream S3-compatible guide](https://litestream.io/guides/s3-compatible/)
