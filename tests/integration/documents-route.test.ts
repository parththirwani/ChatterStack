import { beforeEach, describe, expect, it, vi } from 'vitest';
import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';

const auth = vi.fn();
const records = new Map<string, Record<string, unknown>>();
const db = {
  document: {
    findMany: vi.fn(async ({ where }: { where: { userId?: string; id?: { in: string[] }; lastUsedAt?: { not: null } } }) =>
      [...records.values()].filter((row) => (!where.userId || row.userId === where.userId) && (!where.id || where.id.in.includes(String(row.id)))
        && (!where.lastUsedAt || row.lastUsedAt !== null))),
    findUnique: vi.fn(async ({ where }: { where: { id?: string; userId_sha256?: { userId: string; sha256: string } } }) =>
      [...records.values()].find((row) => where.id ? row.id === where.id : row.userId === where.userId_sha256?.userId && row.sha256 === where.userId_sha256?.sha256) ?? null),
    findUniqueOrThrow: vi.fn(async ({ where }: { where: { id: string } }) => records.get(where.id)),
    findFirst: vi.fn(async ({ where }: { where: { id: string; userId: string } }) =>
      [...records.values()].find((row) => row.id === where.id && row.userId === where.userId) ?? null),
    create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
      const row = { id: crypto.randomUUID(), createdAt: new Date(), favoritedAt: null, lastUsedAt: null, ...data };
      records.set(String(row.id), row);
      return row;
    }),
    updateMany: vi.fn(async ({ where, data }: { where: { id: string; userId: string }; data: Record<string, unknown> }) => {
      const row = records.get(where.id);
      if (!row || row.userId !== where.userId) return { count: 0 };
      Object.assign(row, data);
      return { count: 1 };
    }),
    delete: vi.fn(async ({ where }: { where: { id: string } }) => { records.delete(where.id); }),
  },
};
const storage = {
  open: vi.fn(),
  read: vi.fn(),
  stream: vi.fn(),
  delete: vi.fn(),
};
const handleUpload = vi.fn();
vi.mock('@/src/lib/auth', () => ({ auth: () => auth() }));
vi.mock('@/src/lib/prisma', () => ({ prisma: db }));
vi.mock('@/src/lib/server/document-storage', () => ({ documentStorage: storage }));
vi.mock('@vercel/blob/client', () => ({ handleUpload }));

const { GET: list, POST: confirm } = await import('@/src/app/api/documents/route');
const { POST: check } = await import('@/src/app/api/documents/check/route');
const { POST: token } = await import('@/src/app/api/documents/upload/route');
const { PATCH: favorite, DELETE: remove } = await import('@/src/app/api/documents/[id]/route');
const { GET: content } = await import('@/src/app/api/documents/[id]/content/route');
const { GET: cleanup } = await import('@/src/app/api/cron/cleanup-documents/route');

const userId = 'user-1';
const file = Buffer.from('# Notes');
const sha256 = crypto.createHash('sha256').update(file).digest('hex');
const storageKey = 'users/user-1/0e7ba32e-05b0-477d-8e30-2bf0a849649e/notes.md';
const input = { name: 'notes.md', mimeType: 'text/markdown', size: file.length, sha256, storageKey };
const request = (path: string, body: unknown) => new Request(`http://localhost/api/${path}`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
});
const context = (id: string) => ({ params: Promise.resolve({ id }) });

beforeEach(() => {
  records.clear();
  vi.clearAllMocks();
  auth.mockResolvedValue({ user: { id: userId } });
  storage.open.mockResolvedValue({ size: file.length, contentType: 'text/markdown', read: async () => file, discard: async () => {} });
  storage.read.mockResolvedValue(file);
  storage.delete.mockResolvedValue(undefined);
  storage.stream.mockImplementation(async () => ({ statusCode: 200, stream: new ReadableStream({
    start(controller) { controller.enqueue(file); controller.close(); },
  }) }));
});

