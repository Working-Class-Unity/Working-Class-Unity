# WCU Website Security Hardening (Vibe Code Security Check)

Date: 2026-02-21
Repo: /home/chima/Projects/Working-Class-Unity
App: wcu-website (Nuxt 4 SSR)

## Inputs (Collected Once)

- App type: public org website + authenticated member portal
- Data sensitivity: PII (member email/name/committee) + sensitive org data (organizing + finance summaries)
- Stack:
  - Frontend/SSR: Nuxt 4 (Nitro)
  - Backend data: PocketBase (service client via server)
  - Email: Resend
  - Integrations: Cal.com embed, Formbricks client SDK
- Deployment: Coolify (Dockerfile) behind reverse proxy (Traefik)
- API style: REST under /api/v1/**

## Phase 0: Threat Model (1 page)

Assets
- Session cookie (wcu_session)
- Magic-link tokens (in URLs)
- PocketBase service credentials (server-only)
- Member profile + dues history
- Organizing + finance records
- Email delivery quota (Resend)

Actors
- Anonymous user
- Authenticated member
- Organizer/treasurer/admin
- Bot/attacker

Entry Points
- Public pages
- API routes: /api/v1/auth/*, /api/v1/member/*, /api/v1/organizing/*, /api/v1/finance/*
- Third-party scripts (Cal.com, Formbricks)

Authz Matrix (current intent)
- Read member overview: authenticated member
- Read organizing summary: organizer+ (organizer/treasurer/admin)
- Read finance summary: dues-current member
- Request magic link: anonymous allowed (anti-enumeration required)
- Verify magic link: anonymous allowed (token required)

Abuse / Failure Modes
- Email-bombing and enumeration attempts on auth endpoints
- Token leakage via URL/referrer/logs
- Caching of private SSR/API responses
- XSS via unsafe HTML injection sinks
- Vulnerable dependencies shipped

## Tasks

- [x] Task 1: Add security docs (gate report + runbook + PocketBase auth notes)
- [x] Task 2: Add CI guardrails (secret scan, dependency scan, SAST, dependabot)
- [x] Task 3: Add baseline runtime hardening (headers + no-store caching rules)
- [x] Task 4: Add rate limiting for /api/** (middleware)
- [ ] Task 5: Remove v-html highlight sink (tenant handbook)
- [ ] Task 6: Clean 400s for input validation (no noisy 500s)
- [ ] Task 7: Run verification commands and update the gate report with results

## Review Notes (fill as we go)

- Keep PocketBase end-user auth flow unchanged for now; document future hardening steps.
- Commit after each task.
