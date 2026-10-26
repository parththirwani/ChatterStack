/**
 * The rail's turn model: how a message list becomes one entry per question,
 * and how those entries are flattened and measured for the preview card.
 */
import { describe, expect, it } from 'vitest';
import { buildTurns, summarize, tickWidth, toPreviewText } from '@/src/components/chat/navigation/turns';
import type { Message } from '@/src/types/chat.types';

const user = (content: string): Message => ({ role: 'user', content });
const assistant = (content: string): Message => ({ role: 'assistant', content });

describe('buildTurns', () => {
  it('pairs a question with the answer that follows it', () => {
    const turns = buildTurns([user('Why is the build slow?'), assistant('Because it reinstalls every time.')]);

    expect(turns).toEqual([
      { anchorIndex: 0, question: 'Why is the build slow?', answer: 'Because it reinstalls every time.' },
    ]);
  });

  it('keeps one entry per question, in document order', () => {
    const turns = buildTurns([
      user('First'),
      assistant('Answer one'),
      user('Second'),
      assistant('Answer two'),
      user('Third'),
    ]);

    expect(turns.map((turn) => [turn.anchorIndex, turn.question, turn.answer])).toEqual([
      [0, 'First', 'Answer one'],
      [2, 'Second', 'Answer two'],
      [4, 'Third', ''],
    ]);
  });

  it('treats the thinking time as one answer even when a turn holds two', () => {
    const turns = buildTurns([user('First'), assistant('Part one.'), assistant('Part two.'), user('Second')]);

    expect(turns[0].answer).toBe('Part one. Part two.');
    expect(turns[1].answer).toBe('');
  });

  it('ignores anything before the first question', () => {
    expect(buildTurns([assistant('stray'), { role: 'system', content: 'prompt' }, user('Real start')])).toEqual([
      { anchorIndex: 2, question: 'Real start', answer: '' },
    ]);
  });

  it('is empty for an empty chat', () => {
    expect(buildTurns([])).toEqual([]);
  });
});

describe('toPreviewText', () => {
  it('drops fenced code and flattens the prose around it', () => {
    const text = toPreviewText('Run this:\n\n```bash\nnpm ci && npm test\n```\n\nIt is enough.');

    expect(text).toBe('Run this: It is enough.');
  });

  it('removes inline markup, headings, list markers, and link targets', () => {
    const text = toPreviewText(
      '## Plan\n\n- use **Redis** for `locks`\n1. ship it\n\n> note\n\nSee [the guide](https://example.com/guide).'
    );

    expect(text).toBe('Plan use Redis for locks ship it note See the guide.');
  });

  it('returns nothing for a message that is only code', () => {
    expect(toPreviewText('```ts\nconst a = 1;\n```')).toBe('');
  });
});

describe('summarize', () => {
  it('keeps short text as it is', () => {
    expect(summarize('Short **question**?')).toBe('Short question?');
  });

  it('cuts long text to one character less than the limit and marks it', () => {
    const out = summarize('a'.repeat(50), 20);

    expect(out).toHaveLength(20);
    expect(out.endsWith('…')).toBe(true);
    expect(out.startsWith('aaaa')).toBe(true);
  });
});

describe('tickWidth', () => {
  it('stays inside the rail', () => {
    for (const question of ['', 'hi', 'a'.repeat(4000)]) {
      expect(tickWidth(question)).toBeGreaterThanOrEqual(10);
      expect(tickWidth(question)).toBeLessThanOrEqual(28);
    }
  });

  it('grows with the question but flattens out', () => {
    expect(tickWidth('hi')).toBeLessThan(tickWidth('a'.repeat(120)));
    expect(tickWidth('a'.repeat(120))).toBeLessThanOrEqual(tickWidth('a'.repeat(1200)));
  });

  it('does not change with whitespace around the question', () => {
    expect(tickWidth('  what?  ')).toBe(tickWidth('what?'));
  });
});
