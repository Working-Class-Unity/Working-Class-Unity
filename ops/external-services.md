# External Services Readiness

> Imported donor history; this is not an operational WCU checklist. The current release boundary is
> [`docs/basic-release.md`](../docs/basic-release.md); do not provision OpenAI or user-file R2.

These items require account-level actions outside the local repository. The app can provide adapters, docs, and environment validation, but the services are not complete until the real resources exist and production secrets are configured.

## Readiness Command

Use:

```bash
pnpm run ops:readiness -- --env-file=.env.production
```

Use strict mode in deployment gates:

```bash
pnpm run ops:readiness:strict -- --env-file=.env.production
```

The command uses the same evaluator and manifests as server startup. It validates the database, readiness, application/auth origin, auth secret, independent Google flag, and one complete core email transport, plus all six exact module flags and both exact private `NUXT_OPENAI_FILE_SEARCH_ENABLED=true|false` and `NUXT_OPENAI_WEB_SEARCH_ENABLED=true|false` switches. Google credentials are required only when its flag is true; optional-module provider values are required only for module flags set to true. AI disabled requires both subordinate switches to be false. File Search true additionally requires one trimmed `NUXT_OPENAI_FILE_SEARCH_VECTOR_STORE_ID`; Web Search true additionally requires one through 100 reviewed canonical domains in `NUXT_OPENAI_WEB_SEARCH_ALLOWED_DOMAINS`. Node's dotenv parser is used, and already-exported environment values take precedence over the file. Exact false is healthy-disabled and inert across routes, direct services, workers, UI, and protected readiness. Readiness never contacts OpenAI, retrieves a store, searches files or the web, or validates live domain behavior; real provider certification is still required before enabling Google or a module/capability in staging or production.

Before a launch, copy `ops/production-evidence-template.md` and fill it with non-secret proof for each external service. Filled evidence copies match `ops/production-evidence-*.md` and are ignored by git by default. Record an accountable reviewer and review date. The implementation checklist is not externally complete until that human-reviewed evidence exists for the target environment.

Keep certification resources separate from production: use dedicated staging databases/storage namespaces, provider test projects or sandboxes, and least-privilege credentials. The repository's loopback `api:smoke` uses local Files state and a locally signed webhook fixture; it neither accepts these credentials nor certifies an external provider. The deployed `ops:smoke` is credential-free and read-only.

## Cloudflare

- Create or connect the production zone.
- Configure DNS for the production app domain.
- Configure baseline CDN/cache behavior for safe public assets.
- Configure WAF and rate-limit rules for the exact magic-link request/redemption, workspace invitation-manager POST, upload, and AI routes. Edge controls do not replace app-owned user/organization quotas or authorization.
- Create any optional private user Files R2 bucket/credential required by the selected fork.
- When off-host backup is selected, under #36 and separate infrastructure authority create one private Standard database-backup bucket per app/environment, an Object Read & Write token scoped only to it, a 30-day `sqlite/v1/` Bucket Lock, and a 35-day lifecycle rule. Configure no public domain or CORS. Keep its `BACKUP_R2_*` values Runtime-only and Build-disabled on the Coolify Compose resource; only the explicit operator consumes them. Persistent baseline staging/production selects this capability; forks may omit it and document the resulting recovery boundary. See [the backup runbook](backup-runbook.md). #37 executes and certifies the provider behavior.
- Create separate Turnstile widgets/keys for non-production and production, restrict the production widget to the deployed hostname, and record real `auth_magic_link` action/hostname validation. Cloudflare's official dummy credentials remain local/automated-test fixtures and must not be deployed. Files and AI routes do not use Turnstile.
- Store the resulting values in the production environment.

## OpenAI

