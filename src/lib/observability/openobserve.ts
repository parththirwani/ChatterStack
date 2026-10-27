/**
 * OpenObserve LLM observability.
 *
 * A deliberately small, dependency-free client: it POSTs batches of JSON
 * records to OpenObserve's ingestion API. No OpenTelemetry provider is
 * registered here, because Sentry's SDK owns the process-wide OTel setup.
 *
 * Rules this module lives by: it never blocks a request, it never throws at a
 * caller, it drops its own oldest records when the buffer is full, it gives up
 * after a short timeout, and it is a complete no-op unless the URL and
 * credentials are configured.
 */
import { after } from 'next/server';

export type LlmCallStatus = 'ok' | 'error' | 'aborted';

export interface LlmCallRecord {
  /** OpenObserve's time field, in microseconds. */
  _timestamp: number;
  timestamp: string;
  /** development / preview / production (see environment.ts). */
  environment?: string;
  trace_id: string;
  span: string;
  user_id?: string;
  conversation_id?: string;
  provider: string;
  model: string;
  thinking_level?: string;
  status: LlmCallStatus;
  error_type?: string;
  error_message?: string;
  duration_ms: number;
  time_to_first_token_ms?: number;
  input_tokens?: number;
  output_tokens?: number;
  /** True when the token counts were estimated locally instead of from the provider. */
  estimated: boolean;
  cost_usd?: number;
  finish_reason?: string;
  message_count?: number;
  attachment_count?: number;
  rag_used?: boolean;
  stopped: boolean;
  /** Only present when OPENOBSERVE_LOG_CONTENT=true, truncated. */
  prompt?: string;
  completion?: string;
}

export interface OpenObserveConfig {
  url: string;
  org: string;
  stream: string;
  authorization: string;
  logContent: boolean;
  /** OTLP traces (one trace per chat request) in addition to the log records. */
  traces: boolean;
  /** OpenObserve traces stream, sent as the `stream-name` header. */
  traceStream: string;
  /**
   * Attach the user's message and the model's answer to trace spans
   * (OPENOBSERVE_TRACE_CONTENT). Separate from logContent on purpose: the two
   * flags store different amounts of user content in different places.
   */
  traceContent: boolean;
}

export const DEFAULT_STREAM = 'llm_calls';
export const DEFAULT_ORG = 'default';
export const DEFAULT_TRACE_STREAM = 'default';
export const FLUSH_TIMEOUT_MS = 3000;
/** Records held in memory before the oldest are dropped. */
export const MAX_BUFFER = 200;
/** Records per POST, and the size at which a flush is triggered eagerly. */
export const FLUSH_THRESHOLD = 25;
/** Content logging truncates each side to this many characters. */
export const MAX_CONTENT_LENGTH = 2000;
/**
 * After a failed send, wait this long before trying again. Records keep
 * buffering meanwhile, and the cap below decides which ones survive.
 */
export const FAILURE_BACKOFF_MS = 30_000;

interface ObservabilityState {
  buffer: LlmCallRecord[];
  flushes: number;
  errors: number;
  dropped: number;
  lastErrorAt: number;
  retryAfter: number;
  inFlight: boolean;
}

const globalState = globalThis as typeof globalThis & { __chatterstackOpenObserve?: ObservabilityState };

function state(): ObservabilityState {
  if (!globalState.__chatterstackOpenObserve) {
    globalState.__chatterstackOpenObserve = {
      buffer: [],
      flushes: 0,
      errors: 0,
      dropped: 0,
      lastErrorAt: 0,
      retryAfter: 0,
      inFlight: false,
    };
  }
  return globalState.__chatterstackOpenObserve;
}

const truthy = (value: string | undefined) => value?.trim().toLowerCase() === 'true';

/**
 * Null unless a URL and either `OPENOBSERVE_AUTH` or a user/password pair are
 * set, which is what keeps the whole integration inert by default.
 */
