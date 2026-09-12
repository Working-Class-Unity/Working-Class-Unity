# Observability

Optional Sentry reporting tracks web errors and release health. The server preload and Nuxt client
configuration initialize only when the paired DSNs are configured. No module-enable flag is used.

## Configuration

- `NUXT_SENTRY_DSN` and `NUXT_PUBLIC_SENTRY_DSN` are supplied together.
- `NUXT_SENTRY_ENVIRONMENT` / `NUXT_PUBLIC_SENTRY_ENVIRONMENT` and
  `NUXT_SENTRY_RELEASE` / `NUXT_PUBLIC_SENTRY_RELEASE` identify the same deployment.
- `NUXT_SENTRY_TRACES_SAMPLE_RATE` / `NUXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE` use the runtime-validated
  range from 0 through 1; the default is `0.05`.
- `NUXT_OBSERVABILITY_TEST_TOKEN` optionally enables the protected operator test routes.

The exact runtime schema and `.env.production.example` are authoritative. No Stripe, email, or worker
integration is part of this site's error-reporting contract.

## Capture boundary

Use the reviewed diagnostic codes in `server/services/observability/capture.ts` for handled failures.
The shared policy in `shared/sentry-privacy.ts` rebuilds events, breadcrumbs, spans, and envelopes
from an allowlist. It excludes personal information, cookies, request bodies/headers/query strings,
raw source captures, restricted event details, credentials, and arbitrary exception/context payloads.
Local diagnostics likewise use bounded codes and correlation IDs rather than serialized provider errors.

Keep health endpoints out of telemetry traffic. Code tests use in-memory transports to inspect what
would be serialized; they do not prove real delivery, provider retention, access controls, or alerting.
Those are deployment checks, not promises made by this guide.

## Build and release

The official Nuxt Sentry integration owns configured client source-map upload. Keep `SENTRY_AUTH_TOKEN`
in a build secret, with `SENTRY_ORG`, `SENTRY_PROJECT`, and any release/URL inputs separate from runtime
configuration. The post-build cleanup removes source maps from deployed output. A configured upload
failure must fail the build; do not publish maps from the web image as a workaround.

Start production with the packaged Sentry preload:

```bash
node --import ./.output/server/sentry.server.config.mjs .output/server/index.mjs
```

When explicitly checking delivery, temporarily configure the test token and use the protected server
or client test journey from that release. Keep the token out of public URLs, logs, and evidence, then
clear it after the check. Record the release, correlation ID, provider receipt, and result privately.

For an incident, correlate the deployed release, Sentry diagnostic, web logs, and host metrics; then
reproduce with disposable data. A fix requires relevant local verification and a separately authorized
deployment, followed by checking that the reported behavior has recovered.
