import { beforeEach, describe, expect, it, vi } from 'vitest';
import crypto from 'node:crypto';

const records = new Map<string, Record<string, unknown>>();
const db = {
  document: {
    findUnique: vi.fn(async ({ where }: { where: { userId_sha256: { userId: string; sha256: string } } }) =>
      [...records.values()].find((row) => row.userId === where.userId_sha256.userId && row.sha256 === where.userId_sha256.sha256) ?? null),
    findMany: vi.fn(async ({ where }: { where: { id?: { in: string[] }; userId?: string; storageKey?: { in: string[] } } }) =>
      [...records.values()].filter((row) => (!where.userId || row.userId === where.userId) && (!where.id || where.id.in.includes(String(row.id))) && (!where.storageKey || where.storageKey.in.includes(String(row.storageKey))))),
    findFirst: vi.fn(async ({ where }: { where: { id: string; userId: string } }) =>
      [...records.values()].find((row) => row.id === where.id && row.userId === where.userId) ?? null),
    create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
      const row = { id: crypto.randomUUID(), ...data, createdAt: new Date(), favoritedAt: null, lastUsedAt: null };
      records.set(String(row.id), row);
      return row;
    }),
    updateMany: vi.fn(async () => ({ count: 1 })),
    delete: vi.fn(async ({ where }: { where: { id: string } }) => { records.delete(where.id); }),
  },
};
const discard = vi.fn(async () => {});
const storage = {
  open: vi.fn(),
  read: vi.fn(),
  save: vi.fn(),
  delete: vi.fn(),
  list: vi.fn(),
};
vi.mock('@/src/lib/prisma', () => ({ prisma: db }));
vi.mock('@/src/lib/server/document-storage', () => ({ documentStorage: storage }));
const { confirmUpload, cleanupUnconfirmedUploads, cleanupUnusedDocuments, newStorageKey, resolveDocuments, validStorageKey } =
  await import('@/src/lib/server/documents');

const userId = 'user-1';
const bytes = Buffer.from('# Notes');
const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
const meta = { name: 'notes.md', mimeType: 'text/markdown', size: bytes.length, sha256 };
const key = 'users/user-1/0e7ba32e-05b0-477d-8e30-2bf0a849649e/notes.md';

beforeEach(() => {
  records.clear();
  vi.clearAllMocks();
  storage.open.mockResolvedValue({ size: bytes.length, contentType: meta.mimeType, read: async () => bytes, discard });
  storage.read.mockResolvedValue(bytes);
  storage.save.mockResolvedValue({});
  storage.delete.mockResolvedValue(undefined);
  storage.list.mockResolvedValue({ blobs: [], hasMore: false });
});

