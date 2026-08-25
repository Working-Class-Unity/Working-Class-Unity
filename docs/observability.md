# Observability

## Sentry Baseline

Use Sentry for production error tracking, release visibility, and post-release triage. The Nuxt SDK is initialized by `sentry.client.config.ts` and `sentry.server.config.ts` only when Observability has its exact enabled flag and complete validated Sentry inputs. Build-only organization, project, and token values do not affect runtime readiness.

The client config reads the server-derived `useRuntimeConfig().public.moduleStates` projection, which the pinned Sentry Nuxt module loads as a generated client plugin. The server config is an intentional exception: Node preloads the generated config before Nitro, so its dependency-free resolver reads only the exact Observability flag, both DSNs, and the two optional sample-rate inputs from canonical `process.env.NUXT_*` names. Full application runtime validation still runs immediately afterward. A Nitro startup invariant rejects an enabled deployment that omitted the preload. This follows [Sentry's Nuxt manual-setup guidance](https://docs.sentry.io/platforms/javascript/guides/nuxt/manual-setup/) and Node's documented [`--import` preload](https://nodejs.org/docs/latest-v24.x/api/cli.html#--importmodule). Disabled or incomplete Observability makes no initializer, capture, route-control, or upload call. Real provider delivery remains staging evidence in R-033/[#37](https://github.com/smallwiselabs/swl-step-by-step/issues/37).

## Capture Rules

Capture:

- Unhandled client errors.
- Server route exceptions.
- Stripe webhook processing failures.
- Background worker failures.
- Release version and environment.

Do not capture passwords, raw session tokens, Stripe secrets, raw webhook payloads, Checkout/Portal URLs, R2 credentials, full private prompts, or private file contents. Billing persistence itself keeps only allowlisted current-projection fields and minimized event receipts; observability context must not reconstruct the discarded provider body.

Server code should use `captureException` from `server/services/observability/capture.ts` for handled failures. Callers select one reviewed error code; the helper derives its fixed low-cardinality component and operation, generates a correlation id, and emits only that safe metadata locally. Callers cannot provide arbitrary tags, extra context, or user ids, and the local diagnostic never serializes provider payloads, prompts, file content, tokens, email addresses, error messages, stacks, or causes. When Observability is ready, the original exception is forwarded to the SDK so useful application frames can be retained only after the global policy below rebuilds the event.

### Runtime privacy policy

Client and server use the same explicit allowlist in `shared/sentry-privacy.ts`. `sendDefaultPii`, user information, cookies, request and response headers, request bodies, query parameters, generative-AI inputs/outputs, hosted-search queries/actions/results/citation metadata, stack-frame variables, frame context, server name, server local-variable capture, logs, and metrics are disabled. Final `beforeSend`, `beforeSendTransaction`, `beforeSendSpan`, and `beforeBreadcrumb` hooks rebuild telemetry because the pinned SDK's collection controls do not constrain fields supplied explicitly by application or integration code. The pinned SDK intentionally bypasses `beforeSend` for an internal exception created after its event-processing pipeline fails, so the same finite event allowlist runs again on event items at the official `beforeEnvelope` integration boundary. That late integration also removes dynamic sampling context from every envelope because the pinned SDK builds transaction and standalone-span headers from raw root names before the terminal event/span hooks. This deliberately gives up provider-side dynamic-sampling context; local sampling still follows the configured trace sample rate.

The provider-bound shapes are limited to:

- events and exceptions: SDK identifiers and version metadata, time, level, platform, configured environment/release, an allowlisted HTTP method, fixed diagnostic code/component/operation, a UUID correlation id, generic exception text, and application-frame location as an `/_nuxt/*.js` asset or the literal `application` with line/column and in-app state. Client errors may additionally retain only matched source-map debug metadata consisting of `type`, the same normalized `/_nuxt/*.js` code path, and a canonical v4 debug id;
- breadcrumbs: time, reviewed category/type/level, event id, HTTP method/status, and request/response byte counts—never message, URL, selector, or arbitrary data;
- transactions and spans: trace/span identifiers, timing, status, fixed operation/description labels, HTTP response status, and sampling rate—never raw transaction/span names, route parameters, URLs, prompts, responses, or arbitrary attributes.

Unknown diagnostic codes and arbitrary event tags are discarded. Full prompts/responses, user fields, private project/file data, exception messages/causes, request URLs/headers/cookies/bodies/query strings, arbitrary contexts/extras, breadcrumb text/data, route parameters, and span attributes therefore do not survive serialization. This policy follows Sentry's [sensitive-data guidance](https://docs.sentry.io/platforms/javascript/guides/nuxt/data-management/sensitive-data/) and the pinned `10.64.0` [`dataCollection` contract](https://github.com/getsentry/sentry-javascript/blob/10.64.0/packages/core/src/types/datacollection.ts); the ordinary and internal-failure gates follow the pinned [client processing order](https://github.com/getsentry/sentry-javascript/blob/10.64.0/packages/core/src/client.ts#L1643-L1744) and Sentry's own [late envelope-integration pattern](https://github.com/getsentry/sentry-javascript/blob/10.64.0/packages/core/src/integrations/moduleMetadata.ts#L13-L32). The standalone-span boundary follows the pinned [`createSpanEnvelope`](https://github.com/getsentry/sentry-javascript/blob/10.64.0/packages/core/src/envelope.ts#L124-L176) and [dynamic-sampling-context construction](https://github.com/getsentry/sentry-javascript/blob/10.64.0/packages/core/src/tracing/dynamicSamplingContext.ts#L137-L148) order.

The behavior test initializes the real pinned server SDK with an in-memory transport, captures hostile events, linked exceptions, matched and unmatched debug metadata, breadcrumbs, a transaction, and child spans, forces an application event processor to fail through the public API, then inspects the bodies received only after the SDK's official envelope serializer. A bounded companion process selects the package's public browser export and proves a standalone span's serialized payload and header are sanitized too. Both paths prove private canaries do not reach serialized telemetry or local diagnostics. The transports make no provider or loopback network request and do not emulate Sentry; deployed browser behavior remains staging evidence in #37.

## Configuration

- `NUXT_MODULES_OBSERVABILITY_ENABLED`
- `NUXT_SENTRY_DSN`
- `NUXT_PUBLIC_SENTRY_DSN`
- `NUXT_SENTRY_ENVIRONMENT`
- `NUXT_PUBLIC_SENTRY_ENVIRONMENT`
- `NUXT_SENTRY_RELEASE`
- `NUXT_PUBLIC_SENTRY_RELEASE`
- `NUXT_SENTRY_TRACES_SAMPLE_RATE`
- `NUXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE`
- `NUXT_OBSERVABILITY_TEST_TOKEN`
- `SENTRY_AUTH_TOKEN`
- `SENTRY_ORG`
- `SENTRY_PROJECT`
- `SENTRY_RELEASE`
- `SENTRY_URL`
- `SENTRY_UPLOAD_CACHE_BUST`

When Observability is enabled, both DSNs are required and already trimmed. Sample-rate variables may be omitted for the literal `0.05` default; when supplied, they must be nonblank finite values from 0 through 1. With exact `false`, test routes and the client test page return stable 404 disabled responses, capture remains local-only, and protected readiness remains healthy without calling Sentry.

### Production source-map lifecycle

The official `@sentry/nuxt` integration owns debug-id injection and upload. A production build generates hidden client maps only when the exact Observability flag plus already-trimmed `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, and `SENTRY_PROJECT` are all present. Missing, partial, disabled, or non-production configuration sets both client and server maps to `false`. Server maps remain out of scope because the privacy policy deliberately reduces server frames to `application`; the supported upload selection excludes Nuxt SSR and Nitro server output. `SENTRY_RELEASE` and a self-hosted `SENTRY_URL` are optional non-secret build inputs.

The upload error handler rethrows, so a configured upload failure stops the build. After a successful Nuxt build and upload, the app-owned post-build operation removes every remaining `*.map` below `.output`, scans the deployable output again, and fails if any removal or scan fails or any map remains. Nuxt's documented [`hidden` mode](https://nuxt.com/docs/4.x/api/nuxt-config#sourcemap) prevents a public bundle reference but does not delete the map; the explicit removal is therefore still required.

Docker supplies `SENTRY_AUTH_TOKEN` only through a BuildKit secret. Organization, project, release, optional URL, and `SENTRY_UPLOAD_CACHE_BUST` are ordinary non-secret build arguments. Docker documents that [build arguments and environment variables are inappropriate for secrets](https://docs.docker.com/build/building/secrets/) and that [secret contents do not invalidate the build cache](https://docs.docker.com/build/cache/invalidation/#build-secrets). Change the arbitrary cache discriminator whenever upload credentials, target, or intent changes; never use the token or a token hash as its value. The production process starts with `node --import ./.output/server/sentry.server.config.mjs ./.output/server/index.mjs`.

Enabled `/api/live` and `/api/ready` traces are excluded before provider traffic: root sampling returns zero for exact decoded health paths, terminal transaction filtering drops a surviving health root, child-span filtering removes health fetches from neighboring transactions, and the client propagation target does not attach Sentry trace headers to the two canonical paths. Neighbor paths such as `/api/liveness` and `/api/readiness` remain eligible. Provider-side inbound filtering alone would still transmit a discarded envelope, so it is only background context from Sentry's [health-check filter documentation](https://docs.sentry.io/api/projects/update-an-inbound-data-filter/), not the implementation boundary. Real client/server delivery, real upload receipt, client symbolication, alerts, retention/access, provider-side controls, and provider presentation remain staging evidence in R-033/[#37](https://github.com/smallwiselabs/swl-step-by-step/issues/37). Server symbolication would require a separately approved privacy expansion.

## Test Events

To test a server event, temporarily set `NUXT_OBSERVABILITY_TEST_TOKEN`, deploy or restart, then send:

```bash
curl -X POST "$NUXT_PUBLIC_APP_URL/api/observability/test-error" -H "x-observability-test-token: $NUXT_OBSERVABILITY_TEST_TOKEN"
```

The route returns a controlled 500 after capturing a test exception. Clear `NUXT_OBSERVABILITY_TEST_TOKEN` after confirming the Sentry event.

To test a client event, temporarily set `NUXT_OBSERVABILITY_TEST_TOKEN`, deploy or restart, then open:

```text
$NUXT_PUBLIC_APP_URL/observability-client-test#token=$NUXT_OBSERVABILITY_TEST_TOKEN
```

The page validates the token server-side, removes the token hash from the address bar, and captures a controlled client exception. Clear `NUXT_OBSERVABILITY_TEST_TOKEN` after confirming the Sentry event.

## Triage

1. Check Sentry issue details.
2. Identify release, route, user impact, and frequency.
3. Check Coolify logs around the same timestamp.
4. Check DigitalOcean resource metrics.
5. Reproduce in staging if possible.
6. Patch and add a regression test or smoke check.
7. Deploy and confirm the issue stops recurring.
