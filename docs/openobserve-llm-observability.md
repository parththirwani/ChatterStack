# OpenObserve LLM observability

Every model call in ChatterStack can be recorded to an OpenObserve stream so
latency, token use, cost and failures can be analysed without reading
application logs. The client is `src/lib/observability/openobserve.ts`; the
wrapper that produces a record per call is `src/lib/observability/trace-llm-call.ts`.

Configuration lives in `.env.example` (`OPENOBSERVE_URL`, `OPENOBSERVE_ORG`,
`OPENOBSERVE_USER` / `OPENOBSERVE_PASSWORD`, or `OPENOBSERVE_AUTH`,
`OPENOBSERVE_STREAM`, `OPENOBSERVE_LOG_CONTENT`). With no URL or no credentials
the client does nothing at all.

## The stream

Records are POSTed to `POST {OPENOBSERVE_URL}/api/{OPENOBSERVE_ORG}/{stream}/_json`
with Basic auth, as a JSON array. OpenObserve creates the stream on the first
write, and it infers each field's type from what arrives first - a field that is
missing in the very first record can end up typed wrongly. Send one complete
sample first (or pre-create the stream mapping) using this record:

```json
{
  "_timestamp": 1761523200000000,
  "timestamp": "2026-10-27T00:00:00.000Z",
  "trace_id": "6f1d2f2c-0000-4000-8000-000000000001",
  "span": "completion",
  "user_id": "cm0abc1230000abcd0ef00001",
  "conversation_id": "0e7ba32e-05b0-477d-8e30-2bf0a849649e",
  "provider": "openrouter",
  "model": "openai/gpt-6.1-sol",
  "thinking_level": "medium",
  "status": "ok",
  "stopped": false,
  "duration_ms": 2143,
  "time_to_first_token_ms": 431,
  "input_tokens": 1200,
  "output_tokens": 340,
  "estimated": false,
  "cost_usd": 0.0058,
  "finish_reason": "stop",
  "message_count": 4,
  "attachment_count": 0,
  "rag_used": true
}
```

`_timestamp` is in **microseconds** (that is what OpenObserve sorts and filters
on); `timestamp` is a readable ISO copy. Spans written today: `completion`,
`council-member-answer`, `council-ranking`, `council-chair`, `title-generation`,
`embedding`, `embeddings`.

Optional: add `"pricing"` fields per model yourself, or extend
`src/config/models.ts` - the title model (`openai/gpt-5.6-luna`) and the
embedding model are not priced there, so their records carry no `cost_usd`.

## Queries

OpenObserve's SQL is DataFusion-flavoured. Replace `llm_calls` with your
`OPENOBSERVE_STREAM` if you changed it. The same file in machine-readable form:
[`openobserve-llm-queries.json`](openobserve-llm-queries.json).

### p50 / p95 latency per model

```sql
SELECT model,
       COUNT(*)                                                          AS calls,
       ROUND(AVG(duration_ms), 1)                                        AS avg_ms,
       ROUND(approx_percentile_cont(duration_ms, 0.50), 1)               AS p50_ms,
       ROUND(approx_percentile_cont(duration_ms, 0.95), 1)               AS p95_ms
FROM llm_calls
GROUP BY model
ORDER BY calls DESC
```

### Error rate per model per day

```sql
SELECT DATE_TRUNC('day', TO_TIMESTAMP(_timestamp / 1000000))            AS day,
       model,
       COUNT(*)                                                          AS calls,
       SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END)                 AS errors,
       ROUND(100.0 * SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) / COUNT(*), 2) AS error_pct
FROM llm_calls
GROUP BY day, model
ORDER BY day DESC, error_pct DESC
```

### Failure kinds (and how often users hit Stop)

```sql
SELECT error_type, COUNT(*) AS n
FROM llm_calls
WHERE status <> 'ok'
GROUP BY error_type
ORDER BY n DESC
```

```sql
SELECT status,
       COUNT(*)                                  AS calls,
       SUM(CASE WHEN stopped THEN 1 ELSE 0 END)  AS stopped,
       SUM(CASE WHEN rag_used THEN 1 ELSE 0 END) AS with_rag
FROM llm_calls
GROUP BY status
```

### Tokens and cost per day

```sql
SELECT DATE_TRUNC('day', TO_TIMESTAMP(_timestamp / 1000000)) AS day,
       COUNT(*)                    AS calls,
       SUM(input_tokens)           AS input_tokens,
       SUM(output_tokens)          AS output_tokens,
       ROUND(SUM(cost_usd), 6)     AS cost_usd,
       SUM(CASE WHEN estimated THEN 1 ELSE 0 END) AS estimated_calls
FROM llm_calls
GROUP BY day
ORDER BY day DESC
LIMIT 90
```

### Cost per model, and per user

