/**
 * OTLP traces: one trace per chat request, nested spans, GenAI attributes,
 * delivery that cannot get stuck, and the content rules - content is opt-in
 * through its own flag and limited to the user's message and the answer.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const afterCalls: Array<() => unknown> = [];
let insideRequest = false;
vi.mock('next/server', () => ({
  after: (callback: () => unknown) => {
    if (!insideRequest) throw new Error('"after" was called outside a request scope');
    afterCalls.push(callback);
  },
}));

const traces = await import('@/src/lib/observability/otlp-traces');
const { traceLlmCall } = await import('@/src/lib/observability/trace-llm-call');
const { describeError, resetObservability } = await import('@/src/lib/observability/openobserve');

type OtlpSpan = {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  name: string;
  kind: number;
  attributes: Array<{ key: string; value: Record<string, unknown> }>;
  status: { code: number; message?: string };
};
type OtlpBody = {
  resourceSpans: Array<{ resource: { attributes: Array<{ key: string; value: Record<string, unknown> }> }; scopeSpans: Array<{ spans: OtlpSpan[] }> }>;
};

let requests: Array<{ url: string; headers: Record<string, string>; body: OtlpBody }> = [];
let respond: () => Response = () => new Response(null, { status: 200 });
/** When set, trace POSTs wait for it (log-record POSTs never do). */
let traceGate: Promise<void> | null = null;
const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
  requests.push({ url, headers: init.headers as Record<string, string>, body: JSON.parse(init.body as string) });
  if (traceGate && url.endsWith('/v1/traces')) {
    const gate = traceGate;
    traceGate = null;
    await gate;
  }
  return respond();
});

const configure = ({ traces: on = 'true', content, logContent }: { traces?: string; content?: string; logContent?: string } = {}) => {
  vi.stubEnv('OPENOBSERVE_URL', 'https://observe.example.com');
  vi.stubEnv('OPENOBSERVE_ORG', 'acme');
  vi.stubEnv('OPENOBSERVE_AUTH', 'cmVhZABjb21wYW55OnNlY3JldA==');
  vi.stubEnv('OPENOBSERVE_TRACES', on);
  if (content !== undefined) vi.stubEnv('OPENOBSERVE_TRACE_CONTENT', content);
  if (logContent !== undefined) vi.stubEnv('OPENOBSERVE_LOG_CONTENT', logContent);
};

const traceRequests = () => requests.filter((request) => request.url.endsWith('/v1/traces'));
const sentSpans = (): OtlpSpan[] =>
  traceRequests().flatMap((request) => request.body.resourceSpans[0].scopeSpans[0].spans);
const attr = (span: OtlpSpan, key: string) => {
  const value = span.attributes.find((entry) => entry.key === key)?.value;
  if (!value) return undefined;
  if ('intValue' in value) return Number(value.intValue);
  if ('arrayValue' in value) return (value.arrayValue as { values: Array<{ stringValue: string }> }).values.map((v) => v.stringValue);
  return Object.values(value)[0];
};

const drain = async () => {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await traces.flushTraces();
};

const TRACE_ID = '6f1d2f2c-1111-4000-8000-000000000001';

const modelCall = (overrides: Partial<Parameters<typeof traceLlmCall>[0]> = {}, answer = 'A telemetry protocol.') =>
  traceLlmCall(
    {
      traceId: TRACE_ID,
      span: 'completion',
      model: 'openai/gpt-6.1-sol',
      inRequest: true,
      userId: 'user-42',
      conversationId: 'conv-7',
      // The assembled prompt: system prompt, history, memory and file text.
      prompt: 'system: SECRET SYSTEM PROMPT\nuser: earlier turn\nuser: Context from past conversations: OTHER CHAT\nFile: notes.txt\n\nPRIVATE FILE TEXT',
      contentPrompt: 'What is OTLP?',
      ...overrides,
    },
    async (metrics) => {
      metrics.firstToken();
      metrics.usage({ prompt_tokens: 12, completion_tokens: 5 });
      metrics.finishReason('stop');
      metrics.completion(answer);
      return answer;
    }
  );