export function openObserveConfig(): OpenObserveConfig | null {
  const url = process.env.OPENOBSERVE_URL?.trim().replace(/\/+$/, '');
  if (!url) return null;

  const token = process.env.OPENOBSERVE_AUTH?.trim();
  const user = process.env.OPENOBSERVE_USER?.trim();
  const password = process.env.OPENOBSERVE_PASSWORD;

  let authorization: string | undefined;
  if (token) {
    authorization = token.includes(':') ? `Basic ${Buffer.from(token).toString('base64')}` : `Basic ${token}`;
  } else if (user && password) {
    authorization = `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}`;
  }
  if (!authorization) return null;

  return {
    url,
    org: process.env.OPENOBSERVE_ORG?.trim() || DEFAULT_ORG,
    stream: process.env.OPENOBSERVE_STREAM?.trim() || DEFAULT_STREAM,
    authorization,
    logContent: truthy(process.env.OPENOBSERVE_LOG_CONTENT),
    traces: truthy(process.env.OPENOBSERVE_TRACES),
    traceStream: process.env.OPENOBSERVE_TRACE_STREAM?.trim() || DEFAULT_TRACE_STREAM,
    traceContent: truthy(process.env.OPENOBSERVE_TRACE_CONTENT),
  };
}

export function truncateContent(value: string | undefined): string | undefined {
  if (!value) return undefined;
  return value.length > MAX_CONTENT_LENGTH ? `${value.slice(0, MAX_CONTENT_LENGTH)}...` : value;
}

/** Counter-only error bookkeeping: the SDK's own failures are never thrown or logged per call. */
function noteError(): void {
  const current = state();
  const now = Date.now();
  if (now - current.lastErrorAt >= FAILURE_BACKOFF_MS) {
    current.lastErrorAt = now;
    current.errors += 1;
  }
}

/**
 * POSTs one JSON body to an OpenObserve API path (`/api/{org}/...`). Shared by
 * the log records below and the OTLP traces in `otlp-traces.ts`: it never
 * throws, gives up after `timeoutMs`, and only counts its own failures.
 */
export interface DeliveryResult {
  ok: boolean;
  /** HTTP status, or 0 when the request never got an answer (network, timeout). */
  status: number;
}

/**
 * True when OpenObserve refused this exact payload (bad JSON, too large, wrong
 * stream). Resending it cannot help, so the batch is dropped instead of being
 * retried forever. 408/429 are about timing, not the payload, and are retried.
 */
export function isPermanentRejection(result: DeliveryResult): boolean {
  return result.status >= 400 && result.status < 500 && result.status !== 408 && result.status !== 429;
}

