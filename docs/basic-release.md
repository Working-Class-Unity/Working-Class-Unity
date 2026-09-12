# Public website scope

The application serves public WCU content and public event listings. Membership contributions use
Stripe-hosted links for $10/month Membership and $27/month Solidarity; subscription management uses
the hosted Stripe customer portal. RSVP and organizing forms open Solidarity.

There are no website accounts, authentication, free-user tiers, local people, membership or governance
records, RSVP or attendance records, billing APIs/webhooks, transactional email, AI chat/search,
user uploads, or user-file storage. These are removed capabilities rather than runtime switches.

The database contains event metadata only. `audience-members` remains an accepted source tag and is
excluded from public responses everywhere. Campaign and Side-Quest database features are deferred;
current public campaign pages and event campaign classification remain.

Sentry error reporting is optional. The shipped Compose deployment includes a separate private R2
event-database backup runner and requires its credentials. These operational capabilities do not
introduce website identities or member-only pages.

Removing local identity code is distinct from production data retirement. Follow the separately
approved [database cutover](database-cutover.md); keep real Stripe subscriptions intact.
