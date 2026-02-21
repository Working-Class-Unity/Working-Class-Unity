# Security Runbook (WCU Website)

This runbook is intentionally short. It documents the minimum operational steps to keep the site secure over time.

## Secret Rotation

Rotate via your deployment platform secret store (Coolify env vars). Do not commit secrets.

- `AUTH_SESSION_SECRET`
  - Generate a new 64+ char random value.
  - Deploy.
  - Note: rotating invalidates existing sessions.
- `RESEND_API_KEY`
  - Rotate in Resend dashboard.
  - Update Coolify.
  - Deploy.
- PocketBase service credentials
  - Rotate the service account password.
  - Update Coolify vars `POCKETBASE_SERVICE_EMAIL` / `POCKETBASE_SERVICE_PASSWORD`.
  - Deploy.

## Dependency Updates

- Prefer automated updates via Dependabot.
- For manual updates:
  - `cd wcu-website && npm outdated`
  - Update, then run `npm run quality` and `npm run build`.

## Post-Deploy Verification

Headers:

```bash
curl -sI https://workingclassunity.com | sed -n '1,40p'
```

Confirm:
- `Strict-Transport-Security` present (after HTTPS is stable)
- CSP present
- `X-Content-Type-Options: nosniff`
- `Referrer-Policy` present

Cookies:
- Session cookie is `HttpOnly; Secure; SameSite=Lax` (or stricter)
- No secrets appear in HTML or `.output/` bundles

## Incident Response (Minimal)

- If a secret may be exposed: rotate it first, then investigate.
- Re-run secret scan on repo history and deploy artifacts.
- Add a note to `wcu-website/docs/security-gate-report.md` under “Remaining Risks / Explicit Acceptances”.
