/**
 * The Sentry scrubber: expected conditions are dropped, private data never
 * leaves, and only the low-cardinality tags this app sets survive.
 */
import { describe, expect, it } from 'vitest';
import {
  DROP_STATUS_CODES,
  errorTags,
  isExpectedError,
  isSentryDisabled,
  redactText,
  redactValue,
  scrubBreadcrumb,
  scrubEvent,
  statusFromMessage,
  type SentryEventLike,
} from '@/src/lib/observability/sentry-filters';

const event = (): SentryEventLike => ({
  event_id: 'abc',
  message: 'chat failed',
  request: {
    url: 'https://app.example/api/chat',
    headers: { cookie: 'authjs.session-token=secret', authorization: 'Bearer sk-test', 'content-type': 'application/json' },
    cookies: { 'authjs.session-token': 'secret' },
    data: '{"message":"how do I refinance my mortgage?"}',
    query_string: 'conversationId=9f1c',
  },
  extra: { content: 'the answer the model wrote', attachments: [{ name: 'taxes.pdf' }], attempt: 2 },
  contexts: { trace: { op: 'http.server' }, response: { status_code: 500 } },
  user: { id: 'user-42', email: 'sam@example.com', ip_address: '203.0.113.7' },
  breadcrumbs: [
    { type: 'console', message: 'log', data: { arguments: ['the user prompt'] } },
    { type: 'fetch', category: 'fetch', data: { 'request.body': 'the user prompt', url: 'https://app.example/api/chat' } },
    { type: 'navigation', category: 'navigation', data: { from: '/', to: '/chat' } },
  ],
  exception: { values: [{ type: 'Error', value: 'OpenRouter API error: 503 - upstream down' }] },
});

describe('isExpectedError', () => {
  it.each([401, 403, 404, 409, 429])('drops %i responses', (status) => {
    expect(isExpectedError(Object.assign(new Error(`Request failed ${status}`), { status }))).toBe(true);
    expect(isExpectedError(new Error(`OpenRouter API error: ${status} - nope`))).toBe(true);
  });

  it.each(DROP_STATUS_CODES)('lists %i as droppable', (status) => {
    expect(DROP_STATUS_CODES).toContain(status);
  });

  it('reports 5xx failures', () => {
    expect(isExpectedError(Object.assign(new Error('boom'), { status: 503 }))).toBe(false);
  });

  it('drops client aborts and user Stop', () => {
    expect(isExpectedError(Object.assign(new Error('The user aborted a request.'), { name: 'AbortError' }))).toBe(true);
    expect(isExpectedError(new Error('BodyTimeoutError: signal aborted'))).toBe(true);
  });

  it('drops rate-limit rejections and plain unauthorized responses', () => {
    expect(isExpectedError(new Error('Rate limit exceeded'))).toBe(true);
    expect(isExpectedError(new Error('Unauthorized'))).toBe(true);
  });

  it('ignores nothing when there is no error', () => {
    expect(isExpectedError(undefined)).toBe(false);
    expect(isExpectedError(new Error('Qdrant upsert failed'))).toBe(false);
  });

  it('reads statuses out of provider messages', () => {
    expect(statusFromMessage('OpenRouter API error: 429 - slow down')).toBe(429);
    expect(statusFromMessage('Request failed with status code 404')).toBe(404);
    expect(statusFromMessage('Title generation failed: upstream never answered')).toBeUndefined();
    expect(statusFromMessage('the model produced 1400 tokens')).toBeUndefined();
  });
});

describe('redactText', () => {
  it('truncates long provider messages', () => {
    const out = redactText(`the upstream model complained. `.repeat(500));
    expect(out.length).toBeLessThanOrEqual(1003);
    expect(out.endsWith('...')).toBe(true);
  });

  it('removes base64 payloads, data urls and bearer tokens', () => {
    const base64 = Buffer.from('a private document').toString('base64').repeat(30);
    expect(redactText(`payload ${base64}`)).toContain('[redacted base64]');
    expect(redactText('see data:application/pdf;base64,JVBERi0x for details')).toContain('[redacted data url]');
    expect(redactText('Authorization: Bearer sk-or-v1-secret')).not.toContain('sk-or-v1-secret');
  });
});

