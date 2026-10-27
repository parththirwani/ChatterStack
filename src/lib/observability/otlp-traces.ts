/**
 * OpenObserve traces: one OTLP trace per chat request.
 *
 * Like `openobserve.ts`, this is a small dependency-free exporter (OTLP/HTTP
 * JSON) instead of an OpenTelemetry SDK, because Sentry's SDK owns the
 * process-wide OTel setup. It reuses that module's config, auth, timeout and
 * never-throw rules, and is a no-op unless `OPENOBSERVE_TRACES=true`.
 *
 * Shape of a trace:
 *   chat <model> | council       root: outcome (and, opt-in, question + answer)
 *   ├─ rag.retrieve              memory lookup
 *   │  └─ embedding <model>      the query embedding, nested under the lookup
 *   ├─ completion <model>        or council-member-answer / council-ranking / council-chair
 *   ├─ title-generation <model>
 *   ├─ db.persist                saving the turn (Redis cache + Postgres)
 *   ├─ rag.ingest                writing the turn to memory
 *   │  └─ embeddings <model>
 *   └─ profile.update
 * Requests rejected before streaming (validation, ownership, rate limit) are a
 * root span only, with status `rejected` and the HTTP status code.
 *
 * Attributes follow the OpenTelemetry GenAI conventions (`gen_ai.*`). Content
 * is opt-in through its own flag, `OPENOBSERVE_TRACE_CONTENT=true`, and is
 * deliberately narrow: the user's own message text and the model's answer,
 * each cut to MAX_TRACE_CONTENT_LENGTH characters. Never the system prompt,
 * earlier turns, retrieved memory, extracted attachment text or file bytes.
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import crypto from 'crypto';
import { after } from 'next/server';
import {
  describeError,
  flushNowAndKeepAlive,
  isPermanentRejection,
  openObserveConfig,
  postToOpenObserve,
  type LlmCallStatus,
} from './openobserve';
import { appEnvironment } from './environment';

export const SERVICE_NAME = 'chatterstack';
/** The user's message and the model's answer are each cut to this many characters. */
export const MAX_TRACE_CONTENT_LENGTH = 4_000;
export const MAX_SPAN_BUFFER = 500;
export const SPAN_FLUSH_THRESHOLD = 50;
/** Spans per POST: with the content cap this keeps a request well under 1 MB. */
export const MAX_SPANS_PER_REQUEST = 100;
const FAILURE_BACKOFF_MS = 30_000;

/** `rejected`: the request was refused before any model call (4xx). Not an error. */
export type SpanStatus = LlmCallStatus | 'rejected';

type AttributeValue = string | number | boolean | string[] | undefined;
export type SpanAttributes = Record<string, AttributeValue>;

export interface FinishedSpan {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  name: string;
  /** 1 = internal, 3 = client (a call to a model provider). */
  kind: 1 | 3;
  startedAt: number;
  endedAt: number;
  status: SpanStatus;
  errorMessage?: string;
  attributes: SpanAttributes;
}

interface TraceState {
  buffer: FinishedSpan[];
  inFlight: boolean;
  retryAfter: number;
  /** Spans lost to the buffer cap or a refused payload since the last report. */
  dropped: number;
  droppedTotal: number;
}

const globalState = globalThis as typeof globalThis & { __chatterstackOtlpTraces?: TraceState };

const freshState = (): TraceState => ({ buffer: [], inFlight: false, retryAfter: 0, dropped: 0, droppedTotal: 0 });

function state(): TraceState {
  if (!globalState.__chatterstackOtlpTraces) globalState.__chatterstackOtlpTraces = freshState();
  return globalState.__chatterstackOtlpTraces;
}

/** The step span (if any) that calls made right now belong to. */
const activeStep = new AsyncLocalStorage<{ traceId: string; spanId: string }>();

/** True when traces should be recorded at all. */
export function tracesEnabled(): boolean {
  return openObserveConfig()?.traces === true;
}

/** True when the user's message and the model's answer may be attached to spans. */
export function traceContentEnabled(): boolean {
  const config = openObserveConfig();
  return config?.traces === true && config.traceContent;
}

/**
 * OTLP wants a 32-hex-character trace id. Chat requests use a UUID (dashes
 * dropped); anything else is hashed so the same input always maps to one trace.
 */
export function otlpTraceId(traceId: string): string {
  const hex = traceId.replace(/-/g, '').toLowerCase();
  if (/^[0-9a-f]{32}$/.test(hex)) return hex;
  return crypto.createHash('sha256').update(traceId).digest('hex').slice(0, 32);
}

/**
 * The root span id is derived from the trace id, so every model call made for
 * a request can point at its parent without threading an id through each layer.
 */
export function requestSpanId(traceId: string): string {
  return crypto.createHash('sha256').update(`request:${traceId}`).digest('hex').slice(0, 16);
}

