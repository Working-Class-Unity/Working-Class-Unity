# Production evidence template

Copy this template to a private operations record outside Git. Do not put credentials, contact data,
source captures, database contents, private event URLs, or raw provider responses in this file.

## Authorized operation

- Requested change and authorization:
- Environment, resource, selected commit, and image identity:
- Operator and time:
- Expected result and rollback boundary:

## Code verification

- Checks actually run and their results:
- Remaining limitations or failures:

## Deployment or event update

- Target database/volume confirmed privately:
- Migration or event-preview digest and apply receipt:
- Readiness and public page/calendar checks:
- Restricted event exclusion:
- Hosted Stripe/Solidarity links checked without mutation:
- Backup result and optional observability result:

## Database cutover, when applicable

- Standalone DELETE-mode legacy backup without sidecars and fresh destination confirmed:
- Allowlisted metadata, hybrid identities, integrity, and foreign keys verified:
- No retired tables or mixed personal snapshots in destination:
- Temporary private rollback copy recorded:
- New release accepted or rollback performed:
- Old identity-bearing files and temporary copy retirement status:
- Existing off-host copy/retention state checked:
- Stripe subscriptions and external Solidarity records left intact:

## Result

- Completed actions:
- Unchanged or unverified provider state:
- Follow-up owner and concrete next action, if needed:
