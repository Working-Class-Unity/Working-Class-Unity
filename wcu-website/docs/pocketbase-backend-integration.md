# PocketBase Backend Integration (Architecture Branch)

This document describes the backend architecture now scaffolded in `feature/moderate-arch-pocketbase` and how to wire your PocketBase instance.

## What Is Implemented

- Versioned server API routes under `server/api/v1/**`.
- Passwordless auth (magic link):
  - `POST /api/v1/auth/request-link`
  - `GET /api/v1/auth/verify?token=...`
  - `GET /api/v1/auth/me`
  - `POST /api/v1/auth/logout`
- Session cookie issuance with signed tokens (`wcu_session`).
- Membership dashboard data endpoint:
  - `GET /api/v1/member/overview`
- Organizing dashboard summary endpoint (role-gated):
  - `GET /api/v1/organizing/summary`
- Finance dashboard summary endpoint (dues-current gated):
  - `GET /api/v1/finance/summary`

## Access Rules

- `member` routes: authenticated user required.
- `organizing` routes: role must be `organizer`, `treasurer`, or `admin`.
- `finance` routes: dues must be current (paid-through date + 60-day grace).

## Required Environment Variables

Copy `wcu-website/.env.example` to `.env` and set values.

Core:
- `POCKETBASE_URL`
- `POCKETBASE_SERVICE_EMAIL`
- `POCKETBASE_SERVICE_PASSWORD`
- `AUTH_SESSION_SECRET`
- `AUTH_SESSION_TTL_SECONDS`
- `RESEND_API_KEY`
- `RESEND_FROM_EMAIL`
- `AUTH_MAGIC_LINK_ORIGIN`

Collection/field mapping (defaults are provided):
- `POCKETBASE_AUTH_COLLECTION`
- `POCKETBASE_MAGIC_LINK_COLLECTION`
- `POCKETBASE_MEMBER_PROFILE_COLLECTION`
- `POCKETBASE_DUES_RECORD_COLLECTION`
- `POCKETBASE_BUILDINGS_COLLECTION`
- `POCKETBASE_OUTREACH_COLLECTION`
- `POCKETBASE_FINANCE_INCOME_COLLECTION`
- `POCKETBASE_FINANCE_EXPENSE_COLLECTION`
- plus field override vars in `.env.example`

## PocketBase Collections and Expected Fields

### 1) Auth collection (default: `users`)
Expected fields:
- `email` (string)
- `role` (string: `member|organizer|treasurer|admin`)
- `duesPaidThrough` (ISO date string or nullable)

### 2) Magic links (default: `auth_magic_links`)
Expected fields:
- `userId` (string/relation)
- `email` (string)
- `tokenHash` (string)
- `expiresAt` (ISO date string)
- `consumedAt` (ISO date string, nullable)
- `requestedIp` (string, nullable)
- `userAgent` (string, nullable)

### 3) Member profiles (default: `member_profiles`)
Expected fields:
- `userId`
- `fullName`
- `committee` (`membership|education|treasurer|null`)
- `isInGoodStanding` (boolean)
- `duesPaidThrough` (nullable)
- `joinedAt`

### 4) Dues records (default: `dues_records`)
Expected fields:
- `memberId` or `userId`
- `amountCents`
- `currency`
- `paidAt`
- `source` (`stripe|manual`)
- `stripeInvoiceId` (nullable)

### 5) Organizing data
`buildings` expected fields:
- `status` (`target|active|won|paused`)

`outreach_interactions` expected fields:
- `buildingId`
- `organizerUserId`
- `occurredAt`
- `interactionType`
- `notes`

### 6) Finance data
Income collection (default `dues_records`) expected fields:
- `amountCents`
- `paidAt`
- optional `incomeType` (`donation` or anything else treated as dues)

Expense collection (default `expense_records`) expected fields:
- `amountCents`
- `spentAt`
- `category`
- `description`
- `createdByUserId`

## Verification Checklist

From `wcu-website/`:

```bash
npm install
npm run quality
npm run dev
```

Manual checks:
1. Open `/member`, request magic link, click link, confirm session established.
2. Open `/member`, confirm profile + dues records load.
3. Open `/organizing` as organizer+, confirm summary loads.
4. Open `/finance` as dues-current member, confirm summary loads.
5. As non-eligible user, confirm clear 401/403 UI state on restricted dashboards.

## Notes

- In development, magic-link request responses include `debugMagicLink` when available.
- Unknown/missing collections return empty dashboard data where safe; severe query issues return 500 with route-specific messages.