describe('document storage rules', () => {
  it('creates a user scoped path with a safe filename', () => {
    const generated = newStorageKey(userId, '../strange name.md');
    expect(validStorageKey(userId, generated)).toBe(true);
    expect(validStorageKey('user-2', generated)).toBe(false);
    expect(generated).not.toContain('..');
  });

  it('verifies stored bytes, size and type before creating metadata', async () => {
    const result = await confirmUpload(userId, { ...meta, storageKey: key });
    expect(result.storageKey).toBe(key);
    expect(db.document.create).toHaveBeenCalledOnce();
    expect(storage.open).toHaveBeenCalledOnce();
    expect(storage.open).toHaveBeenCalledWith(key);
  });

  it('reuses the same content per user without reading or uploading it again', async () => {
    const first = await confirmUpload(userId, { ...meta, storageKey: key });
    vi.clearAllMocks();
    const again = await confirmUpload(userId, { ...meta, storageKey: newStorageKey(userId, meta.name) });
    expect(again.id).toBe(first.id);
    expect(storage.open).not.toHaveBeenCalled();
    expect(db.document.create).not.toHaveBeenCalled();
  });

  it.each([
    ['different user path', { ...meta, storageKey: key.replace('user-1', 'user-2') }],
    ['unsupported type', { ...meta, mimeType: 'text/html', storageKey: key }],
    ['wrong hash', { ...meta, sha256: '0'.repeat(64), storageKey: key }],
  ])('rejects %s', async (_label, input) => {
    await expect(confirmUpload(userId, input)).rejects.toThrow();
    expect(db.document.create).not.toHaveBeenCalled();
  });

  it('rejects metadata that disagrees with the stored object', async () => {
    const read = vi.fn(async () => bytes);
    storage.open.mockResolvedValue({ size: 2, contentType: meta.mimeType, read, discard });
    await expect(confirmUpload(userId, { ...meta, storageKey: key })).rejects.toThrow('does not match');
    // The mismatch is caught from metadata alone, so the body is never downloaded.
    expect(read).not.toHaveBeenCalled();
    expect(discard).toHaveBeenCalledOnce();
    expect(db.document.create).not.toHaveBeenCalled();
  });

  it('rejects an upload whose stored type differs from the claimed one', async () => {
    storage.open.mockResolvedValue({ size: bytes.length, contentType: 'application/pdf', read: async () => bytes, discard });
    await expect(confirmUpload(userId, { ...meta, storageKey: key })).rejects.toThrow('does not match');
    expect(discard).toHaveBeenCalledOnce();
  });

  it('rejects an upload that is not in storage', async () => {
    storage.open.mockResolvedValue(null);
    await expect(confirmUpload(userId, { ...meta, storageKey: key })).rejects.toThrow('does not match');
    expect(db.document.create).not.toHaveBeenCalled();
  });

  it('does not resolve another user’s document', async () => {
    records.set('other', { id: 'other', userId: 'user-2', name: 'secret.md', mimeType: 'text/markdown', size: 1, storageKey: 'other' });
    await expect(resolveDocuments(userId, [{ documentId: 'other', name: 'secret.md', mimeType: 'text/markdown', size: 1 }])).rejects.toThrow('Document not found');
    expect(storage.read).not.toHaveBeenCalled();
  });

  it('uses saved sizes to enforce the aggregate limit, even if the request lies', async () => {
    for (let index = 0; index < 3; index++) records.set(String(index), {
      id: String(index), userId, name: 'large.pdf', mimeType: 'application/pdf', size: 4 * 1024 * 1024, storageKey: String(index),
    });
    const files = Array.from({ length: 3 }, (_, index) => ({ documentId: String(index), name: 'large.pdf', mimeType: 'application/pdf', size: 1 }));
    await expect(resolveDocuments(userId, files)).rejects.toThrow('10 MB');
    expect(storage.read).not.toHaveBeenCalled();
  });

  it('turns missing historical files into no bytes', async () => {
    expect(await resolveDocuments(userId, [{ documentId: 'gone', name: 'old.md', mimeType: 'text/markdown', size: 2 }], true)).toEqual([]);
  });

  it('deletes only old unfavourited documents', async () => {
    const old = new Date('2026-08-01T00:00:00Z');
    records.set('stale', { id: 'stale', userId, name: 'stale.md', storageKey: 'stale', createdAt: old, lastUsedAt: old, favoritedAt: null });
    records.set('favorite', { id: 'favorite', userId, name: 'favorite.md', storageKey: 'favorite', createdAt: old, lastUsedAt: old, favoritedAt: old });
    db.document.findMany.mockImplementationOnce(async () => [records.get('stale')!]);
    expect(await cleanupUnusedDocuments(new Date('2026-10-27T00:00:00Z'))).toBe(1);
    expect(db.document.findMany).toHaveBeenCalledWith({
      where: {
        favoritedAt: null,
        createdAt: { lt: new Date('2026-09-27T00:00:00.000Z') },
        OR: [{ lastUsedAt: null }, { lastUsedAt: { lt: new Date('2026-09-27T00:00:00.000Z') } }],
      },
      select: { id: true, userId: true },
      take: 100,
    });
    expect(storage.delete).toHaveBeenCalledWith('stale');
    expect(records.has('stale')).toBe(false);
    expect(records.has('favorite')).toBe(true);
  });

  it('deletes only unconfirmed objects older than one day, across listing pages', async () => {
    const old = new Date('2026-10-20T00:00:00Z');
    const recent = new Date('2026-10-27T00:00:00Z');
    records.set('known', { id: 'known', userId, storageKey: 'users/known' });
    storage.list
      .mockResolvedValueOnce({ blobs: [
        { pathname: 'users/known', uploadedAt: old },
        { pathname: 'users/orphan', uploadedAt: old },
      ], hasMore: true, cursor: 'next' })
      .mockResolvedValueOnce({ blobs: [{ pathname: 'users/recent', uploadedAt: recent }], hasMore: false });
    db.document.findMany.mockImplementation(async ({ where }: { where: { id?: { in: string[] }; userId?: string; storageKey?: { in: string[] } } }) =>
      [...records.values()].filter((row) => where.storageKey?.in.includes(String(row.storageKey))));
    expect((await cleanupUnconfirmedUploads(new Date('2026-10-27T12:00:00Z')))).toEqual({ removed: 1, hasMore: false, cursor: null });
    expect(storage.list).toHaveBeenNthCalledWith(2, 'next');
    expect(storage.delete).toHaveBeenCalledTimes(1);
    expect(storage.delete).toHaveBeenCalledWith('users/orphan');
  });

  it('bounds the work per run and reports hasMore with a resume cursor', async () => {
    const old = new Date('2026-10-20T00:00:00Z');
    const pages = [
      { blobs: [{ pathname: 'users/orphan-1', uploadedAt: old }], hasMore: true, cursor: 'c2' },
      { blobs: [{ pathname: 'users/orphan-2', uploadedAt: old }], hasMore: true, cursor: 'c3' },
      { blobs: [{ pathname: 'users/orphan-3', uploadedAt: old }], hasMore: true, cursor: 'c4' },
      { blobs: [{ pathname: 'users/orphan-4', uploadedAt: old }], hasMore: true, cursor: 'c5' },
    ];
    pages.forEach((page) => storage.list.mockResolvedValueOnce(page));
    db.document.findMany.mockImplementation(async () => []);

    const run = await cleanupUnconfirmedUploads(new Date('2026-10-27T12:00:00Z'), { maxPages: 3 });
    expect(run).toEqual({ removed: 3, hasMore: true, cursor: 'c4' });
    expect(storage.list).toHaveBeenCalledTimes(3);
    expect(storage.delete).toHaveBeenCalledTimes(3);
  });

  it('resumes from the cursor of the previous run', async () => {
    const old = new Date('2026-10-20T00:00:00Z');
    storage.list.mockReset();
    storage.list.mockResolvedValue({ blobs: [{ pathname: 'users/orphan-b', uploadedAt: old }], hasMore: false });
    db.document.findMany.mockImplementation(async () => []);

    const run = await cleanupUnconfirmedUploads(new Date('2026-10-27T12:00:00Z'), { cursor: 'page-2' });
    expect(run).toEqual({ removed: 1, hasMore: false, cursor: null });
    expect(storage.list).toHaveBeenCalledTimes(1);
    expect(storage.list).toHaveBeenCalledWith('page-2');
    expect(storage.delete).toHaveBeenCalledWith('users/orphan-b');
  });

  it('also stops on the time budget with a resume cursor', async () => {
    const old = new Date('2026-10-20T00:00:00Z');
    let elapsed = 0;
    vi.spyOn(Date, 'now').mockImplementation(() => 1_000 + (elapsed += 15_000));
    storage.list.mockReset();
    storage.list.mockResolvedValue({ blobs: [{ pathname: 'users/orphan-t', uploadedAt: old }], hasMore: true, cursor: 'next-t' });
    db.document.findMany.mockImplementation(async () => []);

    const run = await cleanupUnconfirmedUploads(new Date('2026-10-27T12:00:00Z'), { maxPages: 100, timeBudgetMs: 10_000 });
    expect(run.hasMore).toBe(true);
    expect(run.cursor).toBe('next-t');
    expect(storage.list).toHaveBeenCalledTimes(1);
  });
});
