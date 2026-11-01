import { describe, expect, it } from 'vitest';
import {
  ToolCallAccumulator,
  UNSUPPORTED_TOOL_CALL_NAME,
  collectToolCalls,
  parseToolCallArguments,
  toolCallKey,
} from '@/src/lib/api/chat/tool-stream';

describe('ToolCallAccumulator', () => {
  it('joins a call whose id, name and arguments arrive in separate deltas', () => {
    const accumulator = new ToolCallAccumulator();
    accumulator.push([{ index: 0, id: 'call_a', type: 'function', function: { name: 'search', arguments: '' } }]);
    accumulator.push([{ index: 0, function: { arguments: '{"qu' } }]);
    accumulator.push([{ index: 0, function: { arguments: 'ery":"R2"}' } }]);

    expect(accumulator.list()).toEqual([
      { callId: 'call_a', name: 'search', arguments: '{"query":"R2"}' },
    ]);
  });

  it('keeps parallel calls apart by index and returns them in stream order', () => {
    const accumulator = new ToolCallAccumulator();
    accumulator.push([
      { index: 1, id: 'call_b', function: { name: 'beta' } },
      { index: 0, id: 'call_a', function: { name: 'alpha' } },
    ]);
    accumulator.push([
      { index: 1, function: { arguments: '{}' } },
      { index: 0, function: { arguments: '{"a":1}' } },
    ]);

    expect(accumulator.list().map((call) => call.callId)).toEqual(['call_a', 'call_b']);
    expect(accumulator.list()[0].arguments).toBe('{"a":1}');
    expect(accumulator.list()[1].arguments).toBe('{}');
  });

  it('starts a new call when a delta carries no index', () => {
    const accumulator = new ToolCallAccumulator();
    accumulator.push([{ id: 'call_a', function: { name: 'first', arguments: '{"a":1}' } }]);
    accumulator.push([{ id: 'call_b', function: { name: 'second' } }]);
    accumulator.push([{ function: { arguments: '{}' } }]);

    expect(accumulator.list()).toEqual([
      { callId: 'call_a', name: 'first', arguments: '{"a":1}' },
      { callId: 'call_b', name: 'second', arguments: '{}' },
    ]);
  });

  it('splits a name that the model streamed in pieces', () => {
    const accumulator = new ToolCallAccumulator();
    accumulator.push([{ index: 0, id: 'call_a', function: { name: 'mcp__cf' } }]);
    accumulator.push([{ index: 0, function: { name: '__docs_search' } }]);

    expect(accumulator.list()[0].name).toBe('mcp__cf__docs_search');
  });

  it('invents a call id when the provider omits one', () => {
    const accumulator = new ToolCallAccumulator();
    accumulator.push([{ index: 0, function: { name: 'solo', arguments: '{}' } }]);

    const [call] = accumulator.list();
    expect(call.callId).toMatch(/^call_/);
    expect(call.name).toBe('solo');
  });

  it('marks a call with no name unsupported instead of guessing one', () => {
    const accumulator = new ToolCallAccumulator();
    accumulator.push([{ index: 0, id: 'call_a', function: { arguments: '{}' } }]);

    expect(accumulator.list()[0].name).toBe(UNSUPPORTED_TOOL_CALL_NAME);
  });

  it('is unfazed by empty or malformed deltas', () => {
    const accumulator = new ToolCallAccumulator();
    accumulator.push(undefined);
    accumulator.push(null);
    accumulator.push([]);
    accumulator.push([{}, null as never]);

    expect(accumulator.size).toBe(1);
    expect(accumulator.list()).toEqual([
      { callId: expect.stringMatching(/^call_/), name: UNSUPPORTED_TOOL_CALL_NAME, arguments: '' },
    ]);
  });

  it('collects across batches with collectToolCalls', () => {
    expect(collectToolCalls([[{ index: 0, id: 'a', function: { name: 'x' } }], [{ index: 0, function: { arguments: '1' } }]]))
      .toEqual([{ callId: 'a', name: 'x', arguments: '1' }]);
  });
});

describe('parseToolCallArguments', () => {
  it('treats a missing argument blob as an empty object', () => {
    expect(parseToolCallArguments('')).toEqual({ ok: true, value: {} });
    expect(parseToolCallArguments('   ')).toEqual({ ok: true, value: {} });
  });

  it('parses a complete object', () => {
    expect(parseToolCallArguments('{"query":"R2","limit":3}')).toEqual({
      ok: true,
      value: { query: 'R2', limit: 3 },
    });
  });

  it('refuses half-streamed JSON rather than executing it', () => {
    const parsed = parseToolCallArguments('{"query":"R2"');
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.error).toMatch(/not valid JSON/);
  });

  it.each(['[1,2]', '"text"', '7', 'null'])('refuses %s because arguments must be an object', (raw) => {
    const parsed = parseToolCallArguments(raw);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.error).toMatch(/JSON object/);
  });
});

describe('toolCallKey', () => {
  it('matches the same call written with a different key order', () => {
    expect(toolCallKey('search', '{"a":1,"b":2}')).toBe(toolCallKey('search', '{"b":2,"a":1}'));
  });

  it('separates different tools and different arguments', () => {
    expect(toolCallKey('a', '{}')).not.toBe(toolCallKey('b', '{}'));
    expect(toolCallKey('a', '{"x":1}')).not.toBe(toolCallKey('a', '{"x":2}'));
  });

  it('still keys invalid arguments apart', () => {
    expect(toolCallKey('a', '{"x":')).not.toBe(toolCallKey('a', '{"y":'));
  });
});
