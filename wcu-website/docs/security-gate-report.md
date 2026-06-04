# Security Gate Report (WCU Website)

Date: 2026-02-21
Scope: /home/chima/Projects/Working-Class-Unity/wcu-website

## Status

PASS (with explicit risk acceptance below)

## Findings (Release Blockers)

None.

## Fixes Applied

- Added CI guardrails:
  - gitleaks secret scan
  - dependency review + npm audit (high+)
  - Semgrep OWASP Top 10 scan
  - Dependabot updates
- Added baseline runtime hardening:
  - HSTS (production only)
  - COOP + CORP headers
- Removed `v-html` search highlighting sink on tenant handbook TOC (safe rendering)
- Updated npm lockfile via `npm audit fix` and re-validated `npm run quality` + `npm run build`
- Added an npm-audit CI gate script with an explicit allowlist for one build-time advisory
- Removed `x-powered-by` header at runtime (Nitro `beforeResponse` hook)
- i18n redirect cookie is `Secure` in production (`detectBrowserLanguage.cookieSecure`)

## Verification Results (2026-02-21)

- Secrets
  - `rg` scan (excluding `knowledgebase/`) returned no matches for common key patterns.
  - CI: gitleaks secret scan workflow added.
- Dependencies
  - `npm run audit:prod` PASSED with allowlist-only findings for `GHSA-3PPC-4F35-3M26`.
- Build artifacts
  - `rg` scan of `.output/` found no key material.
- Headers + caching
  - Local production build (`NODE_ENV=production`) verified:
    - HSTS + CSP + COOP/CORP present on `/`.
    - `x-powered-by` removed.

## Verification Commands (to rerun)

From repo root:

```bash
# Secrets
gitleaks detect --source .
# (Quick local fallback)
rg -n "(sk_live_|AKIA[0-9A-Z]{16}|BEGIN PRIVATE KEY|xox[baprs]-|ghp_[A-Za-z0-9]{36}|github_pat_)" -S . -g'!knowledgebase/**'

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
curl -sI https://workingclassunity.com
```

## Remaining Risks / Explicit Acceptances

- `GHSA-3PPC-4F35-3M26` (minimatch ReDoS)
  - Present in Nuxt build-time toolchain dependencies (glob/archiver/eslint path).
  - Risk accepted because these packages are not shipped as runtime `node_modules` in the Docker image (the image copies `.output/` only), and the affected code paths are not exposed to untrusted user-supplied glob patterns in production.
  - Tracking: `wcu-website/scripts/npm-audit-gate.mjs` allowlist.
  - Revisit: remove allowlist when upstream (Nuxt/Nitro toolchain) upgrades away from vulnerable minimatch versions.