```sql
SELECT model, ROUND(SUM(cost_usd), 6) AS cost_usd, COUNT(*) AS calls
FROM llm_calls
WHERE cost_usd IS NOT NULL
GROUP BY model
ORDER BY cost_usd DESC
```

```sql
SELECT user_id, ROUND(SUM(cost_usd), 4) AS cost_usd, COUNT(*) AS calls
FROM llm_calls
WHERE user_id IS NOT NULL
GROUP BY user_id
ORDER BY cost_usd DESC
LIMIT 50
```

### Council stage breakdown

```sql
SELECT span,
       model,
       COUNT(*)                                            AS calls,
       ROUND(AVG(duration_ms), 1)                          AS avg_ms,
       ROUND(approx_percentile_cont(duration_ms, 0.95), 1) AS p95_ms,
       SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END)   AS errors
FROM llm_calls
WHERE span LIKE 'council%'
GROUP BY span, model
ORDER BY span, calls DESC
```

Whole council runs, from the trace id that joins the stages:

```sql
SELECT trace_id,
       COUNT(*)              AS stages,
       COUNT(DISTINCT model) AS models,
       SUM(duration_ms)      AS model_ms,
       MAX(_timestamp) - MIN(_timestamp) AS spread_us
FROM llm_calls
WHERE span LIKE 'council%'
GROUP BY trace_id
ORDER BY model_ms DESC
LIMIT 50
```

### Time to first token

```sql
SELECT model,
       thinking_level,
       ROUND(approx_percentile_cont(time_to_first_token_ms, 0.50), 1) AS p50_ttfb_ms,
       ROUND(approx_percentile_cont(time_to_first_token_ms, 0.95), 1) AS p95_ttfb_ms
FROM llm_calls
WHERE time_to_first_token_ms IS NOT NULL
GROUP BY model, thinking_level
ORDER BY model, thinking_level
```

### One chat request, end to end

```sql
SELECT timestamp, span, model, status, duration_ms, time_to_first_token_ms,
       input_tokens, output_tokens, cost_usd, finish_reason
FROM llm_calls
WHERE trace_id = 'paste-a-trace-id-here'
ORDER BY _timestamp
```

## Importing

OpenObserve dashboard exports are tied to the build's JSON schema, so no
dashboard file is shipped here. Import instead with the query set:

1. Logs → explore → pick the stream → run each query above → **Save view**
   (they then appear in the sidebar and can be pinned to a dashboard).
2. Or create the saved views through the API, one call each:

```bash
curl -sS -u "$OPENOBSERVE_USER:$OPENOBSERVE_PASSWORD" -X POST \
  "$OPENOBSERVE_URL/api/$OPENOBSERVE_ORG/search/<stream>/_save" \
  -H 'Content-Type: application/json' \
  -d '{"query_fn":"sql","query":"<query above>","name":"<panel name>","streaming_url":"","type":"logs"}'
```

The panels worth having first, in this order: p50/p95 latency per model, error
rate per model per day, tokens and cost per day, council stage breakdown, and
time to first token.

## Traces

`OPENOBSERVE_TRACES=true` adds OTLP traces next to the records: one trace per
chat request in OpenObserve → Traces (stream `OPENOBSERVE_TRACE_STREAM`,
default `default`). The trace id is the request's `trace_id` with the dashes
removed, so a record and its trace can be matched.

```
chat <model> | council <model>      root: question, final answer, outcome
├─ rag.retrieve                     duration, rag_chunks, rag_context_found
├─ completion <model>               or council-member-answer / council-ranking / council-chair
├─ title-generation <model>
└─ embedding | embeddings <model>
```

Span attributes: `gen_ai.operation.name`, `gen_ai.provider.name`,
`gen_ai.request.model`, `gen_ai.usage.input_tokens`,
`gen_ai.usage.output_tokens`, `gen_ai.response.finish_reasons`,
`gen_ai.conversation.id`, `user.id`, and `chatterstack.*` for cost, time to
first token, stage, thinking level, RAG use, Stop and answer length. A user's
Stop has span status OK with `chatterstack.stopped=true`; failures have status
ERROR with the provider's message.

With `OPENOBSERVE_LOG_CONTENT=true`, spans also carry the content:
`gen_ai.input.messages` / `gen_ai.output.messages` (JSON) and the flattened
`gen_ai.prompt.N.role|content`, `gen_ai.completion.0.role|content`. Each message
is cut to 16,000 characters; file parts appear as `[+N file part(s)]`.

## Privacy

Records hold ids, counts, durations and costs only. Prompts and answers are
never included unless `OPENOBSERVE_LOG_CONTENT=true`, in which case each side is
truncated to 2,000 characters and stored in that OpenObserve stream - treat the
stream as holding user content. File parts are described as a count
(`attachment_count`) and, in a logged prompt, as `[+N file part(s)]`: attachment
bytes are never written. `user_id` is the NextAuth id, not an email. The same
flag controls content in traces (16,000 characters per message there).
