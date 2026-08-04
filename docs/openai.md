# OpenAI baseline

This guide is the active implementation and operations reference for the optional AI module. [ADR 0012](adr/0012-direct-openai-responses-and-local-history.md) owns the provider and history decision; [ADR 0013](adr/0013-deployment-owned-openai-file-search.md) owns the optional deployment corpus; and [ADR 0014](adr/0014-server-owned-openai-web-search.md) owns optional domain-restricted Web Search.

The baseline calls OpenAI directly through exact `openai@6.47.0` and the Responses API. It does not use Cloudflare AI Gateway, a generic provider framework, OpenAI-managed Conversations, or `previous_response_id`. SQLite is authoritative for application-visible history.

## Optional-module states

| State        | Meaning                                                                                                                                           |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `disabled`   | `NUXT_MODULES_AI_ENABLED=false`; no key is required, and AI request/service/worker boundaries do no AI database, client, quota, or provider work. |
| `incomplete` | AI is enabled but one or more exact provider values is absent or invalid; startup/readiness fails closed.                                         |
| `ready`      | All configuration is valid and the database is available; this does not make a provider network request.                                          |

File Search and Web Search are private subordinate capabilities, not additional public module states. Their `NUXT_OPENAI_*_ENABLED` switches must always be exact `true` or `false` and neither can be true while AI is disabled. AI-ready configuration remains valid with either or both false. File Search additionally requires one server-owned vector-store ID; Web Search additionally requires one server-owned allowlist.

Ready AI requires server-only values:

```dotenv
NUXT_MODULES_AI_ENABLED=true
NUXT_OPENAI_API_KEY=<project service-account key>
NUXT_OPENAI_PROJECT_ID=<environment-specific OpenAI project ID>
NUXT_OPENAI_MODEL=gpt-5.6-luna
NUXT_OPENAI_FILE_SEARCH_ENABLED=false
NUXT_OPENAI_FILE_SEARCH_VECTOR_STORE_ID=
NUXT_OPENAI_WEB_SEARCH_ENABLED=false
NUXT_OPENAI_WEB_SEARCH_ALLOWED_DOMAINS=
```

The key and project ID must have no surrounding whitespace, and the model must equal the code-owned allowlist. When File Search is true, `NUXT_OPENAI_FILE_SEARCH_VECTOR_STORE_ID` must also be nonblank, trimmed, and at most 512 characters. When Web Search is true, `NUXT_OPENAI_WEB_SEARCH_ALLOWED_DOMAINS` must contain one through 100 canonical comma-separated ASCII hostnames. Schemes, paths, ports, credentials, wildcards, IP literals, whitespace, trailing dots, malformed labels, duplicates, and redundant parent/subdomain entries are invalid. OpenAI documents that an allowed parent also includes its subdomains. False switches normalize stale subordinate values away so they cannot enter a request. The configured project ID is passed to the SDK exactly; local readiness does not contact OpenAI or prove that an ID/domain policy resolves to the intended project/provider behavior. Issue #37 certifies those bindings. Never use `OPENAI_BASE_URL`, expose a key to public runtime configuration, or set `dangerouslyAllowBrowser`. Disabled forks should omit provider values and keep both subordinate switches false. Final generated baseline `0000` creates the optional local AI/citation tables as part of one common schema, but a disabled process constructs no client and contacts no provider.

Use a separate OpenAI project for each persistent staging/production environment; files and storage are project-scoped. The runtime service-account key and the separately invoked corpus-operator key belong to that same project but have different least-privilege permissions. Set project spend and rate controls as defense in depth; the application's user quotas remain authoritative for product behavior. OpenAI API usage has separate billing from every ChatGPT subscription.

## Public HTTP boundary

All responses are `private, no-store`. Routes are available only when AI is ready and every operation re-authenticates against persisted state.

