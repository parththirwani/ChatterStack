import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createCompletion, streamCompletion } from '@/src/lib/api/chat/openrouter';
import { delta, sseResponse } from '../helpers/sse';

const fetchMock = vi.fn();

beforeEach(() => {
  vi.stubEnv('OPENROUTER_API_KEY', 'test-key');
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset();
  fetchMock.mockImplementation(async () => sseResponse([delta({ content: 'ok' }), '[DONE]']));
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const requestBody = (call = 0) => JSON.parse(fetchMock.mock.calls[call][1].body);

describe('streamCompletion reasoning parameter', () => {
  it.each([
    ['anthropic/claude-sonnet-5.5', 'max', 'max'],
    ['openai/gpt-6.1-sol', 'xhigh', 'xhigh'],
    ['google/gemini-4-argon', 'max', 'high'],
    ['google/gemini-4-argon', 'off', 'low'],
    ['deepseek/deepseek-v4.1-flash-1017', 'off', 'none'],
    ['deepseek/deepseek-v4.1-flash-1017', 'medium', 'low'],
  ] as const)('%s at %s sends effort %s', async (model, level, effort) => {
    await streamCompletion([{ role: 'user', content: 'hi' }], model, { thinkingLevel: level });
    expect(requestBody().reasoning).toEqual({ effort });
  });

  it('gives higher levels more room for tokens', async () => {
    const maxTokens: Record<string, number> = {};
    for (const level of ['low', 'medium', 'high', 'xhigh', 'max'] as const) {
      fetchMock.mockClear();
      await streamCompletion([{ role: 'user', content: 'hi' }], 'anthropic/claude-sonnet-5.5', { thinkingLevel: level });
      maxTokens[level] = requestBody().max_tokens;
    }
    expect(maxTokens.low).toBeLessThan(maxTokens.medium);
    expect(maxTokens.medium).toBeLessThan(maxTokens.high);
    expect(maxTokens.high).toBeLessThan(maxTokens.xhigh);
    expect(maxTokens.xhigh).toBeLessThan(maxTokens.max);
  });

  it('streams with the requested model', async () => {
    await streamCompletion([{ role: 'user', content: 'hi' }], 'openai/gpt-6.1-sol');
    expect(fetchMock.mock.calls[0][0]).toBe('https://openrouter.ai/api/v1/chat/completions');
    expect(requestBody()).toMatchObject({ model: 'openai/gpt-6.1-sol', stream: true });
  });
});

describe('streamCompletion parsing', () => {
  it('reports reasoning and answer separately even when lines are split across reads', async () => {
    fetchMock.mockResolvedValue(
      sseResponse(
        [
          delta({ reasoning: 'Think ' }),
          delta({ reasoning: 'harder — ünïcode' }),
          delta({ content: 'Hello ' }),
          delta({ content: 'wörld' }),
          '[DONE]',
        ],
        3
      )
    );
    const chunks: string[] = [];
    const reasoning: string[] = [];
    const result = await streamCompletion([{ role: 'user', content: 'hi' }], 'openai/gpt-6.1-sol', {
      thinkingLevel: 'high',
      onChunk: (chunk) => chunks.push(chunk),
      onReasoning: (chunk) => reasoning.push(chunk),
    });

    expect(reasoning.join('')).toBe('Think harder — ünïcode');
    expect(chunks.join('')).toBe('Hello wörld');
    // The returned text is the answer only, never the reasoning.
    expect(result).toBe('Hello wörld');
  });

  it('throws on an HTTP error', async () => {
    fetchMock.mockResolvedValue(new Response('nope', { status: 502 }));
    await expect(streamCompletion([], 'openai/gpt-6.1-sol')).rejects.toThrow(/502/);
  });

  it('throws when the stream reports an error', async () => {
    fetchMock.mockResolvedValue(sseResponse([{ error: { message: 'model overloaded' } }]));
    await expect(streamCompletion([], 'openai/gpt-6.1-sol')).rejects.toThrow('model overloaded');
  });

  it('refuses to run without an API key', async () => {
    vi.stubEnv('OPENROUTER_API_KEY', '');
    await expect(streamCompletion([], 'openai/gpt-6.1-sol')).rejects.toThrow(/OPENROUTER_API_KEY/);
  });
});

describe('createCompletion', () => {
  it('adds the system prompt and keeps the thinking level', async () => {
    await createCompletion([{ role: 'user', content: 'hi' }], 'anthropic/claude-sonnet-5.5', { thinkingLevel: 'xhigh' });
    const body = requestBody();
    expect(body.messages[0].role).toBe('system');
    expect(body.messages.at(-1)).toEqual({ role: 'user', content: 'hi' });
    expect(body.reasoning).toEqual({ effort: 'xhigh' });
  });
});

describe('stopping a stream', () => {
  it('cancels the upstream request and returns the text so far', async () => {
    const stop = new AbortController();
    fetchMock.mockImplementation(async (_url: string, init: RequestInit) => {
      const encoder = new TextEncoder();
      return new Response(new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: 'Half an ' } }] })}\n\n`));
          init.signal?.addEventListener('abort', () => controller.error(new DOMException('Aborted', 'AbortError')));
        },
      }));
    });
    const onChunk = vi.fn(() => stop.abort());
    const result = await streamCompletion([{ role: 'user', content: 'hi' }], 'openai/gpt-6.1-sol', { signal: stop.signal, onChunk });

    expect(fetchMock.mock.calls[0][1].signal).toBe(stop.signal);
    expect(result).toBe('Half an ');
  });

  it('still reports real stream errors', async () => {
    fetchMock.mockImplementation(async () => new Response(new ReadableStream({
      start(controller) { controller.error(new Error('connection reset')); },
    })));
    await expect(streamCompletion([], 'openai/gpt-6.1-sol')).rejects.toThrow('connection reset');
  });
});
