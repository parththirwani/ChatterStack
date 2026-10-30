# Auto compaction for chat context

Status: implementation plan, researched 2026-10-28. This document is a brief for the implementation agent. It does not change chat behavior.

## Goal

Let a conversation continue when its model input approaches the selected model's context limit. Keep the complete transcript in the UI and database. Send the model a compacted working context consisting of a summary of older turns, a small verbatim recent tail, and the new turn. The summary must preserve user instructions, decisions, unresolved tasks, named entities, and references needed to continue. A model switch must still work.

Success means a long chat stays usable without silent loss of the current task, stays within the model's input budget, and does not charge or save hidden compaction calls incorrectly.

## What the labs publish

| System | Published mechanism | Lesson for ChatterStack |
| --- | --- | --- |
| [OpenAI Responses](https://developers.openai.com/api/docs/guides/compaction) | Automatic compaction at a configured token threshold, or an explicit `/responses/compact` call. It returns opaque encrypted state and tells clients to pass the compacted output forward as returned. | Trigger before overflow and treat a provider generated compacted state as its own format. OpenAI's opaque item cannot be used as a portable summary for ChatterStack's other models. |
| [Anthropic Claude](https://platform.claude.com/docs/en/build-with-claude/compaction-threshold) | Server side threshold compaction writes a summary block and continues the request. [On demand compaction](https://platform.claude.com/docs/en/build-with-claude/compaction) can keep recent turns verbatim and can run in the background. Anthropic also [clears old tool results](https://platform.claude.com/docs/en/build-with-claude/context-editing) separately. | Keep a verbatim tail and compact at complete turn boundaries. Separate summarization from deterministic removal of stale, bulky material. |
| [Google Gemini CLI](https://github.com/google-gemini/gemini-cli/blob/main/packages/core/src/context/chatCompressionService.ts) | Its open source implementation defaults to compression at 50% of model context, keeps part of recent history, rolls an earlier snapshot into the next one, checks the summary for missing details, and rejects an inflated result. | Use a fraction of the available budget, merge successive snapshots, validate the result, and measure tokens after compaction. This describes Gemini CLI, not a built-in Gemini API compaction feature. |

These are public interfaces and code, not claims about the labs' private ChatGPT, Claude, or Gemini product internals. [Gemini context caching](https://ai.google.dev/gemini-api/docs/caching) saves repeated-input cost; it does not replace summary compaction or extend the model's context limit.

## Current code and constraints

- `apps/web/src/app/api/chat/route.ts` loads every prior message from Redis or Postgres, resolves historical attachments, adds the new turn and optional RAG context, then calls `createCompletion`. It has no model-context budget or compaction step.
- `apps/web/src/lib/api/chat/openrouter.ts` sends OpenAI-style chat completions to OpenRouter. `apps/web/src/config/models.ts` records each model's `contextLength` and `maxOutputTokens`, while `maxTokensFor` in the OpenRouter adapter decides the actual requested output cap. The prompt formatter also inserts system and skill instructions.
- The route reserves daily tokens from an estimate of *full* history before the turn lock is ready. It later records an estimate of the model call. A new compaction call must be included in both the reservation and reconciliation. Reserving against the old full history after compaction would reject turns that should fit.
- `apps/web/prisma/schema.prisma` has `Conversation` and `Message`, but no context snapshot. `apps/web/src/lib/api/chat/conversation-turns.ts` orders saves only within one server process, with a 30 second wait limit. Multiple instances can race.
- Retry removes the last stored exchange only if a replacement answer exists. RAG reads raw conversation history. Council stage 1 sends history to each member; stage 3 also inserts history into the chair prompt. Both need budgeting. Attachments may contain large inline payloads or document references; a text-only estimate does not account for image or PDF tokens.

## Proposed design

### 1. One canonical history, one model view

Keep `Message` rows and the UI transcript unchanged. Add a `ConversationContextSnapshot` record keyed by conversation, with `summaryText`, `throughMessageId`, `sourceHash`, `schemaVersion`, `summaryModelId`, `inputTokensBefore`, `inputTokensAfter`, `createdAt`, and `updatedAt`. The boundary is the last **completed exchange** included in the summary. Use stable message IDs and ordering by `(createdAt, id)`; a timestamp alone is not a safe boundary. Delete snapshots with their conversation.

For a new model request, build the model view as current system and skill instructions, a clearly marked historical summary, verbatim messages after the boundary, and the current user message. The summary is lower trust than system instructions. Do not insert it as a system instruction. Keep RAG retrieval separate; it may consult the full saved transcript, while the model sees a bounded RAG excerpt. Never rewrite transcript rows or put the summary into a visible assistant reply.

Choose the cut at an exchange boundary and keep at least the last two completed exchanges verbatim. Keep the current user turn and its attachments verbatim. Older attachment *payloads* must not be copied into a summary prompt. Include safe text and file names where useful, and note that older media details may require reattachment. If an older document is still needed for the current request, resolve it from the document store on demand within the budget. Do not summarize base64 data or store it in the snapshot.

### 2. Budget before the provider call

Make a shared prompt-budget helper that measures the **rendered** request, including system prompt, active skills, summary, recent history, current text, RAG context, and attachment allowance. Use the selected model's `contextLength`; reserve the actual `max_tokens` request from `openrouter.ts` and a safety margin. Start with a compaction trigger at 65% of the remaining input budget, capped at 80,000 input tokens, and target a post-compaction context below 35%. These are rollout defaults to tune from measured traffic, not values supplied by a provider. Never allow input plus requested output to exceed the registered context limit. For council, check each member and the chair against its own limit and full stage prompt; use the smallest safe history view or separate views per model.

Token estimates differ across providers and multimodal inputs. Use an estimator for early triggering, actual OpenRouter usage when available for calibration, and a conservative allowance for media. If the full current turn alone cannot fit, return a clear error asking the user to shorten it or use a larger-context model. Do not silently truncate that turn. If the provider reports a context-length error despite the estimate, perform one bounded compaction and retry once before returning an error; avoid loops and duplicate streamed text.

### 3. Generate and commit a snapshot

When the threshold is crossed, summarize the existing snapshot plus older completed turns up to the new cut. Ask the summarizer for a compact, structured state with current user goal, durable instructions and preferences, established facts with provenance, decisions and rationale, unresolved work, and details that must remain exact such as identifiers or code paths. Tell it to distinguish facts from guesses and omit secrets, credentials, raw attachment bytes, and stale intermediate attempts. Treat conversation text as data, never as instructions to the compactor outside the task of summarizing it. Use a fixed, configured utility model with a known cost and context limit; split or hierarchically summarize if the source cannot fit its own context window.

Validate that the output is nonempty, below its token budget, smaller than the source, and contains the required sections. Preserve old snapshot and full history if generation or validation fails. Compare key user constraints and active task facts against the source in evaluation tests; do not claim that syntax checks prove factual fidelity. Persist the new snapshot with a transaction or compare-and-swap against the source boundary and hash so a concurrent turn or retry cannot attach it to the wrong history. On retry, invalidate a snapshot that includes the replaced exchange, or generate the retry from the unaffected prefix and replace the snapshot only after successful persistence. Repeated compactions must incorporate the previous snapshot.

### 4. Make charging and failure behavior explicit

Move planning of model context and token reservation inside the serialized turn, after the latest history is known. Reserve for the projected answer **and** any summarizer or verification calls, then reconcile with provider-reported usage where available; otherwise use measured estimates. A failed or stopped turn still settles usage for calls already made. A failed compaction must not save a snapshot or alter the transcript. If enough room remains, continue with the previous view; if it cannot safely fit, return a useful error without sending an over-limit provider request. The first release can skip a separate verification model call and use offline fidelity tests; add a live verification call only if evaluation shows it earns its cost and latency.

### 5. Concurrency, visibility, and rollout

The current in-process turn queue is insufficient to protect a persistent snapshot across server instances. Use a database-backed per-conversation lock or optimistic version check for snapshot and message writes; verify retry and queued-turn behavior across two workers. A summary used for a request should match the boundary and history version that request read.

Record metadata only in observability by default: conversation ID, model, trigger reason, before and after input tokens, summary tokens, latency, provider usage, failure reason, and number of compactions. Follow the existing content-logging controls for any text. Add a small nonintrusive UI marker when older context was compacted, with copy that says older turns remain in the transcript but may not all be in the model's active context. A user can still inspect and copy the full history.

Roll out behind a server flag. First collect would-trigger measurements without changing prompts; then enable on internal accounts, then a small percentage of chats. Compare context-limit errors, answer continuity on long chats, token cost, latency to first answer, and summary failure rates. Provide a kill switch that bypasses snapshot use for new turns without deleting transcript history.

## Implementation order for the agent

1. Branch from the latest `origin/dev` as `feature/auto-compaction`. Map the chat, retry, council, RAG, rate-limit, and attachment paths again before editing, since this plan may age. Commit and push checkpoints.
2. Add the snapshot schema and migration, stable boundary queries, and an atomic snapshot update that detects stale history. Keep full `Message` records as the source of truth.
3. Extract prompt rendering and budget calculation so the estimate covers what `openrouter.ts` really sends. Expose the actual requested output cap. Add unit cases for model switches, large system/skill prompts, RAG, and media allowance.
4. Implement the compactor and model-view builder. Preserve two completed exchanges, merge prior snapshots, bound summarizer input and output, and reject invalid or larger summaries. Add a configurable trigger and server flag.
5. Wire regular chat and retry through the new view. Move the rate-limit reservation into the turn's latest-history path and reconcile every provider call. Keep Stop and partial-answer persistence working.
6. Wire council stage 1 and chair separately. Budget their expanded prompts and expose a clear failure when stage content cannot fit. Check that a council member failure does not hide an overall context failure.
7. Add observability and the UI marker. Run a shadow phase, then limited rollout. Document operational defaults and a kill switch.
8. Run the acceptance checks below, review the diff for secrets and generated files, open a PR against `dev`, and include tests and known limits. Do not merge it.

## Acceptance checks

- A long seeded chat crosses the trigger, creates one snapshot, sends the summary plus two recent exchanges, and leaves all UI and database messages intact. Another long turn updates the same snapshot without losing earlier durable facts.
- Switching from a large-context model to a smaller one rebuilds a safe model view before the call. A short current turn still fits; an oversized current attachment produces a clear error.
- Retry of a turn inside or after a snapshot boundary never feeds the removed answer back into the model and never retains it in a snapshot. Failed or stopped retries keep the old saved answer under current behavior.
- Queued or simultaneous turns on separate server instances cannot overwrite a newer snapshot or compute it from stale history.
- Council member and chair prompts each fit their own budgets, including system instructions, stage output, and skill text. RAG additions cannot push an otherwise safe prompt past the limit.
- Empty, malformed, inflated, timed-out, or aborted summarizer output leaves the transcript and last valid snapshot unchanged. The route settles tokens for calls actually made and never loops on provider context errors.
- A representative long-chat evaluation set tests recall of user constraints, exact named details, unfinished tasks, and corrections before and after compaction. Record baseline versus compacted answer quality, latency, and total provider tokens before enabling the flag broadly.

## Known limits and later work

Summaries can omit details. The transcript remains available, but older text is not automatically reinserted into the model view after compaction. Retrieval of specific old turns by message ID, manual "refresh context," and provider-native compaction can be considered after the portable layer is stable. Native OpenAI and Anthropic compaction would need separate API paths and state formats; they cannot simply be passed through the current OpenRouter chat-completions request. Prompt caching may reduce cost, but cached tokens still occupy context, so it is a separate optimization.
