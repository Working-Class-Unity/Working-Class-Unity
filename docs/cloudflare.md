# Cloudflare Baseline

> Imported donor history; this is not an operational WCU runbook. The current WCU boundary is
> [`basic-release.md`](basic-release.md). Do not provision user-file R2 for the basic release.

Cloudflare wraps the Nuxt/Coolify/DigitalOcean core. It should protect, route, and observe traffic without becoming the default application runtime.

## DNS and Proxying

- Route the app hostname through Cloudflare DNS, for example `app.example.com -> Cloudflare proxy -> Coolify app domain/IP -> Nuxt server`.
- Restrict the Coolify origin so untrusted clients cannot bypass Cloudflare and forge the `CF-Connecting-IP` header that Better Auth uses for rate-limit identity. Follow Cloudflare's [origin-protection guidance](https://developers.cloudflare.com/fundamentals/security/protect-your-origin-server/) and [non-Cloudflare traffic restriction guidance](https://developers.cloudflare.com/fundamentals/concepts/cloudflare-ip-addresses/), or use an equivalent authenticated origin boundary; local tests do not certify this external control.
- Keep the hostname proxied when CDN, WAF, or rate-limit features are used.
- Configure SSL/TLS mode intentionally for the origin certificate setup.
- Document production DNS records, origin hostnames, and proxy status in the deployment runbook.

## Cache Rules

Cache only public, repeatable responses:

- Static Nuxt assets under `/_nuxt/**`.
- Public marketing pages.
- Public documentation.
- Public images or generated assets that have no access-control requirement.

Do not cache:

- Authenticated app pages.
- API responses containing private data.
- Auth, checkout, session, webhook, upload, or mutating routes.

The app route rules make `/_nuxt/**` cacheable and default `/api/**` to no-cache. `/api/baseline` is the only cacheable API baseline route because it returns only public module and social-provider states.

## Browser Security Headers

Pinned `nuxt-security@2.6.0` owns the app's standard browser hardening headers, enforced Content Security Policy, per-response nonces, emitted-asset SRI, and `X-Powered-By` removal. The parallel custom header middleware has been deleted. The explicit policy is deny-by-default, uses nonce plus `strict-dynamic` for scripts, permits no blanket third-party browser origin, and adds exact provider sources only when the corresponding module is enabled. Better Auth and application-specific origin, signature, authorization, and payload guarantees remain outside this standard-header module.

Cloudflare must not remove, replace, weaken, or append broader origins to the application CSP. Rocket Loader, edge HTML minification, JavaScript rewriting, and other post-build transformations that could invalidate nonce/SRI behavior remain disabled until separately tested against the packaged app. Production responses include application-owned HSTS; Cloudflare may enforce a compatible or stricter edge transport policy only after the origin and rollback behavior are documented. [ADR 0007](adr/0007-nuxt-security-ownership-and-csp.md) records the exact ownership and residuals.

## WAF, Rate Limits, and Turnstile

Start Cloudflare WAF and rate-limit rules around obvious abuse surfaces:

- `/api/auth/**`
- The magic-link request and redemption endpoints within that auth prefix
- The exact family-plan invitation-manager routes under `/api/invitations`; edge limits complement but do not replace persisted owner verification, the invitation cap, or future app-owned resend quotas
- File upload request routes
- AI generation endpoints
- Other abuse-prone public endpoints added by a fork

The implemented Turnstile surface is deliberately narrow. Magic-link request commands carry an opaque token in `x-turnstile-token` and require action `auth_magic_link` through Better Auth's server `before` hook. Authenticated Files and AI DTOs define no Turnstile field and their handlers perform no Turnstile verification; their authentication, authorization, integrity, quota, and concurrency controls remain app-owned.

The surface uses one opaque string contract of 1–2,048 characters; the application does not trim or otherwise interpret token bytes. Enable the module with `NUXT_MODULES_TURNSTILE_ENABLED=true`, then provide `NUXT_CLOUDFLARE_TURNSTILE_SECRET_KEY` and `NUXT_PUBLIC_TURNSTILE_SITE_KEY`. Enabled verification is mandatory and fail-closed: Siteverify must return success with the exact action and the canonical application hostname, while Cloudflare enforces five-minute expiry and single use. Each attempt has a five-second deadline. A timeout/network failure, undocumented non-2xx response, unreadable or schema-invalid 2xx body, or sole `internal-error` receives one retry with the same UUID `idempotency_key`; deterministic challenge/configuration, unknown, or mixed failures do not retry. The application intentionally omits Siteverify's optional `remoteip` field.

