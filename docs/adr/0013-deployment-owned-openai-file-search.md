# ADR 0013: Deployment-owned OpenAI File Search

- Status: accepted
- Date: 2026-07-16
- Decision owner: baseline application
- Issue: [#148](https://github.com/smallwiselabs/swl-step-by-step/issues/148)
- Final rebaseline: [ADR 0015](0015-final-pre-release-database-rebaseline.md) supersedes this ADR's disposable `0008` amendment and rollback mechanics; its optional deployment-owned File Search boundary remains accepted
- Builds on: [ADR 0008](0008-pre-release-database-rebaseline.md) and [ADR 0012](0012-direct-openai-responses-and-local-history.md)

## Context

Some forks need AI answers grounded in a stable reference corpus, but the baseline should not make every fork maintain an embeddings pipeline, vector database, generic retrieval abstraction, or end-user file system. The selected baseline use case is a deployment-owned, read-only corpus that changes through an explicit operator workflow rather than ordinary conversation requests.

OpenAI File Search is a hosted Responses tool. OpenAI owns chunking, embeddings, hybrid semantic/keyword search, and tool execution after files have been attached to a vector store. It still introduces persistent provider objects, per-call and storage charges, provider retention, citation normalization, and an operational deletion boundary.

The corpus is reference material, not conversation authority. Every conversation remains private and user-owned in SQLite. Family-plan membership may grant entitlement but never access to another person's conversation, and the shared corpus must not contain private per-user application data.

## Decision

### Optional runtime capability

- Retain the AI module as the only public optional-module state. Add private `NUXT_OPENAI_FILE_SEARCH_ENABLED`, which must be exact `false` by default. File Search is subordinate to AI rather than a new public module or UI state.
- AI disabled plus File Search enabled is invalid. AI enabled plus File Search disabled preserves the exact tool-free Issue #33 request and requires no vector store. Enabling both additionally requires one trimmed, bounded `NUXT_OPENAI_FILE_SEARCH_VECTOR_STORE_ID`.
- Bind each persistent application environment to its own OpenAI project. Project resources and service accounts are isolated to that project. One vector store is active in application configuration; blue/green replacement may temporarily retain an old and new store in the same project.
- Runtime readiness validates configuration and SQLite only. It never retrieves a store, lists files, performs a search, or otherwise contacts OpenAI.

### Responses request and output

When File Search is enabled, the existing non-streaming, locally authoritative request adds only:

```json
{
  "tools": [
    {
      "type": "file_search",
      "vector_store_ids": ["<server-configured-id>"],
      "max_num_results": 10
    }
  ],
  "tool_choice": "auto",
  "parallel_tool_calls": false,
  "max_tool_calls": 1
}
```

`store: false`, `background: false`, low reasoning, the 4,096-token output limit, 60-second timeout, `maxRetries: 0`, SDK logging off, local idempotency, the 50-attempt daily quota, and one owner-level concurrent generation remain unchanged. Automatic tool choice permits an ungrounded answer when the model decides search is unnecessary. A domain-specific fork may make a different reviewed decision, but the baseline does not charge every greeting or unrelated turn.

Ten results and one total built-in tool call are application cost/latency bounds, not provider recommendations. [ADR 0014](0014-server-owned-openai-web-search.md) retains that ceiling across both tools: when both are enabled, the model can use File Search or Web Search on one turn, not both.

The application does not request `include: ["file_search_call.results"]`; those results can contain queries, chunks, scores, attributes, and corpus text that the public response does not need. A completed response may contain zero or one completed File Search call. File citations require that completed call. Other or nonterminal tool items, URL citations without ADR 0014's enabled completed Web Search call, malformed provider identifiers/titles, conflicting citation identity, or more than ten unique file sources make the response unusable.

OpenAI's current guide and exact SDK disagree about the practical meaning of a file citation's `index`, and the guide repeats citations. The adapter therefore ignores the index, validates provider file IDs only transiently, deduplicates in first-seen order, and returns only `{ type: "file", title }`. It never persists or exposes a file ID, vector-store ID, query, chunk, score, attribute, tool-call ID, raw envelope, or provider result.

### Durable citations and deletion

Regenerated migration `0008` adds `ai_message_file_citations` with a cascading assistant-message foreign key, ordinal one through ten, a bounded safe title, a `(message_id, ordinal)` primary key, and unique title per message. Assistant finalization inserts visible text and citations in one SQLite transaction. Listing and idempotent replay reload the same citations through a bounded query. User messages and uncited/refused assistant messages expose an empty array.

Clear, conversation deletion, and account deletion remove local citations through message cascade. They never delete the deployment corpus: that shared provider resource is independent of one person's private history. Deleting or replacing a corpus does not rewrite already-visible local messages or their historical source titles.

No local File Search call counter is authoritative. A timed-out or disconnected request may still run and incur a charge. The existing attempt quota plus the one-call request ceiling bounds application dispatch; Issue #37 reconciles actual usage with the OpenAI project dashboard.

### Operator-owned corpus lifecycle

Ordinary application routes cannot create, upload, list, mutate, or delete corpus resources. A separately invoked operator command uses a distinct project service-account key that is never declared in Nuxt runtime configuration and is read only when the command runs.

- `prepare` validates a versioned manifest and contained regular files, creates one marked vector store and uniquely owned File objects, uploads and attaches the corpus, polls with an application deadline, verifies terminal counts, and writes a private local receipt. Known partial resources are compensated without automatic retries.
- `verify <store-id>` inspects only the named managed store with bounded pagination.
- `delete <store-id> --confirm <same-id>` verifies the management marker, deletes the store and its operator-created File objects, and reports incomplete cleanup without hiding residual state.
- Replacement is blue/green: prepare, configure/deploy the new ID, certify it, and explicitly delete the old store. The command never mutates the configured store in place, edits `.env`, deploys, or deletes an old store automatically.

Application ingestion policy permits at most 100 unique safe files, 50 MiB each, 500 MiB total, and 30 minutes of indexing. Manifest paths must remain beneath the manifest directory and resolve to regular non-symlink files. Provider mutation retries remain zero because an ambiguous retry can create duplicate persistent objects. The SDK's unbounded polling helpers are not used; every request and operation has an application-owned deadline.

The runtime service account is restricted to the Responses capability needed by the app. The operator service account additionally needs the exact Files/vector-store permissions required by the command. Both belong to the same environment-specific project. Exact dashboard permission behavior belongs to Issue #37 because no real account is connected during implementation.

## Data controls, costs, and certification

`store: false` controls Responses application-state storage; it does not delete files/vector stores or mean zero provider retention. OpenAI currently documents default abuse-monitoring retention of up to 30 days, persistent Files/vector-store application state until deletion, and no ZDR eligibility for those resource endpoints. The corpus must therefore contain deployment-approved reference material only.

Current published pricing is $2.50 per 1,000 File Search calls plus $0.10/GB/day of vector storage after the listed free allowance, while model tokens remain separately billed. Raw input size does not prove final indexed-storage size. Project budgets and alerts are defense in depth rather than application authorization or a guaranteed hard stop.

[Issue #37](https://github.com/smallwiselabs/swl-step-by-step/issues/37) owns real-project certification: project/resource isolation, runtime and operator permissions, model/tool acceptance, exact request/citation behavior, storage and call billing, pagination, provider errors/rates, deletion/eventual consistency, dashboard usage, retention/ZDR/MAM posture, and absence of private content from deployed logs and Sentry.

## Pre-release database amendment

The owner explicitly confirmed that no database or backup created from the current development package contains valuable data. Issue #148 therefore uses the pinned Drizzle workflow to drop and regenerate the last `0008` migration from snapshot `0007` with the complete AI-plus-citation schema instead of adding `0009`.

This changes the packaged `0008` identity. [ADR 0014](0014-server-owned-openai-web-search.md) repeats the same approved exception once more for durable Web citations. Maintenance must reject either superseded exact identity without mutation; an operator may discard it only with every writer stopped and after confirming again that it contains no valuable data, removing the database and WAL/SHM/journal sidecars together. No runtime or maintenance code deletes it automatically. [Issue #151](https://github.com/smallwiselabs/swl-step-by-step/issues/151) performs the final full pre-release rebaseline after #148 and #149 and before backup or persistent staging establishes a durable compatibility boundary.

## Rejected alternatives

- **OpenAI Embeddings plus an application vector database:** rejected because it adds chunking, indexing, vector-store selection, synchronization, backup, deletion, tuning, and operational maintenance without a current need.
- **A generic RAG, provider, or tool framework:** rejected because one OpenAI-specific managed retrieval feature does not justify speculative translation and orchestration layers.
- **User-owned or continuously mutating corpora:** rejected because they add private-resource authorization, upload, quota, indexing, and deletion lifecycles unrelated to the deployment-owned baseline need.
- **Forced File Search:** rejected because it charges and adds latency to turns that may not need the corpus.
- **Provider-managed conversation history:** rejected by ADR 0012; the corpus does not change SQLite's authority over visible history.
- **Cloudflare AI Gateway:** rejected by ADR 0012; it does not own OpenAI File/vector-store lifecycle and would add another provider boundary.
- **A forward `0009`:** normally preferred after valuable initialized data exists, but rejected for this explicitly disposable development boundary. Issue #151 establishes the final clean baseline after the remaining optional schema work.

## Consequences and residual risks

- A disabled fork remains healthy without an OpenAI key, project, vector store, provider client, or provider call.
- File Search reduces application retrieval maintenance but creates OpenAI storage cost, lifecycle, availability, retention, and vendor coupling.
- Automatic selection does not guarantee every answer is corpus-grounded. Title-only citations identify sources but do not expose passages or downloads.
- Blue/green replacement temporarily stores two corpora. Indeterminate mutations can require dashboard reconciliation. Provider deletion may be eventually consistent, and historical local citation titles remain until their messages are deleted.
- Disabling File Search immediately removes the tool from new requests but does not delete the corpus. Code rollback against an initialized amended `0008` requires disposal/reinitialization of the confirmed-blank database; provider resources require an explicit operator delete.

## Evidence

- [OpenAI File Search guide](https://developers.openai.com/api/docs/guides/tools-file-search)
- [OpenAI Retrieval and vector-store guide](https://developers.openai.com/api/docs/guides/retrieval)
- [OpenAI Responses create reference](https://developers.openai.com/api/reference/resources/responses/methods/create)
- [OpenAI data controls](https://developers.openai.com/api/docs/guides/your-data)
- [OpenAI pricing](https://developers.openai.com/api/docs/pricing)
- [OpenAI project and service-account isolation](https://help.openai.com/en/articles/9186755-managing-your-work-in-the-api-platform-with-projects)
- [GPT-5.6 Luna model tools](https://developers.openai.com/api/docs/models/gpt-5.6-luna)
- [`openai/openai-node` v6.47.0](https://github.com/openai/openai-node/tree/v6.47.0)
- [`openai/openai-responses-starter-app` at `0fae283f`](https://github.com/openai/openai-responses-starter-app/tree/0fae283f12ca3f71015cd9fa3f9b28df97e9ae21)
- [`openai/openai-cookbook` at `20793784`](https://github.com/openai/openai-cookbook/tree/20793784ac467f06ed67f3e3e9349dc9596894e0)
- [`vercel/ai` at `e8043b4f`](https://github.com/vercel/ai/tree/e8043b4f0b28b129feefa5b832aa5c5f5d8e3ef1)
- [`langchain-ai/langchainjs` at `ee76ea03`](https://github.com/langchain-ai/langchainjs/tree/ee76ea0347fb611153e5ec7d0e70fa405f5293a3)
