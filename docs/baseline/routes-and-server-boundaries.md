# Route and Server-Boundary Guide

Status: **approved canonical target, amended through 2026-07-16 by ADRs 0003 through 0012 and by #169 on 2026-07-28**. This is the target route contract, not an inventory of current routes. The original audit inventory remains in [the dated audit](../audits/2026-07-09/inventory.md).

## Route planning rule

Before implementation, classify every route as:

- global core;
- optional-module core;
- product overlay;
- internal/staff operations;
- external provider webhook.

For each route record: caller, auth state, resource authority, family-plan entitlement/quota where applicable, request schema, data entities, response shape, caching, abuse control, logs/retention, and required negative tests.

## Recommended global page matrix

| Page                                           | Access                                                                    | Purpose                                                                                     | Required states                                                             |
| ---------------------------------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `/`                                            | Public                                                                    | User-facing home and clear sign-in/start action                                             | content load/error as applicable                                            |
| `/login`                                       | Public/signed-out                                                         | Magic-link request and configured social login                                              | submit, neutral success, rate/error, expired redemption                     |
| `/signup`                                      | Public/signed-out                                                         | Same passwordless primitives with signup copy/legal disclosure                              | submit, neutral success, disabled provider, failure                         |
| `/invite/[invitationId]`                       | Public shell; details require matching verified user                      | View a minimized invite and explicitly accept or reject                                     | signed out, loading, unavailable, accept/reject, safe error                 |
| `/app`                                         | Authenticated                                                             | Personal application shell with no visible workspace selection                              | loading, empty, error/retry, success                                        |
| `/app/projects`                                | Authenticated user                                                        | Reference private list/create journey                                                       | loading, empty, error/retry, success                                        |
| `/app/projects/[projectId]`                    | Authenticated resource owner                                              | Read/update/delete reference resource                                                       | loading, validation, retryable error, not found/concealed, success          |
| `/account`                                     | Authenticated user                                                        | Identity, linked providers, pending family invitations, account deletion                    | loading/retry, delivery uncertainty, reauth/freshness, exact confirmation   |
| `/account/billing`                             | Payment module; independent person, Personal owner, Family manager/member | Five-offering purchase, transition, Stripe management, Family seats/removal, and self-leave | disabled, free, active, grace, suspended, transition, reconciliation, error |
| `/legal/privacy`                               | Public                                                                    | Fork-customizable privacy/data/provider disclosure                                          | static                                                                      |
| `/legal/terms`                                 | Public                                                                    | Fork-customizable terms                                                                     | static                                                                      |
| `/calendar`                                    | Public; signed-in active members receive additional events                | Upcoming WCU events imported from Solidarity                                                | loading, empty, error/retry, success                                        |
| `/account/billing?checkout=success\|cancelled` | Payment module                                                            | Checkout return state; never proof of payment                                               | pending, active, cancelled, timeout/retry                                   |
| global error/not-found                         | Appropriate                                                               | Friendly recovery without leaking internals                                                 | 404 and 500                                                                 |

### Personal-shell and family-plan routing decision

`/app` is the authenticated personal shell. [ADR 0006](../adr/0006-personal-app-shell-and-invisible-family-plan-routing.md) supersedes ADR 0002's visible `/w/:workspaceSlug` hierarchy without replacing Better Auth Organization as the membership authority. The automatically provisioned family-plan organization, immutable ID, generated slug, and owner membership remain internal. The shell does not expose or select them.

Owner invitation, billing-management, and lifecycle surfaces derive the caller's marked organization on the server and re-read persisted membership. They do not accept a workspace route key as authority. A person may be independent, manage their own family, or be an accepted member of one other family, but cannot exercise those paid relationships in parallel. Private project routes follow [ADR 0003](../adr/0003-family-plan-entitlements-and-user-owned-data.md): the server authenticates and predicates every project operation on the session user ID. A joined organization with an unambiguous granting billing snapshot may supply paid entitlement, but never private-record access. `session.activeOrganizationId`, a generated slug, and navigation state are sufficient for neither boundary. [ADR 0009](../adr/0009-direct-stripe-family-plan-authority.md) records the implemented backend.

R-020B makes the personal-shell correction executable: authenticated `/app` renders a private, non-cacheable personal shell; `GET /api/me` returns only minimized identity and the safe module projection; and visible workspace bootstrap/lookup routes are absent. Invitation acceptance re-reads the exact persisted `member` relationship by immutable organization ID and returns `/app`.

R-020A makes the public identity/account routes executable. `/login` and `/signup` are separate user-intent pages backed by one shared passwordless/social component and the same Better Auth operations. Pinned Better Auth magic-link authentication may create an unknown user through either page, so neither route performs account discovery or represents a separate registration backend. Both pages show Terms and Privacy acknowledgment as disclosure rather than persisted consent. Normal success returns `/app`, invitation success preserves only an exact validated `/invite/:invitationId`, and errors return to the originating intent page. Authenticated `/account` owns minimized identity and linked-provider display/unlinking, while R-021 owns global sign-out in the account menu; signed-out requests return to `/login`. The app-owned frontend `/auth` route is absent, while Better Auth's framework handler remains under `/api/auth/**`. These boundaries follow the pinned [Better Auth Nuxt integration](https://github.com/better-auth/better-auth/blob/v1.6.23/docs/content/docs/integrations/nuxt.mdx) and [magic-link behavior](https://github.com/better-auth/better-auth/blob/v1.6.23/docs/content/docs/plugins/magic-link.mdx).

