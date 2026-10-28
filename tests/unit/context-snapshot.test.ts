import { beforeEach, describe, expect, it, vi } from 'vitest';

const rows = new Map<string, Record<string, unknown>>();

const api = {
  findUnique: vi.fn(async ({ where }: { where: { conversationId: string } }) => rows.get(where.conversationId) ?? null),
  create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
    const row = { id: 'snap', version: 1, schemaVersion: 1, createdAt: new Date(), updatedAt: new Date(), ...data };
    rows.set(String(data.conversationId), row);
    return row;
  }),
  updateMany: vi.fn(async ({ where, data }: { where: { conversationId: string; version: number }; data: Record<string, unknown> }) => {
    const row = rows.get(where.conversationId);
    if (!row || row.version !== where.version) return { count: 0 };
    Object.assign(row, data);
    return { count: 1 };
  }),
  deleteMany: vi.fn(async ({ where }: { where: { conversationId: string } }) => ({
    count: rows.delete(where.conversationId) ? 1 : 0,
  })),
};

vi.mock('@/src/lib/prisma', () => ({ prisma: { conversationContextSnapshot: api } }));

const { commitContextSnapshot, dropSnapshotIfBoundaryMissing, loadContextSnapshot } = await import(
  '@/src/lib/api/chat/context-snapshot'
);

const input = {
  conversationId: 'conversation-1',
  summaryText: '## Current goal\nShip it.',
  throughMessageId: 'm2',
  sourceHash: 'hash-1',
  summaryModelId: 'openai/gpt-4o-mini',
  inputTokensBefore: 1000,
  inputTokensAfter: 200,
  summaryTokens: 40,
};

beforeEach(() => {
  rows.clear();
  Object.values(api).forEach((fn) => fn.mockClear());
});

describe('context snapshot store', () => {
  it('creates the first snapshot with version 1', async () => {
    const saved = await commitContextSnapshot({ ...input, expectedVersion: null });
    expect(saved).toMatchObject({ conversationId: 'conversation-1', throughMessageId: 'm2', version: 1 });
    expect(await loadContextSnapshot('conversation-1')).toMatchObject({ summaryText: input.summaryText });
  });

  it('updates only the version the summary was built from', async () => {
    await commitContextSnapshot({ ...input, expectedVersion: null });

    const updated = await commitContextSnapshot({
      ...input,
      throughMessageId: 'm4',
      summaryText: '## Current goal\nNewer.',
      expectedVersion: 1,
    });
    expect(updated).toMatchObject({ throughMessageId: 'm4', version: 2 });

    const stale = await commitContextSnapshot({ ...input, throughMessageId: 'm6', expectedVersion: 1 });
    expect(stale).toBeNull();
    expect(await loadContextSnapshot('conversation-1')).toMatchObject({ throughMessageId: 'm4', version: 2 });
  });

  it('refuses to create over a snapshot it did not read', async () => {
    await commitContextSnapshot({ ...input, expectedVersion: null });
    expect(await commitContextSnapshot({ ...input, expectedVersion: null })).toBeNull();
  });

  it('drops a snapshot whose boundary a retry removed', async () => {
    await commitContextSnapshot({ ...input, expectedVersion: null });

    expect(await dropSnapshotIfBoundaryMissing('conversation-1', ['m1', 'm2', 'm3'])).not.toBeNull();
    expect(await dropSnapshotIfBoundaryMissing('conversation-1', ['m1', 'm3'])).toBeNull();
    expect(api.deleteMany).toHaveBeenCalledWith({ where: { conversationId: 'conversation-1' } });
  });

  it('leaves a snapshot in storage while a retry is still pending', async () => {
    await commitContextSnapshot({ ...input, expectedVersion: null });

    expect(await dropSnapshotIfBoundaryMissing('conversation-1', ['m1'], false)).toBeNull();
    expect(await loadContextSnapshot('conversation-1')).toMatchObject({ throughMessageId: 'm2' });
    expect(api.deleteMany).not.toHaveBeenCalled();
  });
});
