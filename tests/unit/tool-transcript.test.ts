import { describe, expect, it } from 'vitest';
import { asOpenRouterMessages, loopCallToView } from '@/src/lib/api/chat/tool-transcript';
import { DEFAULT_TOOL_LOOP_LIMITS, type ToolLoopCall } from '@/src/lib/api/chat/tool-loop';

const baseCall: ToolLoopCall = {
  callId: 'call-1',
  name: 'Docs__echo',
  connectionId: 'conn-1',
  toolId: 'echo',
  arguments: '{"value":"hi"}',
  status: 'completed',
  approval: 'approved',
  result: 'echo:hi',
  truncated: false,
};

describe('loopCallToView', () => {
  it('keeps short arguments verbatim and omits an absent error', () => {
    expect(loopCallToView(baseCall)).toEqual({
      callId: 'call-1', name: 'Docs__echo', toolId: 'echo', connectionId: 'conn-1',
      arguments: '{"value":"hi"}', status: 'completed', approval: 'approved', result: 'echo:hi', truncated: false,
    });
  });

  it('bounds oversized arguments and long error text', () => {
    const huge: ToolLoopCall = { ...baseCall, arguments: 'x'.repeat(DEFAULT_TOOL_LOOP_LIMITS.maxArgumentBytes * 2), error: 'boom'.repeat(2_000) };
    const view = loopCallToView(huge);
    // The slice is capped at the limit, plus the short truncation marker.
    expect(Buffer.byteLength(view.arguments, 'utf8')).toBeLessThanOrEqual(DEFAULT_TOOL_LOOP_LIMITS.maxArgumentBytes + 12);
    expect(view.arguments).toContain('[truncated]');
    expect(view.error!.length).toBeLessThanOrEqual(2_048);
  });
});

describe('asOpenRouterMessages', () => {
  it('leaves a tool-free history as a plain role/content list', () => {
    const messages = asOpenRouterMessages([
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'hello' },
    ]);
    expect(messages).toEqual([
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'hello' },
    ]);
  });

  it('expands an assistant turn into tool_calls then one result per call id', () => {
    const messages = asOpenRouterMessages([
      { role: 'user', content: 'run two' },
      { role: 'assistant', content: 'done', toolCalls: [baseCall, { ...baseCall, callId: 'call-2', result: 'echo:2' }] },
    ]);
    expect(messages).toEqual([
      { role: 'user', content: 'run two' },
      { role: 'assistant', content: null, tool_calls: [
        { id: 'call-1', type: 'function', function: { name: 'Docs__echo', arguments: '{"value":"hi"}' } },
        { id: 'call-2', type: 'function', function: { name: 'Docs__echo', arguments: '{"value":"hi"}' } },
      ] },
      { role: 'tool', content: 'echo:hi', tool_call_id: 'call-1' },
      { role: 'tool', content: 'echo:2', tool_call_id: 'call-2' },
      { role: 'assistant', content: 'done' },
    ]);
  });
});