The widget uses Cloudflare's supported compact 150-by-140-pixel size so it fits the baseline's narrowest auth panel without overflow. It clears its token after each magic-link request and on every error, expiry, or interaction timeout. Its error callback takes ownership without retaining or logging Cloudflare's provider code, disables provider-side error retries and feedback, and presents one generic manual retry control; expiry and interaction-timeout refreshes remain automatic.

With exact `false`, the server verifier performs no Siteverify call and returns the optional-defense bypass, while the client does not require a token, render a widget, load Cloudflare's script, or authorize Cloudflare in CSP even if stale keys remain. With exact `true`, both keys are required before startup and the runtime CSP adds only `https://challenges.cloudflare.com` to `script-src` and `frame-src`, following Cloudflare's [CSP guidance](https://developers.cloudflare.com/turnstile/reference/content-security-policy/) and [explicit-rendering guidance](https://developers.cloudflare.com/turnstile/get-started/client-side-rendering/). The runtime recognizes every official dummy site/secret key, rejects mixed real/dummy pairs in every environment, and rejects any dummy credential in production mode. Cloudflare's [official dummy credentials](https://developers.cloudflare.com/turnstile/troubleshooting/testing/) are provider-protocol fixtures: the documented success response uses `hostname: localhost` and `action: test`, so it cannot certify the application's strict `auth_magic_link` and canonical-hostname decision. Local provider doubles own that application behavior; #37 owns a full journey with a separate real widget restricted to the deployed hostname. See Cloudflare's [server-validation contract](https://developers.cloudflare.com/turnstile/get-started/server-side-validation/) and [Turnstile Privacy Addendum](https://www.cloudflare.com/turnstile-privacy-policy/) for the provider boundary.

## R2 Files

Files is optional. Keep `NUXT_MODULES_FILES_ENABLED=false` when a fork does not need file storage; that state performs no signing, SDK, provider, filesystem, database, or queue work and requires no R2 account. Enabled Files requires Jobs and an explicit `NUXT_FILES_DRIVER=local|r2`. Billing independently also requires Jobs; a deployment with either module enabled runs exactly one shared, supervised same-image worker against the web process's SQLite volume. The local driver needs no Cloudflare values. The R2 driver requires the 32-character lowercase hexadecimal account ID, exact 3-63 character lowercase alphanumeric/hyphen bucket name, account endpoint, Access Key ID, and Secret Access Key tuple from `.env.production.example`; partial or malformed configuration fails before listen.

Create one private R2 bucket for the application. Issue one [Object Read & Write token](https://developers.cloudflare.com/r2/api/tokens/) scoped to that bucket, not an account-wide Admin token. Configure the S3 client with `region: "auto"`. The default endpoint is `https://<ACCOUNT_ID>.r2.cloudflarestorage.com`; Cloudflare documents distinct `.eu.` and `.fedramp.` endpoints for jurisdictional buckets. Application policy additionally requires HTTPS, the configured 32-character lowercase-hex account ID in the hostname, one of those exact Cloudflare account endpoint forms, and no username, password, port, path, query, or fragment. This validation prevents credentials from being sent to a caller-selected host; it is stricter application policy, not a claim that Cloudflare performs the client-side validation.

The Files database persists one exact storage binding: driver and bucket plus the normalized account-and-jurisdiction endpoint for R2. Every later operation and cleanup pass must match that binding and each row's bucket; mismatch fails closed before provider mutation or metadata removal. Changing from local to R2, from R2 to local, or to a different R2 bucket, account, or jurisdiction is an explicit stored-object migration rather than a credential rotation or environment edit. No provider-migration command is included, so keep the bound identity unchanged until a stopped-writer copy, inventory verification, cutover, and rollback procedure is implemented and certified.

R2 upload initiation returns 15-minute presigned PUT and HEAD requests for one opaque `files/v1/<file-id>` object. The row and both URLs use one exact signing instant/expiry; mismatched output or a signer that finishes after expiry returns no capability and removes the pending row. The PUT binds the declared `Content-Length`, `Content-Type`, canonical base64 `Content-MD5`, `If-None-Match: *`, `Content-Disposition: attachment`, and `Cache-Control: private, no-store`. Browser JavaScript must provide the exact body and script-set headers; the browser derives the forbidden `Content-Length` header from that body. Cloudflare's current [S3 compatibility table](https://developers.cloudflare.com/r2/api/s3/api/) documents PutObject support for those metadata, conditional, cache-control, and `Content-MD5` fields. Exact pinned-SDK fixtures prove that the declared `ContentLength` and explicitly signable headers enter `X-Amz-SignedHeaders`; #37 retains live browser/R2 certification. The client sets `requestChecksumCalculation: "WHEN_REQUIRED"` to prevent the SDK from adding a full-object CRC32 request that Cloudflare's current checksum table marks unsupported, while keeping the explicit R2-supported `Content-MD5` contract. AWS documentation/source is used only to characterize the pinned S3 client; Cloudflare remains authoritative for R2 compatibility.

Completion reauthenticates and owner-scopes the persisted file row, then the server performs its own credentialed HEAD and compares length and media type. The browser-facing HEAD is only a lost-response diagnostic. R2's [strong consistency model](https://developers.cloudflare.com/r2/reference/consistency/) documents immediate read-after-write/list/delete visibility on the S3 API, so a successful PUT may be finalized without an application delay. Do not compare ETag with MD5 or trust a client-provided checksum result.

An owner-scoped download receives a 60-second presigned GET. Cloudflare documents GET, HEAD, PUT, and DELETE presigning, URL validity from one second through seven days, reuse until expiry, and use only on the R2 S3 API domain in its [presigned URL guide](https://developers.cloudflare.com/r2/api/s3/presigned-urls/). The 15-minute upload and 60-second download values, opaque keys, signed headers, `If-None-Match: *`, and no-public/custom-domain decision are application policy. These URLs are bearer capabilities: anyone holding one can perform its signed operation until expiry, and deletion cannot revoke an already-issued GET immediately.

Browser transfers need an exact-origin [R2 CORS policy](https://developers.cloudflare.com/r2/buckets/cors/). CORS permits browser access; it does not authenticate a person or replace the app's persisted owner predicate. Replace the placeholder with the exact `NUXT_PUBLIC_APP_URL` origin and do not use `*`:

```json
[
  {
    "AllowedOrigins": ["https://app.example.com"],
    "AllowedMethods": ["PUT", "GET", "HEAD"],
    "AllowedHeaders": ["Content-Type", "Content-MD5", "If-None-Match", "Content-Disposition", "Cache-Control"],
    "MaxAgeSeconds": 3600
  }
]
```

Apply and verify the policy through the Cloudflare dashboard or Wrangler before enabling R2 in staging. If browser code later reads a non-safelisted response header, add only that specific `ExposeHeaders` value after review; the baseline does not infer integrity from exposed ETag.

Server R2 calls use standard retries capped at three total attempts and a 30-second abort. Integrity, signature, authorization, and configuration errors are not blindly retried; `429`, `500`, and `503` are bounded transient cases. A browser receiving expiry obtains a new authenticated upload intent, while a conditional `412` resolves through trusted server HEAD because the first PUT may already have succeeded. The adapter accepts `ListObjectsV2` requests up to 100 keys and passes the continuation token unchanged as opaque provider state, but each cleanup invocation requests at most five, rejects missing-key/oversized/duplicate responses, and performs at most five sequential deletes. A cursor-bearing orphan page commits its delayed phase-root successor before the first mutation. One list plus five 30-second deletions has a three-minute provider ceiling below the existing five-minute lease. Ordinary upload cleanup remains due at presign expiry plus one minute. After the singleton storage binding exists, the Files-ready worker runs a throttled SQLite `IMMEDIATE` check before claiming work to maintain one viable full-root `{}` sweep on a 24-hour safety cadence. Only another viable root deduplicates it, so continuous queue traffic and non-root/cursor jobs cannot suppress the recurring root. Recurring roots catch a PUT that began before presign expiry but completed after the ordinary sweep without assuming a provider completion bound. Account deletion commits cleanup but never calls R2 synchronously, so R2 or worker outage can delay physical-byte deletion without restoring authorization after local deletion. Stripe cancellation is a separate precondition: an ambiguous Stripe result may retain a billing owner's identity until cancellation is confirmed, and the worker may retry cancellation but never delete that user.

Local signing/fakes certify only the application protocol and exact SDK serialization. #37 must record the real bucket/token scope, endpoint jurisdiction, deployed CORS behavior, browser PUT/HEAD/GET, integrity rejection, expiry/replay, conditional conflict, pagination, retry/error presentation, late-write cleanup, and account-deletion convergence before an R2-enabled deployment is certified. [ADR 0011](adr/0011-private-files-local-and-r2-lifecycle.md) records the application decisions.

## R2 database backups

Database backups use a second R2 resource boundary. Create one dedicated private Standard bucket per app/environment; never share the Files bucket, token, CORS, object namespace, or authorization. Configure no public/custom domain or browser CORS. Off-host backup is an optional deployment capability selected with the Compose `backup` profile. When selected, the private runner receives `BACKUP_R2_ACCOUNT_ID`, `BACKUP_R2_BUCKET`, `BACKUP_R2_ENDPOINT`, `BACKUP_R2_ACCESS_KEY_ID`, and `BACKUP_R2_SECRET_ACCESS_KEY` as Runtime-only, Build-disabled values and validates them at startup. Reviewed Coolify injects one shared `.env` into every service, so the Compose `environment` map explicitly overrides these five keys to empty on migration, web, and worker while the runner substitutes their configured values. These are not Nuxt runtime values, readiness inputs, or build arguments; only the explicitly invoked backup operator consumes them. A backup-disabled fork provisions neither these values nor the runner/task.

The exact pinned `@aws-sdk/client-s3@3.1045.0` writes one object below `sqlite/v1/` with `requestChecksumCalculation: "WHEN_REQUIRED"`, no SDK retry, exact length, provider-validated `Content-MD5`, and `If-None-Match: *`. R2's current checksum table does not justify a full-object SHA-256 request, so the application places its SHA-256 in the immutable key/metadata and then streams the complete object back through R2's strongly consistent API to independently count and hash the stored bytes. ETag is never treated as MD5 or integrity proof. R2 documents a 5 GiB single-part provider limit; the application uses a conservative `5 GiB - 5 MiB` ceiling, and multipart backup needs a separate design.

Use a separate admin identity to configure a 30-day Bucket Lock and 35-day lifecycle for `sqlite/v1/`; the bucket-scoped runner token cannot change those controls. R2 supplies TLS plus Cloudflare-managed AES-256 at-rest protection, with GCM documented as its preferred mode; this is not client-side secrecy from an authorized R2 principal. The code has no delete path. Follow [the backup runbook](../ops/backup-runbook.md) and [ADR 0016](adr/0016-private-r2-sqlite-backups.md). #36 provisions the real bucket/token/policies, private runner, private off-host receipt sink, and dead-man alert; #37 creates and configures the task and notifications, then executes and certifies upload, read-back, failure, freshness, and restore behavior.

## AI is outside the Cloudflare provider boundary

AI generation and optional hosted File/Web Search call OpenAI directly through the official server SDK. Cloudflare may apply ordinary WAF/rate-limit rules to the application's authenticated AI routes, but it is not a model/search gateway, history store, cache, credential owner, quota authority, domain-policy owner, or authorization source. See [the OpenAI guide](openai.md), [ADR 0012](adr/0012-direct-openai-responses-and-local-history.md), and [ADR 0014](adr/0014-server-owned-openai-web-search.md).

R2 Files continues to use the exact `NUXT_CLOUDFLARE_R2_*` names listed in `.env.production.example`; legacy unprefixed aliases are unsupported. The independent backup operator reads only the five `BACKUP_R2_*` values documented above.