/** Parent for a span of this request: the enclosing step if one is running, else the root. */
export function parentSpanIdFor(traceId: string): string {
  const step = activeStep.getStore();
  return step && step.traceId === traceId ? step.spanId : requestSpanId(traceId);
}

export function newSpanId(): string {
  return crypto.randomBytes(8).toString('hex');
}

export function truncateTraceContent(value: string): string {
  return value.length > MAX_TRACE_CONTENT_LENGTH ? `${value.slice(0, MAX_TRACE_CONTENT_LENGTH)}...` : value;
}

/**
 * Content attributes, in the current GenAI layout only (OpenObserve parses
 * these into its LLM view): the user's own message and, for generations, the
 * answer. Callers pass the user-visible text, never the assembled prompt.
 */
export function contentAttributes(userMessage: string | undefined, answer: string | undefined): SpanAttributes {
  const attributes: SpanAttributes = {};
  if (userMessage !== undefined) {
    attributes['gen_ai.input.messages'] = JSON.stringify([
      { role: 'user', parts: [{ type: 'text', content: truncateTraceContent(userMessage) }] },
    ]);
  }
  if (answer !== undefined) {
    attributes['gen_ai.output.messages'] = JSON.stringify([
      { role: 'assistant', parts: [{ type: 'text', content: truncateTraceContent(answer) }] },
    ]);
  }
  return attributes;
}

function otlpValue(value: Exclude<AttributeValue, undefined>) {
  if (Array.isArray(value)) return { arrayValue: { values: value.map((item) => ({ stringValue: item })) } };
  if (typeof value === 'boolean') return { boolValue: value };
  if (typeof value === 'number') return Number.isInteger(value) ? { intValue: String(value) } : { doubleValue: value };
  return { stringValue: value };
}

function otlpAttributes(attributes: SpanAttributes) {
  return Object.entries(attributes)
    .filter((entry): entry is [string, Exclude<AttributeValue, undefined>] => entry[1] !== undefined)
    .map(([key, value]) => ({ key, value: otlpValue(value) }));
}

const nanos = (ms: number) => `${Math.round(ms)}000000`;

/** The OTLP/HTTP JSON body for a batch of finished spans. */
export function toOtlpPayload(spans: FinishedSpan[], droppedSinceLastSend = 0) {
  return {
    resourceSpans: [
      {
        resource: {
          attributes: otlpAttributes({
            'service.name': SERVICE_NAME,
            // Same development / preview / production value as Sentry and PostHog.
            'deployment.environment': appEnvironment(),
            'deployment.environment.name': appEnvironment(),
            // Spans this instance had to drop (buffer cap, refused payload) since the last send.
            'chatterstack.spans_dropped': droppedSinceLastSend || undefined,
          }),
        },
        scopeSpans: [
          {
            scope: { name: 'chatterstack.llm' },
            spans: spans.map((span) => ({
              traceId: otlpTraceId(span.traceId),
              spanId: span.spanId,
              ...(span.parentSpanId ? { parentSpanId: span.parentSpanId } : {}),
              name: span.name,
              kind: span.kind,
              startTimeUnixNano: nanos(span.startedAt),
              endTimeUnixNano: nanos(Math.max(span.endedAt, span.startedAt)),
              attributes: otlpAttributes({
                ...span.attributes,
                'chatterstack.status': span.status,
                ...(span.status === 'error' ? { 'error.type': span.attributes['error.type'] ?? 'error' } : {}),
              }),
              // 1 = ok, 2 = error. A user's Stop and a 4xx rejection are not errors.
              status: span.status === 'error'
                ? { code: 2, message: span.errorMessage ?? 'error' }
                : { code: 1 },
            })),
          },
        ],
      },
    ],
  };
}

/**
 * Sends everything buffered, MAX_SPANS_PER_REQUEST at a time. Never throws and
 * runs one send loop at a time; spans queued during a send go out in the same
 * flush. A payload OpenObserve refuses outright (4xx other than 408/429) is
 * dropped and counted, so one bad batch cannot block every later trace;
 * temporary failures keep the spans and back off.
 */
export async function flushTraces(): Promise<void> {
  const current = state();
  if (current.inFlight || current.buffer.length === 0) return;
  const config = openObserveConfig();
  if (!config?.traces) {
    current.buffer.length = 0;
    return;
  }

  current.inFlight = true;
  try {
    while (current.buffer.length > 0 && Date.now() >= current.retryAfter) {
      const batch = current.buffer.slice(0, MAX_SPANS_PER_REQUEST);
      const dropped = current.dropped;
      const result = await postToOpenObserve('v1/traces', toOtlpPayload(batch, dropped), {
        headers: { 'stream-name': config.traceStream },
      });
      const sent = new Set(batch);
      if (result.ok) {
        current.dropped = Math.max(0, current.dropped - dropped);
      } else if (isPermanentRejection(result)) {
        current.dropped += batch.length;
        current.droppedTotal += batch.length;
      } else {
        current.retryAfter = Date.now() + FAILURE_BACKOFF_MS;
        break;
      }
      current.buffer = current.buffer.filter((span) => !sent.has(span));
    }
  } finally {
    current.inFlight = false;
  }
}

