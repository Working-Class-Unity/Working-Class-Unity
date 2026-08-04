# Route, Entity, Authorization, and Module Inventory

This inventory describes commit `98e6922`, then records the approved target disposition. “Workspace-scoped” below is target language; the current schema is user-scoped.

## Page routes

| Route | Current access and behavior | Classification | Target disposition |
| --- | --- | --- | --- |
| `/` | Public diagnostic dashboard: health, stack, demo form, state examples | Current reference UI | Keep `/` as global core but replace implementation with a user-facing home. Move detailed diagnostics behind staff/dev access. |
| `/auth` | Public password sign-in/sign-up plus current session panel | Global auth, outdated implementation | Replace with `/login` and `/signup` using magic link plus configured social providers. |
| `/billing` | Public shell; private state after sign-in; free-form Stripe price ID | Optional payment module | Move to workspace billing settings; render only server-owned plans and permission-aware actions. |
| `/observability-client-test` | Publicly renderable; fragment token validated by a protected API | Optional operations module | Exclude from normal navigation; enable only for controlled staging verification. |

No page currently implements `/app`, projects, workspace settings, account profile, file UI, search UI, pricing, checkout result, legal/privacy, onboarding, or a friendly not-found/error journey.

## API routes

| Method and route | Current boundary | Current verdict | Classification and target |
| --- | --- | --- | --- |
| `POST /api/ai/chat` | No session; weak Zod body; Turnstile only if configured; direct AI adapter | Unsafe public cost/privacy relay | Optional AI core. Default authenticated workspace, allowlisted model, quotas, bounded history, provider logging decision. |
| `* /api/auth/**` | Better Auth catch-all | Framework-owned auth surface | Global core. Passwordless/social plugins and tested origin/linking/rate policy required. |
| `GET /api/baseline` | Public static stack data | Diagnostic only | Development/reference route; exclude from product contract. |
| `GET /api/billing` | Session → user-filtered billing repository | Correct current user filter; wrong tenant model | Optional payment core; workspace-scoped. |
| `POST /api/billing/checkout` | Session → arbitrary client price/mode → Stripe REST | Broken commercial authorization | Optional payment core; workspace billing permission and server plan catalog. |
| `POST /api/billing/webhook` | Raw body → HMAC/timestamp → projection → event record | Authenticity positive; idempotency/order unsafe | External payment webhook; transactional durable inbox and official SDK. |
| `GET /api/decisions` | Public static decision data | Diagnostic only | Development/reference route; exclude from product contract. |
| `POST /api/files/:id/complete` | Session → user ownership → storage GET/size → ready | User-scoped; checksum not verified | Optional files core; workspace-scoped HEAD/integrity completion. |
| `PUT /api/files/:id/content?token=…` | HMAC bearer token; app buffers body then writes | Local test adapter is useful; production path is resource-heavy | Optional files core local adapter; configured R2 should use short-lived presigned PUT. |
| `GET /api/files/:id/download` | Session → user ownership → fully buffered object | Current owner check positive; app-proxied | Optional files core; workspace auth plus presigned/streaming configured path. |
| `GET /api/files` | Session → owner-filtered metadata | Correct current user filter; wrong tenant model | Optional files core; workspace-scoped. |
| `POST /api/files/uploads` | Session → metadata → optional Turnstile → pending row/token | Owner derived correctly; partial module/config policy | Optional files core; workspace scope and explicit local/R2 driver. |
| `POST /api/forms/baseline` | Public validation/optional Turnstile; no persistence | Misleading demo success | Remove from product surface or describe as non-persistent reference code. |
| `GET /api/health` | Public DB query and provider configuration details | Leaks topology; HTTP status false positive | Global operations core. Split public liveness from protected/internal readiness. |
| `POST /api/observability/client-test` | Static header token; 404 when token absent | Reasonable staging pattern | Optional observability module; rate limit and staging-only operational control. |
| `POST /api/observability/test-error` | Static header token; 404 when token absent | Reasonable staging pattern | Optional observability module; rate limit and staging-only operational control. |
| `GET /api/projects/:id` | Session → ID validation → user ownership | Correct single-owner check | Global reference-journey core; replace with workspace membership/capability. |
| `GET /api/projects` | No session → unscoped `SELECT` | Broken | Global reference-journey core; session/current-workspace required. |
| `POST /api/projects` | No session → body contains `ownerId` → project/search writes | Broken and non-atomic | Global reference-journey core; derive workspace and transact/reconcile indexing. |
| `GET /api/search?q=…` | Session → FTS filter on JSON `metadata.ownerId` | User-scoped but structurally fragile | Optional search core; relational workspace scope and source-record authorization. |
| `GET /api/storage/objects` | Any session → arbitrary prefix → provider-wide list | Cross-tenant diagnostic exposure | Reject as product API; staff/dev-only or remove. |
| `POST /api/storage/objects` | Any session → arbitrary normalized key/content → overwrite | Cross-tenant corruption/storage risk | Reject as product API; staff/dev-only or remove. |