beforeEach(() => {
  resetObservability();
  traces.resetTraces();
  requests = [];
  respond = () => new Response(null, { status: 200 });
  traceGate = null;
  afterCalls.length = 0;
  insideRequest = false;
  fetchMock.mockClear();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('OTLP traces: switching on', () => {
  it('sends nothing to the traces endpoint unless OPENOBSERVE_TRACES=true', async () => {
    configure({ traces: '' });
    await modelCall();
    traces.recordRequestSpan({ traceId: TRACE_ID, startedAt: Date.now(), status: 'ok', model: 'm', question: 'q' });
    await drain();
    expect(traceRequests()).toHaveLength(0);
    expect(traces.peekBufferedSpans()).toHaveLength(0);
  });

  it('posts OTLP JSON to /api/{org}/v1/traces with auth and the stream-name header', async () => {
    configure();
    vi.stubEnv('OPENOBSERVE_TRACE_STREAM', 'llm');
    await modelCall();
    await drain();

    const [request] = traceRequests();
    expect(request.url).toBe('https://observe.example.com/api/acme/v1/traces');
    expect(request.headers.Authorization).toBe('Basic cmVhZABjb21wYW55OnNlY3JldA==');
    expect(request.headers['stream-name']).toBe('llm');
    expect(request.body.resourceSpans[0].resource.attributes).toContainEqual({ key: 'service.name', value: { stringValue: 'chatterstack' } });
  });
});

describe('OTLP traces: shape', () => {
  it("nests a request's model calls under its root span in one trace", async () => {
    configure();
    await modelCall();
    await modelCall({ span: 'title-generation', model: 'openai/gpt-5.6-luna' });
    traces.recordRequestSpan({ traceId: TRACE_ID, startedAt: Date.now() - 50, status: 'ok', model: 'openai/gpt-6.1-sol', question: 'What is OTLP?', answer: 'A telemetry protocol.' });
    await drain();

    const spans = sentSpans();
    expect(spans).toHaveLength(3);
    const root = spans.find((span) => span.name === 'chat openai/gpt-6.1-sol')!;
    expect(root.parentSpanId).toBeUndefined();
    expect(root.spanId).toBe(traces.requestSpanId(TRACE_ID));
    expect(new Set(spans.map((span) => span.traceId))).toEqual(new Set(['6f1d2f2c111140008000000000000001']));
    for (const child of spans.filter((span) => span !== root)) {
      expect(child.parentSpanId).toBe(root.spanId);
      expect(child.kind).toBe(3);
    }
  });

  it('nests model calls made inside a step under that step, not the root', async () => {
    configure();
    await traces.traceStep(TRACE_ID, 'rag.retrieve', () =>
      modelCall({ span: 'embedding', model: 'openai/text-embedding-3-small', operation: 'embeddings' })
    );
    await drain();

    const embedding = sentSpans().find((span) => span.name.startsWith('embedding'))!;
    const step = sentSpans().find((span) => span.name === 'rag.retrieve')!;
    expect(step.parentSpanId).toBe(traces.requestSpanId(TRACE_ID));
    expect(embedding.parentSpanId).toBe(step.spanId);
  });

  it('records GenAI attributes: model, tokens, finish reason, cost (computed once, shared)', async () => {
    configure();
    await modelCall();
    await drain();

    const [span] = sentSpans();
    expect(span.name).toBe('completion openai/gpt-6.1-sol');
    expect(attr(span, 'gen_ai.operation.name')).toBe('chat');
    expect(attr(span, 'gen_ai.provider.name')).toBe('openrouter');
    expect(attr(span, 'gen_ai.request.model')).toBe('openai/gpt-6.1-sol');
    expect(attr(span, 'gen_ai.usage.input_tokens')).toBe(12);
    expect(attr(span, 'gen_ai.usage.output_tokens')).toBe(5);
    expect(attr(span, 'gen_ai.response.finish_reasons')).toEqual(['stop']);
    expect(attr(span, 'chatterstack.cost_usd')).toBeGreaterThan(0);
    expect(attr(span, 'gen_ai.usage.cost')).toBe(attr(span, 'chatterstack.cost_usd'));
    expect(span.status).toEqual({ code: 1 });
  });

  it('names council requests "council" (the model is the pseudo-id council)', async () => {
    configure();
    traces.recordRequestSpan({ traceId: TRACE_ID, startedAt: Date.now(), status: 'ok', model: 'council', council: true, question: 'q' });
    await drain();
    expect(sentSpans()[0].name).toBe('council');
  });

  it('records a rejected request as status rejected with its HTTP code, not as an error', async () => {
    configure();
    traces.recordRequestSpan({ traceId: TRACE_ID, startedAt: Date.now(), status: 'rejected', httpStatus: 429, model: 'm' });
    await drain();
    const [root] = sentSpans();
    expect(root.status).toEqual({ code: 1 });
    expect(attr(root, 'chatterstack.status')).toBe('rejected');
    expect(attr(root, 'http.response.status_code')).toBe(429);
  });
});

describe('OTLP traces: content', () => {
  it('keeps prompts and answers out of spans unless OPENOBSERVE_TRACE_CONTENT=true', async () => {
    // The log-record flag alone must not put content into traces.
    configure({ logContent: 'true' });
    await modelCall();
    traces.recordRequestSpan({ traceId: TRACE_ID, startedAt: Date.now(), status: 'ok', model: 'm', question: 'What is OTLP?', answer: 'A telemetry protocol.' });
    await drain();

    const body = JSON.stringify(traceRequests().map((request) => request.body));
    expect(body).not.toContain('What is OTLP?');
    expect(body).not.toContain('A telemetry protocol.');
    expect(body).not.toContain('gen_ai.input.messages');
  });

  it("attaches only the user's own message and the answer, in one layout", async () => {
    configure({ content: 'true' });
    await modelCall();
    await drain();

    const [span] = sentSpans();
    expect(JSON.parse(attr(span, 'gen_ai.input.messages') as string)).toEqual([
      { role: 'user', parts: [{ type: 'text', content: 'What is OTLP?' }] },
    ]);
    expect(JSON.parse(attr(span, 'gen_ai.output.messages') as string)).toEqual([
      { role: 'assistant', parts: [{ type: 'text', content: 'A telemetry protocol.' }] },
    ]);
    const body = JSON.stringify(span);
    for (const leaked of ['SECRET SYSTEM PROMPT', 'earlier turn', 'OTHER CHAT', 'PRIVATE FILE TEXT']) {
      expect(body).not.toContain(leaked);
    }
    expect(span.attributes.some((entry) => entry.key.startsWith('gen_ai.prompt.') || entry.key.startsWith('gen_ai.completion.'))).toBe(false);
  });

  it('never attaches embedding inputs, and caps content length', async () => {
    configure({ content: 'true' });
    await modelCall({ span: 'embeddings', model: 'openai/text-embedding-3-small', operation: 'embeddings', contentPrompt: 'stored memory text' });
    await modelCall({}, 'x'.repeat(traces.MAX_TRACE_CONTENT_LENGTH + 500));
    await drain();

    const [embedding, long] = sentSpans();
    expect(JSON.stringify(embedding)).not.toContain('stored memory text');
    const output = JSON.parse(attr(long, 'gen_ai.output.messages') as string)[0].parts[0].content as string;
    expect(output.length).toBe(traces.MAX_TRACE_CONTENT_LENGTH + 3);
  });
});

describe('OTLP traces: errors', () => {
  it('marks failures as errors with a cleaned message, and a user Stop as not an error', async () => {
    configure();
    await expect(
      traceLlmCall({ traceId: TRACE_ID, span: 'completion', model: 'm', inRequest: true }, async () => {
        throw new Error('OpenRouter API error: 502\n  Authorization: Bearer sk-or-v1-abcdef');
      })
    ).rejects.toThrow('502');
    const controller = new AbortController();
    controller.abort();
    await traceLlmCall({ traceId: TRACE_ID, span: 'completion', model: 'm', inRequest: true, signal: controller.signal }, async () => 'partial');
    await drain();

    const [failed, stopped] = sentSpans();
    expect(failed.status.code).toBe(2);
    expect(failed.status.message).toBe('OpenRouter API error: 502 Authorization: Bearer [redacted]');
    expect(failed.status.message).not.toContain('sk-or');
    expect(attr(failed, 'error.type')).toBe('Error');
    expect(stopped.status).toEqual({ code: 1 });
    expect(attr(stopped, 'chatterstack.stopped')).toBe(true);
  });

  it('cleans root and step error messages the same way as model calls', async () => {
    configure();
    const echoed = new Error(`Invalid prisma.message.createMany() invocation:\n\n${'Q'.repeat(2000)}`);
    traces.recordRequestSpan({ traceId: TRACE_ID, startedAt: Date.now(), status: 'error', model: 'm', error: echoed });
    await expect(traces.traceStep(TRACE_ID, 'db.persist', async () => { throw echoed; })).rejects.toThrow();
    await drain();

    for (const span of sentSpans()) {
      expect(span.status.message).toBe(describeError(echoed));
      expect(span.status.message!.length).toBeLessThanOrEqual(303);
    }
  });

  it('times non-LLM steps, and fails a step whose result reports a failure', async () => {
    configure();
    const found = await traces.traceStep(TRACE_ID, 'rag.retrieve', async () => ['chunk'], (r) => ({ 'chatterstack.rag_chunks': r.length }));
    expect(found).toEqual(['chunk']);
    await traces.traceStep(TRACE_ID, 'rag.ingest', async () => 'failed', undefined, (outcome) => outcome === 'failed');
    await expect(traces.traceStep(TRACE_ID, 'rag.retrieve', async () => { throw new Error('qdrant down'); })).rejects.toThrow('qdrant down');
    await drain();

    const [ok, reported, thrown] = sentSpans();
    expect(ok.parentSpanId).toBe(traces.requestSpanId(TRACE_ID));
    expect(attr(ok, 'chatterstack.rag_chunks')).toBe(1);
    expect(reported.status.code).toBe(2);
    expect(thrown.status).toEqual({ code: 2, message: 'qdrant down' });
  });
});

describe('describeError', () => {
  it('redacts credentials, data URLs and base64, and stays one bounded line', () => {
    const message = describeError(new Error(
      `fetch failed\n  Authorization: Bearer abc.def\n  api_key=sk-or-v1-0123456789abcdef password: hunter2 ` +
      `data:image/png;base64,AAAA ${'Q'.repeat(200)} ${'tail '.repeat(100)}`
    ));
    expect(message).not.toMatch(/abc\.def|0123456789abcdef|hunter2|data:image|QQQQ/);
    expect(message).not.toContain('\n');
    expect(message.length).toBeLessThanOrEqual(303);
  });
});

describe('OTLP traces: delivery', () => {
  it('keeps spans buffered on a temporary failure, and never throws', async () => {
    configure();
    respond = () => new Response(null, { status: 503 });
    await modelCall();
    await drain();
    expect(traces.peekBufferedSpans()).toHaveLength(1);
  });

  it('drops a batch OpenObserve refuses outright, so later traces still get through', async () => {
    configure();
    respond = () => new Response('payload too large', { status: 413 });
    await modelCall();
    await drain();
    expect(traces.peekBufferedSpans()).toHaveLength(0);
    expect(traces.traceStats().dropped).toBe(1);

    respond = () => new Response(null, { status: 200 });
    await modelCall();
    await drain();
    const last = traceRequests().at(-1)!;
    expect(last.body.resourceSpans[0].scopeSpans[0].spans).toHaveLength(1);
    // The loss is reported with the next successful send.
    expect(last.body.resourceSpans[0].resource.attributes).toContainEqual({ key: 'chatterstack.spans_dropped', value: { intValue: '1' } });
  });

  it('sends a large buffer in bounded chunks', async () => {
    configure();
    for (let i = 0; i < traces.MAX_SPANS_PER_REQUEST + 30; i++) {
      traces.recordRequestSpan({ traceId: `t-${i}`, startedAt: Date.now(), status: 'ok', model: 'm' });
    }
    await drain();
    const sizes = traceRequests().map((request) => request.body.resourceSpans[0].scopeSpans[0].spans.length);
    expect(Math.max(...sizes)).toBeLessThanOrEqual(traces.MAX_SPANS_PER_REQUEST);
    expect(sizes.reduce((a, b) => a + b, 0)).toBe(traces.MAX_SPANS_PER_REQUEST + 30);
    expect(traces.peekBufferedSpans()).toHaveLength(0);
  });

  it('sends spans queued during an in-flight send in the same flush', async () => {
    configure();
    let release!: () => void;
    traceGate = new Promise<void>((resolve) => { release = resolve; });
    await modelCall(); // starts a background flush, whose trace POST now hangs
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(traceRequests()).toHaveLength(1);
    await modelCall(); // queued while that POST is still open
    release();
    // No further flush is triggered: the open flush must pick the span up itself.
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(sentSpans()).toHaveLength(2);
    expect(traces.peekBufferedSpans()).toHaveLength(0);
  });

  it('keeps the function alive for a threshold flush inside a request', async () => {
    configure();
    insideRequest = true;
    for (let i = 0; i < traces.SPAN_FLUSH_THRESHOLD; i++) {
      traces.recordRequestSpan({ traceId: `t-${i}`, startedAt: Date.now(), status: 'ok', model: 'm' });
    }
    // The eager send started, and its promise was handed to after().
    expect(fetchMock).toHaveBeenCalled();
    const waited = afterCalls.map((callback) => callback());
    expect(waited.some((value) => value instanceof Promise)).toBe(true);
    await Promise.all(waited);
  });

  it('maps any trace id to a valid 32-hex OTLP id', () => {
    expect(traces.otlpTraceId(TRACE_ID)).toBe('6f1d2f2c111140008000000000000001');
    expect(traces.otlpTraceId('title-generation')).toMatch(/^[0-9a-f]{32}$/);
    expect(traces.otlpTraceId('title-generation')).toBe(traces.otlpTraceId('title-generation'));
  });
});
