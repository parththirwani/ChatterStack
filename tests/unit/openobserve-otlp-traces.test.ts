/**
 * OTLP traces: one trace per chat request, nested model-call spans, GenAI
 * attributes, and the rule that prompts and answers are attached only when
 * content logging is on. Off entirely unless OPENOBSERVE_TRACES=true.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/server', () => ({
  after: () => {
    throw new Error('"after" was called outside a request scope');
  },
}));

const traces = await import('@/src/lib/observability/otlp-traces');
const { traceLlmCall } = await import('@/src/lib/observability/trace-llm-call');
const { resetObservability } = await import('@/src/lib/observability/openobserve');

type OtlpSpan = {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  name: string;
  kind: number;
  attributes: Array<{ key: string; value: Record<string, unknown> }>;
  status: { code: number; message?: string };
};

type OtlpBody = { resourceSpans: Array<{ resource: { attributes: unknown[] }; scopeSpans: Array<{ spans: OtlpSpan[] }> }> };

let requests: Array<{ url: string; headers: Record<string, string>; body: OtlpBody }> = [];
const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
  requests.push({ url, headers: init.headers as Record<string, string>, body: JSON.parse(init.body as string) });
  return new Response(null, { status: 200 });
});

const configure = ({ traces: on = 'true', content }: { traces?: string; content?: string } = {}) => {
  vi.stubEnv('OPENOBSERVE_URL', 'https://observe.example.com');
  vi.stubEnv('OPENOBSERVE_ORG', 'acme');
  vi.stubEnv('OPENOBSERVE_AUTH', 'cmVhZABjb21wYW55OnNlY3JldA==');
  vi.stubEnv('OPENOBSERVE_TRACES', on);
  if (content !== undefined) vi.stubEnv('OPENOBSERVE_LOG_CONTENT', content);
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

const modelCall = (overrides: Partial<Parameters<typeof traceLlmCall>[0]> = {}) =>
  traceLlmCall(
    {
      traceId: TRACE_ID,
      span: 'completion',
      model: 'openai/gpt-6.1-sol',
      inRequest: true,
      userId: 'user-42',
      conversationId: 'conv-7',
      messages: [
        { role: 'system', content: 'You are helpful.' },
        { role: 'user', content: [{ type: 'text', text: 'What is OTLP?' }, { type: 'file', file: { file_data: 'data:x' } }] },
      ],
      ...overrides,
    },
    async (metrics) => {
      metrics.firstToken();
      metrics.usage({ prompt_tokens: 12, completion_tokens: 5 });
      metrics.finishReason('stop');
      metrics.completion('A telemetry protocol.');
      return 'A telemetry protocol.';
    }
  );

beforeEach(() => {
  resetObservability();
  traces.resetTraces();
  requests = [];
  fetchMock.mockClear();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('OTLP traces', () => {
  it('sends nothing to the traces endpoint unless OPENOBSERVE_TRACES=true', async () => {
    configure({ traces: '' });
    await modelCall();
    traces.recordRequestSpan({ traceId: TRACE_ID, startedAt: Date.now(), status: 'ok', model: 'm', council: false, question: 'q' });
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

  it('nests a request\'s model calls under its root span in one trace', async () => {
    configure();
    await modelCall();
    await modelCall({ span: 'title-generation', model: 'openai/gpt-5.6-luna' });
    traces.recordRequestSpan({ traceId: TRACE_ID, startedAt: Date.now() - 50, status: 'ok', model: 'openai/gpt-6.1-sol', council: false, question: 'What is OTLP?', answer: 'A telemetry protocol.' });
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

  it('records GenAI attributes: model, tokens, finish reason, cost', async () => {
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

  it('keeps prompts and answers out of spans unless content logging is on', async () => {
    configure();
    await modelCall();
    traces.recordRequestSpan({ traceId: TRACE_ID, startedAt: Date.now(), status: 'ok', model: 'm', council: false, question: 'What is OTLP?', answer: 'A telemetry protocol.' });
    await drain();

    const body = JSON.stringify(traceRequests().map((request) => request.body));
    expect(body).not.toContain('What is OTLP?');
    expect(body).not.toContain('A telemetry protocol.');
    expect(body).not.toContain('gen_ai.input.messages');
  });

  it('attaches prompts and answers when content logging is on, without file bytes', async () => {
    configure({ content: 'true' });
    await modelCall();
    await drain();

    const [span] = sentSpans();
    expect(attr(span, 'gen_ai.prompt.0.role')).toBe('system');
    expect(attr(span, 'gen_ai.prompt.1.content')).toBe('What is OTLP?\n[+1 file part(s)]');
    expect(attr(span, 'gen_ai.completion.0.content')).toBe('A telemetry protocol.');
    expect(JSON.parse(attr(span, 'gen_ai.output.messages') as string)).toEqual([
      { role: 'assistant', parts: [{ type: 'text', content: 'A telemetry protocol.' }] },
    ]);
    expect(JSON.stringify(span)).not.toContain('data:x');
  });

  it('marks failures as errors, and a user Stop as not an error', async () => {
    configure();
    await expect(
      traceLlmCall({ traceId: TRACE_ID, span: 'completion', model: 'm', inRequest: true }, async () => {
        throw new Error('OpenRouter API error: 502');
      })
    ).rejects.toThrow('502');
    const controller = new AbortController();
    controller.abort();
    await traceLlmCall({ traceId: TRACE_ID, span: 'completion', model: 'm', inRequest: true, signal: controller.signal }, async () => 'partial');
    await drain();

    const [failed, stopped] = sentSpans();
    expect(failed.status).toEqual({ code: 2, message: 'OpenRouter API error: 502' });
    expect(attr(failed, 'error.type')).toBe('Error');
    expect(stopped.status).toEqual({ code: 1 });
    expect(attr(stopped, 'chatterstack.stopped')).toBe(true);
  });

  it('names council requests "council" (the model is the pseudo-id council)', async () => {
    configure();
    traces.recordRequestSpan({ traceId: TRACE_ID, startedAt: Date.now(), status: 'ok', model: 'council', council: true, question: 'q' });
    await drain();
    expect(sentSpans()[0].name).toBe('council');
  });

  it('times non-LLM steps under the request and rethrows their errors', async () => {
    configure();
    const found = await traces.traceStep(TRACE_ID, 'rag.retrieve', async () => ['chunk'], (r) => ({ 'chatterstack.rag_chunks': r.length }));
    expect(found).toEqual(['chunk']);
    await expect(traces.traceStep(TRACE_ID, 'rag.retrieve', async () => { throw new Error('qdrant down'); })).rejects.toThrow('qdrant down');
    await drain();

    const [ok, failed] = sentSpans();
    expect(ok.parentSpanId).toBe(traces.requestSpanId(TRACE_ID));
    expect(attr(ok, 'chatterstack.rag_chunks')).toBe(1);
    expect(failed.status).toEqual({ code: 2, message: 'qdrant down' });
  });

  it('keeps spans buffered when OpenObserve rejects them, and never throws', async () => {
    configure();
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 500 })));
    await modelCall();
    await drain();
    expect(traces.peekBufferedSpans()).toHaveLength(1);
  });

  it('maps any trace id to a valid 32-hex OTLP id', () => {
    expect(traces.otlpTraceId(TRACE_ID)).toBe('6f1d2f2c111140008000000000000001');
    expect(traces.otlpTraceId('title-generation')).toMatch(/^[0-9a-f]{32}$/);
    expect(traces.otlpTraceId('title-generation')).toBe(traces.otlpTraceId('title-generation'));
  });
});