describe('redactValue', () => {
  it('removes keys that hold user content, at any depth', () => {
    const cleaned = redactValue({
      keep: 'ok',
      content: 'secret answer',
      nested: { title: 'secret title', attachments: [{ name: 'taxes.pdf' }], deeper: { rag: 'chunks' } },
      list: [{ message: 'secret prompt', safe: 1 }],
    }) as Record<string, unknown>;

    expect(JSON.stringify(cleaned)).not.toContain('secret');
    expect(JSON.stringify(cleaned)).not.toContain('taxes.pdf');
    expect(cleaned.keep).toBe('ok');
    expect((cleaned.list as Record<string, unknown>[])[0].safe).toBe(1);
  });
});

describe('scrubEvent', () => {
  it('drops expected conditions before they reach Sentry', () => {
    expect(scrubEvent(event(), { originalException: Object.assign(new Error('aborted'), { name: 'AbortError' }) })).toBeNull();
    expect(scrubEvent(event(), { originalException: new Error('Rate limit exceeded') })).toBeNull();
    expect(scrubEvent({ message: 'x', exception: { values: [{ value: 'OpenRouter API error: 401 - nope' }] } })).toBeNull();
  });

  it('drops events whose response status is expected', () => {
    const e = event();
    (e.contexts as Record<string, unknown>).response = { status_code: 404 };
    expect(scrubEvent(e)).toBeNull();
  });

  it('removes request headers, cookies and bodies entirely', () => {
    const out = scrubEvent(event())!;
    expect(out.request).toBeUndefined();
    expect(JSON.stringify(out)).not.toContain('authjs.session-token');
    expect(JSON.stringify(out)).not.toContain('sk-test');
  });

  it('keeps nothing that looks like chat or document content', () => {
    const out = scrubEvent(event())!;
    const json = JSON.stringify(out);
    expect(json).not.toContain('the answer the model wrote');
    expect(json).not.toContain('how do I refinance my mortgage');
    expect(json).not.toContain('the user prompt');
    expect(json).not.toContain('taxes.pdf');
    expect((out.extra as Record<string, unknown>).attempt).toBe(2);
  });

  it('reduces the user to the id', () => {
    const out = scrubEvent(event())!;
    expect(out.user).toEqual({ id: 'user-42' });
  });

  it('keeps the trace context and the error itself', () => {
    const out = scrubEvent(event())!;
    expect((out.contexts as Record<string, unknown>).trace).toEqual({ op: 'http.server' });
    expect(JSON.stringify(out.exception)).toContain('OpenRouter API error: 503');
  });

  it('scrubs breadcrumbs: console gone, fetch reduced to the category', () => {
    const out = scrubEvent(event())!;
    const breadcrumbs = out.breadcrumbs as Array<Record<string, unknown>>;
    expect(breadcrumbs.some((b) => b.type === 'console')).toBe(false);
    expect(breadcrumbs.find((b) => b.category === 'fetch')).toEqual({ type: 'fetch', category: 'fetch' });
    expect(JSON.stringify(breadcrumbs)).not.toContain('the user prompt');
  });
});

describe('scrubBreadcrumb', () => {
  it('drops console crumbs and keeps navigation ones', () => {
    expect(scrubBreadcrumb({ type: 'console', message: 'hello' })).toBeNull();
    expect(scrubBreadcrumb({ type: 'navigation', category: 'navigation', data: { to: '/chat' } })).toEqual({
      type: 'navigation',
      category: 'navigation',
      data: { to: '/chat' },
    });
  });
});

describe('errorTags', () => {
  it('only carries the four low-cardinality tags', () => {
    expect(errorTags({ route: '/api/chat', model: 'openai/gpt-6.1-sol', council: false, stage: 'model-call' })).toEqual({
      route: '/api/chat',
      model: 'openai/gpt-6.1-sol',
      council: 'false',
      stage: 'model-call',
    });
    expect(errorTags({})).toEqual({});
  });
});

describe('isSentryDisabled', () => {
  it.each([[undefined], [null], [''], ['   ']])('treats %j as disabled', (dsn) => {
    expect(isSentryDisabled(dsn)).toBe(true);
  });

  it('is enabled with a DSN', () => {
    expect(isSentryDisabled('https://abc@o0.ingest.sentry.io/1')).toBe(false);
  });
});
