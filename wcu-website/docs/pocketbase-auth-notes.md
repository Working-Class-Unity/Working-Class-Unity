# PocketBase Auth (Future Developer Notes)

This repo contains scaffolding for a PocketBase-backed member portal. As of 2026-02-21, treat it as *in progress*.

These notes document what to do (and what not to do) when implementing PocketBase end-user login/auth and expanding the member portal.

## Non-Negotiables

- Never ship PocketBase service credentials to the browser.
  - `POCKETBASE_SERVICE_EMAIL` / `POCKETBASE_SERVICE_PASSWORD` must remain server-only.
- Never allow the client to set roles, dues status, or permissions.
  - Role/dues must be derived server-side.
- Do not log secrets/tokens.
  - Do not log magic-link tokens or session cookie values.
- Rate limit auth endpoints.
  - Request-link and verify endpoints must be protected from spam and brute force.
- Prevent token leakage.
  - Avoid putting long-lived tokens in URLs; if unavoidable, ensure referrer policy and no-store caching are in place.

## PocketBase Rules / Collections

- Lock down collections so anonymous users cannot read private data.
- Prefer server-side access for sensitive reads/writes.
- Keep sensitive fields (role, dues paid-through) in places regular users cannot update.

## Magic Link (If Used)

If the magic-link flow is kept:
- Ensure single-use tokens are consumed atomically at storage level (avoid race conditions).
- Apply `Cache-Control: no-store` to auth endpoints.
- Consider setting a stricter referrer policy on verify responses so tokens do not appear in same-origin request logs.