| Method   | Route                                            | Behavior                                                                                |
| -------- | ------------------------------------------------ | --------------------------------------------------------------------------------------- |
| `GET`    | `/api/ai/conversations`                          | Bounded cursor page of the caller's minimized conversations.                            |
| `POST`   | `/api/ai/conversations`                          | Creates one empty immutable-ID conversation after entitlement and count checks.         |
| `GET`    | `/api/ai/conversations/:conversationId`          | Returns one caller-owned minimized conversation; unknown/foreign/deleted share `404`.   |
| `DELETE` | `/api/ai/conversations/:conversationId`          | Deletes the owned conversation plus messages/attempts; daily usage remains.             |
| `GET`    | `/api/ai/conversations/:conversationId/messages` | Bounded cursor page of caller-owned visible user/assistant messages.                    |
| `POST`   | `/api/ai/conversations/:conversationId/messages` | Reserves one idempotent attempt, calls OpenAI once, and commits visible output/refusal. |
| `DELETE` | `/api/ai/conversations/:conversationId/messages` | Clears messages/attempts and advances history revision; daily usage remains.            |

Message creation accepts only:

```json
{
  "clientRequestId": "a caller-generated UUID",
  "content": "nonblank text"
}
```

The caller cannot set model, owner, family/organization, instructions, temperature/reasoning, tools, vector store, search domains/location/context, output limit, timeout, provider identifiers, or quota fields. Public conversation/message DTOs expose no owner, model, provider, attempt, usage, or error metadata. Every message includes `citations`; it is empty for user/uncited messages and otherwise contains a bounded ordered union of `{ "type": "file", "title": "<safe source title>" }` and `{ "type": "web", "title": "<safe source title>", "url": "https://...", "startIndex": 0, "endIndex": 10 }`.

With Billing disabled, authentication is sufficient to create/generate. With Billing enabled and ready, those operations additionally require persisted paid entitlement. Existing owner-scoped history remains readable, clearable, and deletable after entitlement loss. Family membership never grants conversation access; foreign IDs use the same concealed `404` as missing IDs.

## Request lifecycle

1. The optional-module boundary rejects disabled AI before route body parsing or application work.
2. The route authenticates, validates bounded input, and resolves the conversation by both immutable ID and persisted user ID.
3. One SQLite `IMMEDIATE` reservation predicates the conversation on its persisted owner, rechecks entitlement, conversation revision, one-active-generation concurrency, the 50-reserved-attempt UTC-day quota, and the `(conversation, clientRequestId)` idempotency key. It inserts the user message and pending attempt and claims one content-free owner generation lease before provider I/O.
4. The server loads only the caller's visible, ordered text history and code-owned instructions. Rendered input is capped before dispatch.
5. The thin adapter calls `responses.create` once with a 60-second timeout and caller-disconnect abort. The SDK has `maxRetries: 0` and logging off.
6. The adapter accepts only completed text/refusal plus bounded safe metadata. With hosted tools enabled it accepts at most one completed built-in call and only the matching normalized File or Web citations, then atomically persists the assistant message and citations. The application conditionally finalizes only if owner, conversation, pending attempt, and history revision still match.
7. Clear/delete/account deletion changes or removes local authority immediately. A late provider result can no longer reappear.

The fixed application policy is:

| Control                                   | Bound               |
| ----------------------------------------- | ------------------- |
| Conversations per user                    | 100                 |
| User message                              | 32,000 UTF-8 bytes  |
| Rendered provider input                   | 200,000 UTF-8 bytes |
| Server instructions                       | 32,000 UTF-8 bytes  |
| Output                                    | 4,096 tokens        |
| Reserved generation attempts per user/day | 50 (UTC bucket)     |
| Concurrent generations per user           | 1                   |
| Provider request timeout                  | 60 seconds          |
| Attempt lease                             | 90 seconds          |
| Default/maximum cursor page               | 50 / 100            |

## Exact OpenAI request policy

`apps/web/server/services/ai/openai.ts` lazily creates the only provider client against `https://api.openai.com/v1`. Each call fixes:

