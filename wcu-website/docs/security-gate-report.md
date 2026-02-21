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
- Removed `v-html` search highlighting sink on tenant handbook TOC (safe rendering)
- Converted Zod validation failures into clean 400s (no noisy internal errors)
- Updated npm lockfile via `npm audit fix` and re-validated `npm run quality` + `npm run build`
- Added an npm-audit CI gate script with an explicit allowlist for one build-time advisory
- Removed `x-powered-by` header at runtime (Nitro `beforeResponse` hook)
- i18n redirect cookie is `Secure` in production (`detectBrowserLanguage.cookieSecure`)

## Verification Commands (to rerun)

From repo root:

```bash
# Secrets
gitleaks detect --source .

# Dependencies
cd wcu-website
npm ci
npm run audit:prod

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

- `GHSA-3PPC-4F35-3M26` (minimatch ReDoS)
  - Present in Nuxt build-time toolchain dependencies (glob/archiver/eslint path).
  - Risk accepted because these packages are not shipped as runtime `node_modules` in the Docker image (the image copies `.output/` only), and the affected code paths are not exposed to untrusted user-supplied glob patterns in production.
  - Tracking: `wcu-website/scripts/npm-audit-gate.mjs` allowlist.
  - Revisit: remove allowlist when upstream (Nuxt/Nitro toolchain) upgrades away from vulnerable minimatch versions.
