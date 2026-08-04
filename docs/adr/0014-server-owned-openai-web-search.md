# ADR 0014: Server-owned OpenAI Web Search

- Status: accepted
- Date: 2026-07-16
- Decision owner: baseline application
- Issue: [#149](https://github.com/smallwiselabs/swl-step-by-step/issues/149)
- Final rebaseline: [ADR 0015](0015-final-pre-release-database-rebaseline.md) supersedes this ADR's disposable `0008` amendment and rollback mechanics; its optional domain-restricted Web Search boundary remains accepted
- Builds on: [ADR 0008](0008-pre-release-database-rebaseline.md), [ADR 0012](0012-direct-openai-responses-and-local-history.md), and [ADR 0013](0013-deployment-owned-openai-file-search.md)

## Context

Some forks need current public-web evidence in an otherwise private AI conversation. That need does not justify a generic agent/tool framework, application crawler, local search index, caller-selected browsing policy, or another provider boundary. Web Search must remain an independently disabled fork capability beneath the optional AI module, and enabling it must not weaken persisted authentication, user ownership, entitlement, quota, idempotency, deletion, or content-logging rules.

OpenAI's current guide recommends the Responses API `web_search` tool for new integrations. It supports domain filters and returns inline `url_citation` annotations. The guide documents up to 100 allowed domains, with an allowed domain also covering its subdomains, and says `search_context_size: "medium"` is the balanced default rather than a precise token/source/citation bound. It also says live access is the default when `external_web_access` is omitted. The exact pinned `openai@6.47.0` `WebSearchTool` type predates some newer guide fields but includes `type`, `filters.allowed_domains`, `search_context_size`, and optional location. The baseline uses only that documented, exact-SDK common subset.

## Decision

### Optional deployment policy

- Keep AI as the only public optional-module state. Add private `NUXT_OPENAI_WEB_SEARCH_ENABLED`, which must be exact `false` by default, plus `NUXT_OPENAI_WEB_SEARCH_ALLOWED_DOMAINS` for a deployment-owned comma-separated allowlist. Neither is a per-user setting or public runtime projection.
- AI disabled plus Web Search enabled is invalid. AI enabled plus Web Search disabled remains valid and requires no domain policy. Enabling Web Search requires from one through 100 unique canonical ASCII hostnames.
- Reject schemes, paths, ports, credentials, wildcards, IP literals, whitespace, trailing dots, malformed DNS labels, duplicate entries, and redundant parent/subdomain entries. A configured parent covers its subdomains according to OpenAI's documented filter behavior.
- Runtime readiness validates this configuration and current SQLite availability only. It constructs no provider client while AI is disabled and never searches the web, verifies a domain remotely, or makes a charged provider probe.
- HTTP callers cannot select or override tools, domains, model, search context, live/offline mode, location, source expansion, output limits, or call limits.

### Responses request and combined tool ceiling

When enabled, the existing direct, non-streaming Responses request adds:

```json
{
  "tools": [
    {
      "type": "web_search",
      "filters": {
        "allowed_domains": ["example.com"]
      },
      "search_context_size": "medium"
    }
  ],
  "tool_choice": "auto",
  "parallel_tool_calls": false,
  "max_tool_calls": 1
}
```

The adapter deliberately sends no `user_location`, source/result inclusion, blocked domains, image-search configuration, or unlimited result-token budget. It also omits `external_web_access`: official documentation says omission currently means live access, while exact SDK 6.47.0 does not type that newer field. This is a documented current default that Issue #37 must certify against a real project, not a locally proven provider guarantee.

File Search and Web Search are independently selectable deployment capabilities. If both are enabled, both tools appear in the same request, but `max_tool_calls: 1` remains one total built-in call. The model may therefore use File Search or Web Search on a turn, not both. OpenAI documents that `max_tool_calls` is a total built-in-tool ceiling; raising it to two would not enforce one call of each kind and would weaken the current cost/latency boundary. A fork that needs same-answer corpus-plus-web grounding must adopt and certify a separate reviewed policy.

`store: false`, `background: false`, low reasoning, explicit no-cache mode, the 4,096-token output bound, 60-second timeout, `maxRetries: 0`, SDK logging off, locally authoritative visible history, one active generation, and the 50-reserved-attempt daily quota remain unchanged. Automatic tool choice allows zero search calls and zero citations.

### Output and durable citations

A usable searched text response contains one completed `web_search_call` and one completed `output_text` part with from one through 20 valid `url_citation` annotations. A refusal may remain uncited. URL citations without a completed Web Search call, file citations without a completed File Search call, nonterminal/extra/disabled tool calls, unsupported output items, or searched text without a citation make the result unusable.

Web citations are normalized to:

```json
{
  "type": "web",
  "title": "Safe source title",
  "url": "https://example.com/source",
  "startIndex": 0,
  "endIndex": 12
}
```

Titles are trimmed, control-free, and at most 512 characters. URLs are canonical HTTPS values without credentials or nondefault ports, at most 4,096 characters, and their host must equal an allowed domain or be its subdomain. Offsets must satisfy `0 <= startIndex < endIndex <= text.length`. Exact duplicate URL/span annotations are removed in first-seen order; the same URL may remain at different inline spans. The server never fetches a citation URL.

Any source or page URL that the provider includes in a `search`, `open_page`, or `find_in_page` action is checked against the same HTTPS and allowed-domain policy before the raw action is discarded. This rejects an observable policy violation but does not prove redirect behavior or every effective provider fetch; Issue #37 retains that live certification.

The exact SDK's `output_text` convenience aggregation joins multiple output parts without rebasing annotation offsets. OpenAI does not currently document enough multipart/Unicode offset semantics for the application to repair them safely. The baseline therefore accepts citation-bearing output only when one completed `output_text` part owns the cited text. Issue #37 certifies real provider shapes and offset behavior before enablement.

Regenerated migration `0008` adds the separate `ai_message_web_citations` table with a cascading assistant-message foreign key, ordinal one through 20, bounded title/URL/span checks, a `(message_id, ordinal)` primary key, and exact URL/span uniqueness per message. Keeping separate File and Web tables avoids a nullable generic citation framework. Finalization persists the assistant text and citations atomically; pagination and idempotent replay reload them. Clear, conversation deletion, and account deletion cascade them. Disabling Web Search stops new searches but leaves historical citations until their messages are deleted.

The application never persists or exposes generated queries, search actions, complete consulted-source lists, result documents, tool-call IDs, raw annotations, raw provider envelopes, or provider diagnostic bodies. Citations are not replayed to OpenAI as conversation history.

### Privacy, security, cost, and certification

Retrieved web content is untrusted input. Domain filtering narrows eligible origins but does not establish truth, freshness, safety, or resistance to prompt injection. The baseline exposes no generic action tools, secrets, file mutation, application URL fetcher, or autonomous browsing loop, and deployment policy—not user text—selects domains.

`store: false` disables default Responses application-state storage but is not Zero Data Retention. OpenAI documents default abuse-monitoring retention of up to 30 days subject to stated exceptions, and live Web Search is not HIPAA eligible or covered by a BAA. Prompt-derived search queries may contain private information, and live access may involve third-party sites; exact destination disclosure is not inferred where OpenAI does not document it. Prompts, responses, queries, citation URLs/titles, search envelopes, and raw errors remain excluded from ordinary logs, Sentry events, breadcrumbs, spans, and transaction metadata.

OpenAI currently publishes Web Search at $10 per 1,000 calls ($0.01 per call), plus search-content tokens billed at model rates. At one total built-in call and 50 reserved attempts per user/day, application dispatch permits at most 50 possible Web Search calls, or $0.50 in tool-call fees per user/day before model/search-content tokens. Automatic selection can use fewer. SQLite is not authoritative billing evidence because a timed-out or disconnected dispatch may still execute; the OpenAI dashboard is authoritative.

[Issue #37](https://github.com/smallwiselabs/swl-step-by-step/issues/37) owns live-project certification: model/tool acceptance, live-access behavior, root/subdomain filtering and redirects, query/citation shape, Unicode/multipart offsets, actual charges, provider request IDs/rates/errors/timeouts, retention/ZDR/MAM and HIPAA/BAA posture, third-party disclosure, application/Sentry content exclusion, key rotation, provider outage, and combined File/Web automatic selection. Local and CI tests use deterministic injected fakes and make no provider call or charge.

OpenAI requires inline citations to be clearly visible and clickable whenever Web Search information is displayed. This issue preserves the title, URL, and source span needed by a later renderer but adds no AI UI and therefore does not claim that presentation requirement is certified.

## Pre-release database amendment

The owner confirmed that every current development database and backup remains disposable. Issue #149 therefore repeats Issue #148's narrow exception: use the pinned Drizzle drop/generate workflow to regenerate only the final `0008` from snapshot `0007`, now with both File and Web citation tables, instead of adding `0009`.

Maintenance rejects either superseded exact `0008` identity without mutation. Disposal requires every writer stopped, renewed confirmation that no valuable data exists, and removal of the database plus WAL/SHM/journal sidecars. No runtime or maintenance path performs that deletion automatically. [Issue #151](https://github.com/smallwiselabs/swl-step-by-step/issues/151) then establishes the final clean baseline before persistent staging or backup compatibility; later schema changes return permanently to forward-only migrations.

## Rejected alternatives

- **`web_search_preview` or Chat Completions search models:** rejected because Responses `web_search` is the current recommended integration and owns the required filters and optional search behavior.
- **Caller-selected domains, location, or unrestricted search:** rejected because deployment policy owns privacy, trust, and cost.
- **Blocked-domain policy:** rejected because a reviewed positive allowlist is the narrower baseline boundary.
- **Full source/result inclusion:** rejected because the public contract needs inline citations, not every consulted URL, query, result, or page body.
- **Two total built-in calls:** rejected because the provider does not document a one-call-per-tool constraint and the larger ceiling weakens cost/latency control.
- **Application crawling, caching, local indexing, or a generic tool/agent framework:** rejected as unrelated maintenance and security surface.
- **A generic citation table or UI in this issue:** rejected because two known citation kinds can remain explicit and no AI UI exists.
- **A forward `0009`:** rejected only for this explicitly confirmed disposable window; Issue #151 closes the exception.

## Consequences and residual risks

- Disabled AI and Web Search require no OpenAI credential, domain list, client, or provider call.
- Enabling Web Search adds current-web grounding, variable latency/token cost, third-party disclosure, untrusted-content, provider-availability, and citation-correctness risks.
- Domain allowlisting is a provider request policy, not proof that every effective request/redirect or citation remains within policy; #37 must establish real behavior.
- Automatic choice may skip search. When File and Web Search are both enabled, the one-call ceiling permits only one source system per turn.
- Disabling Web Search is the immediate provider-use rollback. Historical local citations remain until their messages are deleted. Before #151, code rollback against the amended ledger requires stopped-writer disposal/reinitialization of the confirmed-valueless database rather than a down migration.

## Evidence

- [OpenAI Web Search guide](https://developers.openai.com/api/docs/guides/tools-web-search)
- [OpenAI Web Search domain filtering](https://developers.openai.com/api/docs/guides/tools-web-search#domain-filtering)
- [OpenAI Web Search live-access control](https://developers.openai.com/api/docs/guides/tools-web-search#live-internet-access)
- [OpenAI data controls](https://developers.openai.com/api/docs/guides/your-data)
- [OpenAI pricing](https://developers.openai.com/api/docs/pricing)
- [GPT-5.6 Luna model tools](https://developers.openai.com/api/docs/models/gpt-5.6-luna)
- [`openai/openai-node` v6.47.0](https://github.com/openai/openai-node/tree/v6.47.0)
- [Exact v6.47.0 Web Search type](https://github.com/openai/openai-node/blob/v6.47.0/src/resources/responses/responses.ts#L8486-L8522)
- [Exact v6.47.0 output aggregation](https://github.com/openai/openai-node/blob/v6.47.0/src/lib/ResponsesParser.ts#L264-L279)
