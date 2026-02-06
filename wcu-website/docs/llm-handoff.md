# LLM Handoff: PocketBase Architecture Branch

Last updated: February 6, 2026

## 1) Branch and Worktree Context

- Main repo: `/home/chima/Projects/Working-Class-Unity`
- Active worktree: `/home/chima/Projects/Working-Class-Unity/wcu-website-arch`
- Active branch: `feature/moderate-arch-pocketbase`
- Base branch: `master`

This branch is intentionally isolated so website content/editorial work can continue on `master` while backend architecture is built in parallel.

## 2) Goal of This Branch

Build a moderate architecture upgrade (without changing brand design language) so the Nuxt app can evolve from static pages into a member-enabled app backed by PocketBase.

Priority order chosen with user:
1. Membership/auth first
2. Organizing/tenant ops next
3. Finance visibility next
4. Campaign/events migration later

## 3) What Is Implemented

### A) Quality/CI baseline

- Added lint + typecheck + unit test pipeline and workflow.
- Primary command: `npm run quality` (from `wcu-website/`).

### B) Auth foundation (magic link)

Implemented routes:
- `GET /api/v1/auth/me`
- `POST /api/v1/auth/logout`
- `POST /api/v1/auth/request-link`
- `GET /api/v1/auth/verify?token=...&next=...`

Implemented behavior:
- Passwordless login via emailed magic link (Resend).
- Signed HTTP-only session cookie (`wcu_session`).
- Session includes role + dues metadata.

### C) Membership dashboard data

Implemented route:
- `GET /api/v1/member/overview`

Implemented behavior:
- Requires authenticated session.
- Fetches member profile + recent dues records from PocketBase.
- Member page now supports logged-out and logged-in states.

### D) Organizing and finance summary APIs

Implemented routes:
- `GET /api/v1/organizing/summary` (requires organizer+ role)
- `GET /api/v1/finance/summary` (requires dues-current status)

Implemented behavior:
- Organizing page loads summary metrics and recent interactions.
- Finance page loads year-to-date revenue/expenses/net + recent expenses.
- Access-denied UI states are in place.

### E) Typed shared contracts and server libs

- Shared types under `shared/types/**` for auth, membership, tenant-ops, finance.
- Server utility libs for auth/session, mappers, summary calculations, PocketBase config.

### F) Documentation

- Setup and schema expectations: `wcu-website/docs/pocketbase-backend-integration.md`
- Plain-language summary in top-level `README.md`

## 4) What Is NOT Implemented Yet

### A) Campaigns and events are still local/static

Still sourced from:
- `wcu-website/app/data/campaigns.ts`
- `wcu-website/app/data/events.ts`

No PocketBase-backed campaigns/events API has been implemented yet.

### B) Full CRUD workflows are not built yet

Not yet implemented:
- create/edit/delete flows for buildings, interactions, expenses
- member self-service profile editing
- Stripe webhook ingestion and reconciliation pipeline
- admin/organizer operational tooling UI beyond summaries

### C) Production hardening gaps (known)

- Magic-link persistence depends on expected PocketBase collection/field shape.
- No rate-limit/abuse guard on auth request endpoint yet.
- No Playwright E2E coverage for new authenticated dashboard flow yet.
- No migration scripts for PocketBase schema were added in this branch.

## 5) Required Environment Variables

See `.env.example` in `wcu-website/`.

Core required values:
- `POCKETBASE_URL`
- `POCKETBASE_SERVICE_EMAIL`
- `POCKETBASE_SERVICE_PASSWORD`
- `AUTH_SESSION_SECRET`
- `RESEND_API_KEY`
- `RESEND_FROM_EMAIL`
- `AUTH_MAGIC_LINK_ORIGIN`

Collection/field mapping variables are also included and defaulted in `.env.example`.

## 6) Key Access Rules

- Organizing dashboard/API: role must be `organizer`, `treasurer`, or `admin`.
- Finance dashboard/API: member must be dues-current.
- Dues-current logic: paid-through date + 60 day grace period.

## 7) Important Files for the Next Agent

### Auth/session
- `wcu-website/server/lib/auth/session.ts`
- `wcu-website/server/lib/auth/magic-links.ts`
- `wcu-website/server/lib/auth/rbac.ts`
- `wcu-website/server/api/v1/auth/request-link.post.ts`
- `wcu-website/server/api/v1/auth/verify.get.ts`

### PocketBase config/mapping
- `wcu-website/server/lib/pocketbase/config.ts`
- `wcu-website/server/lib/pocketbase/client.ts`
- `wcu-website/server/lib/auth/user-mapper.ts`
- `wcu-website/server/lib/membership/mappers.ts`