## Target global page/API contract

The minimal fork-ready journey should prove these routes before optional product overlays are added.

### Pages

- `/` — public product home.
- `/login` and `/signup` — magic link plus configured social providers.
- `/app` — authenticated shell and current-workspace resolution.
- `/app/projects` — private project list/create with loading, empty, error, success, and forbidden behavior.
- `/app/projects/[id]` — private project read/update/delete reference flow.
- `/account` — personal identity, linked providers, sessions, export/deletion.
- `/workspace` or `/settings/workspace` — workspace name, members/roles when collaboration is enabled, and workspace deletion/transfer policy.
- `/legal/privacy` and `/legal/terms` — baseline data/provider disclosure templates that forks must customize.
- friendly unauthorized, forbidden, not-found, and global error surfaces.

### APIs

- `GET /api/me` — user identity plus current workspace/membership summary.
- current-workspace list/resolve/switch endpoints when multiple memberships are possible.
- workspace settings and membership endpoints appropriate to the chosen Better Auth Organization or app-owned implementation.
- workspace-scoped project CRUD with no ownership fields in client DTOs.
- a minimal public liveness endpoint and protected/internal dependency readiness endpoint.

Optional modules add their own complete route vertical slices only when installed/enabled as described in the canonical guide.

## Entity inventory

| Entity | Current scope and constraints | Target disposition |
| --- | --- | --- |
| `user` | Better Auth identity; unique email | Keep identity separate from tenancy. Add lifecycle hooks/export/deletion policy. |
| `session` | Better Auth session; FK cascade to user; stores IP/user agent | Keep; configure trusted proxy/IP/rate policy and retention. |
| `account` | Better Auth provider/credential account; FK cascade to user; provider/account unique | Reserve the word `account` for auth provider records. Review token encryption/retention. |
| `verification` | Better Auth token record | Use hashed magic-link storage and atomic single-use behavior. |
| `projects` | Plain `owner_id`; globally unique slug; no user FK | Replace owner with `workspace_id`; unique `(workspace_id, slug)`; FK and delete policy. |
| `files` | Plain `owner_id`; unique object key; enum only in TypeScript | Workspace FK; SQL state/size checks; integrity algorithm/provider metadata; deletion lifecycle. |
| `billing_customers` | Plain user ID; Stripe customer unique | Workspace-owned customer; explicit one-per-workspace/provider policy. |
| `billing_subscriptions` | Plain user ID; Stripe subscription unique; free-form status | Workspace-owned projection; constrained status, event version/timestamp, entitlement relation. |
| `billing_events` | Unique Stripe event ID; full JSON payload retained indefinitely | Durable receipt/inbox state; minimized/redacted payload and retention schedule. |
| `search_documents` + FTS5 | Ownership only in JSON metadata; trigger-maintained FTS; repository requests can run `CREATE VIRTUAL TABLE` and trigger DDL | Relational workspace/source scope and transactional/outbox reconciliation; schema changes only through committed migrations, with readiness failing on an old schema. |
| `job_queue` | Generic JSON payload; queued/running/succeeded/failed in TypeScript; no lease/idempotency | SQL checks, atomic claim, lease/recovery, enqueue idempotency, bounded payload/error. |
| `cache_entries` | Namespace/key unique; JSON value; optional expiry | Keep optional local cache with size policy and cleanup evidence. |
| `app_settings` | Global key/JSON value | Reserve for genuinely global non-secret settings or add workspace scope. |
| `app_events` | Global event text/context | Define purpose/retention and ensure private content is not duplicated into logs/events. |

