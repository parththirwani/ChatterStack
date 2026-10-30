/**
 * traceLlmCall: what one model call writes to OpenObserve - on success, on
 * failure and when the user pressed Stop - and the rule that prompts and
 * answers stay out of the record unless content logging is switched on.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/server', () => ({
  after: () => {
    throw new Error('"after" was called outside a request scope');
  },
}));

const { traceLlmCall, promptText } = await import('@/src/lib/observability/trace-llm-call');
const { observabilityStats, openObserveConfig, resetObservability } = await import(
  '@/src/lib/observability/openobserve'
);
const { estimateTokens } = await import('@/src/lib/observability/cost');

const buffered = () => observabilityStats().buffered;

// The buffer is private, so read records back through the flush path.
let captured: Record<string, unknown>[] = [];
const flush = vi.fn(async (_url: string, init: RequestInit) => {
  captured.push(JSON.parse(init.body as string));
  return new Response(null, { status: 200 });
});

const configure = (logContent?: string) => {
  vi.stubEnv('OPENOBSERVE_URL', 'https://observe.example.com');
  vi.stubEnv('OPENOBSERVE_AUTH', 'cmVhZABjb21wYW55OnNlY3JldA==');
  if (logContent !== undefined) vi.stubEnv('OPENOBSERVE_LOG_CONTENT', logContent);
};

const base = {
  traceId: 'trace-abc',
  span: 'completion',
  model: 'openai/gpt-6.1-sol',
  userId: 'user-42',
  conversationId: 'conv-7',
  thinkingLevel: 'medium',
  messageCount: 3,
  attachmentCount: 1,
  ragUsed: true,
  prompt: 'how do I refinance my mortgage',
};

beforeEach(() => {
  resetObservability();
  captured = [];
  flush.mockClear();
  vi.stubGlobal('fetch', flush);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const drain = async () => {
  const { flushObservability } = await import('@/src/lib/observability/openobserve');
  await flushObservability();
  return captured.flat();
};

describe('traceLlmCall', () => {
  it('records nothing and costs nothing while unconfigured', async () => {
    const result = await traceLlmCall(base, async (metrics) => {
      metrics.completion('an answer');
      return 'ok';
    });
    expect(result).toBe('ok');
    expect(buffered()).toBe(0);
    expect(openObserveConfig()).toBeNull();
  });

  it('records a successful call with estimated tokens and a cost', async () => {
    configure();
    await traceLlmCall(base, async (metrics) => {
      metrics.firstToken();
      metrics.finishReason('stop');
      metrics.completion('you can refinance by ...');
      return 'answer';
    });

    const [entry] = await drain();
    expect(entry).toMatchObject({
      trace_id: 'trace-abc',
      span: 'completion',
      provider: 'openrouter',
      model: 'openai/gpt-6.1-sol',
      user_id: 'user-42',
      conversation_id: 'conv-7',
      thinking_level: 'medium',
      status: 'ok',
      stopped: false,
      estimated: true,
      finish_reason: 'stop',
      message_count: 3,
      attachment_count: 1,
      rag_used: true,
      input_tokens: estimateTokens(base.prompt),
    });
    expect(entry.duration_ms).toBeGreaterThanOrEqual(0);
    expect(entry.cost_usd).toBeGreaterThan(0);
    expect(typeof entry.time_to_first_token_ms).toBe('number');
  });

  it('prefers the provider usage over the local estimate', async () => {
    configure();
    await traceLlmCall(base, async (metrics) => {
      metrics.usage({ prompt_tokens: 1200, completion_tokens: 340 });
      return 'answer';
    });

    const [entry] = await drain();
    expect(entry).toMatchObject({ input_tokens: 1200, output_tokens: 340, estimated: false });
  });

  it('keeps prompts and answers out of the record by default', async () => {
    configure('false');
    await traceLlmCall(base, async (metrics) => {
      metrics.completion('the full private answer text');
      return 'answer';
    });

    const [entry] = await drain();
    expect(entry.prompt).toBeUndefined();
    expect(entry.completion).toBeUndefined();
    expect(JSON.stringify(entry)).not.toContain('refinance');
    expect(JSON.stringify(entry)).not.toContain('private answer');
  });

  it('logs truncated content only when OPENOBSERVE_LOG_CONTENT=true', async () => {
    configure('true');
    const long = 'x'.repeat(5000);
    await traceLlmCall({ ...base, prompt: 'a short question' }, async (metrics) => {
      metrics.completion(long);
      return 'answer';
    });

    const [entry] = await drain();
    expect(entry.prompt).toBe('a short question');
    expect((entry.completion as string).length).toBe(2003);
    expect((entry.completion as string).endsWith('...')).toBe(true);
  });

  it('records an error and re-throws it untouched', async () => {
    configure();
    const failure = new Error('OpenRouter API error: 503 - upstream down');
    await expect(
      traceLlmCall(base, async () => {
        throw failure;
      })
    ).rejects.toBe(failure);

    const [entry] = await drain();
    expect(entry).toMatchObject({
      status: 'error',
      stopped: false,
      error_type: 'Error',
      error_message: 'OpenRouter API error: 503 - upstream down',
    });
  });

  it('records an upstream abort as aborted, not as an error', async () => {
    configure();
    const aborted = new DOMException('The user aborted a request.', 'AbortError');
    await expect(
      traceLlmCall(base, async () => {
        throw aborted;
      })
    ).rejects.toBe(aborted);

    const [entry] = await drain();
    expect(entry).toMatchObject({ status: 'aborted', stopped: true, error_type: 'AbortError' });
  });

  it('records a user Stop that resolved with partial text as aborted', async () => {
    configure();
    const controller = new AbortController();
    await traceLlmCall({ ...base, signal: controller.signal }, async (metrics) => {
      metrics.completion('Slow start ');
      controller.abort();
      return 'Slow start ';
    });

    const [entry] = await drain();
    expect(entry).toMatchObject({ status: 'aborted', stopped: true, output_tokens: expect.any(Number) });
    expect(entry.error_type).toBeUndefined();
  });

  it('never lets a broken reporter break the call', async () => {
    configure();
    await expect(
      traceLlmCall({ ...base, prompt: undefined }, async () => 'answer')
    ).resolves.toBe('answer');
  });
});

describe('promptText', () => {
  it('describes text parts and counts files without copying them', () => {
    const text = promptText([
      { role: 'system', content: 'be helpful' },
      {
        role: 'user',
        content: [
          { type: 'text', text: 'summarize this' },
          { type: 'file', file: { filename: 'taxes.pdf', file_data: 'JVBERi0xLjAK' } },
        ],
      },
    ] as never);

    expect(text).toContain('system: be helpful');
    expect(text).toContain('user: summarize this');
    expect(text).toContain('[+1 file part(s)]');
    expect(text).not.toContain('JVBERi0xLjAK');
    expect(text).not.toContain('taxes.pdf');
  });
});
