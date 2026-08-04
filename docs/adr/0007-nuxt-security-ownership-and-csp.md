# ADR 0007: `nuxt-security` ownership and provider-aware CSP

- Status: accepted
- Date: 2026-07-13
- Decision owner: baseline application
- Issue: [R-023B / #24](https://github.com/smallwiselabs/swl-step-by-step/issues/24)

## Context

The baseline previously implemented five browser headers in a 24-line global middleware and deferred Content Security Policy (CSP). That left two problems: the application duplicated a maintained Nuxt module's standard capability, and browser script/style execution had no enforced allowlist. The replacement must not let a generic security module weaken Better Auth or application-specific guarantees merely because those features have similar names.

`nuxt-security@2.6.0` supports Nuxt 4 and Node 24, supplies standard response headers, request nonces, CSP finalization, Subresource Integrity (SRI), `X-Powered-By` removal, per-route overrides, and a documented runtime hook. Its defaults are deliberately compatibility-oriented, however: they include broad script/style sources and enable generic request limiting, input filtering, CORS, method filtering, and logger removal. They are not this application's approved security policy.

## Decision

- Pin `nuxt-security@2.6.0` and remove the parallel custom security-header middleware.
- Let the module own every standard browser-security capability it can fully express: CSP generation and enforcement, fresh request nonces, emitted-asset SRI, HSTS, COOP, CORP, origin isolation, referrer policy, MIME sniffing protection, frame denial, restrictive Permissions Policy, legacy browser headers, and `X-Powered-By` removal.
- Use `strict: false` with every accepted option configured explicitly. This selects a reviewed policy instead of inheriting either the module's compatibility defaults or its stricter preset.
- Reject every `NUXT_SECURITY*` and `NITRO_SECURITY*` runtime input before listen. Deployment configuration cannot disable the policy or re-enable rejected generic middleware.
- Enforce one deny-by-default CSP globally:
  - `default-src`, `base-uri`, and `object-src` are `'none'`;
  - executable scripts require the request nonce and use `strict-dynamic`; inline script attributes are forbidden;
  - production style elements require the request nonce;
  - `style-src-attr 'unsafe-inline'` is the narrow residual needed for Reka UI's runtime floating-menu positioning;
  - framing is denied unless an enabled browser provider requires an exact origin;
  - insecure subresources are upgraded only in production.
- Use `strict-origin-when-cross-origin` globally and retain `no-referrer` for `/invite/**` through the module's route rule.
- Keep COOP and CORP, but disable COEP. Stripe documents that its products do not support cross-origin-isolated sites.
- Use the module's runtime `nuxt-security:routeRules` hook to add browser-provider sources only from validated enabled-module state:
  - enabled Observability adds only the public Sentry DSN origin to `connect-src`;
  - enabled Turnstile adds only `https://challenges.cloudflare.com` to `script-src` and `frame-src`.
- Add no browser source for server-side Stripe, R2, or AI calls, or for Google's current full-page OAuth redirect. A future browser provider must add its documented minimum sources with its feature.
- Keep final shipped behavior enforced. Do not add a CSP report collector or permanent report-only subsystem.

Development is a deliberate policy variant, not the shipped policy. Vite and Nuxt DevTools inject style elements after the document nonce is issued. The pinned module's strict-CSP guide explains that nonces cancel an `unsafe-inline` fallback and that dynamically inserted styles therefore require `unsafe-inline` without a style nonce. Development `style-src` is consequently `'self' 'unsafe-inline'`; production remains `'self' 'nonce-{{nonce}}'`. Scripts keep nonce plus `strict-dynamic` in both environments. A real local Nuxt development-server check confirmed Vite connects and the page hydrates without CSP errors under that variant.

Nitro's standalone build currently externalizes the module's unconditional `xss` import even though that middleware is disabled. The supported `nitro.externals.inline` option bundles that dependency so `.output` remains standalone; a packaged-server test owns this integration behavior.

## Application-owned boundaries retained

The following module features are explicitly disabled because they overlap only superficially with stronger or more specific guarantees:

- request-size limiting;
- rate limiting;
- XSS body filtering;
- CORS;
- allowed-method restriction;
- CSRF middleware;
- Basic Auth;
- logger removal;
- static-site security export.

Better Auth continues to own its handler's CSRF, trusted-origin, cookie, OAuth-state/PKCE, and endpoint rate-limit behavior. The application continues to own unsafe-command origin agreement, raw Stripe webhook authority, feature-specific upload/body limits, authentication, resource authorization, secret-safe logging, and provider lifecycle rules. Family-plan membership never grants private-resource access.

Browser-document policies such as COOP and Permissions Policy are not required on JSON error bodies. Nitro's production error renderer may replace document-oriented headers with its stricter `no-referrer` and `script-src 'none'; frame-ancestors 'none'` error policy. The packaged origin canary protects only the effective error guarantees that have security meaning there; it does not recreate the deleted middleware's header inventory.

## Consequences

- One maintained module replaces the custom header implementation and provides CSP/nonce/SRI behavior the application did not have.
- Provider access is fail-closed and contains no speculative hosts or wildcards.
- The Reka style-attribute allowance, development-only style-element allowance, disabled COEP, and exact enabled-provider origins are explicit residual risks.
- SRI covers assets emitted with integrity metadata. Cloudflare Rocket Loader, HTML rewriting, asset rewriting, or post-build minification must remain off unless separately proven compatible.
- Module upgrades require review of defaults, runtime hooks, plugin ordering, CSP serialization, and standalone packaging before the pin changes.

## Evidence

- Focused Vitest behavior owns explicit module-feature disabling, fixed runtime-policy overrides, base CSP construction, and exact provider extensions.
- The existing invitation browser journey owns `/invite/**` `no-referrer` behavior.
- Playwright against the packaged Nitro server owns enforced-not-report-only CSP, fresh nonces, blocking of a parser-inserted nonce-less script, emitted SRI, hydration, client navigation, Reka interaction, and clean desktop/mobile browser output.
- Deployment smoke owns only effective production header presence. The built-runtime worker retains one additional pre-listen case because only a packaged Nitro process proves a runtime module override is rejected before TCP bind.

## Official sources

- [`nuxt-security@2.6.0` configuration](https://github.com/Baroshem/nuxt-security/blob/v2.6.0/docs/content/1.getting-started/2.configuration.md)
- [Strict CSP and per-route navigation guidance](https://github.com/Baroshem/nuxt-security/blob/v2.6.0/docs/content/5.advanced/3.strict-csp.md)
- [Runtime route-rules hook](https://github.com/Baroshem/nuxt-security/blob/v2.6.0/docs/content/5.advanced/4.hooks.md)
- [Nitro `2.13.4` configuration types](https://github.com/nitrojs/nitro/blob/v2.13.4/src/types/config.ts)
- [Better Auth `1.6.23` security contract](https://github.com/better-auth/better-auth/blob/v1.6.23/docs/content/docs/reference/security.mdx)
- [Cloudflare Turnstile CSP requirements](https://developers.cloudflare.com/turnstile/reference/content-security-policy/)
- [Stripe security guide and cross-origin-isolation limitation](https://docs.stripe.com/security/guide)
- [MDN Content Security Policy guide](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/CSP)
- [MDN `style-src-attr`](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy/style-src-attr)