- Leave `NUXT_MODULES_AI_ENABLED=false`, set both `NUXT_OPENAI_FILE_SEARCH_ENABLED=false` and `NUXT_OPENAI_WEB_SEARCH_ENABLED=false`, and omit every OpenAI credential/resource/domain value when the fork does not need AI or while provider certification is pending. Disabled AI constructs no SDK client and makes no call. File and Web Search are subordinate private configuration, not public modules or UI states.
- Before enabling AI in a persistent environment, create a separate OpenAI project and restricted runtime service-account key for that environment. Store private `NUXT_OPENAI_API_KEY`, `NUXT_OPENAI_PROJECT_ID`, and exact `NUXT_OPENAI_MODEL=gpt-5.6-luna` as Runtime-only, Build-disabled values. File Search may remain false with no vector store; when enabled, configure one private vector-store ID for the deployment-owned corpus. Web Search may remain false with no domain policy; when enabled, configure one through 100 reviewed canonical comma-separated domains. Never expose keys, provider resource IDs, search queries/actions, or citation metadata through a browser bundle, image layer, logs, Sentry, screenshot, or evidence file.
- Configure project rate/spend limits, alerts, API billing, and key rotation. OpenAI API billing is separate from ChatGPT subscriptions. Treat readiness as configuration/SQLite evidence only; it does not connect to OpenAI or prove model access, credits, retention, or provider availability.
- Record real direct Responses model access/alias behavior, safe request/provider IDs, provider rate/quota/refusal/errors, timeout/ambiguous outcome, spend, provider dashboard/log/data-sharing settings, default or approved ZDR/MAM posture, and deployed clear/conversation/account deletion under #37. `store: false` disables default Response application-state storage but is not Zero Data Retention.
- Ordinary application routes may use only the configured corpus; they cannot create, upload, list, mutate, or delete provider corpus resources. Run `pnpm openai:corpus prepare|verify|delete` separately with `OPENAI_CORPUS_OPERATOR_API_KEY` and `OPENAI_CORPUS_PROJECT_ID`. Those operator values are read only by the command and must not be copied into Nuxt/Coolify runtime. Keep its private receipt outside evidence artifacts. Use blue/green replacement: prepare and verify a new marked store, deploy its ID, certify it, then explicitly delete the old store and its operator-owned File objects with matching receipt and confirmation. Never mutate the active store in place or delete it automatically.
- Enabled responses expose and persist only bounded `{ type: "file", title }` or `{ type: "web", title, url, startIndex, endIndex }` citations. Do not expose provider IDs, File/Web queries/actions/full sources/results, chunks, scores, attributes, or raw envelopes. Files and vector stores are persistent provider application state until deletion and are not ZDR-eligible; deleting local conversations/accounts does not delete the shared deployment corpus. Web Search creates no application-owned provider object, and the application never fetches citation URLs.
- Issue #37 owns live File Search evidence for project isolation, separate runtime/operator permissions, bounded ingestion/pagination, model tool acceptance, citations, call/storage billing, provider failure, eventual-consistency cleanup, and retention/ZDR limitations. It also owns Web Search evidence for allowed root/subdomains and redirects, live access, queries/citations/offsets, combined tool selection, call/token billing, provider failure, third-party behavior, ZDR/MAM, and the documented live-search HIPAA/BAA exclusion. Local fakes and configuration readiness make no provider call and certify none of these claims.

## Email

- Select an authenticated SMTP provider and verify the staging/production sending identity or domain.
- Configure `NUXT_EMAIL_TRANSPORT=smtp`, `NUXT_EMAIL_FROM`, `NUXT_EMAIL_SMTP_HOST`, `NUXT_EMAIL_SMTP_PORT`, `NUXT_EMAIL_SMTP_SECURITY=tls|starttls`, `NUXT_EMAIL_SMTP_USERNAME`, and `NUXT_EMAIL_SMTP_PASSWORD` as private runtime values.
- Treat a passing readiness command as configuration evidence only. The application does not connect or authenticate to SMTP at startup or readiness.
- Record real magic-link and invitation send/resend/inbox delivery, provider rejection/failure, expiry/replay, bounce/suppression, and provider operational evidence under R-033 before claiming hosted delivery certification. Local capture, SMTP transport acceptance, and deterministic SMTP doubles do not replace that evidence.

## Google identity

