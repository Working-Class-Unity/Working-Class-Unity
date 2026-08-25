# Decision Tables

## Core Stack

| Area          | Baseline                                                                                              | Optional, Watchlist, Or Future                                                                        |
| ------------- | ----------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Web framework | Vue 3 + Nuxt 4                                                                                        | Other frameworks                                                                                      |
| Server        | Nitro/h3 inside the Nuxt app                                                                          | Separate API service                                                                                  |
| Repository    | Single pnpm application package                                                                       | Larger monorepo with more apps/packages                                                               |
| Database      | SQLite + Drizzle                                                                                      | PostgreSQL, MySQL, or managed database                                                                |
| Backups       | Optional deployment capability; persistent baseline environments use verified snapshots in private R2 | Fork-specific alternatives, omission with a recorded recovery boundary, or continuous replication     |
| Migrations    | Drizzle Kit generated SQL reviewed before apply                                                       | External migration tool                                                                               |
| Validation    | Zod schemas, generated from Drizzle where useful                                                      | Separate hand-written schemas only                                                                    |
| Auth          | Better Auth identity + Nuxt + Drizzle                                                                 | Additional identity plugins when needed                                                               |
| Tenancy       | Better Auth Organization for family-plan membership; user-owned private data                          | Organization-wide private data or a parallel membership authority                                     |
| UI            | Native HTML + Vue SFC + CSS tokens; exact `reka-ui@2.10.1` only for the app-owned account/family menu | Additional maintained headless primitives after a focused need review; no product-wide kit by default |
| State         | Local state, URL state, useFetch, and useState                                                        | Pinia only when shared client state becomes complex                                                   |
| Files         | Optional persistent local or Cloudflare R2 bytes + user-owned SQLite metadata                         | Public buckets, workspace ownership, or a generic ACL                                                 |
| Edge          | Cloudflare DNS/CDN/WAF/Turnstile/rate limits                                                          | Workers or Pages as primary app host                                                                  |
| AI            | Official OpenAI SDK + Responses API + locally authoritative history; optional managed File/Web Search | Provider-managed history, AI Gateway, local crawling/indexing, or a generic multi-provider framework  |
| Payments      | Stripe Checkout + webhooks                                                                            | Custom Elements/payment UI                                                                            |
| Hosting       | Coolify on DigitalOcean                                                                               | Managed PaaS or Kubernetes                                                                            |
| Visibility    | Sentry for production errors                                                                          | Broader observability stack                                                                           |
| Mobile        | Responsive web; Capacitor only when justified                                                         | Full native                                                                                           |

## Cloudflare Service Matrix

| Service          | Baseline Use                                         | Do Not Use By Default For                     |
| ---------------- | ---------------------------------------------------- | --------------------------------------------- |
| DNS              | Domain control and routing                           | App configuration storage                     |
| CDN/cache        | Static and safe public cache                         | Private app pages or webhooks                 |
| WAF              | Managed protection and request filtering             | Business authorization                        |
| Rate limiting    | Magic-link request/redemption, upload, and AI routes | Replacing server-side quotas                  |
| Turnstile        | Magic-link requests                                  | Authenticated Files, authorization, or quotas |
| R2               | Private Files objects and separate SQLite backups    | Relational queries or shared backup/Files ACL |
| Queues/Workflows | Future background work scaling                       | First version job processing                  |

## Mobile Decision Table

| Stage           | Choose When                                                                            | Build Next                                         |
| --------------- | -------------------------------------------------------------------------------------- | -------------------------------------------------- |
| Responsive web  | Users need browser access and basic mobile usability                                   | Capacitor only if app stores or native APIs matter |
| Capacitor       | Native plugins, app stores, push, camera, filesystem, biometrics, or deep links matter | Targeted native escape hatches                     |
| Targeted native | One workflow needs native performance or platform behavior                             | Full native only if most value is native           |
| Full native     | Mobile-specific UX is the product                                                      | Separate native roadmap and team capacity          |

These tables are development documentation and add no public runtime state. [ADR 0002](adr/0002-better-auth-organization-workspace-authority.md) records Better Auth Organization as the membership authority, [ADR 0003](adr/0003-family-plan-entitlements-and-user-owned-data.md) separates that authority from private application-data ownership, [ADR 0004](adr/0004-owner-member-family-plan-boundary.md) narrows the family-plan surface, [ADR 0005](adr/0005-immediate-account-deletion-and-billing-detachment.md) records immediate deletion and minimized billing detachment, [ADR 0006](adr/0006-personal-app-shell-and-invisible-family-plan-routing.md) removes visible workspace routing, [ADR 0007](adr/0007-nuxt-security-ownership-and-csp.md) assigns standard browser-security capabilities to `nuxt-security` while retaining stricter application boundaries, [ADR 0008](adr/0008-pre-release-database-rebaseline.md) remains historical, [ADR 0009](adr/0009-direct-stripe-family-plan-authority.md) records direct SDK family-plan billing, [ADR 0010](adr/0010-remove-local-search-and-fts.md) removes Local Search and FTS, [ADR 0011](adr/0011-private-files-local-and-r2-lifecycle.md) records the private local/R2 Files lifecycle and cleanup boundary, [ADR 0012](adr/0012-direct-openai-responses-and-local-history.md) records the optional direct OpenAI Responses boundary with locally authoritative conversation history, [ADR 0013](adr/0013-deployment-owned-openai-file-search.md) adds deployment-owned managed retrieval, [ADR 0014](adr/0014-server-owned-openai-web-search.md) adds server-owned domain-restricted Web Search, [ADR 0015](adr/0015-final-pre-release-database-rebaseline.md) establishes the preserved two-entry starting prefix and forward-only boundary, [ADR 0016](adr/0016-private-r2-sqlite-backups.md) establishes private immutable R2 database backups and isolated recovery, and [ADR 0017](adr/0017-stripe-personal-family-subscriptions.md) records the current Personal/Family catalog, lifecycle, entitlement, worker, and cancellation-before-deletion contract plus its two forward migrations.