### Dashboard APIs
- `wcu-website/server/api/v1/member/overview.get.ts`
- `wcu-website/server/api/v1/organizing/summary.get.ts`
- `wcu-website/server/api/v1/finance/summary.get.ts`

### Dashboard pages
- `wcu-website/app/pages/member/index.vue`
- `wcu-website/app/pages/organizing/index.vue`
- `wcu-website/app/pages/finance/index.vue`

### Type contracts
- `wcu-website/shared/types/auth.ts`
- `wcu-website/shared/types/membership.ts`
- `wcu-website/shared/types/tenant-ops.ts`
- `wcu-website/shared/types/finance.ts`

## 8) Tests and Quality Status

- Command: `npm run quality`
- Status at handoff: passing (lint + typecheck + unit tests)
- Unit tests include auth utilities, session token behavior, member mappers, organizing summary logic, and finance summary logic.

## 9) Suggested Next Milestones (Decision-Ready)

### Milestone 1: PocketBase schema lock + seed data

- Create/confirm all required collections and fields in PocketBase.
- Seed minimum records for one member, one organizer, and finance samples.
- Verify `/member`, `/organizing`, `/finance` end-to-end locally.

### Milestone 2: Campaign/Event migration to PocketBase

- Add API routes for campaign/event read models.
- Replace `app/data/campaigns.ts` and `app/data/events.ts` reads with server API calls.
- Preserve existing UI and i18n behavior while swapping data source.

### Milestone 3: Stripe ingestion

- Add secure webhook endpoint(s).
- Map payments into dues/income records.
- Add reconciliation + failure logging.

### Milestone 4: Role-specific operation flows

- Organizer CRUD for outreach/building records.
- Treasurer/admin CRUD for expenses and finance tags.
- Add audit trails per record mutation.

## 10) Local Runbook

From worktree root:

```bash
cd wcu-website
npm install
cp .env.example .env
npm run quality
npm run dev
```

## 11) Recent Commit Sequence (Architecture branch)

- `97c88b5` chore(quality): add lint-typecheck-unit baseline and CI workflow
- `72672cb` feat(architecture): scaffold pocketbase domain types and auth foundations
- `f6f8a6f` feat(auth): add pocketbase magic-link sign-in flow
- `b456dce` feat(member): add protected member overview api and dashboard data
- `a2e33ab` feat(dashboard): add protected organizing and finance summaries
- `e115441` test(auth): harden session signature validation
- `6fc15d7` docs(backend): add pocketbase integration and setup guide
- `ac69dd6` docs(readme): add plain-language summary of architecture update
- `127decc` docs(handoff): add standalone llm continuation guide
- `07bfbf6` feat(seo): add locale-aware canonical and hreflang head tags
- `bd003d8` feat(seo): add localized sitemap and strengthen robots rules
- `bfa3ca7` feat(seo): prevent indexing of private dashboard routes
- `e205957` feat(seo): canonicalize KYR route and normalize URLs
- `052e2f6` feat(seo): add branded social cards and og image defaults
- `26d065a` feat(seo): enrich schema markup for events and campaigns
- `8d59308` feat(seo): normalize index-path URLs with permanent redirects

## 12) SEO Rollout Status

### Done in this branch

- Locale-aware SEO head tags are enabled via i18n (`canonical` + alternate locale links).
- `sitemap.xml` is generated at runtime and includes localized route variants.
- `robots.txt` now includes sitemap reference and blocks private dashboards.
- Private dashboard pages (`/member`, `/organizing`, `/finance`) are marked `noindex` in meta and response headers.
- Legacy `/kyr` route is canonicalized to `/know-your-rights` with permanent redirects.
- URL normalization middleware now enforces:
  - no duplicate slashes,
  - no trailing slash variants (except root),
  - no `/index` URL variants.
- Branded Open Graph/Twitter card assets were added under `wcu-website/public/og/`.
- Public pages now use real social cards instead of logo-only OG images.
- Structured data was expanded:
  - Calendar includes `ItemList` with event entries.
  - Campaigns includes `ItemList` with active campaign entries.

### Still pending / future SEO work

- Campaigns/events are still sourced from local files:
  - `wcu-website/app/data/campaigns.ts`
  - `wcu-website/app/data/events.ts`
- No Search Console automation or validation pipeline yet.
- No dedicated Lighthouse CI budget checks yet.
- No OG image generation pipeline (current assets are static SVGs in `public/og/`).