R-023A makes the global route landmark behavior consistent without changing route authority. Every ordinary page renders one `AppPage` main landmark with the stable `main-content` target; the layout's first focusable control skips to that target, and the global error boundary exposes the same target directly. Primary links use app-owned current-route policy while retaining native link/navigation semantics. R-022 makes App current only at exact `/app` and Projects current for the collection and detail routes, so those pages expose exactly one `aria-current="page"`. The built browser journey owns skip focus, current state, rendered target size, focus/control contrast, narrow-width reflow, 200% root-font text stress, reduced motion, Axe, overflow, and console behavior. R-021 adds the separate Reka account/family command menu while primary navigation remains native.

R-021 reads Better Auth's public session endpoint through one shared application composable and projects only user ID, name, and email into Nuxt hydration. Organization identity, slug, role, capabilities, memberships, `activeOrganizationId`, and raw session fields are excluded. SSR checks disable sliding refresh so Better Auth's pinned browser session manager owns cookie refresh plus focus, online, and cross-tab reconciliation. Signed-in documents are private/non-cacheable, and authenticated identity loss or replacement clears owner-gated private state before a document reload. Re-audit this division if the pinned Nuxt/Better Auth versions or Better Auth cookie-caching policy changes. The account menu provides Account and Sign out without becoming workspace navigation or an authorization boundary; billing-authorized Family controls render only inside `/account`.

R-020C composes the family invitation and account-deletion APIs on `/account`, as amended by #169. A billing-current Family manager addresses only the caller's server-derived group; pending invitation summaries expose email/expiry only, and accepted-member summaries expose display name/email plus an undisplayed opaque removal selector. A caller covered by another family cannot operate the dormant marked group until self-leave; `activeOrganizationId` never changes this rule. Create carries only an email; resend/cancel carry only the opaque invitation path ID; manager removal carries only the opaque immutable member reference. The destructive control carries only exact `DELETE`, clears client session state only after confirmed success, and uses uncertainty-safe copy when a failed response cannot prove whether deletion committed. It introduces no broad member-directory route, organization selector, caller-selected server scope, role editor, or data authority.

R-022 makes the user-owned project reference journey executable at `/app/projects` and `/app/projects/[projectId]`. Both pages resolve authentication before project data and clear owner-gated state if the authenticated identity disappears. Collection and detail commands carry only a project name or immutable project ID; duplicate names remain valid. Malformed, missing, deleted, and foreign detail lookups share one concealed unavailable presentation, while transport/server failures remain retryable and distinguishable. Deletion uses an inline irreversible confirmation and does not navigate away until the server confirms success. The project pages and `/app/**` responses are private/non-cacheable.

`/` is a user-facing home, while `/legal/privacy` and `/legal/terms` are explicit fork-customization templates rather than production legal text. Unknown routes and fatal application failures use Nuxt's global `app/error.vue` with distinct non-sensitive 404/general-error titles and a recovery action; there are no literal `/404` or `/error` routes. R-021 implements the global Reka account/family menu; R-020C implements invitation-management and account-deletion controls on `/account`.

## Recommended global API matrix

Names may change in a focused approved route decision, but one canonical set must be used by code, tests, docs, and provider dashboards.

