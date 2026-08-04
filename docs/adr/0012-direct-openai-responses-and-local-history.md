# ADR 0012: Direct OpenAI Responses with locally authoritative history

- Status: accepted
- Date: 2026-07-16
- Decision owner: baseline application
- Issue: [R-026 / #33](https://github.com/smallwiselabs/swl-step-by-step/issues/33)
- Final rebaseline: [ADR 0015](0015-final-pre-release-database-rebaseline.md) supersedes this ADR's migration number and predecessor/rollback mechanics; its direct OpenAI, local-history, ownership, privacy, quota, and deletion decisions remain accepted
- Builds on: [ADR 0003](0003-family-plan-entitlements-and-user-owned-data.md), [ADR 0005](0005-immediate-account-deletion-and-billing-detachment.md), and [ADR 0008](0008-pre-release-database-rebaseline.md)
- Supersedes: active baseline decisions that routed AI through Cloudflare AI Gateway

## Context

AI is optional in this forkable personal-application baseline. A fork with AI disabled must start, pass readiness, and expose no AI experience without an OpenAI account or key. When enabled, the feature is a private text-conversation boundary: each conversation belongs to one authenticated person, while invisible family-plan membership may grant entitlement but never access to another person's history.

The former transitional `/api/ai/chat` relay did not have authentication, persisted ownership, history, application quotas, deletion, or a complete privacy boundary. Retaining Cloudflare AI Gateway in front of OpenAI would preserve a second provider and operational surface without a current product need. A generic multi-provider framework would likewise add translation and testing work that this OpenAI-first product does not need.

Official OpenAI documentation now recommends the Responses API for new projects while continuing to support Chat Completions. Responses can use OpenAI-managed Conversations or `previous_response_id`, but those choices make provider state part of the application's history authority. The Issue #33 boundary requires clear/delete/account-deletion behavior against locally visible history and does not need streaming or provider-managed reasoning continuation. [ADR 0013](0013-deployment-owned-openai-file-search.md) and [ADR 0014](0014-server-owned-openai-web-search.md) later add independently disabled hosted retrieval tools without changing that history authority.

## Decision

### Package, runtime, and module boundary

- Pin the official `openai` JavaScript/TypeScript SDK at exact version `6.47.0` (tag commit `62554053803dea45bf949699c7ea9d1a414df615`). Its published requirements include Node 20 LTS or later and Nitro 2.6 or later, so it is compatible with the repository's pinned Node 24 and Nuxt/Nitro runtime.
- Keep AI independently optional with the existing `disabled`, `incomplete`, and `ready` public states. `NUXT_MODULES_AI_ENABLED=false` ignores absent or stale OpenAI values and constructs no client. Enabled AI is incomplete unless `NUXT_OPENAI_API_KEY`, `NUXT_OPENAI_PROJECT_ID`, and `NUXT_OPENAI_MODEL` are all present and valid; readiness performs no charged or network provider probe.
- Accept only the server allowlisted model identifier `gpt-5.6-luna`. The official model catalog describes it as the cost-sensitive, high-volume GPT-5.6 tier and supports Responses. OpenAI currently publishes no separate dated Luna snapshot, so an alias change cannot be silently treated as version pinning: changing the allowlist requires a reviewed code/configuration change and staging recertification.
- Keep credentials only in private Nuxt runtime configuration. The browser never imports the SDK, receives the API key or OpenAI project ID, selects a model, or supplies provider request options. Bind each persistent environment to its own OpenAI project and service-account key; API usage and billing are separate from ChatGPT subscriptions.
- Isolate the SDK in `apps/web/server/services/ai/openai.ts`. The interface is intentionally OpenAI-specific and thin: it permits deterministic injection, validates the request/response boundary, normalizes safe errors, and prevents routes from handling provider envelopes. It is not a multi-provider abstraction.

### Responses request

For each provider attempt, the adapter sends a non-streaming `responses.create` request to the fixed `https://api.openai.com/v1` origin with:

- server-owned instructions plus the locally persisted visible user/assistant messages;
- `model: "gpt-5.6-luna"`, `reasoning: { effort: "low" }`, and at most 4,096 output tokens;
- `store: false`, `background: false`, and `truncation: "disabled"`;
- `prompt_cache_options: { mode: "explicit" }` with no cache breakpoint and no `prompt_cache_key`, which the current GPT-5.6 prompt-caching contract says performs no prompt-cache reads or writes;
- no `conversation`, `previous_response_id`, attachments, metadata, streaming, or provider-side durable prompt object; with ADR 0013's File Search and ADR 0014's Web Search disabled, no tool fields exist, while enabling either adds only its bounded server-configured tool under one total built-in-call ceiling;
- a domain-separated HMAC-SHA256 of the internal user ID as `safety_identifier`; and
- an application attempt UUID as `X-Client-Request-Id`, never the caller's client request ID, user ID, email, or family identifier.

The application treats each provider call as stateless. OpenAI's manual-state guidance says model-native reasoning/tool output items must be replayed when an integration wants that continuation behavior. This baseline deliberately stores and replays only application-visible text plus ADR 0013/0014's normalized citations because it does not implement model-native reasoning/tool continuation. Enabled hosted tools are newly available on each eligible turn rather than replayed as opaque output. This is a product inference, not a claim that visible messages preserve every provider-internal item.

The adapter accepts only a completed visible text output or a refusal, the resolved model, optional provider request ID, and bounded numeric usage fields. It never returns or persists a raw Response object, headers, error body, reasoning item, tool item, or arbitrary provider metadata.

### Authentication, ownership, entitlement, and request lifecycle

- Every route authenticates against persisted session state before parsing or data access. Each conversation uses an immutable `ai_conversation_<UUID>` ID and every read or write predicates both that ID and the authenticated user's persisted ID. Valid but missing, deleted, or foreign IDs—including another member of the same family plan—share a concealed `404`.
- With Billing disabled, an authenticated user may create a conversation and generate. With Billing enabled and ready, those two operations also require current persisted entitlement. Listing, reading, clearing, and deleting the caller's existing history remain available after entitlement loss.
- The server accepts no model, instructions, owner, provider ID, output bound, timeout, or quota override. A message command contains only a UUID `clientRequestId` and nonblank text. The application limits each message to 32,000 UTF-8 bytes, rendered provider input to 200,000 bytes, server instructions to 32,000 bytes, and each user to 100 conversations.
- Before a provider call, one SQLite `IMMEDIATE` reservation predicates the conversation on its persisted owner, rechecks entitlement and history revision, validates the per-user daily and concurrency limits, inserts the user message and attempt, reserves usage, and claims one content-free owner generation lease. The baseline permits 50 reserved generation attempts per UTC day and one active generation per user. Local validation/authentication/ownership failures occur before reservation.
- The request uses a 60-second provider timeout, a 90-second attempt lease, and cancellation on HTTP disconnect. Late completion cannot finalize after clear, conversation deletion, account deletion, or a history-revision change.

### Retry and idempotency behavior

- Construct the SDK with `maxRetries: 0`. Version 6.47.0 otherwise retries connection errors, 408, 409, 429, and 5xx responses twice; allowing that hidden retry would make one application attempt cause multiple charged provider calls outside the ledger.
- The unique `(conversation, clientRequestId)` ledger is the application idempotency boundary. Reusing the same ID and content replays a terminal visible success/refusal or reports the existing pending/failure state without another provider call. Reusing the ID with changed content is a `409`.
- Preflight replay atomically reaps an expired 90-second pending attempt and its owner lease before returning the persisted `indeterminate` timeout state. It never leaves a crashed request pending forever and never redispatches the same ID.
- A timeout or connection failure after dispatch is `indeterminate`: OpenAI may have processed and charged the request even though the application has no answer. It is never automatically resubmitted. A deliberate user retry is a new turn with a new client request ID.
- Every successfully reserved generation attempt consumes the daily quota; provider-dispatched and ambiguous attempts are not refunded. This favors bounded spend over optimistic retry. The SDK's base client does not configure an idempotency header for Responses, so `X-Client-Request-Id` is correlation evidence, not a claim of provider-side exactly-once execution.

### Persistence, clear, delete, and errors

- Migration `0008` adds `ai_conversations`, `ai_messages`, `ai_generation_attempts`, `ai_generation_leases`, and `ai_usage_buckets`. ADR 0013/0014's owner-authorized pre-release regenerations additionally add title-only `ai_message_file_citations` and bounded URL/span `ai_message_web_citations`. Messages retain the complete application-visible prompt/response text. Attempts retain only bounded state, timestamps/lease, the safe model and provider request identifier, allowlisted numeric usage, and an application error code. The separate owner lease contains only an internal attempt ID and expiry so clear/delete cannot open a second dispatch while the first provider call is still in flight.
- Clear deletes the conversation's messages, citations, and attempts and increments its history revision so a late result cannot reappear. Conversation deletion cascades its message/citation/attempt tree. The content-free owner lease survives either operation until the matching provider call finalizes or its 90-second lease expires; a late old finalizer cannot release a newer lease. The minimized daily usage bucket also survives because deleting visible history must not reset spend controls. Account deletion explicitly removes the caller's conversations, messages, citations, attempts, owner lease, and usage buckets in the existing synchronous deletion transaction.
- These are logical application deletions, not a promise of immediate forensic byte erasure. SQLite's normal `secure_delete` setting, WAL/checkpoint state, and pre-deletion backup retention remain deployment considerations. The baseline does not block a user request on `VACUUM` or backup rewriting; #37 must certify the deployed retention/deletion statement before a fork makes a stronger claim.
- Public DTOs expose conversation IDs/timestamps and message IDs/role/content/sequence/timestamp plus ordered `{ type: "file", title }` or `{ type: "web", title, url, startIndex, endIndex }` citations. Attempts, file/vector-store identifiers, retrieval queries/results/actions, model/provider identifiers, usage, owner identifiers, quota buckets, and internal errors are never public.
- Normalize failures to a finite application-owned surface: unauthenticated `401`, entitlement `403`, concealed resource `404`, duplicate/concurrency/pending conflict `409`, application quota `429`, rejected/malformed provider result `502`, unavailable/rate/configuration provider `503`, and timeout `504`. Do not return, log, or send to Sentry raw OpenAI messages, headers, envelopes, prompts, or responses.

### Privacy and provider retention

- Set `store: false` on every call. This disables the Responses API's default provider application-state storage, but it is not Zero Data Retention. OpenAI documents that default abuse-monitoring logs may contain prompts/responses and are retained for up to 30 days, with possible longer retention under stated legal or safety conditions.
- Zero Data Retention and Modified Abuse Monitoring require OpenAI approval and have feature/model limitations. ZDR also forces `store` false, but not every endpoint or capability is ZDR-eligible. Therefore neither the application nor its UI may claim “zero retention” merely because this request sets `store: false`.
- Disable SDK logging with `logLevel: "off"`; v6.47.0 documents that debug logging includes request/response headers and bodies. Ordinary application logs, Sentry events, breadcrumbs, spans, transaction names, and job diagnostics must contain no prompt or response. Only bounded application codes, attempt/provider request IDs, timing, and numeric usage may be operational metadata.
- Disable prompt caching explicitly as described above. [ADR 0013](0013-deployment-owned-openai-file-search.md) owns File Search storage, tool, pricing, retention, citation, and deletion behavior. [ADR 0014](0014-server-owned-openai-web-search.md) owns Web Search domain policy, combined tool ceiling, citations, privacy, pricing, and certification behavior.

### Tests and production certification

- Local tests inject a deterministic adapter/fetch boundary and never require an API key, make a provider request, or incur a charge. Contract tests verify the exact v6.47.0 request shape, disabled/no-key behavior, no hidden retry, timeout/abort, safe output/refusal extraction, error normalization, request-ID handling, and absence of raw envelope persistence/logging.
- Real OpenAI work belongs to [Issue #37](https://github.com/smallwiselabs/swl-step-by-step/issues/37): isolated project/service-account key, model access and alias behavior, request IDs, rate/quota errors, timeout/ambiguous outcomes, project spend limits and billing, dashboard/log settings, actual retention/ZDR/MAM posture, and deployed deletion/privacy evidence. Local fake evidence is not provider certification.

## Consequences and rollback

- The baseline has one AI provider and less provider-specific configuration than the former Gateway design. Cloudflare remains the DNS/CDN/WAF/Turnstile and optional R2 provider; it is no longer in the model-call path.
- Local SQLite is the source of truth for visible history and deletion. This improves ownership and portability, but every turn resends bounded visible history and therefore consumes input tokens again.
- `store: false` means an answer lost after provider success but before local finalization cannot be fetched back. Timeout/connection ambiguity may consume quota and API spend without a visible answer. Provider outage, rate limiting, model alias changes, and OpenAI policy/retention changes remain operational risks.
- Disable AI to roll back provider use without deleting history. During the explicitly disposable pre-release window, ADRs 0013 and 0014 change `0008` identity and require stopped-writer disposal/reinitialization rather than restoration of a valueless predecessor database. Issue #151 establishes the final clean baseline before persistent staging; afterward an older image must not run against an advanced ledger. Key rotation within the same OpenAI project does not require data migration, but project/model changes require reviewed configuration and recertification.

## Rejected alternatives

### OpenAI-managed Conversations or `previous_response_id`

Rejected as the primary history because OpenAI Conversations persist items until deleted, make a provider identifier part of local lifecycle authority, and are not ZDR-eligible. Chained response state also complicates clear/delete and recovery when local and provider writes diverge. These features may be useful elsewhere; this product needs locally authoritative visible text history.

### Chat Completions

Rejected for new work because OpenAI recommends Responses for new projects and the exact official SDK treats Responses as its primary API. Chat Completions remains supported, but choosing it would provide no product advantage for this bounded text feature.

### Cloudflare AI Gateway in front of OpenAI

Rejected because it adds another token, policy, logging, caching, billing, outage, and certification boundary. Application-owned quotas, attempts, safe metadata, and direct OpenAI project controls already cover the current need. A future gateway requires a measured reason and a new decision.

### Generic provider or agent framework

Rejected because multi-provider message translation, tool abstractions, streaming, agent loops, and provider routing are not current requirements. The thin OpenAI adapter exists for testing and separation, not speculative portability.

## Open-source comparison

- [`openai/openai-node` v6.47.0](https://github.com/openai/openai-node/tree/v6.47.0) is the authoritative SDK implementation. Its runtime, retry, timeout, request-ID, logging, error, and base-client idempotency behavior determine this adapter.
- [`openai/openai-responses-starter-app` at `0fae283f`](https://github.com/openai/openai-responses-starter-app/tree/0fae283f12ca3f71015cd9fa3f9b28df97e9ae21) and [`openai/openai-knowledge-retrieval` at `f62c5dd4`](https://github.com/openai/openai-knowledge-retrieval/tree/f62c5dd49955d2bc793e0a55989863dca61f1ead) demonstrate Responses, Web Search, and File Search request shapes. Their demo UI, streaming, client-selected tools/history, and provider resources are not an authorization or persistence design for this baseline; ADR 0013 owns File Search and ADR 0014 owns Web Search.
- [`danny-avila/LibreChat` v0.8.7 source at `4321f68f`](https://github.com/danny-avila/LibreChat/tree/4321f68f29a0c169cd683876c8b34a28d409eb9e) is a mature, actively maintained multi-user application. Its local user/conversation history and foreign-resource concealment support our ownership direction; its locked `@librechat/agents@3.2.65` source at [`danny-avila/agents` commit `058fcef4`](https://github.com/danny-avila/agents/tree/058fcef49be8dcdf775fd8a13c81732fb0e08a19) also disables OpenAI SDK retries. Its many providers, agents, tools, sharing, and streaming layers are intentionally not adopted.
- [`lobehub/lobehub` v2.2.10 at `4bab1636`](https://github.com/lobehub/lobehub/tree/4bab1636408e60a7ee17b640490fbf33a310a325) is a mature, multi-contributor TypeScript application. It supports OpenAI-specific translation below routes, Responses for eligible models, locally owned messages, and fake SDK tests. Those narrow patterns fit; its product-wide provider/agent framework does not.
- [`vercel/ai` at `e8043b4f`](https://github.com/vercel/ai/tree/e8043b4f0b28b129feefa5b832aa5c5f5d8e3ef1) (`ai@7.0.29`, `@ai-sdk/openai@4.0.15`) demonstrates a maintained Responses default and injected-fetch tests. It is not selected because it replaces the official transport/types with a broad provider abstraction and Gateway-oriented defaults that this OpenAI-only module does not need.

These projects provide implementation context, not authority for OpenAI API behavior, and no source-text testing pattern is copied.

## Official evidence

- [OpenAI Node SDK v6.47.0 README and runtime requirements](https://github.com/openai/openai-node/tree/v6.47.0)
- [OpenAI Node SDK v6.47.0 client source](https://github.com/openai/openai-node/blob/v6.47.0/src/client.ts)
- [Migrate to the Responses API](https://developers.openai.com/api/docs/guides/migrate-to-responses)
- [Conversation state](https://developers.openai.com/api/docs/guides/conversation-state)
- [Data controls and retention](https://developers.openai.com/api/docs/guides/your-data)
- [GPT-5.6 Luna model details](https://developers.openai.com/api/docs/models/gpt-5.6-luna)
- [GPT-5.6 model guidance](https://developers.openai.com/api/docs/guides/latest-model)
- [Prompt caching](https://developers.openai.com/api/docs/guides/prompt-caching)
- [Production best practices](https://developers.openai.com/api/docs/guides/production-best-practices)
- [Rate limits](https://developers.openai.com/api/docs/guides/rate-limits)
- [Error codes](https://developers.openai.com/api/docs/guides/error-codes)
- [OpenAI API billing is separate from ChatGPT](https://help.openai.com/en/articles/8156019-how-can-i-move-my-chatgpt-subscription-to-the-api)
