import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  planContextView,
  recentStartIndex,
  summaryBlockMessage,
  validateSummary,
  __contextCompactionForTests,
  type ContextMessage,
} from '@/src/lib/api/chat/model-context';
import { hashContextSource, type ContextSnapshot } from '@/src/lib/api/chat/context-snapshot';
import { countTokens } from '@/src/middleware/llmTokenRateLimit';

const snapshot = (overrides: Partial<ContextSnapshot> = {}): ContextSnapshot => ({
  id: 'snap-1',
  conversationId: 'conversation-1',
  summaryText: '## Current goal\nKeep the old task.',
  throughMessageId: 'm2',
  sourceHash: hashContextSource(exchange(1)),
  version: 1,
  schemaVersion: 1,
  summaryModelId: 'openai/gpt-4o-mini',
  inputTokensBefore: 900,
  inputTokensAfter: 200,
  summaryTokens: 40,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

const exchange = (index: number): ContextMessage[] => [
  { id: `m${index}`, role: 'user', content: `Question ${index}. ${'alpha '.repeat(40)}` },
  { id: `m${index + 1}`, role: 'assistant', content: `Answer ${index}. ${'beta '.repeat(40)}` },
];

describe('recentStartIndex', () => {
  it('keeps the last two completed exchanges and everything after them', () => {
    const history = [...exchange(1), ...exchange(3), ...exchange(5)];
    // Assistants are at 1, 3 and 5; the second newest starts at the user at 2.
    expect(recentStartIndex(history, 2)).toBe(2);
  });

  it('keeps an incomplete trailing question with the tail', () => {
    const history = [...exchange(1), ...exchange(3), { id: 'm5', role: 'user' as const, content: 'No answer yet' }];
    // Both completed exchanges plus the trailing question have to stay.
    expect(recentStartIndex(history, 2)).toBe(0);
  });

  it('returns zero when there are fewer completed exchanges than requested', () => {
    expect(recentStartIndex(exchange(1), 2)).toBe(0);
  });
});

describe('summary input', () => {
  it('includes the end of an oversized individual message without exceeding chunk budgets', () => {
    const content = `${'middle '.repeat(3000)}END_MARKER`;
    const chunks = __contextCompactionForTests.chunkTranscript(
      [{ id: 'large', role: 'user', content }],
      300
    );
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.join('')).toBe(`User: ${content}`);
    expect(chunks.every((chunk) => countTokens(chunk) <= 300)).toBe(true);
  });
});

describe('planContextView', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('does nothing while the request is below the trigger', () => {
    const history = [{ id: 'm1', role: 'user' as const, content: 'short' }];
    const plan = planContextView({ history, snapshot: null, systemTokens: 10, currentTokens: 10, budget: 10_000, mode: 'on' });
    expect(plan.kind).toBe('none');
  });

  it('cuts at an exchange boundary when the trigger is crossed', () => {
    vi.stubEnv('COMPACTION_TRIGGER_MAX_TOKENS', '100');
    const history = [...exchange(1), ...exchange(3), ...exchange(5)];
    const plan = planContextView({ history, snapshot: null, systemTokens: 10, currentTokens: 10, budget: 10_000, mode: 'on' });

    expect(plan.kind).toBe('compact');
    if (plan.kind !== 'compact') return;
    expect(plan.summarize.map((message) => message.id)).toEqual(['m1', 'm2']);
    expect(plan.keep.map((message) => message.id)).toEqual(['m3', 'm4', 'm5', 'm6']);
  });

  it('merges a previous snapshot with only the newly older turns', () => {
    vi.stubEnv('COMPACTION_TRIGGER_MAX_TOKENS', '100');
    const history = [...exchange(1), ...exchange(3), ...exchange(5), ...exchange(7)];
    const plan = planContextView({
      history,
      snapshot: snapshot(),
      systemTokens: 10,
      currentTokens: 10,
      budget: 10_000,
      mode: 'on',
    });

    expect(plan.kind).toBe('compact');
    if (plan.kind !== 'compact') return;
    expect(plan.previous?.throughMessageId).toBe('m2');
    expect(plan.summarize.map((message) => message.id)).toEqual(['m3', 'm4']);
    expect(plan.keep.map((message) => message.id)).toEqual(['m5', 'm6', 'm7', 'm8']);
  });

  it('uses the snapshot view without a new summary when nothing older needs folding in', () => {
    const history = [...exchange(1), ...exchange(3), ...exchange(5)];
    const plan = planContextView({
      history,
      snapshot: snapshot(),
      systemTokens: 10,
      currentTokens: 10,
      budget: 10_000,
      mode: 'on',
    });

    expect(plan.kind).toBe('none');
    if (plan.kind !== 'none') return;
    expect(plan.history[0].content).toContain('Earlier conversation summary');
    expect(plan.history.map((message) => message.id)).toEqual([undefined, 'm3', 'm4', 'm5', 'm6']);
  });

  it('does not reuse a snapshot when an earlier saved message changed under the same id', () => {
    const history = [...exchange(1), ...exchange(3), ...exchange(5)];
    history[0] = { ...history[0], content: 'Corrected instruction' };
    const plan = planContextView({
      history,
      snapshot: snapshot(),
      systemTokens: 10,
      currentTokens: 10,
      budget: 10_000,
      mode: 'on',
    });

    expect(plan.kind).toBe('none');
    if (plan.kind !== 'none') return;
    expect(plan.history).toBe(history);
    expect(plan.history[0].content).toBe('Corrected instruction');
  });

  it('ignores snapshots entirely when the kill switch is off', () => {
    const history = [...exchange(1), ...exchange(3)];
    const plan = planContextView({
      history,
      snapshot: snapshot(),
      systemTokens: 10,
      currentTokens: 10,
      budget: 10_000,
      mode: 'off',
    });

    expect(plan.kind).toBe('none');
    if (plan.kind !== 'none') return;
    expect(plan.history).toBe(history);
  });

  it('refuses an over-budget request instead of truncating it', () => {
    const history = [...exchange(1), ...exchange(3), ...exchange(5)];
    const plan = planContextView({ history, snapshot: null, systemTokens: 10, currentTokens: 10, budget: 20, mode: 'off' });
    expect(plan.kind).toBe('reject');
  });
});