- `model: "gpt-5.6-luna"` and `reasoning: { effort: "low" }`;
- `max_output_tokens` from the validated application bound, never more than 4,096;
- `store: false`, `background: false`, and `truncation: "disabled"`;
- `prompt_cache_options: { mode: "explicit" }`, no cache breakpoint, and no `prompt_cache_key`;
- no `conversation`, `previous_response_id`, attachments, metadata, prompt object, or streaming;
- code-owned instructions and locally persisted visible user/assistant messages;
- `safety_identifier` as a domain-separated HMAC-SHA256 of the internal user ID using the Better Auth secret; and
- `X-Client-Request-Id` as the server's internal attempt UUID.

The provider request ID, resolved model, and allowlisted numeric usage may be retained on the internal attempt. They are never returned in public DTOs. The raw provider envelope exists only in adapter memory and is discarded after safe extraction.

When both subordinate capabilities are false, the serialized request has no `tools`, `tool_choice`, `parallel_tool_calls`, `max_tool_calls`, vector-store ID, domains, or included search results. File Search adds exactly `{ type: "file_search", vector_store_ids: [configuredId], max_num_results: 10 }`. Web Search adds exactly `{ type: "web_search", filters: { allowed_domains: configuredDomains }, search_context_size: "medium" }`. A request with either tool uses `tool_choice: "auto"`, `parallel_tool_calls: false`, and `max_tool_calls: 1`.

When both tools are enabled, both are offered but the one total built-in-call ceiling means the model can use File Search or Web Search on that turn, not both. Raising the ceiling to two would also permit two calls of one kind; OpenAI does not document a per-tool call limit. Automatic choice may produce zero searches/citations.

The request deliberately omits `include: ["file_search_call.results"]` and `include: ["web_search_call.action.sources"]`, so File queries/chunks/scores/attributes/corpus text and Web queries/actions/complete consulted-source lists do not enter the application envelope. It also sends no user location, blocked-domain policy, image search, or unlimited search-result token budget. The current OpenAI guide documents `medium` as a balanced context setting rather than an exact token/source/citation bound. It documents omitted `external_web_access` as live access; exact SDK 6.47.0 does not type that newer field, so the baseline uses the exact stable typed subset and assigns live-behavior certification to #37.

The official SDK warns that preserving model-native reasoning/tool continuation requires replaying all response output items. This baseline intentionally does not provide that behavior: it sends locally visible text as a new stateless request on every turn and makes enabled tools available again. It stores normalized user-visible citations, not opaque tool calls. Adding opaque reasoning continuation, compaction, other tools, or provider-managed state requires a separate persistence/privacy decision.

## Web citation normalization

A searched text answer requires one completed Web Search call and one completed `output_text` part with one through 20 valid URL annotations. A refusal may remain uncited. The adapter rejects Web citations without a completed Web Search call, File citations without a completed File Search call, nonterminal/extra/disabled tool calls, searched text without a citation, unsupported annotation kinds, or mixed/malformed output.

A Web citation title is trimmed, control-free, and at most 512 characters. Its URL must be canonical HTTPS without credentials or a nondefault port, at most 4,096 characters, and hosted by an allowed domain or one of its subdomains. Its span must satisfy `0 <= startIndex < endIndex <= text.length`. Exact duplicate URL/span annotations are removed in first-seen order; the same URL may remain at distinct spans. The application never server-fetches citation URLs.

When the provider reports source or page URLs in `search`, `open_page`, or `find_in_page` action data, the adapter validates them against the same HTTPS and allowed-domain policy before discarding the action envelope. Redirect and complete effective-fetch behavior still require live certification in #37.

The exact SDK joins multiple `output_text` parts without rebasing annotation offsets. OpenAI does not document enough multipart/Unicode offset semantics for safe local repair, so a citation-bearing answer initially requires exactly one completed text part. #37 certifies real shapes and offsets. A future UI must escape titles, make citations clearly visible and clickable, show an honest destination, and apply safe external-link/referrer behavior; this issue stores the necessary metadata but adds no AI UI.