- Leave `NUXT_SOCIAL_PROVIDERS_GOOGLE_ENABLED=false` when no Google Cloud project/client exists. Disabled Google requires neither credential and exposes no Google UI or OAuth state work.
- Before enabling it, create a Google OAuth web client and consent screen, register the exact application origin plus `/api/auth/callback/google`, and store `NUXT_SOCIAL_PROVIDERS_GOOGLE_CLIENT_ID` plus private `NUXT_SOCIAL_PROVIDERS_GOOGLE_CLIENT_SECRET` as runtime-only values. Google requires exact redirect matching in its official [web-server OAuth documentation](https://developers.google.com/identity/protocols/oauth2/web-server).
- The baseline requests only `openid email`, uses online authorization-code access, and retains no Google token. Keep broader Google API authorization out of this authentication client; add separately reviewed contextual scopes only when a fork owns a real API feature.
- Record real consent, callback and denial, verified same-email link/relink, account removal, and Google-side grant revocation under R-033 before enabling Google in a target environment. Better Auth unlink removes only the local account mapping, so local unlink evidence is not upstream revocation.

## Stripe

- Create a dedicated [Stripe sandbox](https://docs.stripe.com/sandboxes), one application-owned Product, and five distinct recurring Prices: Personal weekly/monthly/annual and Family monthly/annual. Every subscription uses one item with quantity `1`.
- Configure one account-scoped API v1 snapshot event destination at the exact sandbox endpoint `POST /api/webhooks/stripe`, select API version `2026-06-24.dahlia`, and subscribe only to the exact 21-event allowlist in [the deployment guide](../docs/deployment.md): Checkout synchronous/asynchronous outcomes, subscription/pending-update and schedule lifecycle including abort, invoice recovery, `refund.created`, and dispute open/close.
- Use a sandbox restricted runtime key scoped only to Checkout, application-owned transitions, the configured Portal, bounded current-state reads, and cancellation-before-deletion. Record reviewed permissions and denial of unnecessary operations without copying the key into evidence.
- Select an explicit Customer Portal configuration; do not rely on the account default. Disable hosted login, plan/Price/quantity changes, pauses, unapproved profile changes, promotion codes, retention offers, and cancellation-reason/free-text collection; enable payment-method update and invoice history; make cancellation period-end without proration; and set the app return URL, Terms, Privacy, support, public business details, and branding. Application routes own plan/cadence changes.
- Configure Smart Retries for eight attempts over no more than 14 days. Before production activation, record all-five Checkout and compatible payment methods; transition and Portal cancellation/reactivation behavior; grace/recovery/suspension/terminal state; pending invitation reservations and manager removal; transient redelivery, duplicates, ordering and reconciliation; durable ambiguous Checkout recovery; account-deletion cancellation success/ambiguity; measured payload/latency; billing-owner Portal access/member denial; and safe request IDs. Keep raw payloads, secrets, payment data, and Checkout/Portal/bearer URLs out of evidence.
- Create production Product/Prices, Portal configuration, and webhook only after isolated sandbox evidence passes. This instruction does not claim that evidence has been performed.
- Store the private `NUXT_STRIPE_SECRET_KEY`, `NUXT_STRIPE_WEBHOOK_SECRET`, `NUXT_STRIPE_PORTAL_CONFIGURATION_ID`, `NUXT_STRIPE_PERSONAL_WEEKLY_PRICE_ID`, `NUXT_STRIPE_PERSONAL_MONTHLY_PRICE_ID`, `NUXT_STRIPE_PERSONAL_ANNUAL_PRICE_ID`, `NUXT_STRIPE_FAMILY_MONTHLY_PRICE_ID`, and `NUXT_STRIPE_FAMILY_ANNUAL_PRICE_ID` in runtime when `NUXT_MODULES_BILLING_ENABLED=true`; all five Price IDs must be distinct, and Billing requires Jobs.
- Do not accept a Stripe Price ID, quantity, mode, customer, return URL, or organization identifier from a client request. Accept only the five stable application offering keys.
- Never supply live or sandbox credentials to `api:smoke`; its local signed fixture is not provider certification.

## DigitalOcean And Coolify

- Create the Droplet.
- Enable monitoring and alerts.
- Enable backups or attach the chosen backup plan.
- Install Coolify.
- Create a normal Git-connected Docker Compose application from the repository's root `docker-compose.yml`; keep its one local build and shared project/commit-scoped image, enable Coolify's source-commit build value, disable automatic Dockerfile ARG injection, and do not add a registry image.
- Mount persistent storage at `/app/data`.
- When off-host backup is selected, under #36 retain the committed no-port/no-domain backup runner using the same selected-commit image as the other roles, with the shared volume and resource-wide application environment plus its five runner-only credential values. Confirm migration, web, and worker receive empty overrides for those five names despite Coolify's shared `env_file`. Only the explicit operator consumes the backup credential. Provision a private off-host receipt sink and independently scheduled dead-man monitor under #36; 12 hours is the freshness incident threshold. Under #37, create and configure the six-hour Coolify Scheduled Task and its notifications, target it at the runner, then execute and certify success, failure, silence, upload, fetch, and restore behavior.
- Configure all production environment variables.
- Deploy staging first, run migrations, then deploy production.

## Sentry

- Create the Sentry project.
- Configure DSNs, release, environment, org, project, and auth token.
- Confirm source maps upload during a production build.
- Trigger the protected server test route and a temporary client test error.
- Create an alert for high-severity production issues.