describe('document routes', () => {
  it('requires a session for listing, checking, confirming, updating, deleting and reading', async () => {
    auth.mockResolvedValue(null);
    handleUpload.mockImplementation(async ({ onBeforeGenerateToken }: { onBeforeGenerateToken: (path: string) => Promise<unknown> }) =>
      onBeforeGenerateToken(storageKey));
    expect((await list()).status).toBe(401);
    expect((await check(request('documents/check', { sha256 }))).status).toBe(401);
    expect((await confirm(request('documents', input))).status).toBe(401);
    expect((await token(request('documents/upload', {}))).status).toBe(401);
    expect((await favorite(request('documents/1', { favorite: true }), context('1'))).status).toBe(401);
    expect((await remove(request('documents/1', {}), context('1'))).status).toBe(401);
    expect((await content(request('documents/1/content', {}), context('1'))).status).toBe(401);
  });

  it('confirms a private upload and lists only the current user’s metadata once it has been sent', async () => {
    const result = await confirm(request('documents', input));
    expect(result.status).toBe(201);
    const { document } = await result.json();
    expect(document).toMatchObject({ name: 'notes.md', size: file.length, sha256 });
    expect(JSON.stringify(document)).not.toContain(storageKey);
    // Uploaded but not yet sent in a chat: stored, yet not a resource.
    expect((await (await list()).json()).documents).toEqual([]);
    records.get(document.id)!.lastUsedAt = new Date();
    records.set('other', { id: 'other', userId: 'user-2', name: 'private.pdf', createdAt: new Date(), favoritedAt: null, lastUsedAt: new Date() });
    const listed = await (await list()).json();
    expect(listed.documents.map((item: { id: string }) => item.id)).toEqual([document.id]);
    expect((await (await check(request('documents/check', { sha256 }))).json()).document.id).toBe(document.id);
  });

  it('rejects an upload path outside the current user', async () => {
    const result = await confirm(request('documents', { ...input, storageKey: storageKey.replace('user-1', 'user-2') }));
    expect(result.status).toBe(400);
    expect(db.document.create).not.toHaveBeenCalled();
  });

  it('issues short-lived, size-limited tokens only for supported paths', async () => {
    handleUpload.mockImplementation(async ({ onBeforeGenerateToken }: { onBeforeGenerateToken: (path: string) => Promise<unknown> }) =>
      onBeforeGenerateToken(storageKey));
    const response = await token(request('documents/upload', {}));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ allowedContentTypes: ['text/markdown'], maximumSizeInBytes: 5 * 1024 * 1024 });
    handleUpload.mockImplementation(async ({ onBeforeGenerateToken }: { onBeforeGenerateToken: (path: string) => Promise<unknown> }) =>
      onBeforeGenerateToken(storageKey.replace('user-1', 'user-2')));
    expect((await token(request('documents/upload', {}))).status).toBe(400);
  });

  it('allows favourite and download only for the owner', async () => {
    const saved = await (await confirm(request('documents', input))).json();
    const id = saved.document.id;
    expect((await favorite(request('documents/1', { favorite: true }), context(id))).status).toBe(200);
    expect(records.get(id)?.favoritedAt).toBeInstanceOf(Date);
    const downloaded = await content(request('documents/1/content', {}), context(id));
    expect(downloaded.status).toBe(200);
    expect(downloaded.headers.get('Cache-Control')).toBe('private, no-store');
    expect(Buffer.from(await downloaded.arrayBuffer())).toEqual(file);
    auth.mockResolvedValue({ user: { id: 'user-2' } });
    expect((await favorite(request('documents/1', { favorite: false }), context(id))).status).toBe(404);
    expect((await content(request('documents/1/content', {}), context(id))).status).toBe(404);
    expect(storage.stream).toHaveBeenCalledTimes(1);
  });

  it('deletes the private object and its metadata, with owner isolation', async () => {
    const saved = await (await confirm(request('documents', input))).json();
    const id = saved.document.id;
    auth.mockResolvedValue({ user: { id: 'user-2' } });
    expect((await remove(request('documents/1', {}), context(id))).status).toBe(404);
    expect(storage.delete).not.toHaveBeenCalled();
    auth.mockResolvedValue({ user: { id: userId } });
    expect((await remove(request('documents/1', {}), context(id))).status).toBe(204);
    expect(storage.delete).toHaveBeenCalledWith(storageKey);
    expect(records.has(id)).toBe(false);
  });

  it('serves an authenticated inline preview while keeping downloads as attachments', async () => {
    const saved = await (await confirm(request('documents', input))).json();
    const id = saved.document.id;
    const preview = await content(new Request(`http://localhost/api/documents/${id}/content?preview=1`), context(id));
    expect(preview.headers.get('Content-Disposition')).toMatch(/^inline;/);
    expect(preview.headers.get('Cache-Control')).toBe('private, no-store');
    expect(await preview.text()).toBe('# Notes');
    const download = await content(new Request(`http://localhost/api/documents/${id}/content`), context(id));
    expect(download.headers.get('Content-Disposition')).toMatch(/^attachment;/);
    auth.mockResolvedValue({ user: { id: 'user-2' } });
    expect((await content(new Request(`http://localhost/api/documents/${id}/content?preview=1`), context(id))).status).toBe(404);
  });

  it('extracts readable text from a private DOCX preview', async () => {
    const bytes = readFileSync('tests/fixtures/attachment.docx');
    storage.read.mockResolvedValue(bytes);
    records.set('docx', {
      id: 'docx', userId, name: 'attachment.docx',
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      size: bytes.length, storageKey: 'users/user-1/docx/attachment.docx',
    });
    const preview = await content(new Request('http://localhost/api/documents/docx/content?preview=1'), context('docx'));
    expect(preview.status).toBe(200);
    expect(preview.headers.get('Content-Type')).toBe('text/plain; charset=utf-8');
    expect((await preview.text()).trim().length).toBeGreaterThan(0);
    expect(storage.stream).not.toHaveBeenCalled();
  });

  it('protects the cleanup endpoint with CRON_SECRET', async () => {
    vi.stubEnv('CRON_SECRET', 'test-secret');
    expect((await cleanup(new Request('http://localhost/api/cron/cleanup-documents'))).status).toBe(401);
    expect((await cleanup(new Request('http://localhost/api/cron/cleanup-documents', { headers: { authorization: 'Bearer wrong' } }))).status).toBe(401);
    vi.unstubAllEnvs();
  });
});
