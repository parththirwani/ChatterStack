/**
 * What the real OpenRouter client writes for one streamed answer: time to first
 * token, provider usage, finish reason, and the two stop cases. Network and
 * `after()` are both faked.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { afterCalls } = vi.hoisted(() => ({ afterCalls: [] as Array<() => Promise<void>> }));

vi.mock('next/server', () => ({
  after: (callback: () => Promise<void>) => {
    afterCalls.push(callback);
  },
}));

const { createCompletion } = await import('@/src/lib/api/chat/openrouter');
const { runCouncilProcess } = await import('@/src/services/council/councilService');
const { flushObservability, peekBufferedRecords, resetObservability } = await import(
  '@/src/lib/observability/openobserve'
);
const { delta, sseResponse } = await import('../helpers/sse');

const fetchMock = vi.fn();

const trace = {
  traceId: 'trace-stream',
  span: 'completion',
  userId: 'user-9',
  conversationId: 'conv-9',
  thinkingLevel: 'high',
  messageCount: 2,
  attachmentCount: 0,
  ragUsed: false,
};

const only = () => {
  const records = peekBufferedRecords();
  expect(records).toHaveLength(1);
  return records[0];
};

beforeEach(() => {
  resetObservability();
  afterCalls.length = 0;
  vi.stubEnv('OPENROUTER_API_KEY', 'test-key');
  vi.stubEnv('OPENOBSERVE_URL', 'https://observe.example.com');
  vi.stubEnv('OPENOBSERVE_AUTH', 'cmVhZEBjb21wYW55OnNlY3JldA==');
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('createCompletion tracing', () => {
  it('records the streamed answer with provider usage', async () => {
    fetchMock.mockResolvedValue(
      sseResponse([
        delta({ reasoning: 'thinking' }),
        delta({ content: 'Slow start ' }),
        delta({ content: 'doubles cwnd.' }, 'stop'),
        { usage: { prompt_tokens: 420, completion_tokens: 66 } },
        '[DONE]',
      ])
    );

    const answer = await createCompletion([{ role: 'user', content: 'Explain TCP' }], 'openai/gpt-6.1-sol', {
      thinkingLevel: 'high',
      trace,
    });
    expect(answer).toBe('Slow start doubles cwnd.');

    const record = only();
    expect(record).toMatchObject({
      trace_id: 'trace-stream',
      span: 'completion',
      model: 'openai/gpt-6.1-sol',
      user_id: 'user-9',
      conversation_id: 'conv-9',
      thinking_level: 'high',
      status: 'ok',
      stopped: false,
      estimated: false,
      input_tokens: 420,
      output_tokens: 66,
      finish_reason: 'stop',
      rag_used: false,
      message_count: 2,
    });
    expect(record.time_to_first_token_ms).toBeTypeOf('number');
    expect(record.duration_ms).toBeGreaterThanOrEqual(record.time_to_first_token_ms ?? 0);
    // 420 prompt tokens * 0.000002 + 66 completion tokens * 0.00001
    expect(record.cost_usd).toBeCloseTo(420 * 0.000002 + 66 * 0.00001, 10);
    expect(record.prompt).toBeUndefined();
    expect(record.completion).toBeUndefined();
  });

  it('estimates tokens when the provider sends no usage', async () => {
    fetchMock.mockResolvedValue(sseResponse([delta({ content: 'plain answer' }, 'stop'), '[DONE]']));

    await createCompletion([{ role: 'user', content: 'Explain TCP' }], 'openai/gpt-6.1-sol', { trace });

    const record = only();
    expect(record.estimated).toBe(true);
    expect(record.input_tokens).toBeGreaterThan(0);
    expect(record.output_tokens).toBeGreaterThan(0);
  });

  it('records a user Stop as aborted and keeps the partial answer out of it', async () => {
    const controller = new AbortController();
    fetchMock.mockImplementation(async (_url: string, init: RequestInit) =>
      new Response(
        new ReadableStream({
          start(stream) {
            const encoder = new TextEncoder();
            stream.enqueue(encoder.encode(`data: ${JSON.stringify(delta({ content: 'Slow start ' }))}\n\n`));
            init.signal?.addEventListener('abort', () => stream.error(new DOMException('Aborted', 'AbortError')));
            setTimeout(() => controller.abort(), 5);
          },
        }),
        { status: 200 }
      )
    );

    const partial = await createCompletion([{ role: 'user', content: 'Explain TCP' }], 'openai/gpt-6.1-sol', {
      signal: controller.signal,
      trace,
    });
    expect(partial).toBe('Slow start ');

    const record = only();
    expect(record.status).toBe('aborted');
    expect(record.stopped).toBe(true);
    expect(record.error_type).toBeUndefined();
    expect(JSON.stringify(record)).not.toContain('Slow start');
  });

  it('records an upstream failure and still throws to the caller', async () => {
    fetchMock.mockResolvedValue(new Response('upstream down', { status: 503 }));

    await expect(
      createCompletion([{ role: 'user', content: 'Explain TCP' }], 'openai/gpt-6.1-sol', { trace })
    ).rejects.toThrow(/503/);

    const record = only();
    expect(record).toMatchObject({ status: 'error', stopped: false, error_type: 'Error' });
    expect(record.error_message).toContain('503');
  });

  it('flushes after the response, not during it', async () => {
    fetchMock.mockResolvedValue(sseResponse([delta({ content: 'ok' }, 'stop'), '[DONE]']));
    await createCompletion([{ role: 'user', content: 'hi' }], 'openai/gpt-6.1-sol', { trace });

    // The chat's own OpenRouter call is fetch call #1; nothing was posted yet.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(afterCalls).toHaveLength(1);

    await afterCalls[0]();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][0]).toBe('https://observe.example.com/api/default/llm_calls/_json');
    await flushObservability();
  });

  it('writes nothing when OpenObserve is not configured', async () => {
    vi.stubEnv('OPENOBSERVE_URL', '');
    fetchMock.mockResolvedValue(sseResponse([delta({ content: 'ok' }, 'stop'), '[DONE]']));

    await createCompletion([{ role: 'user', content: 'hi' }], 'openai/gpt-6.1-sol', { trace });

    expect(peekBufferedRecords()).toHaveLength(0);
    expect(afterCalls).toHaveLength(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('council tracing', () => {
  it('records every stage under one trace id', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout'] });
    try {
      fetchMock.mockImplementation(async (_url: string, init: RequestInit) => {
        const body = JSON.parse((init as RequestInit).body as string);
        const isChair = body.model === 'google/gemini-4-argon';
        return sseResponse([
          delta({ content: isChair ? 'final answer' : 'an answer' }, 'stop'),
          { usage: { prompt_tokens: 100, completion_tokens: 20 } },
          '[DONE]',
        ]);
      });

      const run = runCouncilProcess(
        'Compare REST and gRPC',
        [],
        {
          members: ['openai/gpt-6.1-sol', 'google/gemini-4-argon'],
          chair: 'google/gemini-4-argon',
          thinkingLevel: 'low',
          trace: { traceId: 'trace-council', userId: 'user-9', conversationId: 'conv-9', ragUsed: false },
        },
        {},
        []
      );
      await vi.runAllTimersAsync();
      expect(await run).toBe('final answer');

      const records = peekBufferedRecords();
      // Two members answer, then both rank, then the chair synthesises.
      expect(records.length).toBe(5);
      expect(new Set(records.map((record) => record.trace_id))).toEqual(new Set(['trace-council']));
      expect(records.map((record) => record.span).sort()).toEqual([
        'council-chair',
        'council-member-answer',
        'council-member-answer',
        'council-ranking',
        'council-ranking',
      ]);
      expect(records.every((record) => record.user_id === 'user-9')).toBe(true);
      expect(records.every((record) => record.conversation_id === 'conv-9')).toBe(true);
      expect(records.every((record) => record.status === 'ok' && record.estimated === false)).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('records a member that failed without hiding the others', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout'] });
    try {
      fetchMock.mockImplementation(async (_url: string, init: RequestInit) => {
        const body = JSON.parse((init as RequestInit).body as string);
        if (body.model === 'openai/gpt-6.1-sol') return new Response('nope', { status: 500 });
        return sseResponse([delta({ content: 'an answer' }, 'stop'), '[DONE]']);
      });

      const run = runCouncilProcess(
        'Compare REST and gRPC',
        [],
        {
          members: ['openai/gpt-6.1-sol', 'google/gemini-4-argon'],
          chair: 'google/gemini-4-argon',
          thinkingLevel: 'low',
          trace: { traceId: 'trace-partial' },
        },
        {},
        []
      );
      await vi.runAllTimersAsync();
      await run;

      const records = peekBufferedRecords();
      const failed = records.filter((record) => record.status === 'error');
      expect(failed.length).toBe(1);
      expect(failed[0].span).toBe('council-member-answer');
      expect(failed[0].model).toBe('openai/gpt-6.1-sol');
      expect(records.filter((record) => record.status === 'ok').length).toBeGreaterThan(0);
    } finally {
      vi.useRealTimers();
    }
  });
});
