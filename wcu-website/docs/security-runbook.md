# Security Runbook (WCU Website)

This runbook is intentionally short. It documents the minimum operational steps to keep the site secure over time.

## Secret Rotation

Rotate via your deployment platform secret store (Coolify env vars). Do not commit secrets.

- No server-side application secrets are required for the current public site.
- If a future integration adds secret values, rotate them in the provider dashboard, update Coolify env vars, and deploy.

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

Artifacts:
- No secrets appear in HTML or `.output/` bundles

## Incident Response (Minimal)

- If a secret may be exposed: rotate it first, then investigate.
- Re-run secret scan on repo history and deploy artifacts.
- Add a note to `wcu-website/docs/security-gate-report.md` under “Remaining Risks / Explicit Acceptances”.
