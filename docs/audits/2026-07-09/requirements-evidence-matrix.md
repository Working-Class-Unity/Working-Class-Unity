# Requirements → Implementation → Test Evidence Matrix

## Authority, evidence, and classification

Normative target conflicts are resolved in this order:

1. explicit owner decisions from the audit interview;
2. current official documentation applicable to the pinned/target version;
3. the owner-approved canonical baseline contract;
4. provisional supplied guides and Initial App Fixes;
5. current repository documentation and examples.

Source inspection, deterministic commands, runtime probes, and external sandbox evidence determine whether the implementation conforms to that target; current behavior does not redefine the target.

Classifications:

- **Global core:** every baseline fork receives it.
- **Optional-module core:** installed and tested in the baseline, but disabled/exposed only by explicit configuration; once enabled, its whole safety contract applies.
- **Product overlay:** belongs in a fork, not the generic baseline.
- **Recommendation:** useful default that may change with evidence.
- **Rejected/outdated:** must not control future implementation.
- **Unresolved:** requires a bounded spike or external evidence.

Status describes commit `98e6922` using the base states **pass**, **partial**, **fail**, **missing**, or **externally blocked**. Comma/slash qualifiers narrow the scope without defining another base state.

## Global core

| ID | Requirement | Current implementation evidence | Current test evidence | Status | Finding |
| --- | --- | --- | --- | --- | --- |
| G-01 | One Nuxt 4/Vue 3/Nitro monolith with browser/server/shared boundaries | Conventional `apps/web/app`, `server`, `shared`; provider adapters under services | Doctor import-boundary checks; build passes | Pass | — |
| G-02 | SQLite/Drizzle schema and committed migrations are authoritative | Six migrations and schema modules exist, but search repository calls execute FTS/trigger DDL at request time | Fresh migration, integrity, FTS insertion pass; no old-schema readiness rejection | Partial/unsafe | DAT-001 |
| G-03 | User identity → membership(role) → workspace → private resources | Only user/owner strings; no workspace/membership tables | No tenancy tests | Missing | TEN-001 |
| G-04 | New user receives an idempotently provisioned personal workspace | Better Auth signup only | No test | Missing | TEN-001, AUTH-001 |
| G-05 | Passwordless magic link plus configurable social providers; no default password flow | `emailAndPassword.enabled: true`; password form; no plugins/email sender | API smoke creates password users | Fail | AUTH-001, EMAIL-001 |
| G-06 | Magic links are short-lived, single-use, hashed, rate-limited, and enumeration-neutral | No magic-link implementation | No test | Missing | AUTH-001 |
| G-07 | Social login uses minimal scopes and verified/explicit linking; unneeded OAuth tokens are not retained, while retained tokens are encrypted/rotatable and cleaned on unlink/delete | Linking/token policy is undocumented; account table has plaintext access/refresh token columns | No linking, encryption, rotation, unlink, or deletion test | Missing | AUTH-001, PRV-001 |
| G-08 | Public home → auth → workspace bootstrap → app → private project → settings journey | Four diagnostic pages only | Browser observation only; no E2E | Fail | PRO-001 |
| G-09 | Private project list/create/read/update/delete derives workspace scope server-side | Collection GET/POST are public; detail is user-owned read only | Smoke normalizes public collection and caller `ownerId` | Fail | SEC-001, TEN-001 |
| G-10 | Client DTOs never accept ownership/tenant identifiers | `createProjectSchema` includes `ownerId` | Unit/smoke assert the field | Fail | SEC-001 |
| G-11 | Repository predicates include tenant scope and cross-workspace negative tests | User filtering exists for some routes; no workspace predicates | No cross-workspace matrix | Missing | TEN-001, TST-001 |
| G-12 | Data FKs, domain checks, deletion/export, and ownership-transfer rules are explicit | App-owned user IDs lack FKs; statuses mostly TypeScript-only; no lifecycle | Migration checker omits deletion/foreign-key behavior | Fail | DAT-001, PRV-001 |
| G-13 | Production config is validated at startup and one naming contract works in built runtime | Mixed `process.env` and Nuxt config; fallback values | Readiness advisory only; runtime probe failed ordinary keys | Fail | CFG-001, SEC-002 |
| G-14 | Public liveness is minimal; detailed readiness is protected and failure returns non-2xx | One public detailed route; always HTTP 200 | Non-strict smoke passes; strict only inspects body | Fail | HLT-001 |
| G-15 | Legal/privacy templates explain application/provider data handling and must be customized by forks | No legal pages or canonical data notice | No test | Missing | PRV-001 |
| G-16 | Browser responses enforce a provider-aware CSP and cookie-authenticated commands reject disallowed cross-origin requests | Several other security headers exist; no CSP or app-owned origin/CSRF contract | Smoke checks other headers only; no hostile-origin command matrix | Missing | WEB-001 |
| G-17 | Passwordless auth has a provider-neutral email sender, deterministic local/CI capture transport, and production delivery/failure/rate tests | No email dependency or service | No test | Missing | EMAIL-001 |

