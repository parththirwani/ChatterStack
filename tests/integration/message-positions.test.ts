/**
 * Message numbering: where a saved exchange lands in its conversation's order,
 * and what a retry removes. The real persistence helpers against a faked Prisma.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = {
  message: {
    aggregate: vi.fn(),
    count: vi.fn(),
    createMany: vi.fn(),
    findFirst: vi.fn(),
    deleteMany: vi.fn(),
  },
  conversation: { update: vi.fn(), create: vi.fn() },
  $transaction: vi.fn(),
};

vi.mock('@/src/lib/prisma', () => ({ prisma: db }));

const { addMessagesToConversation, deleteLastExchange } = await import('@/src/lib/api/chat/conversation-persistance');

const CONVERSATION = '11111111-1111-4111-8111-111111111111';
const saved = () => db.message.createMany.mock.calls[0][0].data as Array<{ role: string; position: number }>;

beforeEach(() => {
  Object.values(db.message).forEach((fn) => fn.mockReset());
  Object.values(db.conversation).forEach((fn) => fn.mockReset());
  db.$transaction.mockReset();
  // Prisma hands the transactional client to a callback; here that is the same fake.
  db.$transaction.mockImplementation(async (work: unknown) =>
    typeof work === 'function' ? (work as (tx: unknown) => unknown)(db) : Promise.all(work as Promise<unknown>[]));
  db.conversation.update.mockResolvedValue({});
  db.message.createMany.mockResolvedValue({ count: 2 });
  db.message.aggregate.mockResolvedValue({ _max: { position: null } });
  db.message.count.mockResolvedValue(0);
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('addMessagesToConversation', () => {
  it('starts a first exchange at position 1 and 2', async () => {
    await addMessagesToConversation(CONVERSATION, 'Explain TCP', 'Slow start doubles cwnd.', 'openai/gpt-6.1-sol');
    expect(saved().map((row) => row.position)).toEqual([1, 2]);
    expect(saved().map((row) => row.role)).toEqual(['user', 'assistant']);
  });

  it('continues after the highest position already in the chat', async () => {
    db.message.aggregate.mockResolvedValue({ _max: { position: 8 } });
    await addMessagesToConversation(CONVERSATION, 'And the risks?', 'Lost writes.');
    expect(saved().map((row) => row.position)).toEqual([9, 10]);
  });

  it('sits behind rows that were saved without a position', async () => {
    // Four old rows, none numbered: max position is nothing, so the row count wins.
    db.message.aggregate.mockResolvedValue({ _max: { position: null } });
    db.message.count.mockResolvedValue(4);
    await addMessagesToConversation(CONVERSATION, 'Next question', 'An answer.');
    expect(saved().map((row) => row.position)).toEqual([5, 6]);
  });

  it('numbers the question alone when there is no answer to save', async () => {
    await addMessagesToConversation(CONVERSATION, 'Question only', '', 'openai/gpt-6.1-sol');
    expect(saved().map((row) => row.position)).toEqual([1]);
  });

  it('reads the position and inserts in one transaction, so two writers cannot share a number', async () => {
    const order: string[] = [];
    db.$transaction.mockImplementation(async (work: (tx: unknown) => unknown) => {
      order.push('transaction');
      return work({
        message: {
          aggregate: async () => { order.push('read'); return { _max: { position: 2 } }; },
          count: async () => 2,
          createMany: async () => { order.push('insert'); return { count: 2 }; },
        },
        conversation: { update: async () => ({}) },
      });
    });
    await addMessagesToConversation(CONVERSATION, 'Q', 'A');
    expect(order).toEqual(['transaction', 'read', 'insert']);
  });

  it('bumps the chat activity to the last saved message', async () => {
    await addMessagesToConversation(CONVERSATION, 'Q', 'A');
    expect(db.conversation.update).toHaveBeenCalledWith({
      where: { id: CONVERSATION },
      data: { updatedAt: expect.any(Date) },
    });
  });
});

describe('deleteLastExchange', () => {
  const questionAt = new Date('2026-10-20T09:00:00Z');

  it('looks for the last question in saved order', async () => {
    db.message.findFirst.mockResolvedValue({ position: 5, createdAt: questionAt });
    db.message.deleteMany.mockResolvedValue({ count: 2 });
    await deleteLastExchange(CONVERSATION);
    expect(db.message.findFirst).toHaveBeenCalledWith({
      where: { conversationId: CONVERSATION, role: 'user' },
      orderBy: [{ position: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }, { id: 'desc' }],
      select: { position: true, createdAt: true },
    });
  });

  it('drops everything from that question onwards by position', async () => {
    db.message.findFirst.mockResolvedValue({ position: 5, createdAt: questionAt });
    db.message.deleteMany.mockResolvedValue({ count: 2 });
    expect(await deleteLastExchange(CONVERSATION)).toBe(2);
    expect(db.message.deleteMany).toHaveBeenCalledWith({
      where: { conversationId: CONVERSATION, position: { gte: 5 } },
    });
  });

  it('falls back to the timestamp for a question saved without a position', async () => {
    db.message.findFirst.mockResolvedValue({ position: null, createdAt: questionAt });
    db.message.deleteMany.mockResolvedValue({ count: 2 });
    await deleteLastExchange(CONVERSATION);
    expect(db.message.deleteMany).toHaveBeenCalledWith({
      where: { conversationId: CONVERSATION, createdAt: { gte: questionAt } },
    });
  });

  it('does nothing to a chat with no saved question', async () => {
    db.message.findFirst.mockResolvedValue(null);
    expect(await deleteLastExchange(CONVERSATION)).toBe(0);
    expect(db.message.deleteMany).not.toHaveBeenCalled();
  });
});