| Method and path                                         | Caller and policy                                           | Boundary behavior                                                                                                                                                                                                                                                |
| ------------------------------------------------------- | ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/live`                                         | Public                                                      | Process liveness only; no topology, credentials, paths, buckets, or provider IDs.                                                                                                                                                                                |
| `GET /api/events`                                       | Public; active members receive an additional audience       | Return sanitized active occurrences in a bounded UTC range. Hidden events never return; member events require a website account linked to an open active membership. Responses are `private, no-store`.                                                          |
| `GET /api/ready`                                        | Internal network probe or short-lived staff control         | Check DB and enabled required modules; redact detail; return 503 on failure. It is not exposed merely so a public smoke test can call it.                                                                                                                        |
| `GET /api/me`                                           | Authenticated                                               | Return only minimized user identity and the safe enabled-module summary; do not expose memberships, organization identifiers/slugs, roles, capabilities, active selection, or an entry target.                                                                   |
| `GET /api/invitations`                                  | Persisted Family manager                                    | Derive the organization from the authenticated user and return only pending, role-free invitation summaries that are unexpired or temporarily frozen by a recoverable Family delinquency; an accepted member cannot operate the dormant marked group.            |
| `POST /api/invitations`                                 | Billing-current Family manager                              | Accept only an email, reserve one seat transactionally, fix the role to `member`, create through Better Auth, and await truthful application delivery. Caller-selected organization, slug, role, or resend flags are rejected.                                   |
| `POST /api/invitations/:invitationId/resend`            | Billing-current Family manager                              | Require that exact pending, unexpired, seat-reserving invitation to belong to the manager-derived organization, reuse its ID, and await truthful delivery.                                                                                                       |
| `POST /api/invitations/:invitationId/cancel`            | Persisted Family manager                                    | Require that exact pending invitation to belong to the manager-derived organization, cancel it transactionally, and release its reserved seat.                                                                                                                   |
| `GET /api/invitations/:invitationId`                    | Matching verified recipient                                 | Return only workspace display name and expiry; conceal invalid, expired, wrong-account, and unverified cases.                                                                                                                                                    |
| `POST /api/invitations/:invitationId/accept`            | Matching verified recipient                                 | Recheck manager billing eligibility and the reserved seat. A current Personal subscriber first completes the durable renewal-off/residual-paid-through protocol; then accept through Better Auth, reconcile partial state, and require the persisted membership. |
| `POST /api/invitations/:invitationId/reject`            | Matching verified recipient                                 | Explicitly reject through Better Auth without exposing invitation internals.                                                                                                                                                                                     |
| `POST /api/account/family/leave`                        | Authenticated accepted member                               | With an empty body and no caller-selected scope, remove only the caller's external membership, release the seat, and restore any unexpired nonrenewing residual Personal entitlement; preserve identities/private data and the manager's subscription.           |
| `DELETE /api/account`                                   | Authenticated user with a session younger than 24 hours     | Strictly require `{ "confirmation": "DELETE" }`; for a billing owner complete durable cancel/retrieve confirmation first, then run local atomic deletion. Ambiguity retains identity; worker cancellation never authorizes user deletion.                        |
| `GET /api/account/billing`                              | Authenticated member or billing owner                       | Return safe offerings, relationship/entitlement, plan/cadence, period/renewal, grace/suspension, transition, accepted/reserved seats, manager member summaries, and computed capabilities; expose no Stripe resource IDs.                                        |
| `POST /api/account/billing/checkout`                    | Commercially independent billing owner                      | Strictly accept one of five offering keys, map it to the private Stripe Price, and create/reuse one durable quantity-`1` Checkout attempt; deny covered members and conflicting billing/transition state.                                                        |
| `POST /api/account/billing/change`                      | Current Personal owner or Family manager                    | Strictly accept one target offering; derive immediate pending Personal-to-Family versus deferred cadence/Family-to-Personal behavior, persist the transition before Stripe, and return only refreshed safe state.                                                |
| `POST /api/account/billing/portal`                      | Current non-covered billing owner                           | Create a short-lived session for the known Customer and exact configured Portal policy, rechecking authority around provider I/O. Portal owns payment methods, invoices, cancellation, and reactivation—not plan/Price changes.                                  |
| `POST /api/account/billing/reconcile`                   | Current non-covered billing owner                           | Under a captured local revision, resolve attempts and bounded current Stripe state; apply only while billing ownership/revision remain unambiguous. Rate-limit so this is not an unbounded listing primitive.                                                    |
| `POST /api/webhooks/stripe`                             | Stripe signature capability                                 | Verify the exact bounded raw body with `stripe@22.3.1`; accept only the 21 reviewed Checkout/subscription/schedule/invoice/refund/dispute events and store the minimized receipt only after durable processing.                                                  |
| `GET/POST /api/projects`                                | Authenticated user                                          | List/create only for the session user; request DTOs cannot supply owner or organization identifiers.                                                                                                                                                             |
| `GET/PATCH/DELETE /api/projects/:projectId`             | Authenticated resource owner                                | Predicate includes both resource ID and authenticated user ID; foreign and unknown IDs share a concealed `404`.                                                                                                                                                  |
| `GET /api/files`                                        | Authenticated resource owner; Files ready                   | Return one bounded keyset page of only the caller's minimized pending/ready metadata; never expose owner or provider locators.                                                                                                                                   |
| `POST /api/files/uploads`                               | Authenticated resource owner; Files ready                   | Validate bounded metadata and integrity, persist the caller-owned pending row and cleanup wake-up, then issue a 15-minute local or R2 upload capability; return no capability if durable setup fails.                                                            |
| `PUT /api/files/:id/content`                            | Authenticated resource owner with local upload capability   | Local-driver-only, app-origin-gated streaming upload; check the pending owner row before consuming bytes, then recheck its exact identity/future expiry immediately before no-overwrite publication and authoritative state before removing the crash marker.    |
| `GET /api/files/:id`                                    | Authenticated resource owner; Files ready                   | Return minimized metadata only when immutable file ID and current user ID match; conceal unknown, foreign, and deleted records identically.                                                                                                                      |
| `POST /api/files/:id/complete`                          | Authenticated resource owner; Files ready                   | Recheck ownership, read trusted storage metadata, and idempotently promote the caller's pending upload only when the persisted integrity contract matches.                                                                                                       |
| `GET /api/files/:id/download`                           | Authenticated resource owner; Files ready                   | Recheck persisted ownership and ready state before issuing a 60-second local or R2 GET capability; never return a capability for a foreign or unavailable row.                                                                                                   |
| `GET /api/files/:id/content`                            | Authenticated resource owner with local download capability | Local-driver-only private stream; require the current ready owner row and the matching 60-second capability, and force attachment handling.                                                                                                                      |
| `DELETE /api/files/:id`                                 | Authenticated resource owner; Files and Jobs ready          | Immediately conceal only the caller's row and commit delayed cleanup after the live upload window; provider I/O never occurs on the request path.                                                                                                                |
| `GET /api/ai/conversations`                             | Authenticated resource owner; AI ready                      | Return one bounded cursor page of only the caller's minimized conversations; no provider, owner, usage, or attempt metadata.                                                                                                                                     |
| `POST /api/ai/conversations`                            | Authenticated user with required entitlement; AI ready      | Accept only an empty object and create one caller-owned immutable-ID conversation after the server count/entitlement checks.                                                                                                                                     |
| `GET /api/ai/conversations/:conversationId`             | Authenticated resource owner; AI ready                      | Return one minimized conversation only when immutable ID and current user ID match; conceal unknown, foreign, and deleted records identically.                                                                                                                   |
| `DELETE /api/ai/conversations/:conversationId`          | Authenticated resource owner; AI ready                      | Delete the caller's conversation/message/attempt tree without resetting daily usage or releasing an in-flight owner lease; perform no provider call.                                                                                                             |
| `GET /api/ai/conversations/:conversationId/messages`    | Authenticated resource owner; AI ready                      | Return one bounded cursor page of ordered visible user/assistant messages for the owned conversation.                                                                                                                                                            |
| `POST /api/ai/conversations/:conversationId/messages`   | Authenticated owner with required entitlement; AI ready     | Reserve one app-idempotent, quota/concurrency-bounded attempt and dispatch at most one direct Responses call; expose only visible committed output or a finite safe error.                                                                                       |
| `DELETE /api/ai/conversations/:conversationId/messages` | Authenticated resource owner; AI ready                      | Delete visible messages/attempts and increment history revision so late results cannot finalize; retain daily usage and any in-flight content-free owner lease.                                                                                                  |
| `* /api/auth/**`                                        | Better Auth contract                                        | Framework-owned auth surface; trusted origins/rate limits/provider config tested.                                                                                                                                                                                |

There is no workspace-switch command or visible workspace route. Better Auth invitation acceptance may update nullable auth-session `activeOrganizationId`, but the app shell and authorization ignore it. Invitation and billing management do not accept client organization scope: the server derives the caller's uniquely marked family-plan organization plus current persisted external membership before acting. An accepted member cannot purchase/reactivate Personal or use Portal/reconciliation/plan-change/cancellation commands while Family covers them. Caller self-leave and the narrow manager-removal command each derive the exact persisted relationship, release only that seat, preserve private data, and restore unexpired residual Personal entitlement when applicable. Entitlement reads independently evaluate current persisted memberships and local subscription snapshots; paid access never implies private-data access.

### Current R-008B command-origin boundary

The current implementation fail-closes every unsafe app-owned `/api` request before its route handler. It accepts an exact configured `Origin`, `Sec-Fetch-Site: same-origin`, or a same-origin `Referer` fallback, requires every supplied recognized signal to agree, and returns redacted `403 CROSS_ORIGIN_REQUEST_BLOCKED` for missing, malformed, `null`, cross-site, same-site, direct-navigation (`none`), or conflicting signals. The comparison target is the exact origin of validated `NUXT_PUBLIC_APP_URL`, never an inbound `Host` or forwarded-host value. These strict details are application policy built from the [OWASP CSRF guidance](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html), the [MDN Fetch Metadata guide](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/Fetch_metadata), and the [W3C Fetch Metadata specification](https://www.w3.org/TR/fetch-metadata/).

The optional-module boundary runs before the origin boundary, preserving `404 MODULE_DISABLED` for a disabled route. Only these exact independent-authentication paths bypass the app-command gate: Better Auth's `/api/auth` and `/api/auth/**` surface, whose [official security contract](https://better-auth.com/docs/reference/security) owns CSRF/origin checks; `POST /api/webhooks/stripe`, whose raw body is authenticated by the official SDK according to [Stripe's signature requirements](https://docs.stripe.com/webhooks/signature); and the private-token `POST /api/observability/client-test` and `POST /api/observability/test-error` controls. Local `PUT /api/files/:id/content` remains origin-gated and then requires its session, short-lived capability, and persisted-owner checks; R2 browser PUTs target Cloudflare's S3 API and rely on exact-origin bucket CORS. There is no generic bearer-token exemption, and neighboring paths/methods stay protected.

Evidence is deliberately labeled. The focused origin suite owns the full signal, command-family, exemption, neighbor, encoded-route, and ordering matrix. One built encoded-project request owns only packaged Nuxt/Nitro decoded-path classification, middleware registration, stable rejection/security headers, and unchanged project state. Focused real-H3 and service tests own invalid-signature/no-write, provider-shape, duplicate/out-of-order event semantics, projection, and reconciliation. The isolated packaged-app suite retains one billing canary only for canonical `/api/webhooks/stripe` route/config mounting, official SDK test-header verification over Nitro's exact raw body, and duplicate receipt idempotency. Deterministic local signatures do not certify Stripe sandbox or live delivery. Focused real Better Auth/Drizzle/SQLite handler tests remain the primary account-deletion cookie, data, and recovery evidence; one packaged browser deletion separately proves the mounted app route, confirmed-success navigation, and subsequent signed-out protection. Project CRUD independently authenticates before validation, rejects every caller-supplied ownership field, and predicates each data operation on the session user ID; same-origin verification and family-plan membership never authorize a project.

## Optional-module route families

### Payment

- `GET /api/account/billing` — safe catalog plus relationship, entitlement source, plan/cadence, renewal/period, transition, dunning, accepted/reserved seats, manager member summaries, and computed capabilities; it never makes a covered member's residual Personal relationship manageable.
- `POST /api/account/billing/checkout` — an independent owner requests exactly one of `personal.weekly`, `personal.monthly`, `personal.annual`, `family.monthly`, or `family.annual`; the server selects the private Price and quantity `1` and reuses durable Checkout identity/idempotency.
- `POST /api/account/billing/change` — the server derives a deferred cadence change, immediate pending Personal-to-Family upgrade, or deferred Family-to-Personal downgrade from one exact target offering; callers cannot choose timing, proration, or payment behavior.
- `POST /api/account/billing/portal` — the current non-covered owner creates a short-lived configured-Portal URL for payment methods, invoices, cancellation, or reactivation after authority rechecks; the Portal cannot change plan or Price.
- `POST /api/account/billing/reconcile` — the current non-covered owner refreshes ambiguous/stale current state under bounded provider reads, rate limiting, full-revision, and relationship conflict detection.
- `POST /api/webhooks/stripe` — exact raw body, official SDK signature verification, the exact 21-event allowlist, minimized durable receipt, and bounded authoritative current-state reconciliation.

The backend redirects to `/account/billing?checkout=success` or `?checkout=cancelled` under the exact configured HTTPS application origin; neither redirect is proof of payment. The page re-reads the local projection and reports pending confirmation until authoritative Stripe state changes. Verified active Personal or Family grants the same premium capability; a verified first renewal failure grants only through the fixed local deadline no later than 14 days after that event's original timestamp. After the deadline, `past_due` alone does not grant, and unexpected `trialing`, unknown Price, multiple/equal conflict, or other ambiguity enters reconciliation. Cadence changes and Family-to-Personal take effect at renewal; Personal-to-Family uses a verified pending update before Family/invitation rights. Portal cancellation/reactivation is period-end; application routes own plan/cadence changes. A covered member sees `Family membership`, no payer/payment details, and self-leave only; a manager sees accepted/reserved seats and may remove a non-manager through the narrow opaque-reference command.

Billing is optional. `/account` links to `/account/billing` only when the server-derived Billing module state is ready. Billing-ready requires Jobs plus exactly one operational same-image worker against the web process's SQLite volume. With `NUXT_MODULES_BILLING_ENABLED=false`, an unpaid fork needs no Stripe account or credentials, renders no billing link or control, makes no Stripe call, keeps readiness healthy, and receives concealed `404 MODULE_DISABLED` responses for the page, Billing APIs, and Stripe webhook before database or provider work. Core identity, invitation-record ownership, private-data isolation, and `POST /api/account/family/leave` remain outside that route-module boundary; this does not make invitation mutations billing-independent. When Billing is disabled, current Family billing authority cannot be verified and every invitation mutation fails closed. When Billing is ready, the state-specific create/resend/accept and cancel/decline/reject gates below apply. Disabling Billing after live subscriptions exist is not a decommissioning procedure; the provider relationship must be reconciled separately before disabling the module.

### Family-plan invitations

The R-017I/R-018A routes are the invitation endpoints in the global matrix above plus `/invite/:invitationId`, amended by #169's Stripe authority and reservation rules. There is no broad Better Auth member-directory endpoint; the Billing DTO may give the current manager only accepted-member display name/email plus an undisplayed opaque removal reference. Native Better Auth invitation HTTP routes and broad Organization reads remain disabled. Each manager route authenticates, derives the marked organization, re-reads persisted manager and Billing state, and passes only the immutable organization ID to Better Auth. Create/resend/accept require active Family, renewal on, and no grace, suspension, cancellation, downgrade, or reconciliation conflict. Cancel/decline/reject remain available while frozen. Recipient detail requires a matching verified email, returns a minimized role-free projection, and uses the same concealed result for unavailable or foreign invitations.

Opening the application link never mutates membership. The global referrer policy is `strict-origin-when-cross-origin`, but the `nuxt-security` route rule for `/invite/**` emits `Referrer-Policy: no-referrer`; the existing invitation browser journey owns that privacy behavior. Accept, reject, ID-bound resend, and pending cancellation are explicit `POST` commands under the global app-origin boundary. Better Auth owns invitation records and member creation, while application transactions, compare-and-set revisions, and database constraints own capacity across the web and worker processes. The manager consumes one of six total seats; each accepted member and pending, unexpired invitation consumes one of the five remaining seats. A pending invitation that reaches its original expiry during a valid recoverable `past_due` or `unpaid` Family dunning episode remains visible, cancelable, and seat-reserving, but it cannot be created, resent, or accepted. Recovery to active billing re-enables ordinary expiry against the unchanged timestamp; cancellation, downgrade, or terminal Family lifecycle still releases it. Canceled, declined, and rejected invitations also release their reservation, and partial acceptance cannot count twice. A current Personal subscriber may join only after durable Stripe renewal-off confirmation preserves the paid-through date as nonrenewing residual state. The only roles remain `owner` and `member`: no admin, role mutation, transfer, successor ownership, export, or standalone workspace deletion exists. A member may self-leave; a persisted manager may remove one non-manager by opaque immutable reference. Pinned Better Auth performs membership deletion and active-organization clearing as separate writes while this app's incompatible async adapter transaction wrapper is disabled, so each narrow app-owned command uses one `BEGIN IMMEDIATE` transaction: self-leave deletes the caller's exact external membership and clears that caller's affected pointers, while manager removal reauthorizes the manager before deleting the exact non-manager membership and clearing only the target's affected pointers. Both paths release the seat and preserve identity/private data. Family downgrade/cancellation/terminal state or manager deletion dissolves coverage at the approved effective time while preserving member accounts.

### Account deletion

`DELETE /api/account` is the only public lifecycle delete command. It authenticates before parsing and accepts only `{ "confirmation": "DELETE" }`. Before any provider work, the application explicitly requires the session to be inside the configured 86,400-second freshness window. Its eventual pinned Better Auth server-API call supplies no password, token, callback URL, or email-verification callback, so Better Auth enforces freshness again. Native delete and callback HTTP paths remain `404`.

For a Stripe-backed billing owner, the route first durably records an exact-subscription cancellation request, calls immediate cancellation with no automatic refund or proration, and retrieves the subscription from Stripe. It proceeds only when retrieval confirms cancellation. A timeout, connection failure, or unconfirmed result leaves the user, credentials, sessions, organization, and private data intact. The worker may retry only that cancellation and retrieval; it can never call Better Auth deletion or treat the durable request as standing deletion authorization. After worker confirmation, the person must return with another fresh session and exact `DELETE` confirmation.

Only after no Stripe cancellation is required or confirmed cancellation is durable does the documented `beforeDelete` hook own one synchronous SQLite transaction: detach minimum provider continuity when justified; delete caller project/file/AI/live-billing rows; clear the deleted group from surviving invitee sessions; delete the owned group plus caller memberships/invitations elsewhere; purge matching magic-link verification rows; and delete sessions, accounts, then the user. This hook performs no Stripe, local-storage, R2, or OpenAI call. Better Auth's remaining deletes are safe no-ops and its response expires session cookies. File metadata has a live-user foreign key, and the transaction commits an empty delayed orphan-cleanup job. AI conversations/messages/attempts/generation leases/quota buckets are removed logically in the same transaction; a late provider result cannot finalize after its local owner/attempt authority disappears. The replay-safe worker performs bounded file-provider reconciliation after the upload-capability window; storage failure can delay physical-byte removal but cannot restore application access after local deletion. SQLite free-page/WAL remnants and retained backups are governed by the documented storage/backup policy rather than rewritten synchronously by this route. The route is private/no-store.

Invitees lose membership-derived entitlement only. Their identity, personal group, sessions, and user-owned records remain. Detached billing rows contain only minimized provider/customer references, status/order timestamps, reconciliation purpose/policy, and optional purge time—never identity, organization, Price, raw event payload, receipt, or content. A same-email registration creates a new user. Late provider events resolve exact subscription references and recheck after a deletion race; they cannot create live state or invent a missing deletion timestamp. [ADR 0005](../adr/0005-immediate-account-deletion-and-billing-detachment.md) records the table-by-table boundary and [ADR 0009](../adr/0009-direct-stripe-family-plan-authority.md) records the provider implementation.

### Files

- `GET /api/files` — `{ files, nextCursor }`, a bounded keyset page of the caller's minimized ready/pending metadata.
- `POST /api/files/uploads` — authenticate, validate a 1-byte-through-25-MiB size, normalized media type, filename display metadata, and canonical base64 `Content-MD5`, then create an opaque pending row and 15-minute upload capability. Local returns `{ file, upload }`; R2 additionally returns the diagnostic `head` request.
- `PUT /api/files/:id/content` — local-driver-only byte stream authenticated by the upload capability; it validates current persisted owner/pending/expiry state before consuming bytes and publishes only after size and MD5 verification, then returns `{ file }`.
- `GET /api/files/:id` — `{ file }` with minimized metadata for one owned immutable ID.
- `POST /api/files/:id/complete` — `{ file }` after owner-scoped, trusted storage metadata verification and an idempotent pending-to-ready transition.
- `GET /api/files/:id/download` — `{ file, download }` with an owner-scoped 60-second local or R2 GET capability.
- `GET /api/files/:id/content` — local-driver-only stream requiring both the authenticated owner and the 60-second download capability.
- `DELETE /api/files/:id` — immediately conceal the owned row, commit delayed cleanup after the upload capability expires, and return `204`.

Every route derives the owner from the session and includes that immutable user ID in its repository predicate. Valid file IDs use the server-generated `file_<UUID>` shape. Any unknown value accepted by the bounded 1-through-128-character path schema, including a foreign or deleted ID, shares one `404`; two users in the same family-plan group receive the same concealed result for each other's files. Overlong path parameters and malformed request bodies or queries receive a minimized `400` before provider work. DTOs never expose owner ID, bucket, object key, internal checksum, or deletion state. Object keys use the server-generated `files/v1/<opaque-file-id>` shape; the original filename is display metadata only. The baseline has no collaborator table or generic ACL, and family-plan membership grants no file access.

The database binds Files to one exact driver and bucket identity plus the normalized account-and-jurisdiction endpoint for R2. Routes, services, and cleanup fail closed before provider mutation or metadata deletion when active configuration or a row's bucket does not match it. Changing local/R2 driver or R2 bucket, account, or jurisdiction requires an explicit stopped-writer object migration; no configuration-only switch or supported provider-migration command exists in the baseline.

R2 initiation supplies a presigned PUT and diagnostic HEAD for 15 minutes using the same signing instant and expiry as the pending row; mismatched or already-expired signer output returns no capability. The PUT requires the declared `Content-Length`, `Content-Type`, `Content-MD5`, `If-None-Match: *`, `Content-Disposition: attachment`, and `Cache-Control: private, no-store`; browser JavaScript supplies the exact body and script-set headers while the user agent derives the forbidden length header. Completion independently performs credentialed HEAD and does not trust the client diagnostic. A presigned URL is a reusable bearer capability until expiry, not a one-use session. No `/api/storage/**` provider diagnostic route exists, because the product has no staff authorization model.

Files DTOs and handlers have no Turnstile coupling. Upload authorization, integrity, size limits, and edge/app rate limits remain independent controls. [ADR 0011](../adr/0011-private-files-local-and-r2-lifecycle.md) owns the driver, migration, cleanup, and residual-access contract.

### AI

- `GET /api/ai/conversations` — `{ conversations, nextCursor }`, a bounded page of the caller's minimized private conversations.
- `POST /api/ai/conversations` — create an empty immutable-ID conversation after persisted authentication, optional Billing entitlement, and the 100-conversation limit; accept only an empty object.
- `GET /api/ai/conversations/:conversationId` — `{ conversation }` only when immutable conversation ID and persisted user ID match.
- `DELETE /api/ai/conversations/:conversationId` — delete the owned conversation/message/citation/attempt tree while retaining the caller's minimized daily quota bucket.
- `GET /api/ai/conversations/:conversationId/messages` — `{ messages, nextCursor }`, a bounded ordered page of visible user/assistant text plus normalized File/Web citations.
- `POST /api/ai/conversations/:conversationId/messages` — accept exact `{ clientRequestId, content }`, reserve one idempotent attempt, call direct OpenAI Responses at most once, and return the visible committed user/assistant result. The server owns instructions, model, optional deployment corpus/Web-domain policy, 32,000-byte message and 200,000-byte rendered-input limits, 4,096-token output, 50-reserved-attempt UTC-day quota, one-active-generation concurrency, and 60-second timeout.
- `DELETE /api/ai/conversations/:conversationId/messages` — clear visible messages/citations/attempts and advance history revision so late provider results cannot reappear; retain the daily quota bucket and any content-free in-flight owner lease until matching finalization or expiry.

Every route authenticates and predicates resource ID plus current persisted owner ID. Unknown, deleted, and foreign IDs—including another member of the same family plan—share one concealed `404`. Create/generate require current persisted entitlement only when Billing is ready; list/read/clear/delete remain owner-accessible after entitlement loss. Public DTOs omit owner, model, provider/attempt/file/vector-store IDs, retrieval queries/actions/results, usage, quota, and internal errors. Citations are only `{ type: "file", title }` or `{ type: "web", title, url, startIndex, endIndex }` with server-normalized bounded values.

The official `openai@6.47.0` adapter calls Responses directly with local visible history, `store: false`, explicit no-cache mode, no provider conversation/previous response, no attachments or streaming, no SDK retry, and SDK logging off. File and Web Search are separate subordinate disabled-by-default fork switches. File Search true adds one server-selected read-only vector store and at most ten results. Web Search true adds one strict server-owned one-to-100-domain allowlist and medium search context; callers cannot provide domains, location, context, or tools. Either request uses automatic choice, disabled parallel calls, and at most one total built-in call; when both are offered, one turn can use File or Web Search, not both. The adapter requests no raw File results or full Web sources/actions and never server-fetches citation URLs. Same idempotency UUID plus same content replays/reports the existing attempt without another provider call; changed content conflicts. A timeout or connection failure after dispatch is indeterminate and never auto-resubmitted. Raw provider envelopes/errors, search queries/actions/results, citation metadata, and prompt/response text do not enter ordinary logs or Sentry. `store: false` is not Zero Data Retention, does not remove persistent OpenAI Files/vector stores, and live Web Search is not HIPAA/BAA-covered; [ADR 0012](../adr/0012-direct-openai-responses-and-local-history.md), [ADR 0013](../adr/0013-deployment-owned-openai-file-search.md), [ADR 0014](../adr/0014-server-owned-openai-web-search.md), and [the OpenAI guide](../openai.md) own the provider privacy and #37 certification boundary. There is no anonymous `/api/ai/chat` relay or Turnstile field.

### Jobs

- Job control is server/worker-only unless a deliberately authorized status endpoint exists.
- Billing or Files requires Jobs and exactly one supervised worker from the web's immutable image with the same local same-host SQLite volume.
- A Stripe account-deletion job is cancellation reconciliation only. Its handler re-reads durable state, retries exact-subscription cancellation/retrieval replay-safely, and records confirmation; it never deletes a user, organization, session, credential, or private record.
- Supervision restarts unexpected exits outside stop-first maintenance. Operators monitor oldest-due backlog, pending cancellation age, and scheduled-effect deadlines because process liveness alone does not prove convergence.

### Observability

Test-error controls are staging/internal operations. They are absent or 404 when disabled, use short-lived operational authorization when enabled, and never appear in primary navigation.

## Server boundary flow

### First-party read

```text
page useFetch
  → Nitro route
  → session
  → validated query/params
  → immutable resource owner or feature-specific access relationship
  → resource-scoped repository predicate
  → independent family-plan entitlement check only when the capability is paid
  → response DTO
```

### First-party command

```text
native form/button
  → $fetch command
  → optional-module gate
  → app-owned cross-origin/CSRF verification
  → session
  → server validation
  → resource ownership or feature-specific collaboration check
  → independent family-plan entitlement/quota check when required
  → transaction/service/provider adapter
  → minimal result/idempotency status
```

### Provider webhook

```text
raw request bytes
  → provider authenticity and replay window
  → schema/event-type validation
  → atomically claim durable receipt
  → update/reconcile local projection
  → mark processed or retryable failure
  → fast 2xx only after accepted durable state
```

### Background job

```text
domain transaction commits eligible work
  → atomic lease claim
  → replay-safe handler
  → conditional complete/fail using worker token
  → delayed retry, terminal failure, or stale recovery
```

This is at-least-once execution, not exactly once. The worker token fences queue-state completion after reclaim; it cannot undo an external side effect performed before a crash. Current cleanup and Stripe-cancellation handlers are therefore replay-safe and re-read authoritative state before each bounded effect. Stored failure diagnostics use fixed bounded codes rather than payload or exception text.

## Layer rules

### Pages/components

- coordinate UI and accessible states;
- use native form semantics and route metadata;
- never import database/provider/server secret code;
- treat route middleware as UX, not server authorization.

### Composables

- reusable browser-safe orchestration;
- typed wrappers around real Nitro endpoints are acceptable;
- do not hide or bypass route authorization boundaries.

### API handlers

- own HTTP concerns after the global gates: raw body where required, validation, session, resource ownership or feature-specific access, independent family-plan entitlement/owner authority where applicable, status/error mapping, cache headers, and response minimization; every unsafe app-owned API command remains under the global cross-origin/CSRF policy even before a route becomes cookie-authenticated;
- do not accept authority fields from the browser;
- delegate provider/domain work after policy checks.

### Services

- own provider SDKs, timeouts, pagination, idempotency headers, normalized failures, and module state;
- do not assume a route already applied resource or family-plan policy when the service can be called elsewhere; pass explicit owner/collaborator and entitlement/organization context where needed.

### Repositories

- require scope explicitly;
- include scope in `SELECT`, `UPDATE`, and `DELETE` predicates;
- use transactions for invariants and durable outbox/inbox patterns where external work cannot be atomic;
- never expose an unscoped “list all private rows” method to product handlers.

### Shared helpers

- pure, serializable, safe for browser and server;
- no Vue/Nitro/database/provider imports;
- shared validation improves DTO consistency but server validation remains authoritative.

## Error and response rules

- 400: invalid input with safe field errors.
- 401: authentication required.
- 403: cross-origin app command rejected with stable redacted `CROSS_ORIGIN_REQUEST_BLOCKED`, or authenticated but missing workspace/capability; avoid revealing private-resource existence when policy requires 404.
- 404: resource/module/control absent or intentionally concealed.
- 409: uniqueness/version/state conflict.
- 413: body exceeds enforced limit before full buffering.
- 429: application rate/quota limit.
- 502: provider rejected content or returned a malformed/unusable result.
- 503: enabled dependency/config/readiness unavailable.
- 504: provider timeout; an already-dispatched operation may be indeterminate.
- 5xx bodies contain a stable public error code and correlation ID, never provider payloads/secrets/topology.

## Caching

- No private/session/authorization response is cached publicly.
- Auth, checkout, webhooks, upload coordination, AI commands, and mutations are never edge-cached.
- Only explicitly public repeatable content/assets receive public cache policy.
- Provider/CDN settings cannot compensate for missing application authorization.

## Required route tests

Every private resource family includes:

- anonymous request;
- authenticated non-owner/non-collaborator;
- owner or explicit feature collaborator as applicable;
- a different user with the same family-plan membership;
- a colliding resource identifier or former technical slug owned by another user;
- missing family-plan entitlement or owner authority only for the separate operations that require it;
- invalid/malformed input;
- disallowed cross-origin request for every unsafe app-owned API command, plus separate hostile-origin/signature/capability evidence for every exact exemption;
- not-found/concealment behavior;
- disabled/incomplete optional module where applicable;
- persistence rollback/retry behavior on injected downstream failure.

The reference journey additionally runs through Chromium with keyboard-only navigation, focus transitions, narrow CSS viewports, long content, and loading/empty/error/success states. Physical-device, cross-browser, and browser-zoom certification remain separate evidence.