## Retry, cancellation, and idempotency

The SDK defaults to two automatic retries for connection failures, 408, 409, 429, and 5xx responses; the baseline sets `maxRetries: 0`. One application attempt therefore owns at most one provider dispatch. `X-Client-Request-Id` is for support correlation and is not represented as provider exactly-once support.

The caller UUID is an application idempotency key:

- same UUID and same content replays a terminal text/refusal or reports the existing pending/failure without another call;
- same UUID with changed content returns `409`;
- replay after the 90-second lease expires atomically marks the abandoned pending attempt `indeterminate`, removes its owner lease, and returns the persisted timeout state without redispatch;
- timeout/connection loss after dispatch becomes `indeterminate` and is never automatically resubmitted; and
- a deliberate retry is a new turn with a new UUID.

Every successfully reserved generation attempt consumes the daily quota; validation, authentication, ownership, and entitlement failures before reservation do not. Provider-dispatched or ambiguous attempts are never refunded. A request may be processed and charged even when the client sees `504` or disconnects. This conservative rule prevents retries or deletion from resetting spend controls.

## Local data and deletion

Generated baseline `0000_pre_release_baseline.sql` creates:

- `ai_conversations` for owner, timestamps, next sequence, and history revision;
- `ai_messages` for complete application-visible user/assistant text;
- `ai_message_file_citations` for at most ten ordered, unique, title-only sources attached to an assistant message;
- `ai_message_web_citations` for at most 20 ordered unique URL/span annotations with bounded safe titles and HTTPS URLs attached to an assistant message;
- `ai_generation_attempts` for bounded state, lease, safe provider correlation, numeric usage, and normalized errors;
- `ai_generation_leases` for one transient owner-level internal attempt ID and expiry, without conversation ID or content; and
- `ai_usage_buckets` for minimized daily quota state.

Clear deletes messages, both citation kinds, and attempts but retains the usage bucket. It also retains the content-free owner generation lease until the matching in-flight call finalizes or the 90-second lease expires; otherwise repeated clear/delete commands could bypass the one-active-generation cost control. Conversation delete behaves the same way. A late old finalizer predicates the exact attempt ID and cannot clear a newer lease. Account deletion removes every locally owned AI row, including citations, active leases, and quota buckets, in the existing synchronous transaction. These user operations never mutate the shared deployment corpus or perform Web cleanup because Web Search creates no application-owned provider object. OpenAI Conversations, stored Responses, user files, and provider prompt resources remain unused.

[ADR 0015](adr/0015-final-pre-release-database-rebaseline.md)/#151 folds the settled AI and separate File/Web citation schema into generated `0000`. Future schema changes are forward-only.

## Deployment corpus operations

Ordinary HTTP routes have no corpus-management capability. The local operator command is separately authenticated with `OPENAI_CORPUS_OPERATOR_API_KEY` and `OPENAI_CORPUS_PROJECT_ID`; those values are not Nuxt runtime configuration and are read only when the command is invoked.

```text
pnpm openai:corpus prepare <manifest.json>
pnpm openai:corpus verify <vector-store-id>
pnpm openai:corpus delete <vector-store-id> --confirm <same-vector-store-id>
```

The manifest is a JSON file whose paths are relative to the manifest's directory and whose digests are lowercase SHA-256:

```json
{
  "version": 1,
  "name": "Example app reference corpus 2026-07-16",
  "files": [
    {
      "path": "corpus/reference-guide.pdf",
      "sha256": "0000000000000000000000000000000000000000000000000000000000000000"
    }
  ]
}
```

Replace the illustrative all-zero digest with the digest of the final bytes (for example, from `sha256sum corpus/reference-guide.pdf`) before invoking `prepare`. Every uploaded basename must be trimmed, safe, at most 512 characters, and unique across the corpus because that basename becomes the only user-visible citation title.

