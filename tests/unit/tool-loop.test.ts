import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { McpDisabledError } from '@/src/lib/api/chat/mcp-config';

vi.mock('@/src/lib/api/chat/openrouter', () => ({
  streamChat: vi.fn(),
}));

const { streamChat } = await import('@/src/lib/api/chat/openrouter');
const {
  DEFAULT_TOOL_LOOP_LIMITS,
  ToolLoopUnsupportedModelError,
  runToolLoop,
  toolSchemaTokens,
} = await import('@/src/lib/api/chat/tool-loop');

const streamMock = vi.mocked(streamChat);

type TurnShape = {
  content?: string;
  calls?: Array<{ callId: string; name: string; arguments: string }>;
  usage?: { promptTokens: number; completionTokens: number };
  aborted?: boolean;
};

const turn = (shape: TurnShape) => ({
  content: shape.content ?? '',
  toolCalls: shape.calls ?? [],
  usage: shape.usage ?? { promptTokens: 0, completionTokens: 0 },
  aborted: shape.aborted ?? false,
  wantsTools: (shape.calls ?? []).length > 0,
  finishReason: shape.calls?.length ? 'tool_calls' : 'stop',
});

const searchTool = {
  name: 'mcp__cf__search',
  description: 'Search the Cloudflare documentation',
  parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
  connectionId: 'conn_1',
  toolId: 'docs/search_cloudflare_documentation',
};

const abortError = () => Object.assign(new Error('The user aborted a request.'), { name: 'AbortError' });

function harness(overrides: Partial<Parameters<typeof runToolLoop>[0]> = {}) {
  const executed: Array<{ name: string; args: Record<string, unknown> }> = [];
  const approvals: string[] = [];
  const events: string[] = [];
  let clock = 1_000;

  const base = {
    userId: 'user_1',
    model: 'anthropic/claude-sonnet-5.5',
    messages: [{ role: 'user', content: 'How do I list R2 buckets?' }],
    tools: [searchTool],
    supportsTools: true,
    signal: new AbortController().signal,
    isToolEnabled: () => true,
    requestApproval: vi.fn(async (request: { callId: string }) => {
      approvals.push(request.callId);
      return 'approved' as const;
    }),
    execute: vi.fn(async (tool: typeof searchTool, _callId: string, args: Record<string, unknown>) => {
      executed.push({ name: tool.name, args });
      return { ok: true as const, content: 'bucketApi.listBuckets() exists' };
    }),
    onEvent: vi.fn((event: { kind: string }) => events.push(event.kind)),
    now: () => clock,
  };

  const options = { ...base, ...overrides };
  return {
    options,
    executed,
    approvals,
    events,
    advance: (ms: number) => { clock += ms; },
    run: () => runToolLoop(options as Parameters<typeof runToolLoop>[0]),
  };
}

