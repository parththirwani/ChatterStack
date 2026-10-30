/**
 * The OpenObserve client: inert without configuration, batches, caps the buffer
 * by dropping the oldest records, times out, and never lets its own failures
 * escape. `after` is mocked so flushing only happens when a test asks for it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { afterMock, afterCalls } = vi.hoisted(() => ({ afterMock: vi.fn(), afterCalls: [] as Array<() => Promise<void>> }));

// Flushing is scheduled with after() in a request scope; recording the callback
// keeps the tests in charge of when a batch actually goes out.
vi.mock('next/server', () => ({
  after: (callback: () => Promise<void>) => {
    afterCalls.push(callback);
    afterMock(callback);
  },
}));

const {
  enqueueLlmCallRecord,
  flushObservability,
  observabilityStats,
  openObserveConfig,
  peekBufferedRecords,
  resetObservability,
  sendBatch,
  MAX_BUFFER,
  FLUSH_THRESHOLD,
} = await import('@/src/lib/observability/openobserve');

const fetchMock = vi.fn();

const record = (index = 0) => ({
  _timestamp: 1_700_000_000_000_000 + index,
  timestamp: new Date(1_700_000_000_000 + index).toISOString(),
  trace_id: 'trace-1',
  span: 'completion',
  provider: 'openrouter',
  model: 'openai/gpt-6.1-sol',
  status: 'ok' as const,
  stopped: false,
  estimated: true,
  duration_ms: 12 + index,
});

const configure = () => {
  vi.stubEnv('OPENOBSERVE_URL', 'https://observe.example.com/');
  vi.stubEnv('OPENOBSERVE_USER', 'read@company');
  vi.stubEnv('OPENOBSERVE_PASSWORD', 'a-placeholder-secret');
};

beforeEach(() => {
  afterCalls.length = 0;
  afterMock.mockClear();
  resetObservability();
  fetchMock.mockReset();
  fetchMock.mockResolvedValue(new Response(null, { status: 200 }));
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('openObserveConfig', () => {
  it('is null without a URL', () => {
    expect(openObserveConfig()).toBeNull();
  });

  it('is null with a URL but no credentials', () => {
    vi.stubEnv('OPENOBSERVE_URL', 'https://observe.example.com');
    expect(openObserveConfig()).toBeNull();
  });

  it('applies the documented defaults', () => {
    configure();
    const config = openObserveConfig()!;
    expect(config.url).toBe('https://observe.example.com');
    expect(config.org).toBe('default');
    expect(config.stream).toBe('llm_calls');
    expect(config.logContent).toBe(false);
  });

  it('honours org and stream overrides', () => {
    configure();
    vi.stubEnv('OPENOBSERVE_ORG', 'acme');
    vi.stubEnv('OPENOBSERVE_STREAM', 'llm_traces');
    expect(openObserveConfig()).toMatchObject({ org: 'acme', stream: 'llm_traces' });
  });

  it('builds a Basic header from user and password', () => {
    configure();
    const expected = Buffer.from('read@company:a-placeholder-secret').toString('base64');
    expect(openObserveConfig()!.authorization).toBe(`Basic ${expected}`);
  });

  it('accepts a ready-made OPENOBSERVE_AUTH token', () => {
    vi.stubEnv('OPENOBSERVE_URL', 'https://observe.example.com');
    vi.stubEnv('OPENOBSERVE_AUTH', 'cmVhZEBjb21wYW55OnNlY3JldA==');
    expect(openObserveConfig()!.authorization).toBe('Basic cmVhZEBjb21wYW55OnNlY3JldA==');
  });

  it('encodes a user:password pair given as OPENOBSERVE_AUTH', () => {
    vi.stubEnv('OPENOBSERVE_URL', 'https://observe.example.com');
    vi.stubEnv('OPENOBSERVE_AUTH', 'read@company:secret');
    expect(openObserveConfig()!.authorization).toBe(
      `Basic ${Buffer.from('read@company:secret').toString('base64')}`
    );
  });
});

describe('enqueueLlmCallRecord', () => {
  it('is a no-op while unconfigured', () => {
    enqueueLlmCallRecord(record());
    expect(observabilityStats()).toMatchObject({ buffered: 0, flushes: 0 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('buffers records and posts them as one JSON batch after the response', async () => {
    configure();
    enqueueLlmCallRecord(record(1));
    enqueueLlmCallRecord(record(2));
    expect(observabilityStats().buffered).toBe(2);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(afterCalls).toHaveLength(2);

    // What next/server runs once the response (or the SSE stream) is finished.
    await afterCalls[0]();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://observe.example.com/api/default/llm_calls/_json');
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe(
      `Basic ${Buffer.from('read@company:a-placeholder-secret').toString('base64')}`
    );
    expect(JSON.parse(init.body)).toHaveLength(2);
    expect(observabilityStats()).toMatchObject({ buffered: 0, flushes: 1, errors: 0 });
  });

  it('flushes by itself once the batch is full', async () => {
    configure();
    for (let i = 0; i < FLUSH_THRESHOLD; i++) enqueueLlmCallRecord(record(i));
    // Let the in-flight send settle.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toHaveLength(FLUSH_THRESHOLD);
    expect(observabilityStats().buffered).toBe(0);
  });

  it('caps the buffer, keeping the newest records while the endpoint is down', async () => {
    configure();
    fetchMock.mockRejectedValue(new Error('ECONNREFUSED'));
    enqueueLlmCallRecord(record(0));
    await flushObservability(); // rejected: back off and keep the record
    expect(observabilityStats().buffered).toBe(1);

    for (let i = 1; i <= MAX_BUFFER + 24; i++) enqueueLlmCallRecord(record(i));

    const stats = observabilityStats();
    expect(stats.buffered).toBe(MAX_BUFFER);
    expect(stats.dropped).toBe(25);

    const kept = peekBufferedRecords();
    expect(kept[kept.length - 1].duration_ms).toBe(12 + MAX_BUFFER + 24);
    expect(kept.some((item) => item.duration_ms === 12)).toBe(false);
  });

  it('sends a short abort signal so a slow ingest cannot hang a request', async () => {
    configure();
    await sendBatch([record()], 5);
    expect(fetchMock.mock.calls[0][1].signal).toBeDefined();
  });

  it('gives up on a hung ingest after the timeout', async () => {
    configure();
    fetchMock.mockImplementation(() => new Promise(() => {}));
    const started = Date.now();
    const ok = await sendBatch([record()], 10);
    expect(ok).toBe(false);
    expect(Date.now() - started).toBeLessThan(1000);
    expect(observabilityStats()).toMatchObject({ flushes: 1, errors: 1 });
  });

  it('counts a rejected request as one swallowed error, rate limited', async () => {
    configure();
    fetchMock.mockRejectedValue(new Error('ECONNREFUSED'));
    await expect(sendBatch([record()])).resolves.toBe(false);
    await sendBatch([record()]);
    await sendBatch([record()]);
    expect(observabilityStats().errors).toBe(1);
  });

  it('marks a non-2xx response as an error but never throws', async () => {
    configure();
    fetchMock.mockResolvedValue(new Response('stream not found', { status: 404 }));
    await expect(sendBatch([record()])).resolves.toBe(false);
    expect(observabilityStats().errors).toBe(1);
  });

  it('drops the buffer instead of sending when the config disappears', async () => {
    configure();
    enqueueLlmCallRecord(record());
    vi.stubEnv('OPENOBSERVE_URL', '');
    await flushObservability();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(observabilityStats().buffered).toBe(0);
  });
});
