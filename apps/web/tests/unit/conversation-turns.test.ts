import { describe, expect, it } from 'vitest';
import { beginConversationTurn } from '@/src/lib/api/chat/conversation-turns';

const settled = async (promise: Promise<void>) => {
  let done = false;
  void promise.then(() => (done = true));
  await new Promise((resolve) => setTimeout(resolve, 0));
  return done;
};

describe('conversation turns', () => {
  it('starts the first turn right away', async () => {
    const turn = beginConversationTurn('a');
    expect(await settled(turn.ready)).toBe(true);
    turn.end();
  });

  it('holds a steered turn until the interrupted one has saved', async () => {
    const interrupted = beginConversationTurn('b');
    const steered = beginConversationTurn('b');
    const after = beginConversationTurn('b');
    expect(await settled(steered.ready)).toBe(false);
    interrupted.end();
    expect(await settled(steered.ready)).toBe(true);
    expect(await settled(after.ready)).toBe(false);
    steered.end();
    expect(await settled(after.ready)).toBe(true);
    after.end();
  });

  it('does not order different conversations against each other', async () => {
    const one = beginConversationTurn('c');
    const other = beginConversationTurn('d');
    expect(await settled(other.ready)).toBe(true);
    one.end();
    other.end();
  });

  it('stops waiting on a turn that never finishes', async () => {
    beginConversationTurn('e');
    const next = beginConversationTurn('e', 5);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(await settled(next.ready)).toBe(true);
    next.end();
  });
});
