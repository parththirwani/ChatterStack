/**
 * Pure Sentry event shaping: no SDK import, so it runs (and is tested) anywhere.
 *
 * The app stores private chat content, so an event may only ever carry an error
 * type, a truncated message, a stack trace and the low-cardinality tags this
 * codebase sets explicitly. Anything that looks like a request body, a header,
 * an attachment payload or a chat message is removed here as a last line of
 * defence, and expected conditions (auth failures, aborts, rate limits) are
 * dropped instead of reported.
 */

export const DROP_STATUS_CODES = [401, 403, 404, 409, 429] as const;

export const MAX_TEXT_LENGTH = 1000;

const DENIED_KEYS = [
  'authorization',
  'cookie',
  'set-cookie',
  'proxy-authorization',
  'x-api-key',
  'openrouter-api-key',
  'apikey',
  'key',
  'token',
  'secret',
  'password',
];

/** Keys that must never appear in extra/context data: they hold user content. */
const DENIED_CONTEXT_KEYS = [
  'content',
  'message',
  'messages',
  'prompt',
  'completion',
  'response',
  'reasoning',
  'title',
  'text',
  'body',
  'request_body',
  'attachment',
  'attachments',
  'file',
  'filename',
  'document',
  'documents',
  'context',
  'rag',
  'chunks',
  'payload',
  'data',
  'headers',
  'cookies',
  'user',
];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Cuts long provider errors short and removes base64 / data-URL payloads. */
export function redactText(value: string): string {
  let text = value;
  text = text.replace(/data:[^\s,"']+/gi, '[redacted data url]');
  text = text.replace(/[a-zA-Z0-9+/=\r\n]{120,}/g, '[redacted base64]');
  text = text.replace(/(Bearer|Authorization)\s+\S+/gi, '$1 [redacted]');
  return text.length > MAX_TEXT_LENGTH ? `${text.slice(0, MAX_TEXT_LENGTH)}...` : text;
}

function isDeniedKey(key: string): boolean {
  const lowered = key.toLowerCase();
  return DENIED_CONTEXT_KEYS.includes(lowered) || DENIED_KEYS.includes(lowered);
}

/** Recursively removes denied keys from anything we attach to an event. */
export function redactValue<T>(value: T): T {
  if (typeof value === 'string') return redactText(value) as unknown as T;
  if (Array.isArray(value)) return value.map((item) => redactValue(item)) as unknown as T;
  if (!isRecord(value)) return value;

  const clean: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (isDeniedKey(key)) continue;
    clean[key] = redactValue(item);
  }
  return clean as T;
}

/** True for conditions the app already handles for the user. */
export function isExpectedError(error: unknown): boolean {
  if (!error) return false;

  const candidate = error as { name?: string; message?: string; status?: number; statusCode?: number };
  const name = candidate.name ?? '';
  const message = candidate.message ?? String(error);

  if (name === 'AbortError' || name === 'APIUserAbortError' || name === 'TimeoutError') return true;
  if (/\bsignal aborted\b/i.test(message)) return true;
  if (/Rate limit exceeded|daily (token|limit)|limit of \d+ council/i.test(message)) return true;
  if (/^Unauthorized$/i.test(message.trim())) return true;

  const status = candidate.status ?? candidate.statusCode ?? statusFromMessage(message);
  return status !== undefined && (DROP_STATUS_CODES as readonly number[]).includes(status);
}

/** Reads an HTTP status out of messages like `OpenRouter API error: 401 - ...`. */
export function statusFromMessage(message: string): number | undefined {
  const match =
    message.match(/\b(?:error|status(?: code)?)[:\s]+(4\d\d|5\d\d)\b/i) ?? message.match(/^\((\d{3})\)/);
  const status = match ? Number(match[1]) : undefined;
  return status && status >= 400 && status <= 599 ? status : undefined;
}

export interface ErrorTagContext {
  route?: string;
  model?: string;
  council?: boolean;
  stage?: string;
}

/** Low-cardinality tags only: ids and flags, never user content. */
export function errorTags(context: ErrorTagContext): Record<string, string> {
  const tags: Record<string, string> = {};
  if (context.route) tags.route = redactText(context.route);
  if (context.model) tags.model = redactText(context.model);
  if (context.council !== undefined) tags.council = String(context.council);
  if (context.stage) tags.stage = redactText(context.stage);
  return tags;
}

export type SentryEventLike = Record<string, unknown>;

type ExceptionValues = Array<{ value?: string; type?: string }>;

/**
 * beforeSend: drop expected conditions, strip everything that could carry a
 * request body, header or chat content, and keep the user as an id only.
 * Returns null for events that should never reach Sentry.
 */
export function scrubEvent(event: SentryEventLike, hint?: { originalException?: unknown }): SentryEventLike | null {
  const values = (event.exception as { values?: ExceptionValues } | undefined)?.values;
  if (isExpectedError(hint?.originalException) || isExpectedError(values?.[0]?.value)) return null;

  const contexts = isRecord(event.contexts) ? event.contexts : undefined;
  const response = contexts && isRecord(contexts.response) ? contexts.response : undefined;
  const status = response?.status_code;
  if (typeof status === 'number' && (DROP_STATUS_CODES as readonly number[]).includes(status)) return null;

  // No request data at all: headers carry the session cookie, bodies carry chat text.
  delete event.request;

  if (event.extra) event.extra = redactValue(event.extra);
  if (contexts) {
    const cleanedContexts = { ...contexts };
    delete cleanedContexts.request_body;
    for (const key of Object.keys(cleanedContexts)) {
      if (key === 'trace') continue;
      cleanedContexts[key] = redactValue(cleanedContexts[key]);
    }
    event.contexts = cleanedContexts;
  }

  if (typeof event.message === 'string') event.message = redactText(event.message);
  for (const value of values ?? []) {
    if (value.value) value.value = redactText(value.value);
  }

  // Identity is the NextAuth id. sendDefaultPii is off, so nothing else arrives,
  // but strip anything that slipped through anyway.
  if (event.user !== undefined) {
    const id = isRecord(event.user) ? event.user.id : undefined;
    if (typeof id === 'string' && id) event.user = { id };
    else delete event.user;
  }

  if (Array.isArray(event.breadcrumbs)) {
    event.breadcrumbs = event.breadcrumbs
      .filter((breadcrumb): breadcrumb is SentryLikeBreadcrumb => isRecord(breadcrumb))
      .map(scrubBreadcrumb)
      .filter((breadcrumb): breadcrumb is SentryLikeBreadcrumb => breadcrumb !== null);
  }

  return event;
}

export interface SentryLikeBreadcrumb {
  message?: string;
  data?: Record<string, unknown>;
  type?: string;
  category?: string;
}

/** beforeBreadcrumb / breadcrumb cleanup: no console text, no fetch bodies. */
export function scrubBreadcrumb(breadcrumb: SentryLikeBreadcrumb): SentryLikeBreadcrumb | null {
  if (breadcrumb.type === 'console') return null;
  if (breadcrumb.category === 'fetch' || breadcrumb.category === 'xhr') {
    return { type: breadcrumb.type, category: breadcrumb.category };
  }
  const cleaned: SentryLikeBreadcrumb = { ...breadcrumb };
  if (cleaned.message) cleaned.message = redactText(cleaned.message);
  if (cleaned.data) cleaned.data = redactValue(cleaned.data);
  return cleaned;
}

/** True when nothing was configured, i.e. Sentry must stay completely off. */
export function isSentryDisabled(dsn: string | undefined | null): boolean {
  return !dsn || !dsn.trim();
}
