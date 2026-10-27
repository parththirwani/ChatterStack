/**
 * OpenObserve traces: one OTLP trace per chat request.
 *
 * Like `openobserve.ts`, this is a small dependency-free exporter (OTLP/HTTP
 * JSON) instead of an OpenTelemetry SDK, because Sentry's SDK owns the
 * process-wide OTel setup. It reuses that module's config, auth, timeout and
 * never-throw rules, and is a no-op unless `OPENOBSERVE_TRACES=true`.
 *
 * Shape of a trace:
 *   chat <model>                 root: the user's question and the final answer
 *   ├─ rag.retrieve              memory lookup (duration, whether context was found)
 *   ├─ completion <model>        or council-member-answer / council-ranking / council-chair
 *   ├─ title-generation <model>
 *   └─ embedding(s) <model>
 *
 * Attributes follow the OpenTelemetry GenAI conventions (`gen_ai.*`). Prompts
 * and answers are attached only when `OPENOBSERVE_LOG_CONTENT=true`, both as
 * `gen_ai.input.messages` / `gen_ai.output.messages` and in the older
 * `gen_ai.prompt.N.*` / `gen_ai.completion.N.*` form that OpenObserve's own
 * instrumentors emit. Attachment bytes are never included.
 */
import crypto from 'crypto';
import { after } from 'next/server';
import { openObserveConfig, postToOpenObserve, type LlmCallStatus } from './openobserve';

export const SERVICE_NAME = 'chatterstack';
/** Each prompt/answer message is cut to this many characters inside a span. */
export const MAX_TRACE_CONTENT_LENGTH = 16_000;
export const MAX_SPAN_BUFFER = 500;
export const SPAN_FLUSH_THRESHOLD = 50;
const FAILURE_BACKOFF_MS = 30_000;

type AttributeValue = string | number | boolean | string[] | undefined;
export type SpanAttributes = Record<string, AttributeValue>;

export interface TraceMessage {
  role: string;
  content: unknown;
}

export interface FinishedSpan {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  name: string;
  /** 1 = internal, 3 = client (a call to a model provider). */
  kind: 1 | 3;
  startedAt: number;
  endedAt: number;
  status: LlmCallStatus;
  errorMessage?: string;
  attributes: SpanAttributes;
}

interface TraceState {
  buffer: FinishedSpan[];
  inFlight: boolean;
  retryAfter: number;
  dropped: number;
}

const globalState = globalThis as typeof globalThis & { __chatterstackOtlpTraces?: TraceState };

function state(): TraceState {
  if (!globalState.__chatterstackOtlpTraces) {
    globalState.__chatterstackOtlpTraces = { buffer: [], inFlight: false, retryAfter: 0, dropped: 0 };
  }
  return globalState.__chatterstackOtlpTraces;
}

/** True when traces should be recorded at all. */
export function tracesEnabled(): boolean {
  return openObserveConfig()?.traces === true;
}

/** True when prompts and answers may be attached to spans. */
export function traceContentEnabled(): boolean {
  const config = openObserveConfig();
  return config?.traces === true && config.logContent;
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

export function newSpanId(): string {
  return crypto.randomBytes(8).toString('hex');
}

export function truncateTraceContent(value: string): string {
  return value.length > MAX_TRACE_CONTENT_LENGTH ? `${value.slice(0, MAX_TRACE_CONTENT_LENGTH)}...` : value;
}

/** Text of one message; file parts are counted, never copied. */
export function messageText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  const text = content
    .filter((part): part is { type: string; text: string } =>
      typeof part === 'object' && part !== null && (part as { type?: string }).type === 'text')
    .map((part) => part.text)
    .join('\n');
  const files = content.filter((part) =>
    typeof part === 'object' && part !== null && (part as { type?: string }).type !== 'text').length;
  return files ? `${text}${text ? '\n' : ''}[+${files} file part(s)]` : text;
}

/**
 * Content attributes for one call: the messages sent and the answer received,
 * in both the current and the older GenAI attribute layouts.
 */