### Missing global entities

- `workspace`
- `workspace_membership` with `owner`, `admin`, and `member` roles (exact capability mapping belongs in policy code)
- current-workspace selection or deterministic resolver
- workspace-scoped project ownership
- deletion/export audit state as needed

Optional modules may add invitation, entitlement/grant, conversation/message, email delivery, and provider receipt entities. They are not all global-core tables.

## Authorization model

The provisional route guide flattened identity, lifecycle, role, and payment state. The corrected model evaluates separate axes:

| Axis | Examples | Authority |
| --- | --- | --- |
| Caller | browser user, provider webhook, internal maintenance job | Route/authenticator |
| Authentication | anonymous, authenticated, fresh/verified when sensitive | Better Auth/session policy |
| Workspace membership | none, member, admin, owner | Membership persistence/plugin |
| Capability | project read/write, member manage, billing manage, workspace delete | App policy derived from membership role |
| Entitlement | feature grant, plan limit, quota remaining | Workspace entitlement projection |
| Lifecycle | personal workspace ready, optional onboarding incomplete/complete | App state; not a membership role |
| Global staff | support/admin operations | Separate, explicit staff control; never inferred from workspace role |

Every private request should resolve in this order:

1. authenticate the caller;
2. validate input;
3. resolve the current/URL workspace;
4. load membership and required capability;
5. apply entitlement/quota if relevant;
6. query/mutate with workspace scope included in the repository predicate;
7. return a resource-minimizing response and auditable result.

Frontend route guards are user experience. Server authorization remains authoritative.

## Module inventory

| Module | Installed/current surface | Current state | Target baseline state |
| --- | --- | --- | --- |
| Core app | Nuxt/Vue/Nitro/SQLite/Drizzle | Installed; incomplete journey | Always enabled and behaviorally tested. |
| Auth | Better Auth password flow | Enabled with unsafe fallback | Always enabled; passwordless magic link, configurable social, safe linking, no fallback secret. |
| Workspace | None | Missing | Always enabled; personal workspace can be visually unobtrusive in simple forks. |
| Projects | API only; collection auth broken | Unsafe | Always enabled reference vertical slice with browser/integration tests. |
| Stripe | Hand-written REST/HMAC, billing page | Implicitly available when secrets appear | Optional; disabled safely; complete config + sandbox tests when enabled. |
| Files/R2 | Metadata, app-proxy transfer, diagnostics | Local fallback implicit; R2 partial config changes behavior | Optional; explicit driver/enabled state; local/CI adapter plus R2 contract tests. |
| AI Gateway | Public chat proxy | Disabled only by missing URL; unsafe if configured | Optional; authenticated/quota policy, app-held conversation history, explicit provider logging. |
| Turnstile | Component/service on selected routes | Missing secret means success | Optional defense; disabled explicitly or enabled/fail-closed with official test keys. |
| Sentry | SDK configs/test routes | Disabled without DSN; server bootstrap/scrubbing unproven | Optional; safe-disabled, maps uploaded then removed from public output, globally scrubbed, staging evidence. |
| Email | None | Missing | Required by magic-link auth; provider-neutral adapter and local capture transport. |
| Search | FTS repository/API | User-scoped JSON authorization | Optional; workspace-scoped and source-authorized. |
| Jobs | Queue/one-poll worker | No callers; race/recovery gaps | Optional; safe queue contract and lifecycle tests. |
| PWA | Custom manifest/SW/offline page | Always active in production | Optional enabled module; offline shell only; real browser/device evidence. |
| Reka UI | Not installed | Missing | Install for the account/workspace dropdown; app owns styling/wrapper and tests. |
| PrimeVue/Tailwind/Nuxt UI/shadcn-vue | Not installed | Correct | Explicitly excluded from canonical dependencies. |

## Product overlays

Bible readers, baby-name discovery, family/history features, polling/voting, product-specific onboarding, product-specific admin, and product-specific pricing are not baseline-core routes or entities. A fork may add them only after the global journey and selected optional modules pass their contracts.