## Optional-module core

| ID | Requirement | Current implementation evidence | Current test evidence | Status | Finding |
| --- | --- | --- | --- | --- | --- |
| O-01 | Each optional module has explicit disabled/enabled state; disabled is healthy, enabled incomplete fails closed | Provider presence inferred from credentials; readiness requires everything; health marks disabled degraded | No state matrix | Fail | MOD-001, SEC-002 |
| O-02 | Stripe uses official SDK, server plan catalog, workspace billing permission, idempotent Checkout, and workspace metadata | Hand-written fetch/signature; arbitrary price/mode; user billing | Local smoke covers basic projection/duplicate sequentially | Fail | PAY-001 |
| O-03 | Stripe webhook is raw-body verified, transactionally deduplicated, order-aware, and minimally retained | Raw-body/HMAC positive; projection before receipt; full payload retained | Signature unit test and sequential duplicate smoke only | Partial/unsafe | PAY-002, PRV-001 |
| O-04 | Files use workspace metadata, server-generated keys, integrity checks, explicit local/R2 driver, and short-lived configured transfers | User-owned metadata; app-proxy buffer; caller checksum; implicit local fallback | One local file smoke; pure orphan helper test | Fail | SEC-003, STO-001, STO-002, RES-001 |
| O-05 | Storage diagnostics are staff/dev-only and provider listing/cleanup paginates | Any authenticated user can list/write keys; R2 one page | No adversarial/pagination tests | Fail | SEC-003, STO-002 |
| O-06 | AI requires explicit public/auth policy, server model allowlist, input/token ceilings, rate/quota/budget/concurrency, timeout | Public route; caller model; unbounded strings/array; no quota/timeout | No route/provider tests | Fail | AI-001, RES-001 |
| O-07 | Full AI conversation history is workspace-scoped app data with clear/delete/export/workspace-deletion | No conversation schema or UI | No test | Missing | PRV-001 |
| O-08 | Provider prompt/response logging is deliberately configured; Sentry/server logs do not duplicate full prompts | Messages forwarded unchanged; no Cloudflare logging header/policy | No test/external evidence | Fail | PRV-001 |
| O-09 | Turnstile disabled explicitly or enabled with mandatory server validation, shared 2,048-character token limit, hostname/action, timeout retry identity, and test keys | Missing secret returns success; only `success` checked; form/file/AI schemas accept up to 4,096 characters | Schema/presence tests only | Fail | SEC-002, MOD-001 |
| O-10 | Sentry is safe-disabled; server/client initialize correctly; client maps are uploaded then deleted from public output; global scrubbing exists | SDK configs exist; production entry does not preload emitted server config; global scrubbing is absent | Build inspection found 13 client `.map` files in public output and no entry import; no SDK/public-map test; external project absent | Partial/unsafe | OBS-001 |
| O-11 | Search uses relational workspace scope and validates source visibility | FTS scope stored in JSON metadata owner ID | Smoke checks user separation only | Partial/outdated | TEN-001, DAT-001 |
| O-12 | Jobs claim atomically, lease/recover, validate worker completion, and support idempotency | Select then update by ID; no stale recovery | Audit concurrency probe duplicated a claim | Fail | JOB-001 |
| O-13 | PWA is feature-gated, installable with target icons, shell-only offline, update-aware, and device tested | Custom PWA always production-active; portrait; SVG-only | Regex/source checks; no install/update/device test | Partial | PWA-001 |

## Frontend and CSS

| ID | Requirement | Current implementation evidence | Current test evidence | Status | Finding |
| --- | --- | --- | --- | --- | --- |
| UI-01 | Native HTML, Vue SFCs, raw CSS, and app-owned components; no PrimeVue/Tailwind/Nuxt UI/shadcn | Current implementation follows this choice | Lint/Stylelint/build pass | Pass | — |
| UI-02 | Reka UI supplies the accessible account/workspace dropdown only where widget complexity requires it | Reka absent; native topbar links only | No menu keyboard/focus tests | Missing | UI-001 |
| UI-03 | Global reset/tokens/base/layout architecture with scoped feature/component CSS | One `main.css`, scoped component/page styles, initial tokens | Stylelint and narrow CSS regex check | Partial | UI-001 |
| UI-04 | Every important view handles loading, empty, error/retry, success, unauthorized, forbidden, not-found | Reusable demo state component; health/billing states; no product journey | No browser state suite | Partial | PRO-001, TST-001 |
| UI-05 | Semantic shell includes skip link, main focus, route titles, current nav, 44px touch targets, tested contrast | Semantic header/nav/main and focus outline; several gaps/36–40px controls | Browser mobile observation; no axe/keyboard/screen-reader gate | Partial | UI-001 |
| UI-06 | Responsive layout has no narrow overflow and works without hover-only behavior | Current 390px page had no horizontal overflow | One audit observation, not automated | Partial/pass current pages | TST-001 |