beforeEach(() => {
  vi.stubEnv('MCP_TOOLS', 'on');
  streamMock.mockReset();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

const sentMessages = (call = 0) => streamMock.mock.calls[call][0] as Array<Record<string, unknown>>;
const sentTools = (call = 0) => (streamMock.mock.calls[call][2] as { tools?: unknown }).tools;

describe('runToolLoop happy path', () => {
  it('runs an approved call and returns the model answer that followed it', async () => {
    streamMock
      .mockResolvedValueOnce(turn({ content: '', calls: [{ callId: 'call_1', name: searchTool.name, arguments: '{"query":"R2"}' }] }))
      .mockResolvedValueOnce(turn({ content: 'Use bucketApi.listBuckets().' }));

    const result = await harness().run();

    expect(result.content).toBe('Use bucketApi.listBuckets().');
    expect(result.rounds).toBe(2);
    expect(result.stop).toBeUndefined();
    expect(result.calls).toHaveLength(1);
    expect(result.calls[0]).toMatchObject({
      callId: 'call_1', status: 'completed', approval: 'approved',
      result: 'bucketApi.listBuckets() exists', connectionId: 'conn_1',
    });
  });

  it('sends the tool definitions in OpenRouter shape on every round', async () => {
    streamMock
      .mockResolvedValueOnce(turn({ calls: [{ callId: 'call_1', name: searchTool.name, arguments: '{}' }] }))
      .mockResolvedValueOnce(turn({ content: 'done' }));

    await harness().run();

    expect(sentTools(0)).toEqual([
      { type: 'function', function: { name: searchTool.name, description: searchTool.description, parameters: searchTool.parameters } },
    ]);
    expect(sentTools(1)).toEqual(sentTools(0));
  });

  it('answers every call id exactly once, in the order the model asked', async () => {
    const calls = [1, 2, 3].map((n) => ({ callId: `call_${n}`, name: searchTool.name, arguments: `{"query":"q${n}"}` }));
    streamMock
      .mockResolvedValueOnce(turn({ calls }))
      .mockResolvedValueOnce(turn({ content: 'three answers' }));

    const result = await harness().run();

    expect(result.calls.map((call) => call.callId)).toEqual(['call_1', 'call_2', 'call_3']);
    const toolMessages = sentMessages(1).filter((message) => message.role === 'tool');
    expect(toolMessages.map((message) => message.tool_call_id)).toEqual(['call_1', 'call_2', 'call_3']);
    expect(new Set(toolMessages.map((message) => message.tool_call_id)).size).toBe(3);
  });

  it('keeps OpenRouter message ordering: assistant tool_calls before its tool results', async () => {
    streamMock
      .mockResolvedValueOnce(turn({ calls: [{ callId: 'call_1', name: searchTool.name, arguments: '{}' }] }))
      .mockResolvedValueOnce(turn({ content: 'ok' }));

    await harness().run();

    const sent = sentMessages(1);
    expect(sent.map((message) => message.role)).toEqual(['user', 'assistant', 'tool']);
    expect(sent[1].tool_calls).toEqual([
      { id: 'call_1', type: 'function', function: { name: searchTool.name, arguments: '{}' } },
    ]);
  });

  it('adds up prompt and completion tokens across every round', async () => {
    streamMock
      .mockResolvedValueOnce(turn({ calls: [{ callId: 'call_1', name: searchTool.name, arguments: '{}' }], usage: { promptTokens: 900, completionTokens: 20 } }))
      .mockResolvedValueOnce(turn({ content: 'ok', usage: { promptTokens: 1_400, completionTokens: 60 } }));

    const result = await harness().run();

    expect(result.usage).toEqual({ input: 2_300, output: 80 });
  });

  it('keeps the streamed text from the calling round and the final round together', async () => {
    streamMock
      .mockResolvedValueOnce(turn({ content: 'Let me check.', calls: [{ callId: 'call_1', name: searchTool.name, arguments: '{}' }] }))
      .mockResolvedValueOnce(turn({ content: 'It is bucketApi.listBuckets().' }));

    const result = await harness().run();
    expect(result.content).toBe('Let me check.\n\nIt is bucketApi.listBuckets().');
  });

  it('reports the call lifecycle as typed events', async () => {
    streamMock
      .mockResolvedValueOnce(turn({ calls: [{ callId: 'call_1', name: searchTool.name, arguments: '{}' }] }))
      .mockResolvedValueOnce(turn({ content: 'ok' }));

    const run = harness();
    await run.run();
    expect(run.events).toEqual(['approval_request', 'call_started', 'call_result']);
  });
});

describe('runToolLoop with nothing to offer', () => {
  it('sends no tools array when there are no enabled connections', async () => {
    streamMock.mockResolvedValueOnce(turn({ content: 'plain answer' }));

    const result = await harness({ tools: [] }).run();

    expect(sentTools(0)).toBeUndefined();
    expect(result.content).toBe('plain answer');
    expect(result.rounds).toBe(1);
    expect(result.calls).toEqual([]);
    expect(streamMock).toHaveBeenCalledTimes(1);
  });
});

describe('runToolLoop refusals and denials', () => {
  it('refuses every tool while MCP_TOOLS is off', async () => {
    vi.stubEnv('MCP_TOOLS', 'off');
    await expect(harness().run()).rejects.toBeInstanceOf(McpDisabledError);
    expect(streamMock).not.toHaveBeenCalled();
  });

  it('still runs a tool-free turn while MCP_TOOLS is off', async () => {
    vi.stubEnv('MCP_TOOLS', '');
    streamMock.mockResolvedValueOnce(turn({ content: 'plain answer' }));
    const result = await harness({ tools: [] }).run();
    expect(result.content).toBe('plain answer');
  });

  it('refuses to run at all when the model cannot take tools', async () => {
    const run = harness({ supportsTools: false }).run();
    await expect(run).rejects.toBeInstanceOf(ToolLoopUnsupportedModelError);
    expect(streamMock).not.toHaveBeenCalled();
  });

  it('still answers normally when a tool-free model has no tools to be offered', async () => {
    streamMock.mockResolvedValueOnce(turn({ content: 'no tools here' }));
    const result = await harness({ supportsTools: false, tools: [] }).run();
    expect(result.content).toBe('no tools here');
  });

  it('shows the denial to the model and never executes the tool', async () => {
    streamMock
      .mockResolvedValueOnce(turn({ calls: [{ callId: 'call_1', name: searchTool.name, arguments: '{}' }] }))
      .mockResolvedValueOnce(turn({ content: 'Understood, I will not.' }));

    const run = harness({ requestApproval: async () => 'denied' as const });
    const result = await run.run();

    expect(run.executed).toEqual([]);
    expect(result.calls[0]).toMatchObject({ status: 'denied', approval: 'denied' });
    expect(result.calls[0].result).toMatch(/denied/i);
    expect(result.content).toBe('Understood, I will not.');
  });

  it('labels an approval that expired instead of a denial', async () => {
    streamMock
      .mockResolvedValueOnce(turn({ calls: [{ callId: 'call_1', name: searchTool.name, arguments: '{}' }] }))
      .mockResolvedValueOnce(turn({ content: 'ok' }));

    const run = harness({ requestApproval: async () => 'expired' as const });
    const result = await run.run();

    expect(run.executed).toEqual([]);
    expect(result.calls[0]).toMatchObject({ status: 'timed_out', approval: 'expired' });
    expect(result.calls[0].result).toMatch(/expired/i);
  });

  it('does not run a tool the user switched off', async () => {
    streamMock
      .mockResolvedValueOnce(turn({ calls: [{ callId: 'call_1', name: searchTool.name, arguments: '{}' }] }))
      .mockResolvedValueOnce(turn({ content: 'ok' }));

    const run = harness({ isToolEnabled: () => false });
    const result = await run.run();

    expect(run.approvals).toEqual([]);
    expect(run.executed).toEqual([]);
    expect(result.calls[0]).toMatchObject({ status: 'not_enabled' });
  });

  it('does not run a name that no connection offered', async () => {
    streamMock
      .mockResolvedValueOnce(turn({ calls: [{ callId: 'call_1', name: 'made_up', arguments: '{}' }] }))
      .mockResolvedValueOnce(turn({ content: 'ok' }));

    const run = harness();
    const result = await run.run();

    expect(run.executed).toEqual([]);
    expect(result.calls[0]).toMatchObject({ status: 'not_enabled' });
    expect(result.calls[0].result).toMatch(/not available/i);
  });

  it('answers an invented tool name without a name at all', async () => {
    streamMock
      .mockResolvedValueOnce(turn({ calls: [{ callId: 'call_1', name: '__unsupported_tool_call__', arguments: '{}' }] }))
      .mockResolvedValueOnce(turn({ content: 'ok' }));

    const run = harness();
    const result = await run.run();
    expect(result.calls[0].status).toBe('not_enabled');
    expect(run.executed).toEqual([]);
  });
});

describe('runToolLoop argument and result bounds', () => {
  it('tells the model its arguments were not JSON and does not execute', async () => {
    streamMock
      .mockResolvedValueOnce(turn({ calls: [{ callId: 'call_1', name: searchTool.name, arguments: '{"query":' }] }))
      .mockResolvedValueOnce(turn({ content: 'Sorry, fixed now.' }));

    const run = harness();
    const result = await run.run();

    expect(run.executed).toEqual([]);
    expect(result.calls[0]).toMatchObject({ status: 'invalid_arguments' });
    expect(result.calls[0].result).toMatch(/not valid JSON/);
  });

  it('refuses arguments over the byte cap', async () => {
    const huge = `{"query":"${'x'.repeat(DEFAULT_TOOL_LOOP_LIMITS.maxArgumentBytes)}"}`;
    streamMock
      .mockResolvedValueOnce(turn({ calls: [{ callId: 'call_1', name: searchTool.name, arguments: huge }] }))
      .mockResolvedValueOnce(turn({ content: 'ok' }));

    const run = harness();
    const result = await run.run();

    expect(run.executed).toEqual([]);
    expect(result.calls[0].status).toBe('too_large');
    expect(result.stop?.limit).toBe('arguments');
  });

  it('truncates an oversized tool result and says so', async () => {
    streamMock
      .mockResolvedValueOnce(turn({ calls: [{ callId: 'call_1', name: searchTool.name, arguments: '{}' }] }))
      .mockResolvedValueOnce(turn({ content: 'ok' }));

    const run = harness({
      execute: async () => ({ ok: true as const, content: 'ü'.repeat(20_000) }),
      limits: { maxResultBytes: 512 },
    });
    const result = await run.run();

    expect(result.calls[0].status).toBe('completed');
    expect(result.calls[0].truncated).toBe(true);
    expect(Buffer.byteLength(result.calls[0].result, 'utf8')).toBeLessThanOrEqual(512 + '[truncated]'.length + 1);
    expect(result.calls[0].result).toMatch(/\[truncated\]$/);
  });

  it('hands a tool failure back to the model as a visible result', async () => {
    streamMock
      .mockResolvedValueOnce(turn({ calls: [{ callId: 'call_1', name: searchTool.name, arguments: '{}' }] }))
      .mockResolvedValueOnce(turn({ content: 'The server is down.' }));

    const run = harness({ execute: async () => ({ ok: false as const, error: 'MCP call timed out' }) });
    const result = await run.run();

    expect(result.calls[0]).toMatchObject({ status: 'failed', approval: 'approved', result: 'MCP call timed out' });
    expect(result.content).toBe('The server is down.');
  });

  it('catches an execution that throws', async () => {
    streamMock
      .mockResolvedValueOnce(turn({ calls: [{ callId: 'call_1', name: searchTool.name, arguments: '{}' }] }))
      .mockResolvedValueOnce(turn({ content: 'noted' }));

    const run = harness({ execute: async () => { throw new Error('socket hang up'); } });
    const result = await run.run();

    expect(result.calls[0]).toMatchObject({ status: 'failed', error: 'socket hang up' });
  });
});

describe('runToolLoop budgets', () => {
  it('stops a model that repeats an already answered call', async () => {
    const call = { callId: 'call_1', name: searchTool.name, arguments: '{"query":"R2"}' };
    streamMock
      .mockResolvedValueOnce(turn({ calls: [call] }))
      .mockResolvedValueOnce(turn({ calls: [{ ...call, callId: 'call_2' }] }))
      .mockResolvedValueOnce(turn({ content: 'Stopping now.' }));

    const run = harness();
    const result = await run.run();

    expect(run.executed).toHaveLength(1);
    expect(result.calls.map((entry) => entry.status)).toEqual(['completed', 'repeated']);
    expect(result.stop?.limit).toBe('calls');
  });

  it('caps the rounds and still lets the model close with text', async () => {
    const call = (n: number) => ({ callId: `call_${n}`, name: searchTool.name, arguments: `{"query":"q${n}"}` });
    streamMock
      .mockResolvedValueOnce(turn({ calls: [call(1)] }))
      .mockResolvedValueOnce(turn({ calls: [call(2)] }))
      .mockResolvedValueOnce(turn({ calls: [call(3)] }))
      .mockResolvedValueOnce(turn({ calls: [call(4)] }))
      .mockResolvedValueOnce(turn({ content: 'Final answer from what I have.' }));

    const result = await harness().run();

    expect(result.rounds).toBe(DEFAULT_TOOL_LOOP_LIMITS.maxRounds);
    expect(result.stop?.limit).toBe('rounds');
    expect(result.content).toBe('Final answer from what I have.');
    // One result for every one of the four calls, plus the closing answer.
    expect(result.calls).toHaveLength(4);
    expect(streamMock).toHaveBeenCalledTimes(5);
  });

  it('caps the calls in a single round and still answers the leftovers', async () => {
    const calls = [1, 2, 3, 4, 5].map((n) => ({ callId: `call_${n}`, name: searchTool.name, arguments: `{"query":"q${n}"}` }));
    streamMock
      .mockResolvedValueOnce(turn({ calls }))
      .mockResolvedValueOnce(turn({ content: 'partial' }));

    const run = harness();
    const result = await run.run();

    expect(run.executed).toHaveLength(DEFAULT_TOOL_LOOP_LIMITS.maxCallsPerRound);
    expect(result.calls).toHaveLength(calls.length);
    expect(result.calls.at(-1)).toMatchObject({ callId: 'call_5', status: 'too_large' });
  });

  it('caps the whole turn at the total call budget', async () => {
    streamMock.mockImplementation(async (messages) => {
      const sent = messages as Array<{ role: string }>;
      const rounds = sent.filter((message) => message.role === 'assistant').length;
      if (rounds >= 2) return turn({ content: 'done' }) as never;
      return turn({ calls: [
        { callId: `call_a${rounds}`, name: searchTool.name, arguments: `{"query":"a${rounds}"}` },
        { callId: `call_b${rounds}`, name: searchTool.name, arguments: `{"query":"b${rounds}"}` },
        { callId: `call_c${rounds}`, name: searchTool.name, arguments: `{"query":"c${rounds}"}` },
      ] }) as never;
    });

    const result = await harness({ limits: { maxTotalCalls: 4 } }).run();

    // Every call id the model produced still got an answer.
    expect(result.calls).toHaveLength(6);
    expect(result.calls.filter((call) => call.status === 'completed')).toHaveLength(4);
    expect(result.calls.filter((call) => call.status === 'too_large')).toHaveLength(2);
    expect(result.stop?.limit).toBe('calls');
  });

  it('stops when the elapsed budget runs out', async () => {
    const run = harness();
    let first = true;
    streamMock.mockImplementation(async () => {
      if (first) {
        first = false;
        run.advance(DEFAULT_TOOL_LOOP_LIMITS.maxElapsedMs + 1);
        return turn({ calls: [{ callId: 'call_1', name: searchTool.name, arguments: '{}' }] }) as never;
      }
      return turn({ content: 'wrapped up' }) as never;
    });

    const result = await run.run();

    expect(run.executed).toEqual([]);
    expect(result.calls[0]).toMatchObject({ status: 'timed_out' });
    expect(result.stop?.limit).toBe('elapsed');
  });

  it('counts the tool schemas into the prompt token budget', async () => {
    streamMock.mockResolvedValueOnce(turn({ content: 'plain' }));
    // One schema already costs more than the budget allows, so the tools are
    // never offered and the model is asked for a plain answer instead.
    const result = await harness({ limits: { maxPromptTokens: toolSchemaTokens([searchTool]) - 1 } }).run();
    expect(streamMock).toHaveBeenCalledTimes(1);
    expect(sentTools(0)).toBeUndefined();
    expect(result.stop?.limit).toBe('prompt_tokens');
    expect(result.content).toBe('plain');
  });

  it('stops when the prompt outgrows the tool token budget', async () => {
    streamMock
      .mockResolvedValueOnce(turn({ calls: [{ callId: 'call_1', name: searchTool.name, arguments: '{}' }] }))
      .mockResolvedValueOnce(turn({ content: 'ok' }));

    // Room for the schema and the question, but not for the tool result.
    const run = harness({
      limits: { maxPromptTokens: toolSchemaTokens([searchTool]) + 40 },
      execute: async () => ({ ok: true as const, content: 'x'.repeat(4_000) }),
    });
    const result = await run.run();

    expect(result.stop?.limit).toBe('prompt_tokens');
    expect(result.calls).toHaveLength(1);
    expect(result.content).toBe('ok');
  });

  it('counts tool schemas toward the prompt budget', () => {
    expect(toolSchemaTokens([])).toBe(0);
    expect(toolSchemaTokens([searchTool])).toBeGreaterThan(0);
    expect(toolSchemaTokens([searchTool, searchTool])).toBe(toolSchemaTokens([searchTool]) * 2);
  });
});

describe('runToolLoop cancellation', () => {
  it('cancels the model call and reports the text so far', async () => {
    streamMock.mockRejectedValueOnce(abortError());
    const controller = new AbortController();
    controller.abort();

    const result = await harness({ signal: controller.signal }).run();

    expect(result.aborted).toBe(true);
    expect(result.content).toBe('');
    expect(result.calls).toEqual([]);
  });

  it('runs nothing when the user stops while the model is still streaming', async () => {
    const controller = new AbortController();
    streamMock.mockImplementationOnce(async () => {
      controller.abort();
      return turn({ aborted: true, content: 'Half an answer' }) as never;
    });

    const run = harness({ signal: controller.signal });
    const result = await run.run();

    expect(result.aborted).toBe(true);
    expect(result.content).toBe('Half an answer');
    expect(run.executed).toEqual([]);
    expect(streamMock).toHaveBeenCalledTimes(1);
  });

  it('runs nothing when the user stops before the approval came back', async () => {
    const controller = new AbortController();
    streamMock
      .mockResolvedValueOnce(turn({ calls: [{ callId: 'call_1', name: searchTool.name, arguments: '{}' }] }))
      .mockResolvedValueOnce(turn({ content: 'later' }));

    const run = harness({
      signal: controller.signal,
      requestApproval: async () => {
        controller.abort();
        throw abortError();
      },
    });
    const result = await run.run();

    expect(run.executed).toEqual([]);
    expect(result.calls[0]).toMatchObject({ status: 'cancelled', approval: 'denied' });
    expect(result.aborted).toBe(true);
  });

  it('cancels mid execution and still answers every call id the model is waiting on', async () => {
    const controller = new AbortController();
    streamMock
      .mockResolvedValueOnce(turn({ calls: [
        { callId: 'call_1', name: searchTool.name, arguments: '{}' },
        { callId: 'call_2', name: searchTool.name, arguments: '{"query":"next"}' },
      ] }))
      .mockResolvedValueOnce(turn({ content: 'later' }));

    const run = harness({
      signal: controller.signal,
      execute: async (_tool, callId) => {
        if (callId === 'call_1') controller.abort();
        throw abortError();
      },
    });
    const result = await run.run();

    expect(result.aborted).toBe(true);
    expect(result.calls.map((call) => call.callId)).toEqual(['call_1', 'call_2']);
    expect(result.calls.map((call) => call.status)).toEqual(['cancelled', 'cancelled']);
    expect(streamMock).toHaveBeenCalledTimes(1);
  });

  it('keeps the answer it has when the closing call is cancelled', async () => {
    const call = (n: number) => ({ callId: `call_${n}`, name: searchTool.name, arguments: `{"query":"q${n}"}` });
    streamMock
      .mockResolvedValueOnce(turn({ calls: [call(1)], content: 'Working.' }))
      .mockResolvedValueOnce(turn({ calls: [call(2)] }))
      .mockResolvedValueOnce(turn({ calls: [call(3)] }))
      .mockResolvedValueOnce(turn({ calls: [call(4)] }))
      .mockRejectedValueOnce(abortError());

    const result = await harness().run();

    expect(result.stop?.limit).toBe('rounds');
    expect(result.calls).toHaveLength(4);
    expect(result.content).toBe('Working.');
  });
});