export async function postToOpenObserve(
  path: string,
  body: unknown,
  { headers = {}, timeoutMs = FLUSH_TIMEOUT_MS }: { headers?: Record<string, string>; timeoutMs?: number } = {}
): Promise<DeliveryResult> {
  const config = openObserveConfig();
  if (!config) return { ok: false, status: 0 };

  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  // The race is what guarantees the wait ends: the signal alone only cancels a
  // fetch that honours it, and a stuck socket could hold the promise forever.
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error('openobserve flush timed out'));
    }, timeoutMs);
  });

  try {
    const response = await Promise.race([
      fetch(`${config.url}/api/${config.org}/${path}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: config.authorization,
          ...headers,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      }),
      timeout,
    ]);
    state().flushes += 1;
    if (!response.ok) noteError();
    return { ok: response.ok, status: response.status };
  } catch {
    state().flushes += 1;
    noteError();
    return { ok: false, status: 0 };
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/**
 * Sends one batch. Exported so the timeout and the auth header are directly
 * testable; production code goes through `enqueueLlmCallRecord`.
 */
export async function sendBatch(records: LlmCallRecord[], timeoutMs = FLUSH_TIMEOUT_MS): Promise<boolean> {
  return (await deliverBatch(records, timeoutMs)).ok;
}

async function deliverBatch(records: LlmCallRecord[], timeoutMs = FLUSH_TIMEOUT_MS): Promise<DeliveryResult> {
  const config = openObserveConfig();
  if (!config || records.length === 0) return { ok: false, status: 0 };
  return postToOpenObserve(`${config.stream}/_json`, records, { timeoutMs });
}

/**
 * Sends everything buffered. Safe to call repeatedly and never throws. Records
 * are only forgotten once OpenObserve accepted them (or refused that exact
 * payload for good), and only one send runs at a time; records queued during a
 * send go out in the same flush, so nothing waits for the next request.
 */
export async function flushObservability(): Promise<void> {
  const current = state();
  if (current.inFlight || current.buffer.length === 0) return;
  if (!openObserveConfig()) {
    current.buffer.length = 0;
    return;
  }

  current.inFlight = true;
  try {
    while (current.buffer.length > 0 && Date.now() >= current.retryAfter) {
      const batch = current.buffer.slice();
      const result = await deliverBatch(batch);
      const sent = new Set<LlmCallRecord>(batch);
      if (result.ok || isPermanentRejection(result)) {
        if (!result.ok) current.dropped += batch.length;
        current.buffer = current.buffer.filter((item) => !sent.has(item));
        continue;
      }
      // Temporary failure: the batch stays buffered. Back off so a broken
      // endpoint cannot turn into a retry storm; the cap in the enqueue path
      // decides which records survive while OpenObserve is unreachable.
      current.retryAfter = Date.now() + FAILURE_BACKOFF_MS;
    }
  } finally {
    current.inFlight = false;
  }
}

/**
 * Delivery is scheduled after the response finishes, so the chat's SSE stream
 * is never waited on. Outside a request scope the flush simply runs in the
 * background.
 */
function scheduleFlush(): void {
  try {
    after(() => flushObservability());
  } catch {
    void flushObservability();
  }
}

export function enqueueLlmCallRecord(record: LlmCallRecord): void {
  if (!openObserveConfig()) return;

  const current = state();
  current.buffer.push(record);
  while (current.buffer.length > MAX_BUFFER) {
    current.buffer.shift();
    current.dropped += 1;
  }

  if (current.buffer.length >= FLUSH_THRESHOLD) flushNowAndKeepAlive(flushObservability);
  else scheduleFlush();
}

/**
 * A full buffer is sent right away, and the same promise is handed to after()
 * so a serverless function stays alive until the send finishes instead of
 * being frozen mid-POST.
 */
export function flushNowAndKeepAlive(flush: () => Promise<void>): void {
  const pending = flush();
  try {
    after(() => pending);
  } catch {
    // Outside a request scope there is nothing to keep alive.
  }
}

/**
 * One-line, bounded description of a failure for telemetry. Collapses
 * whitespace, strips data URLs / base64 / bearer tokens and caps the length, so
 * an error that echoes request data (a DB or HTTP error) cannot carry much of
 * it. Used for every error that leaves the process via OpenObserve.
 */
export const MAX_ERROR_MESSAGE_LENGTH = 300;
export function describeError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  const cleaned = raw
    .replace(/data:[^\s,"']+/gi, '[redacted data url]')
    .replace(/[a-zA-Z0-9+/=]{120,}/g, '[redacted base64]')
    .replace(/\b(Bearer|Basic)\s+[^\s,;"']+/gi, '$1 [redacted]')
    .replace(/\b(authorization|api[_-]?key|token|password|secret)(["']?\s*[:=]\s*["']?)(?!Bearer\b|Basic\b)[^\s,;"']+/gi, '$1$2[redacted]')
    .replace(/\bsk-[A-Za-z0-9_-]{8,}/g, '[redacted key]')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return 'unknown error';
  return cleaned.length > MAX_ERROR_MESSAGE_LENGTH ? `${cleaned.slice(0, MAX_ERROR_MESSAGE_LENGTH)}...` : cleaned;
}

/** What is still waiting to be sent (diagnostics and tests). */
export function peekBufferedRecords(): readonly LlmCallRecord[] {
  return [...state().buffer];
}

/** Diagnostics for tests and for a future health endpoint. */
export function observabilityStats(): { buffered: number; flushes: number; errors: number; dropped: number } {
  const current = state();
  return { buffered: current.buffer.length, flushes: current.flushes, errors: current.errors, dropped: current.dropped };
}

/** Test helper: start from an empty buffer and empty counters. */
export function resetObservability(): void {
  globalState.__chatterstackOpenObserve = {
    buffer: [],
    flushes: 0,
    errors: 0,
    dropped: 0,
    lastErrorAt: 0,
    retryAfter: 0,
    inFlight: false,
  };
}