function scheduleFlush(): void {
  try {
    after(() => flushTraces());
  } catch {
    void flushTraces();
  }
}

/** Queues one finished span for delivery after the response. */
export function enqueueSpan(span: FinishedSpan): void {
  if (!tracesEnabled()) return;
  const current = state();
  current.buffer.push(span);
  while (current.buffer.length > MAX_SPAN_BUFFER) {
    current.buffer.shift();
    current.dropped += 1;
    current.droppedTotal += 1;
  }
  if (current.buffer.length >= SPAN_FLUSH_THRESHOLD) flushNowAndKeepAlive(flushTraces);
  else scheduleFlush();
}

/**
 * The root span of a chat request: how the whole turn went and, with content
 * enabled, what the user asked and what they got back. Every other span of the
 * request hangs under it. Also used for requests rejected before streaming.
 */
export function recordRequestSpan(input: {
  traceId: string;
  startedAt: number;
  status: SpanStatus;
  model?: string;
  council?: boolean;
  userId?: string;
  conversationId?: string;
  question?: string;
  answer?: string;
  error?: unknown;
  /** HTTP status when the request was answered without streaming (rejections, 500s). */
  httpStatus?: number;
  attributes?: SpanAttributes;
}): void {
  if (!tracesEnabled()) return;
  try {
    enqueueSpan({
      traceId: input.traceId,
      spanId: requestSpanId(input.traceId),
      // Council requests carry the pseudo-model 'council'; members are child spans.
      name: input.council ? 'council' : `chat ${input.model ?? 'unknown'}`,
      kind: 1,
      startedAt: input.startedAt,
      endedAt: Date.now(),
      status: input.status,
      errorMessage: input.error !== undefined ? describeError(input.error) : undefined,
      attributes: {
        'gen_ai.operation.name': 'chat',
        'gen_ai.provider.name': 'openrouter',
        'gen_ai.request.model': input.model,
        'gen_ai.conversation.id': input.conversationId,
        'user.id': input.userId,
        'http.response.status_code': input.httpStatus,
        'chatterstack.span': 'request',
        'chatterstack.council': input.council,
        'chatterstack.answer_length': input.answer !== undefined ? input.answer.length : undefined,
        'chatterstack.empty_answer': input.answer !== undefined ? !input.answer.trim() : undefined,
        ...input.attributes,
        ...(traceContentEnabled() ? contentAttributes(input.question, input.answer) : {}),
      },
    });
  } catch {
    // Tracing must never break the request it describes.
  }
}

/**
 * A non-LLM step of a request (RAG lookup, persistence, ingestion), timed
 * around `run`. Model calls made inside `run` nest under this step's span.
 */
export async function traceStep<T>(
  traceId: string | undefined,
  name: string,
  run: () => Promise<T>,
  describe?: (result: T) => SpanAttributes,
  /** For steps that report failure in their result instead of throwing. */
  failed?: (result: T) => boolean
): Promise<T> {
  if (!traceId || !tracesEnabled()) return run();
  const startedAt = Date.now();
  const spanId = newSpanId();
  const parentSpanId = parentSpanIdFor(traceId);
  let status: LlmCallStatus = 'ok';
  let failure: unknown;
  let attributes: SpanAttributes = {};
  try {
    const result = await activeStep.run({ traceId, spanId }, run);
    try {
      attributes = describe?.(result) ?? {};
      if (failed?.(result)) status = 'error';
    } catch {
      attributes = {};
    }
    return result;
  } catch (error) {
    status = 'error';
    failure = error;
    throw error;
  } finally {
    try {
      enqueueSpan({
        traceId,
        spanId,
        parentSpanId,
        name,
        kind: 1,
        startedAt,
        endedAt: Date.now(),
        status,
        errorMessage: failure !== undefined ? describeError(failure) : undefined,
        attributes: {
          'chatterstack.span': name,
          'error.type': failure instanceof Error ? failure.name : undefined,
          ...attributes,
        },
      });
    } catch {
      // ignore
    }
  }
}

/** Diagnostics and tests. */
export function peekBufferedSpans(): readonly FinishedSpan[] {
  return [...state().buffer];
}

/** Diagnostics: what is waiting, and how many spans were lost overall. */
export function traceStats(): { buffered: number; dropped: number } {
  const current = state();
  return { buffered: current.buffer.length, dropped: current.droppedTotal };
}

/** Test helper. */
export function resetTraces(): void {
  globalState.__chatterstackOtlpTraces = freshState();
}