## Verification, supply chain, and operations

| ID | Requirement | Current implementation evidence | Current test evidence | Status | Finding |
| --- | --- | --- | --- | --- | --- |
| V-01 | Fresh clone installs under pinned Node/pnpm and one verify command proves the documented local contract | pnpm pinned; Node only lower-bounded; no local pnpm/Corepack initially | Exact frozen install and verify passed through `npx` | Partial | TST-001 |
| V-02 | PR CI runs formatting/lint/Stylelint/typecheck/targeted behavior/migration consistency | No `.github/workflows` or format script | None | Missing | TST-001 |
| V-03 | Merge CI runs all tests/build/Docker/integration/browser | No CI, Docker test, E2E, or API smoke in verify | None | Missing | TST-001 |
| V-04 | Coverage threshold and route/provider failure tests prevent presence-only claims | No coverage package/script/threshold; many structural assertions | 20/20 tests pass but route risks remain | Fail | TST-001 |
| V-05 | Dependency, provenance, and secret scanning gate merges | No maintained scanners | Manual audit found 21 advisories; narrow secret pattern scan clean | Missing | DEP-001, TST-001 |
| V-06 | `master` is canonical and protected; focused Issues/PRs carry evidence | Current branch is `main`; no CI/protection evidence | Externally unverified | Missing/deferred | DOC-001 |
| D-01 | Docker build context excludes secrets/data and runtime runs non-root with an executable maintenance path | No `.dockerignore`; runtime only `.output`; default root user | Static only; Docker unavailable | Fail | OPS-001, OPS-002 |
| D-02 | SQLite app is single-host/replica with persistent DB and local-object paths | DB volume `/app/data`; object fallback outside it; replica rule undocumented | Runtime config/path probe exposed mismatch | Fail | CFG-001, STO-001 |
| D-03 | Migrations run before replacement; backup is off-host/scheduled; restore drill proves RPO/RTO | Good local backup helper; production image cannot run it; restore procedural | Local backup integrity passed; no full restore/deploy drill | Partial | OPS-002 |
| D-04 | Production smoke is read-only; mutating integration uses isolated fixtures/cleanup | `ops:smoke` read-only; docs also prescribe mutating `api:smoke` | Both local suites run; API suite wrote durable fixtures | Fail | OPS-003 |
| D-05 | Persistent `baseline-staging` deploys exact `master` commit with isolated provider sandboxes | No accounts/deployment yet | Externally blocked | Externally blocked | — |

## Rejected/outdated guide claims

| Claim | Disposition | Reason |
| --- | --- | --- |
| Domain `account` is the shared product/billing tenant | Rejected | `account` already has Better Auth provider meaning; owner chose `workspace`. |
| Private resources can remain directly user-owned in the baseline | Rejected | Prevents safe team/workspace forks and forces cross-layer migrations. |
| Clients may submit `ownerId` or Stripe price IDs | Rejected | Ownership and commercial policy are server authority. |
| PrimeVue, Tailwind, Nuxt UI, or shadcn-vue are baseline UI choices | Rejected | Owner explicitly excluded them; Nuxt UI is Tailwind-based. |
| Separate `drizzle-zod` is simply deprecated for this pinned repository | Outdated/conditional | Current `drizzle-orm/zod` documentation targets Drizzle v1/RC. Stable Drizzle 0.45 should retain `drizzle-zod` until a tested v1 migration. |
| Cloudflare AI Gateway `/compat` is the target endpoint | Outdated | Current docs mark the unified OpenAI-compatible route deprecated; use the current REST API contract. |
| PWA portrait orientation and always-on registration are generic baseline requirements | Rejected | PWA is an optional module and generic forks must support landscape unless product evidence says otherwise. |
| Source/presence checks establish provider readiness | Rejected | Optional providers require disabled/enabled/failure contract tests and staging sandbox evidence. |
| `api:smoke` is appropriate against production | Rejected | It creates users/projects/files/objects/billing rows and does not clean them up. |

## Unresolved bounded decisions

These do not justify guessing during repairs. Each becomes a short architecture/compatibility spike before the dependent Issue:

- Better Auth Organization plugin versus a small app-owned workspace layer;
- URL workspace scope versus server/session active-workspace selection;
- exact email provider (the adapter and test capture transport are not provider-dependent);
- exact social providers enabled in staging (Google is the provisional first provider);
- stable Drizzle v0 versus isolated Drizzle v1 migration timing;
- custom PWA implementation versus `@vite-pwa/nuxt` behind the module flag;
- final AI provider/model allowlist and user-visible retention defaults;
- browser/device support matrix and whether installability is required in every fork;
- Coolify migration hook/maintenance image design and final backup destination/RPO/RTO.
