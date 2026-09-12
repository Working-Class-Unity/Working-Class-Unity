# Public website operations

The production application serves public WCU pages and event metadata. Stripe handles subscriptions
through hosted payment and portal links; Solidarity handles organizer records and RSVPs. The website
has no user accounts, membership database, billing worker, email sender, or public event-write API.

Use the selected release's packaged operators and these guides:

- [Deployment](../docs/deployment.md) and [release checklist](deployment-checklist.md).
- [Events-only database cutover](../docs/database-cutover.md).
- [On-demand event sync](../docs/solidarity-event-sync.md).
- [Backups](backup-runbook.md) and [restore](restore-runbook.md).
- [External services](external-services.md) and [evidence template](production-evidence-template.md).

The Compose services are `migrate`, `web`, and `backup-runner`; the runner requires its R2 credentials.
The event-sync command runs
on demand from an organizer workstation and connects to the packaged operator. Never deploy organizer
browser credentials or configure unattended dashboard scraping.

Documentation and passing local checks do not establish production authorization or provider health.
Keep real environment values, database files, source captures, and receipts outside Git. A routine
event edit needs the reviewed preview/apply workflow; a database replacement or production deployment
needs its separately approved operational plan.

During the first public-site cutover, stop and remove retired worker and Stripe sync containers,
disable their tasks, and verify no orphan process still uses the volume. Preserve
one private temporary rollback copy, and copy only allowlisted event metadata into a fresh database.
Verify before retiring identity-bearing copies. Never use account deletion to clear old data, and never
cancel Stripe subscriptions as a side effect of removing the website integration.
