# Auto compaction: implementation notes

Status: implemented behind `CHAT_COMPACTION_MODE`. See
[auto-compaction-plan.md](auto-compaction-plan.md) for the original research
and design brief.

## Behavior

A conversation always keeps every `Message` row and the full UI transcript.
Only the **model view** for a request can be compacted:

1. Before the provider call, the rendered request is measured (system prompt,
   security policy, active skills, history, RAG excerpt, current message and
   attachment allowance) against the selected model's context window minus its
   requested output cap and a safety margin.
2. For Council, the smallest member/chair input budget is used, and each stage
   is checked against its own model before sending.
3. When the request crosses `min(65% of the input budget, 80,000 tokens)`, the
   older completed turns are summarized. The last `COMPACTION_RECENT_EXCHANGES`
   (default 2) completed exchanges and the current message stay verbatim.
4. The summary is a user-role block titled **Earlier conversation summary**.
   It is explicitly marked as background data, not instructions. It is never
   inserted as a system message and never written as an assistant reply.
5. The summary covers everything up to a completed exchange boundary. Each new
   compaction merges the previous summary with only the messages after its
   boundary, so older durable facts roll forward.

The current user message is never truncated. If it cannot fit, or if
compaction cannot bring the request under budget, the route returns an
actionable error before calling the provider.

## Storage

`ConversationContextSnapshot` is one row per conversation:

- `summaryText`, `throughMessageId`, `sourceHash`, `version`, `schemaVersion`
- `summaryModelId`, `inputTokensBefore`, `inputTokensAfter`, `summaryTokens`

`throughMessageId` refers to a saved `Message` row, not a timestamp. Reads use
`(createdAt, id)` order and verify the source hash and schema version before
reusing a summary. Snapshot writes compare-and-swap on `version`; a
concurrent turn that built its summary from different history cannot overwrite
a newer one. The losing turn still uses its own in-memory summary for that
request. Deleting a conversation deletes its snapshot (cascade).

A successful retry that removes the exchange a snapshot ended on deletes the
unusable snapshot. A failed retry leaves the saved snapshot intact. Retries
after the boundary do not affect it.

## Failure behavior

- Empty, malformed, section-less, over-long or non-shrinking summaries are
  rejected. The route falls back to the pre-existing view when it fits.
- A summarizer timeout or abort leaves the transcript and the previous snapshot
  unchanged. An attempted summarizer request is included in the reply's token
  analytics.
- The soft trigger does not reject a turn: below the hard budget, the full
  history is still used if a summary is unavailable.
- `off` bypasses snapshot use for new turns (kill switch) without deleting
  anything.

## Configuration

| Variable | Default | Meaning |
| --- | --- | --- |
| `CHAT_COMPACTION_MODE` | `off` | `off`, `shadow` or `on`. |
| `COMPACTION_MODEL` | `openai/gpt-4o-mini` | Fixed utility model for summaries. |
| `COMPACTION_TRIGGER_RATIO` | `0.65` | Share of the input budget that triggers compaction. |
| `COMPACTION_TRIGGER_MAX_TOKENS` | `80000` | Never wait for a larger window to fill. |
| `COMPACTION_RECENT_EXCHANGES` | `2` | Completed exchanges kept verbatim; minimum 1. |

The summary output is capped at 1,600 tokens and the summarizer input is chunked
to fit its own context window. Successive chunks roll into one summary.

## Observability

Each request records `chatterstack.context_compacted`,
`chatterstack.context_tokens_before` and `chatterstack.context_tokens_after` on
its root span. Summarizer calls use the `context-compaction` span and follow the
existing OpenObserve content-logging controls. The client shows a small
"Older turns summarized" note on the reply, with before/after input tokens in
its tooltip; the note is live-session only.

## Known limits

- Concurrent turns on different instances are serialized for snapshot writes
  but message and Redis-cache writes still use the existing per-instance turn
  queue. Message rows are append-only, so the transcript cannot be corrupted;
  the cache can briefly lag.
- Summaries can omit details. Older text is not automatically reinserted into
  the model view. The transcript stays available, but there is no
  "refresh context" or retrieval-by-message-id control yet.
- Image/PDF token estimates are conservative allowances, not provider-exact
  multimodal counts. The safety margin absorbs the common cases.
- The summarizer is an extra paid call. The UI analytics for the reply include
  it in the reported input/output totals.
