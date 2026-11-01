/**
 * Accumulates OpenRouter `tool_calls` streaming deltas.
 *
 * A tool call arrives fragmented across many chunks: the id and name come with
 * the first delta for a given `index`, and the JSON arguments arrive one token
 * at a time. Nothing here parses arguments; callers must wait until the stream
 * ends and use `parseToolCallArguments`, so a half-streamed object is never
 * executed.
 */

/** One entry of `choices[0].delta.tool_calls` as it arrives on the wire. */
export interface RawToolCallDelta {
  index?: number;
  id?: string;
  type?: string;
  function?: { name?: string; arguments?: string };
}

/** A tool call after the stream ended. `arguments` is the raw, complete string. */
export interface StreamedToolCall {
  callId: string;
  name: string;
  arguments: string;
}

interface Slot {
  callId: string;
  name: string;
  args: string;
}

/**
 * A tool call with no name cannot be executed; it is reported instead of being
 * guessed at.
 */
export const UNSUPPORTED_TOOL_CALL_NAME = '__unsupported_tool_call__';

export class ToolCallAccumulator {
  private readonly slots = new Map<number, Slot>();
  private nextIndex = 0;
  private lastIndex: number | undefined;
  private nextSyntheticId = 1;

  push(deltas: readonly RawToolCallDelta[] | undefined | null): void {
    if (!Array.isArray(deltas)) return;
    for (const item of deltas) {
      if (!item || typeof item !== 'object') continue;
      // An index continues that call. Without one, a call id or a name starts a
      // new call and a bare argument fragment continues the latest call.
      const hasIndex = typeof item.index === 'number' && Number.isFinite(item.index);
      const startsCall = Boolean(item.id) || Boolean(item.function?.name);
      let index: number;
      if (hasIndex) {
        index = Math.trunc(item.index as number);
        this.nextIndex = Math.max(this.nextIndex, index + 1);
      } else if (startsCall || this.lastIndex === undefined) {
        index = this.nextIndex++;
      } else {
        index = this.lastIndex;
      }
      this.lastIndex = index;

      let slot = this.slots.get(index);
      if (!slot) {
        slot = { callId: '', name: '', args: '' };
        this.slots.set(index, slot);
      }
      if (typeof item.id === 'string' && item.id) {
        slot.callId = item.id;
      }
      if (typeof item.function?.name === 'string') {
        slot.name += item.function.name;
      }
      if (typeof item.function?.arguments === 'string') {
        slot.args += item.function.arguments;
      }
    }
  }

  get size(): number {
    return this.slots.size;
  }

  /** Complete calls in stream order, with synthesized ids where needed. */
  list(): StreamedToolCall[] {
    return [...this.slots.keys()]
      .sort((a, b) => a - b)
      .map((index) => {
        const slot = this.slots.get(index) as Slot;
        return {
          callId: slot.callId || `call_${index + 1}_${this.nextSyntheticId++}`,
          name: slot.name.trim() || UNSUPPORTED_TOOL_CALL_NAME,
          arguments: slot.args,
        };
      });
  }
}

/** Convenience for a single finished stream. */
export function collectToolCalls(deltas: readonly RawToolCallDelta[][]): StreamedToolCall[] {
  const accumulator = new ToolCallAccumulator();
  for (const batch of deltas) accumulator.push(batch);
  return accumulator.list();
}

export type ParsedToolArguments =
  | { ok: true; value: Record<string, unknown> }
  | { ok: false; error: string };

/**
 * Tool arguments are untrusted model output: they must be JSON, and an object.
 * An empty argument string is the documented way to pass `{}`.
 */
export function parseToolCallArguments(raw: string): ParsedToolArguments {
  const text = (raw ?? '').trim();
  if (!text) return { ok: true, value: {} };
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, error: 'The model sent arguments that are not valid JSON.' };
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, error: 'Tool arguments must be a JSON object.' };
  }
  return { ok: true, value: parsed as Record<string, unknown> };
}

/** Canonical form for repeat-call detection: same call, same key. */
export function toolCallKey(name: string, raw: string): string {
  const parsed = parseToolCallArguments(raw);
  const args = parsed.ok ? stableStringify(parsed.value) : (raw ?? '').trim();
  return `${name}\u0000${args}`;
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(',')}}`;
}
