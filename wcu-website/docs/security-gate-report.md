# Security Gate Report (WCU Website)

Date: 2026-02-21
Scope: /home/chima/Projects/Working-Class-Unity/wcu-website

## Status

FAIL (in progress)

## Findings (What Blocks Release)

High
- Missing CI security guardrails (secrets scan, dependency vuln scan, SAST)
- Missing rate limiting for auth/write/cost-amplifying endpoints
- Private/auth content lacks explicit `Cache-Control: no-store`
- XSS sink: `v-html` used for search highlighting in tenant handbook

Medium
- Missing HSTS header
- Validation errors can surface as noisy 500s (Zod parse errors)

## Fixes Applied

- Added CI guardrails:
  - gitleaks secret scan
  - dependency review + npm audit (high+)
  - Semgrep OWASP Top 10 scan
  - Dependabot updates
- Added baseline runtime hardening:
  - HSTS (production only)
  - COOP + CORP headers
  - `Cache-Control: no-store` for `/api/**` and member dashboards
  - Stricter `Referrer-Policy` on `/api/v1/auth/verify`
- Added server-side rate limiting for `/api/**` (in-memory, per-IP)

## Verification Commands (to rerun)

From repo root:

```bash
# Secrets
gitleaks detect --source .

# Dependencies
cd wcu-website
npm ci
npm audit --omit=dev

# SAST
semgrep --config p/owasp-top-ten --error wcu-website

# Build + scan output
cd wcu-website
npm run build
rg -n "(AKIA|sk_live_|BEGIN PRIVATE KEY|service_role)" .output -S

# Headers (post-deploy)
curl -sI https://workingclassunity.com | sed -n '1,40p'
```

## Remaining Risks / Explicit Acceptances

None recorded yet.
