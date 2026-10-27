/**
 * The ordering rules a fork depends on, the fork title, and which ids count as
 * saved. Pure functions, so no database.
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/src/lib/prisma', () => ({ prisma: {} }));

const { MESSAGE_ORDER, MESSAGE_ORDER_DESC, nextPosition } = await import('@/src/lib/server/message-order');
const { forkTitle } = await import('@/src/lib/server/conversation-fork');
const { isSavedMessageId } = await import('@/src/lib/client/message-id');

describe('message order', () => {
  it('sorts by the saved position, oldest column first', () => {
    expect(MESSAGE_ORDER).toEqual([
      { position: { sort: 'asc', nulls: 'first' } },
      { createdAt: 'asc' },
      { id: 'asc' },
    ]);
  });

  it('reverses the same order, putting rows with no position last', () => {
    expect(MESSAGE_ORDER_DESC).toEqual([
      { position: { sort: 'desc', nulls: 'last' } },
      { createdAt: 'desc' },
      { id: 'desc' },
    ]);
  });

  it('names a position after everything already numbered', () => {
    expect(nextPosition(null, 0)).toBe(1);
    expect(nextPosition(3, 3)).toBe(4);
    expect(nextPosition(7, 2)).toBe(8);
  });

  it('stays behind rows saved before positions existed', () => {
    // Four unnumbered rows, none of them numbered yet: the new one goes last.
    expect(nextPosition(null, 4)).toBe(5);
    // Two old unnumbered rows plus one numbered row: still behind both.
    expect(nextPosition(1, 3)).toBe(4);
  });
});

describe('forkTitle', () => {
  it('names the copy after its source', () => {
    expect(forkTitle('Caching plan')).toBe('Fork of Caching plan');
  });

  it('falls back to the first question when the source has no title', () => {
    expect(forkTitle(null, '   How does\n  write-back caching work?  ')).toBe('Fork of How does write-back caching work?');
    expect(forkTitle('   ', 'First thing I asked')).toBe('Fork of First thing I asked');
  });

  it('has something to say even for an untitled chat with no question', () => {
    expect(forkTitle(null, null)).toBe('Fork of untitled chat');
    expect(forkTitle('', '')).toBe('Fork of untitled chat');
  });

  it('keeps to the title limit', () => {
    const title = forkTitle('x'.repeat(200));
    expect(title).toHaveLength(80);
    expect(title.startsWith('Fork of ')).toBe(true);
  });
});

describe('isSavedMessageId', () => {
  it('accepts the ids the database hands out', () => {
    expect(isSavedMessageId('11111111-1111-4111-8111-111111111111')).toBe(true);
    expect(isSavedMessageId('9F1C2D3E-0000-4000-8000-000000000000')).toBe(true);
  });

  it('rejects the composer placeholders and nothing at all', () => {
    expect(isSavedMessageId('user-local-1761548400000-1')).toBe(false);
    expect(isSavedMessageId('assistant-local-1761548400000-2')).toBe(false);
    expect(isSavedMessageId(undefined)).toBe(false);
    expect(isSavedMessageId('')).toBe(false);
    expect(isSavedMessageId('11111111-1111-4111-8111-11111111111')).toBe(false);
  });
});
