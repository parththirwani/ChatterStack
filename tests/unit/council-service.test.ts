import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { StreamOptions } from '@/src/lib/api/chat/openrouter';

const streamCompletion = vi.fn();
vi.mock('@/src/lib/api/chat/openrouter', () => ({ streamCompletion: (...args: unknown[]) => streamCompletion(...args) }));

const { runCouncilProcess } = await import('@/src/services/council/councilService');

type Msg = { role: string; content: string };
const GPT = 'openai/gpt-6.1-sol';
const GEMINI = 'google/gemini-4-argon';
const CLAUDE = 'anthropic/claude-sonnet-5.5';
const DEEPSEEK = 'deepseek/deepseek-v4.1-flash-1017';

function stageOf(messages: Msg[]): 'stage1' | 'stage2' | 'stage3' {
  if (messages[0].role === 'user') return 'stage2';
  return messages[0].content.includes('Stage 3') ? 'stage3' : 'stage1';
}

beforeEach(() => {
  vi.useFakeTimers();
  // Failing members are logged on purpose; keep test output readable.
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  streamCompletion.mockReset();
  streamCompletion.mockImplementation(async (messages: Msg[], model: string, options: StreamOptions = {}) => {
    const stage = stageOf(messages);
    if (stage === 'stage1') return `answer from ${model}`;
    if (stage === 'stage2') return 'Analysis…\nFINAL RANKING:\n1. Response B\n2. Response A\n3. Response C';
    options.onReasoning?.('weighing answers');
    options.onChunk?.('Final ');
    options.onChunk?.('answer');
    return 'Final answer';
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

async function run(options: Parameters<typeof runCouncilProcess>[2], callbacks: Parameters<typeof runCouncilProcess>[3] = {}) {
  const promise = runCouncilProcess('What is TCP?', [], options, callbacks);
  await vi.runAllTimersAsync();
  return promise;
}

const callsFor = (stage: string) =>
  streamCompletion.mock.calls.filter(([messages]) => stageOf(messages as Msg[]) === stage);

describe('runCouncilProcess', () => {
  it('asks exactly the chosen members and lets the chosen chair write the answer', async () => {
    const result = await run({ members: [GPT, CLAUDE], chair: CLAUDE, thinkingLevel: 'high' });

    expect(result).toBe('Final answer');
    expect(callsFor('stage1').map(([, model]) => model).sort()).toEqual([CLAUDE, GPT].sort());
    expect(callsFor('stage2').map(([, model]) => model).sort()).toEqual([CLAUDE, GPT].sort());
    expect(callsFor('stage3').map(([, model]) => model)).toEqual([CLAUDE]);
  });

  it('applies the thinking level to every member and the chair', async () => {
    await run({ members: [GPT, GEMINI], chair: GEMINI, thinkingLevel: 'max' });
    for (const [, , options] of streamCompletion.mock.calls) {
      expect((options as StreamOptions).thinkingLevel).toBe('max');
    }
  });

  it('streams the chair’s reasoning and answer, and reports each member’s answer and the rankings', async () => {
    const onChunk = vi.fn();
    const onReasoning = vi.fn();
    const onAnswer = vi.fn();
    const onRankings = vi.fn();
    await run({ members: [GPT, GEMINI, CLAUDE], chair: GEMINI }, { onChunk, onReasoning, onAnswer, onRankings });

    expect(onChunk.mock.calls.map(([chunk]) => chunk).join('')).toBe('Final answer');
    expect(onReasoning).toHaveBeenCalledWith('weighing answers');
    expect(onAnswer.mock.calls.map(([answer]) => answer.model).sort()).toEqual([CLAUDE, GEMINI, GPT].sort());
    expect(onAnswer).toHaveBeenCalledWith({ model: GPT, response: `answer from ${GPT}` });

    // Every reviewer ranked "Response B" (the second answer) first.
    const rankings = onRankings.mock.calls[0][0] as Array<{ model: string; averageRank: number }>;
    expect(rankings[0]).toEqual({ model: GEMINI, averageRank: 1 });
    expect(rankings.map((r) => r.model)).toEqual([GEMINI, GPT, CLAUDE]);
  });

  it('reports progress for each stage, including the chair', async () => {
    const onProgress = vi.fn();
    await run({ members: [GPT, GEMINI], chair: GPT }, { onProgress });
    const seen = onProgress.mock.calls.map(([stage, model, progress]) => `${stage}:${model}:${progress}`);
    expect(seen).toEqual(
      expect.arrayContaining([
        `stage1:${GPT}:0`, `stage1:${GPT}:100`, `stage1:${GEMINI}:100`,
        `stage2:${GPT}:100`, `stage2:${GEMINI}:100`,
        `stage3:${GPT}:0`, `stage3:${GPT}:100`,
      ])
    );
  });

  it('reports how long every model call took, so the total can be broken down', async () => {
    const onTiming = vi.fn();
    await run({ members: [GPT, GEMINI], chair: GPT }, { onTiming });

    const seen = onTiming.mock.calls.map(([timing]) => timing.stage + ':' + timing.model).sort();
    expect(seen).toEqual([
      'stage1:' + GEMINI, 'stage1:' + GPT,
      'stage2:' + GEMINI, 'stage2:' + GPT,
      'stage3:' + GPT,
    ]);
    expect(onTiming.mock.calls.every(([timing]) => typeof timing.durationMs === 'number')).toBe(true);
  });

  it('does not report a time for a member that never answered', async () => {
    const base = streamCompletion.getMockImplementation()!;
    streamCompletion.mockImplementation(async (messages: Msg[], model: string, options?: StreamOptions) => {
      if (model === DEEPSEEK && stageOf(messages) === 'stage1') throw new Error('overloaded');
      return base(messages, model, options);
    });
    const onTiming = vi.fn();
    await run({ members: [GPT, GEMINI, DEEPSEEK], chair: GPT }, { onTiming });

    const seen = onTiming.mock.calls.map(([timing]) => timing.stage + ':' + timing.model);
    expect(seen).not.toContain('stage1:' + DEEPSEEK);
    expect(seen).toContain('stage1:' + GPT);
  });

  it('marks a failing member as skipped and leaves it out of peer review', async () => {
    const base = streamCompletion.getMockImplementation()!;
    streamCompletion.mockImplementation(async (messages: Msg[], model: string, options?: StreamOptions) => {
      if (model === DEEPSEEK && stageOf(messages) === 'stage1') throw new Error('overloaded');
      return base(messages, model, options);
    });
    const onProgress = vi.fn();

    const result = await run({ members: [GPT, GEMINI, DEEPSEEK], chair: GEMINI }, { onProgress });

    expect(result).toBe('Final answer');
    expect(onProgress).toHaveBeenCalledWith('stage1', DEEPSEEK, -1);
    expect(callsFor('stage2').map(([, model]) => model)).not.toContain(DEEPSEEK);
  });

  it('fails loudly when no member could answer, instead of returning an error as the answer', async () => {
    streamCompletion.mockRejectedValue(new Error('down'));
    const onChunk = vi.fn();
    const promise = runCouncilProcess('What is TCP?', [], { members: [GPT, GEMINI], chair: GPT }, { onChunk });
    const assertion = expect(promise).rejects.toThrow('No council member could answer');
    await vi.runAllTimersAsync();
    await assertion;
    expect(onChunk).not.toHaveBeenCalled();
  });

  it('runs peer review in parallel (staggered), not one member after another', async () => {
    const base = streamCompletion.getMockImplementation()!;
    const reviewStarts: number[] = [];
    streamCompletion.mockImplementation(async (messages: Msg[], model: string, options?: StreamOptions) => {
      if (stageOf(messages) === 'stage2') {
        reviewStarts.push(Date.now());
        await new Promise((resolve) => setTimeout(resolve, 30_000)); // a slow reasoning model
      }
      return base(messages, model, options);
    });
    const started = Date.now();
    await run({ members: [GPT, GEMINI, CLAUDE, DEEPSEEK], chair: GPT, thinkingLevel: 'high' });

    expect(reviewStarts).toHaveLength(4);
    // All four reviews start within the 1s stagger of each other...
    expect(Math.max(...reviewStarts) - Math.min(...reviewStarts)).toBeLessThanOrEqual(3000);
    // ...so the whole council takes about one review, not four (2+ minutes) in a row.
    expect(Date.now() - started).toBeLessThan(40_000);
  });

  it('passes the stop signal to every model call', async () => {
    const stop = new AbortController();
    await run({ members: [GPT, GEMINI], chair: GPT, signal: stop.signal });
    expect(streamCompletion.mock.calls.every(([, , options]) => (options as StreamOptions).signal === stop.signal)).toBe(true);
  });

  it('stops before the next stage once stopped, returning no answer', async () => {
    const stop = new AbortController();
    const base = streamCompletion.getMockImplementation()!;
    streamCompletion.mockImplementation(async (messages: Msg[], model: string, options?: StreamOptions) => {
      const result = await base(messages, model, options);
      stop.abort(); // the user presses Stop during the independent answers
      return result;
    });
    const result = await run({ members: [GPT, GEMINI], chair: GPT, signal: stop.signal });
    expect(result).toBe('');
    expect(callsFor('stage2')).toHaveLength(0);
    expect(callsFor('stage3')).toHaveLength(0);
  });
});