export function contentAttributes(input: TraceMessage[], output: string | undefined, outputRole = 'assistant'): SpanAttributes {
  const attributes: SpanAttributes = {};
  const inputMessages = input.map((message) => ({
    role: message.role,
    parts: [{ type: 'text', content: truncateTraceContent(messageText(message.content)) }],
  }));
  attributes['gen_ai.input.messages'] = JSON.stringify(inputMessages);
  inputMessages.forEach((message, index) => {
    attributes[`gen_ai.prompt.${index}.role`] = message.role;
    attributes[`gen_ai.prompt.${index}.content`] = message.parts[0].content;
  });

  if (output !== undefined) {
    const answer = truncateTraceContent(output);
    attributes['gen_ai.output.messages'] = JSON.stringify([{ role: outputRole, parts: [{ type: 'text', content: answer }] }]);
    attributes['gen_ai.completion.0.role'] = outputRole;
    attributes['gen_ai.completion.0.content'] = answer;
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
export function toOtlpPayload(spans: FinishedSpan[]) {
  return {
    resourceSpans: [
      {
        resource: {
          attributes: otlpAttributes({
            'service.name': SERVICE_NAME,
            'deployment.environment': process.env.SENTRY_ENVIRONMENT || process.env.VERCEL_ENV || process.env.NODE_ENV,
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
              // 1 = ok, 2 = error. A user's Stop is not an error.
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

/** Sends everything buffered; never throws, one send at a time, backs off on failure. */
export async function flushTraces(): Promise<void> {
  const current = state();
  if (current.inFlight || current.buffer.length === 0) return;
  const config = openObserveConfig();
  if (!config?.traces) {
    current.buffer.length = 0;
    return;
  }
  if (Date.now() < current.retryAfter) return;

  const batch = current.buffer.slice();
  current.inFlight = true;
  let accepted = false;
  try {
    accepted = await postToOpenObserve('v1/traces', toOtlpPayload(batch), {
      headers: { 'stream-name': config.traceStream },
    });
  } finally {
    current.inFlight = false;
  }

  if (accepted) {
    const sent = new Set(batch);
    current.buffer = current.buffer.filter((span) => !sent.has(span));
    return;
  }
  current.retryAfter = Date.now() + FAILURE_BACKOFF_MS;
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
  }
  if (current.buffer.length >= SPAN_FLUSH_THRESHOLD) void flushTraces();
  else scheduleFlush();
}

/**
 * The root span of a chat request: what the user asked, what they got back,
 * and how the whole turn went. Every model call of the request hangs under it.
 */
export function recordRequestSpan(input: {
  traceId: string;
  startedAt: number;
  status: LlmCallStatus;
  model: string;
  council: boolean;
  userId?: string;
  conversationId?: string;
  question: string;
  answer?: string;
  errorMessage?: string;
  attributes?: SpanAttributes;
}): void {
  if (!tracesEnabled()) return;
  try {
    enqueueSpan({
      traceId: input.traceId,
      spanId: requestSpanId(input.traceId),
      // Council requests carry the pseudo-model 'council'; members are child spans.
      name: input.council ? 'council' : `chat ${input.model}`,
      kind: 1,
      startedAt: input.startedAt,
      endedAt: Date.now(),
      status: input.status,
      errorMessage: input.errorMessage,
      attributes: {
        'gen_ai.operation.name': 'chat',
        'gen_ai.provider.name': 'openrouter',
        'gen_ai.request.model': input.model,
        'gen_ai.conversation.id': input.conversationId,
        'user.id': input.userId,
        'chatterstack.span': 'request',
        'chatterstack.council': input.council,
        'chatterstack.answer_length': input.answer?.length ?? 0,
        'chatterstack.empty_answer': !input.answer?.trim(),
        ...input.attributes,
        ...(traceContentEnabled()
          ? contentAttributes([{ role: 'user', content: input.question }], input.answer)
          : {}),
      },
    });
  } catch {
    // Tracing must never break the request it describes.
  }
}

/** A non-LLM step of a request (e.g. the RAG lookup), timed around `run`. */
export async function traceStep<T>(
  traceId: string | undefined,
  name: string,
  run: () => Promise<T>,
  describe?: (result: T) => SpanAttributes
): Promise<T> {
  if (!traceId || !tracesEnabled()) return run();
  const startedAt = Date.now();
  let status: LlmCallStatus = 'ok';
  let errorMessage: string | undefined;
  let attributes: SpanAttributes = {};
  try {
    const result = await run();
    try {
      attributes = describe?.(result) ?? {};
    } catch {
      attributes = {};
    }
    return result;
  } catch (error) {
    status = 'error';
    errorMessage = error instanceof Error ? error.message : String(error);
    throw error;
  } finally {
    try {
      enqueueSpan({
        traceId,
        spanId: newSpanId(),
        parentSpanId: requestSpanId(traceId),
        name,
        kind: 1,
        startedAt,
        endedAt: Date.now(),
        status,
        errorMessage,
        attributes: { 'chatterstack.span': name, ...attributes },
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

/** Test helper. */
export function resetTraces(): void {
  globalState.__chatterstackOtlpTraces = { buffer: [], inFlight: false, retryAfter: 0, dropped: 0 };
}
