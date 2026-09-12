# Deployment checklist

Use this checklist for an authorized release of the public website. It records operational checks;
it does not authorize deployment or production data access by itself.

## Before release

- Record the selected commit/image and the results of `pnpm verify`.
- Confirm the intended Coolify resource, origin, persistent `/app/data` volume, and current database type.
- For the first events-only release, complete the reviewed [new-file conversion](../docs/database-cutover.md).
  Normal migration must refuse the old application database.
- Confirm `migrate` gates `web` and `backup-runner`, and supply the runner's required R2 credentials.
  Stop and remove retired `worker` and
  `stripe-sync-runner` containers and disable their tasks before installing the new database; check
  for orphan containers even after their Compose definitions are removed.
- Use current environment examples. Keep Sentry upload secrets separate from runtime, backup credentials
  restricted to the private runner, and Solidarity browser credentials off the server.
- Record the approved rollback boundary and the temporary private backup location without exposing data.

## After release

- Confirm successful migration, web readiness, and expected container image/volume.
- Check public pages and navigation in English, Spanish, and Punjabi.
- Check the calendar and RSVP destinations; verify `audience-members` is excluded from public results.
- Open the existing $10/$27 Stripe links and management portal without submitting payment or changes.
- Check canonical metadata, sitemap, robots, and llms.txt through the public origin/CDN.
- Verify configured Sentry and backup behavior using separately authorized operator checks.
- After cutover, retire only this website's exact Stripe webhook endpoint through the authorized
  provider configuration change; preserve all subscriptions and other integrations.
- Record the result privately. After the database cutover is accepted, retire old identity-bearing
  database files and the temporary rollback copy through the approved process.

Keep failed verification explicit. A healthy HTTP probe alone does not prove correct event filtering,
database conversion, hosted links, or backup recovery.
