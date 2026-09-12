# Cloudflare boundary

Cloudflare may provide DNS/CDN protection for the public site and a separate private R2 destination
for event-database backups. Existing payment and organizer subdomains remain provider destinations;
this application change does not authorize DNS changes.

## Web traffic

Keep the application origin, HTTPS settings, security headers, and CDN cache behavior consistent.
Public static assets may be cached according to their versioned responses. Preserve origin cache
headers for event responses, health endpoints, errors, and operator probes. Do not cache private
readiness results or broaden a cache rule across `/api/`.

The application owns its content-security policy and response headers. Review built responses and
external-link navigation through the CDN after an authorized deployment. Stripe and Solidarity are
hosted destinations; the website does not embed their authenticated flows or receive payment/RSVP data.
The public website has no account forms requiring Turnstile.

## Private R2 backups

Only the backup runner uses R2; its credentials are required by the shipped Compose deployment.
Give it a dedicated private event-backup bucket and
bucket-scoped credentials; keep public access, custom public domains, and browser CORS disabled.
The exact five `BACKUP_R2_*` inputs and supported operations are in [the backup runbook](../ops/backup-runbook.md).
They are not Nuxt public values, build inputs, or web-process credentials.

The operator creates a consistent SQLite snapshot, verifies it, conditionally uploads an immutable
object, and reads all bytes back to compare its SHA-256. A provider ETag alone is not integrity proof.
The operator has no object-delete command. Bucket retention, lifecycle, access controls, and alerts
are external configuration: inspect and record the actual approved settings rather than assuming
that repository defaults provision them.

Legacy identity-bearing backups are a separate part of the [database cutover](database-cutover.md).
Do not restore those backups into the public events-only application or describe them as retired
until their actual storage and retention state has been checked.