`prepare` requires contained regular files whose bytes match those digests. It rejects symlinks, path escape, duplicate/unsafe filenames, more than 100 files, any file over 50 MiB, or more than 500 MiB total. It creates a marked new store and uniquely owned File objects, uses zero SDK retries, explicitly polls to a 30-minute total deadline, verifies terminal counts, and writes a `0600` receipt beneath ignored local `data/openai-corpus`. Known partial resources are compensated; an indeterminate provider mutation stops for dashboard reconciliation.

Replacement is intentionally blue/green: prepare and verify the new store, configure/deploy its ID, certify the deployed behavior, then explicitly delete the old store. The command does not list all stores, mutate an active store in place, edit `.env`, deploy, or automatically delete anything. `delete` requires the matching private receipt and confirmation value, verifies the provider ownership marker, and deletes both the vector store and its operator-created File objects. Incomplete cleanup remains recorded and returns failure.

These operations are logical application deletion, not a claim of immediate forensic erasure. SQLite normally leaves `secure_delete` off; deleted bytes can remain in reusable pages or WAL state, and pre-deletion backups remain governed by their retention policy. The baseline does not run `VACUUM` or rewrite backups during a user request. Issue #37 must certify deployed WAL/checkpoint behavior, backup retention and expiry, restore implications, and the exact deletion statement before a fork promises physical erasure. See SQLite's official [`secure_delete`](https://www.sqlite.org/pragma.html#pragma_secure_delete) and [WAL](https://www.sqlite.org/wal.html) documentation.

## Privacy and retention

`store: false` disables the Responses API's default application-state storage; it does **not** mean zero provider retention. OpenAI's current data-controls guide states that default abuse-monitoring logs may include prompts/responses and may be retained for up to 30 days, or longer under stated legal/safety conditions. OpenAI approval is required for Modified Abuse Monitoring or Zero Data Retention, and feature/endpoint eligibility still matters.

Do not advertise Zero Data Retention unless the exact OpenAI organization/project control and every enabled endpoint/tool have been certified. ZDR forces `store` false, but `store: false` alone does not confer ZDR. Files and vector stores are persistent provider application state until deletion and are not ZDR-eligible. The corpus must contain deployment-approved reference material, never private user-owned data. OpenAI documents live Web Search as not HIPAA eligible and not covered by a BAA. Prompt-derived queries may contain private information, and live access can involve third-party sites; OpenAI does not document enough destination behavior for this application to make a broader disclosure claim.

OpenAI currently publishes File Search pricing of $2.50 per 1,000 calls and vector storage of $0.10/GB/day after the listed free allowance. Web Search is $10 per 1,000 calls ($0.01/call) plus search-content tokens billed at model rates. With at most one built-in call per attempt and the existing 50-attempt user/day ceiling, application dispatch permits at most 50 possible File or Web Search calls per user/day. The maximum Web Search tool-call fee from that ceiling is therefore $0.50/user/day before model/search-content tokens. SQLite does not claim authoritative tool-call billing because an ambiguous timeout may still execute; #37 reconciles provider dashboard usage. Raw corpus bytes do not predict indexed storage size, and medium Web context is not a precise token-cost bound.

SDK `logLevel` is fixed to `off` because debug mode can include HTTP headers and bodies. Prompt/response text, generated search queries, citation URLs/titles, source lists, and result content must not enter ordinary logs, Sentry events, breadcrumbs, spans, transaction names, attempt diagnostics, or provider error normalization. Safe operational fields are limited to application codes, bounded timing/usage, and non-user-derived attempt/provider request IDs. Retrieved pages are untrusted evidence: allowlisting narrows eligible origins but does not prove truth, freshness, safety, or prompt-injection resistance.

## Safe failures

| Status | Meaning exposed by the application                                          |
| ------ | --------------------------------------------------------------------------- |
| `401`  | Authentication required.                                                    |
| `403`  | Current entitlement required for create/generate.                           |
| `404`  | Conversation is unavailable, including foreign/missing/deleted IDs.         |
| `409`  | Idempotency mismatch, existing pending attempt, or concurrency conflict.    |
| `429`  | Application daily quota reached.                                            |
| `502`  | Provider rejected the content or returned malformed/non-usable output.      |
| `503`  | Provider authentication/permission/rate/availability/configuration failure. |
| `504`  | Provider timeout; outcome may be indeterminate.                             |