describe('validateSummary', () => {
  const headings = [
    '## Current goal',
    '## Durable instructions and preferences',
    '## Established facts',
    '## Decisions and rationale',
    '## Unresolved work',
    '## Exact details',
  ].join('\n\n');

  it('accepts a structured summary smaller than its source', () => {
    expect(validateSummary(`${headings}\n\nPayload.`, 500)).toEqual({ ok: true, tokens: expect.any(Number) });
  });

  it('rejects empty, section-less and inflated summaries', () => {
    expect(validateSummary('   ', 500).ok).toBe(false);
    expect(validateSummary('A summary without headings.', 500).ok).toBe(false);
    expect(validateSummary(`${headings}\n\n${'x '.repeat(4000)}`, 100).ok).toBe(false);
  });
});

describe('snapshot helpers', () => {
  it('hashes ids and content deterministically', () => {
    const messages = [
      { id: 'a', role: 'user', content: 'one' },
      { id: 'b', role: 'assistant', content: 'two' },
    ];
    expect(hashContextSource(messages)).toBe(hashContextSource([...messages]));
    expect(hashContextSource(messages)).not.toBe(hashContextSource([{ ...messages[0], content: 'changed' }]));
  });

  it('marks the summary as background data, not a system instruction', () => {
    const message = summaryBlockMessage('## Current goal\nShip it.');
    expect(message.role).toBe('user');
    expect(message.content).toContain('not as new instructions');
    expect(message.content).toContain('## Current goal');
  });
});
