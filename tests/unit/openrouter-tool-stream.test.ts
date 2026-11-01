import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { streamChat, streamCompletion, streamTurn } from '@/src/lib/api/chat/openrouter';
import { delta, sseResponse, toolCallArgumentChunks, toolCallDelta } from '../helpers/sse';

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

describe('streamTurn tool call deltas', () => {
  it('reassembles arguments split across chunks and byte fragments', async () => {
    fetchMock.mockResolvedValue(
      sseResponse(
        [
          toolCallDelta({ index: 0, id: 'call_1', name: 'mcp__cf__search' }),
          ...toolCallArgumentChunks(0, ['{"que', 'ry":"R2 ', 'caça"', '}']),
          delta({}, 'tool_calls'),
          '[DONE]',
        ],
        3
      )
    );

    const result = await streamTurn([], 'anthropic/claude-sonnet-5.5');
    expect(result.content).toBe('');
    expect(result.wantsTools).toBe(true);
    expect(result.toolCalls).toEqual([
      { callId: 'call_1', name: 'mcp__cf__search', arguments: '{"query":"R2 caça"}' },
    ]);
  });

  it('returns two parallel calls in order with their own ids', async () => {
    fetchMock.mockResolvedValue(
      sseResponse([
        toolCallDelta({ index: 0, id: 'call_a', name: 'first' }),
        toolCallDelta({ index: 1, id: 'call_b', name: 'second' }),
        ...toolCallArgumentChunks(0, ['{"a":1}']),
        ...toolCallArgumentChunks(1, ['{"b":2}']),
        delta({}, 'tool_calls'),
        '[DONE]',
      ])
    );

    const result = await streamTurn([], 'anthropic/claude-sonnet-5.5');
    expect(result.toolCalls).toEqual([
      { callId: 'call_a', name: 'first', arguments: '{"a":1}' },
      { callId: 'call_b', name: 'second', arguments: '{"b":2}' },
    ]);
  });

  it('treats an answer that is only tool calls as a finished turn', async () => {
    // No content at all: the old "the model returned no answer" guard must not fire.
    fetchMock.mockResolvedValue(sseResponse([
      toolCallDelta({ index: 0, id: 'call_1', name: 'solo', arguments: '{}' }),
      delta({}, 'tool_calls'),
      '[DONE]',
    ]));

    await expect(streamTurn([], 'anthropic/claude-sonnet-5.5')).resolves.toMatchObject({
      content: '',
      wantsTools: true,
    });
  });

  it('still fails on a stream that produced neither text nor calls', async () => {
    fetchMock.mockResolvedValue(sseResponse([delta({ reasoning: 'hmm' }), delta({}, 'length'), '[DONE]']));
    await expect(streamTurn([], 'anthropic/claude-sonnet-5.5')).rejects.toThrow(/ran out of tokens/);
  });

  it('streams text before the calls and reports both', async () => {
    fetchMock.mockResolvedValue(sseResponse([
      delta({ content: 'Let me look ' }),
      delta({ content: 'that up.' }),
      toolCallDelta({ index: 0, id: 'call_1', name: 'search', arguments: '{"q":"x"}' }),
      delta({}, 'tool_calls'),
      '[DONE]',
    ]));
    const chunks: string[] = [];
    const result = await streamTurn([], 'anthropic/claude-sonnet-5.5', { onChunk: (chunk) => chunks.push(chunk) });

    expect(chunks.join('')).toBe('Let me look that up.');
    expect(result.content).toBe('Let me look that up.');
    expect(result.toolCalls).toHaveLength(1);
  });

  it('reports provider usage and the finish reason', async () => {
    fetchMock.mockResolvedValue(sseResponse([
      delta({ content: 'hi' }),
      { choices: [{ delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 120, completion_tokens: 9 } },
      '[DONE]',
    ]));

    const result = await streamTurn([], 'anthropic/claude-sonnet-5.5');
    expect(result.usage).toEqual({ promptTokens: 120, completionTokens: 9 });
    expect(result.finishReason).toBe('stop');
  });

  it('hands back an unfinished argument blob untouched instead of parsing it', async () => {
    fetchMock.mockResolvedValue(sseResponse([
      toolCallDelta({ index: 0, id: 'call_1', name: 'search', arguments: '{"partial' }),
      delta({}, 'tool_calls'),
      '[DONE]',
    ]));

    const result = await streamTurn([], 'anthropic/claude-sonnet-5.5');
    expect(result.aborted).toBe(false);
    expect(result.toolCalls).toHaveLength(1);

    // A call whose arguments never finished is only ever reported raw.
    expect(result.toolCalls[0].arguments).toBe('{"partial');
  });

  it('flags a stream cancelled mid-flight and keeps the text so far', async () => {
    const stop = new AbortController();
    fetchMock.mockImplementation(async (_url: string, init: RequestInit) => {
      const encoder = new TextEncoder();
      return new Response(new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(delta({ content: 'Half an ' }))}\n\n`));
          init.signal?.addEventListener('abort', () => controller.error(new DOMException('Aborted', 'AbortError')));
        },
      }));
    });

    const result = await streamTurn([], 'anthropic/claude-sonnet-5.5', {
      signal: stop.signal,
      onChunk: () => stop.abort(),
    });
    expect(result.aborted).toBe(true);
    expect(result.content).toBe('Half an ');
    expect(result.wantsTools).toBe(false);
  });
});

describe('the tools request parameter', () => {
  it('is sent only when definitions are given', async () => {
    await streamTurn([], 'anthropic/claude-sonnet-5.5');
    expect(requestBody().tools).toBeUndefined();

    await streamTurn([], 'anthropic/claude-sonnet-5.5', {
      tools: [{ type: 'function', function: { name: 'search', parameters: { type: 'object' } } }],
    });
    expect(requestBody(1).tools).toEqual([
      { type: 'function', function: { name: 'search', parameters: { type: 'object' } } },
    ]);
  });

  it('keeps reasoning and max_tokens untouched when tools are added', async () => {
    await streamTurn([], 'anthropic/claude-sonnet-5.5', {
      thinkingLevel: 'high',
      tools: [{ type: 'function', function: { name: 'search' } }],
    });
    expect(requestBody()).toMatchObject({ reasoning: { effort: 'high' }, stream: true });
    expect(requestBody().max_tokens).toBeGreaterThan(0);
  });

  it('passes assistant tool_calls and tool results through unchanged', async () => {
    const messages = [
      { role: 'user', content: 'docs?' },
      { role: 'assistant', content: null, tool_calls: [{ id: 'call_1', type: 'function' as const, function: { name: 'search', arguments: '{"q":"x"}' } }] },
      { role: 'tool', content: 'a result', tool_call_id: 'call_1' },
    ];
    await streamChat(messages, 'anthropic/claude-sonnet-5.5', { tools: [{ type: 'function', function: { name: 'search' } }] });

    const sent = requestBody().messages;
    expect(sent[0].role).toBe('system');
    expect(sent.at(-2)).toEqual(messages[1]);
    expect(sent.at(-1)).toEqual(messages[2]);
  });
});

describe('the string API keeps its old shape', () => {
  it('still returns only the answer text', async () => {
    fetchMock.mockResolvedValue(sseResponse([
      delta({ reasoning: 'think' }),
      delta({ content: 'Hello ' }),
      delta({ content: 'world' }),
      '[DONE]',
    ]));
    await expect(streamCompletion([], 'anthropic/claude-sonnet-5.5')).resolves.toBe('Hello world');
  });

  it('still throws when the model answers with nothing', async () => {
    fetchMock.mockResolvedValue(sseResponse([delta({}, 'stop'), '[DONE]']));
    await expect(streamCompletion([], 'anthropic/claude-sonnet-5.5')).rejects.toThrow(/no answer \(stop\)/);
  });
});