Never expose OpenAI's raw status body, message, headers, stack, or response envelope. Provider request IDs may be retained internally for support evidence but do not appear in user-facing errors.

## Deterministic tests and staging

Local tests inject deterministic fakes and make no external request. They cover module/sub-capability states; exact tool-free, File-only, Web-only, and combined request shapes; strict domain parsing; no-key disabled startup; one dispatch and one total built-in call per attempt; timeout/abort; search/no-search/File/Web citations and malformed output; URL/domain/span validation; durable pagination/replay/deletion; operator path/hash/limit/poll/cleanup behavior; safe error classes; ownership and same-family concealment; limits/concurrency/idempotency; migrations; and log/Sentry redaction through observable behavior.

Do not place a real OpenAI key in `.env`, fixtures, source control, a browser bundle, logs, or Sentry. A developer does not need API credits to run the local gate.

Issue #37 owns persistent-staging certification before enabling AI for users:

- environment-specific OpenAI project and least-privilege service-account key;
- exact model access/alias behavior and output/price assumptions;
- real request-ID, rate/quota, refusal, timeout, and ambiguous-result behavior;
- project spend/rate limits, billing method, alerts, and confirmation that ChatGPT billing is unrelated;
- OpenAI dashboard/log/data-sharing settings and documented ZDR/MAM posture;
- prompt/response absence from deployed application logs and Sentry;
- clear, conversation deletion, and account-deletion behavior in the deployed topology; and
- key rotation, provider outage, rollback, and incident evidence.

File Search additionally requires #37 evidence for project-scoped vector storage, separate runtime/operator service-account permissions, real ingestion and bounded pagination, model tool acceptance, citation shape, storage/call billing, provider error behavior, deletion/eventual consistency, and its exact retention/ZDR limitations. Web Search additionally requires live-access, root/subdomain filtering and redirects, query/citation/Unicode/multipart behavior, actual charges, provider failures, retention/ZDR/MAM and HIPAA/BAA posture, third-party disclosure, and combined File/Web automatic-selection evidence.

Until that evidence exists, keep AI disabled in persistent staging/production. Readiness validates configuration and current database availability only; it does not certify OpenAI connectivity, credentials, credits, model access, retention, or deletion.

## Official references

- [OpenAI Node SDK v6.47.0](https://github.com/openai/openai-node/tree/v6.47.0)
- [Responses migration guidance](https://developers.openai.com/api/docs/guides/migrate-to-responses)
- [Conversation state](https://developers.openai.com/api/docs/guides/conversation-state)
- [Data controls](https://developers.openai.com/api/docs/guides/your-data)
- [GPT-5.6 Luna](https://developers.openai.com/api/docs/models/gpt-5.6-luna)
- [Prompt caching](https://developers.openai.com/api/docs/guides/prompt-caching)
- [Production best practices](https://developers.openai.com/api/docs/guides/production-best-practices)
- [Rate limits](https://developers.openai.com/api/docs/guides/rate-limits)
- [Error codes](https://developers.openai.com/api/docs/guides/error-codes)
- [File Search](https://developers.openai.com/api/docs/guides/tools-file-search)
- [Web Search](https://developers.openai.com/api/docs/guides/tools-web-search)
- [Retrieval and vector stores](https://developers.openai.com/api/docs/guides/retrieval)
- [Pricing](https://developers.openai.com/api/docs/pricing)
- [OpenAI projects and service accounts](https://help.openai.com/en/articles/9186755-managing-your-work-in-the-api-platform-with-projects)
- [API billing versus ChatGPT billing](https://help.openai.com/en/articles/9039756-billing-settings-in-chatgpt-vs-platform)
