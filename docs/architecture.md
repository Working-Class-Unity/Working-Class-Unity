# WCU architecture

WCU is a public Nuxt website with a local event metadata database. Stripe hosts membership payments
and subscription management. Solidarity hosts event authoring, RSVP collection, and organizing forms.

## Application boundaries

- `app/` owns public pages, localized content, navigation, and calendar presentation.
- `shared/` holds public contracts, taxonomy, discovery data, and common validation.
- `server/api/events/` reads public event metadata from SQLite.
- Event import and sync operators validate reviewed Solidarity metadata and write it transactionally.
- Database maintenance initializes and verifies the events-only schema and creates consistent backups.
- Health endpoints, response security, and optional Sentry observability support the web process.

The site has no local user, person, session, membership, governance, RSVP, attendance, billing, AI,
or file-upload model. Campaign and Side-Quest database management is future work; current campaign
pages and event campaign tags remain supported.

## Hosted membership payments

| Public action          | Destination                                                  |
| ---------------------- | ------------------------------------------------------------ |
| Membership — $10/month | https://pay.workingclassunity.com/b/7sI4hF1hc9IIepq4gh       |
| Solidarity — $27/month | https://pay.workingclassunity.com/b/bIY4hF4tof325SUaEE       |
| Manage subscription    | https://pay.workingclassunity.com/p/login/00g29l9RKespfsI7ss |

These are ordinary external links. Stripe handles checkout, its own customer verification, receipts,
and subscription changes. The website requires no Stripe API key, webhook signing secret, or local
subscription projection. There is no website account to activate after payment.

## Event data

Solidarity remains authoritative for event titles, descriptions, schedules, locations, links, and
classification. The local database stores an allowlist of that metadata, stable provider identities,
and the minimal import/sync provenance required to reconcile later updates. It does not store raw
People reports or arbitrary provider payloads.

Every public query excludes `audience-members` and hidden events. Keeping the original audience tag
prevents a later import from accidentally publishing a restricted event. The same exclusion applies
to the calendar, navigation event panel, metadata, and discovery output. Knowing a direct Solidarity
URL is governed by Solidarity's own access behavior; the website does not authenticate visitors.

Imports are on demand. Failed or incomplete collection cannot authorize retirement. Rescheduling
preserves event/session identity and paired hybrid occurrences. RSVP actions open the hosted
Solidarity event page.

## Runtime and recovery

One web process uses the event database on a persistent `/app/data` volume. A one-shot migration
service must finish before web and the private backup runner start. The shipped Compose deployment
requires the runner's R2 credentials; the runner has no public route. There is no application worker
or Stripe synchronization process.

Normal initialization and restore accept only the packaged events-only database contract. The
retired application database requires the explicit [conversion workflow](database-cutover.md).
The [deployment guide](deployment.md) and [backup runbook](../ops/backup-runbook.md) describe the
operator boundary. Restoring event metadata never changes Stripe subscriptions or Solidarity records.
