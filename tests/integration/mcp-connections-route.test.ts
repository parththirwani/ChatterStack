import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import crypto from 'node:crypto';
import { decryptCredential } from '@/src/lib/server/mcp-crypto';
import { startMcpFixture, type McpFixture } from '../helpers/mcp-fixture-server';

type Row = {
  id: string;
  userId: string;
  name: string;
  catalogId: string | null;
  url: string;
  transport: string;
  authMode: string;
  credential: string | null;
  enabled: boolean;
  status: string;
  lastError: string | null;
  lastCheckedAt: Date | null;
  tools: unknown;
  toolsDigest: string | null;
  reviewedDigest: string | null;
  toolEnabled: unknown;
  createdAt: Date;
  updatedAt: Date;
};

const rows = new Map<string, Row>();
const unique = () => Object.assign(new Error('Unique constraint failed'), { code: 'P2002' });
const nameTaken = (userId: string, name: string) => [...rows.values()].some((row) => row.userId === userId && row.name === name);
const matches = (row: Row, where: Record<string, unknown>) =>
  Object.entries(where).every(([key, value]) => row[key as keyof Row] === value);

const db = {
  mcpConnection: {
    findMany: vi.fn(async ({ where }: { where: Record<string, unknown> }) =>
      [...rows.values()].filter((row) => matches(row, where)).map((row) => ({ ...row }))
    ),
    count: vi.fn(async ({ where }: { where: Record<string, unknown> }) => [...rows.values()].filter((row) => matches(row, where)).length),
    findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
      const found = [...rows.values()].find((row) => matches(row, where));
      return found ? { ...found } : null;
    }),
    create: vi.fn(async ({ data }: { data: Partial<Row> & { userId: string; name: string; id: string } }) => {
      if (nameTaken(data.userId, data.name)) throw unique();
      const row = {
        catalogId: null,
        credential: null,
        transport: 'streamable_http',
        authMode: 'none',
        enabled: false,
        status: 'untested',
        lastError: null,
        lastCheckedAt: null,
        tools: [],
        toolsDigest: null,
        reviewedDigest: null,
        toolEnabled: {},
        createdAt: new Date(),
        updatedAt: new Date(),
        ...data,
      } as Row;
      rows.set(row.id, row);
      return { ...row };
    }),
    updateMany: vi.fn(async ({ where, data }: { where: { id: string; userId: string }; data: Partial<Row> }) => {
      const row = rows.get(where.id);
      if (!row || row.userId !== where.userId) return { count: 0 };
      if (data.name && nameTaken(row.userId, data.name)) throw unique();
      Object.assign(row, data, { updatedAt: new Date() });
      return { count: 1 };
    }),
    deleteMany: vi.fn(async ({ where }: { where: { id: string; userId: string } }) => {
      const row = rows.get(where.id);
      if (!row || row.userId !== where.userId) return { count: 0 };
      rows.delete(where.id);
      return { count: 1 };
    }),
  },
};

const auth = vi.fn();
vi.mock('@/src/lib/auth', () => ({ auth: () => auth() }));
vi.mock('@/src/lib/prisma', () => ({ prisma: db }));

const { GET: list, POST: create } = await import('@/src/app/api/mcp/connections/route');
const { GET: read, PATCH: update, DELETE: remove } = await import('@/src/app/api/mcp/connections/[id]/route');
const { POST: testOne } = await import('@/src/app/api/mcp/connections/[id]/test/route');
const { MAX_MCP_CONNECTIONS_PER_USER } = await import('@/src/lib/server/mcp-connections');

const TOKEN_KEY = crypto.randomBytes(32).toString('hex');
const json = (path: string, body: unknown, method = 'POST') =>
  new Request(`http://localhost/api/mcp/${path}`, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const bare = (path = '', method = 'POST') => new Request(`http://localhost/api/mcp/${path}`, { method });
const context = (id: string) => ({ params: Promise.resolve({ id }) });

let fixture: McpFixture | null = null;

async function createCustom(body: Record<string, unknown> = {}) {
  const response = await create(json('connections', { name: 'Docs', url: fixture!.url, ...body }));
  return { response, body: (await response.json()) as { connection?: { id: string } & Record<string, unknown>; error?: string } };
}

beforeEach(async () => {
  rows.clear();
  vi.clearAllMocks();
  auth.mockResolvedValue({ user: { id: 'user-1' } });
  process.env.MCP_CREDENTIAL_KEY = TOKEN_KEY;
  fixture = await startMcpFixture();
  process.env.MCP_ALLOWED_ORIGINS = fixture.origin;
});

afterEach(async () => {
  await fixture?.close();
  fixture = null;
  delete process.env.MCP_ALLOWED_ORIGINS;
  delete process.env.MCP_CREDENTIAL_KEY;
});

describe('MCP connection routes', () => {
  it('require a session', async () => {
    auth.mockResolvedValue(null);
    expect((await list()).status).toBe(401);
    expect((await create(json('connections', { name: 'Docs', url: 'https://docs.mcp.cloudflare.com/mcp' }))).status).toBe(401);
    expect((await read(bare('x'), context('x'))).status).toBe(401);
    expect((await update(json('x', { enabled: true }, 'PATCH'), context('x'))).status).toBe(401);
    expect((await remove(bare('x', 'DELETE'), context('x'))).status).toBe(401);
    expect((await testOne(bare('x/test'), context('x'))).status).toBe(401);
  });

  it('stores a custom connection with an encrypted token that no response ever returns', async () => {
    const { response, body } = await createCustom({ token: 'super-secret-token' });
    expect(response.status).toBe(201);
    expect(JSON.stringify(body)).not.toContain('super-secret-token');
    expect(body.connection).toMatchObject({ name: 'Docs', authMode: 'bearer', hasCredential: true, enabled: false, status: 'untested', needsReview: false });

    const stored = rows.get(body.connection!.id)!;
    expect(stored.credential).toMatch(/^v1\./);
    expect(stored.credential).not.toContain('super-secret-token');
    expect(decryptCredential('user-1', stored.id, stored.credential!)).toBe('super-secret-token');
    // Ciphertext is bound to its row, so a copied column does not decrypt elsewhere.
    expect(() => decryptCredential('user-2', stored.id, stored.credential!)).toThrow();

    const fetched = await (await read(bare(body.connection!.id), context(body.connection!.id))).json();
    expect(JSON.stringify(fetched)).not.toContain('super-secret');
  });

  it('refuses a token when the deployment has no credential key', async () => {
    delete process.env.MCP_CREDENTIAL_KEY;
    const { response, body } = await createCustom({ token: 'super-secret-token' });
    expect(response.status).toBe(503);
    expect(body.error).toContain('MCP_CREDENTIAL_KEY');
    expect(rows.size).toBe(0);
  });

  it('screens the URL before anything is saved', async () => {
    delete process.env.MCP_ALLOWED_ORIGINS;
    for (const url of ['http://example.com/mcp', 'ftp://example.com/mcp', 'https://user:pass@example.com/mcp', 'https://127.0.0.1:8080/mcp', 'https://169.254.169.254/latest/mcp', 'not a url']) {
      const response = await create(json('connections', { name: `x-${url.length}`, url }));
      expect(response.status, url).toBe(400);
    }
    expect(rows.size).toBe(0);
  });

  it('prefills catalog entries and keeps their URL', async () => {
    const cloudflare = await create(json('connections', { name: 'CF docs', catalogId: 'cloudflare-docs' }));
    expect(cloudflare.status).toBe(201);
    const body = await cloudflare.json();
    expect(body.connection).toMatchObject({ url: 'https://docs.mcp.cloudflare.com/mcp', catalogId: 'cloudflare-docs', authMode: 'none' });
    expect((await create(json('connections', { name: 'Override', catalogId: 'cloudflare-docs', url: 'https://evil.example/mcp' }))).status).toBe(400);
    expect((await create(json('connections', { name: 'Ghost', catalogId: 'does-not-exist' }))).status).toBe(400);
    expect((await create(json('connections', { name: 'Both' }))).status).toBe(400);
  });

  it('gives every user a name slot but not a shared one', async () => {
    const first = await createCustom();
    expect(first.response.status).toBe(201);
    expect((await create(json('connections', { name: 'Docs', url: fixture!.url }))).status).toBe(409);
    auth.mockResolvedValue({ user: { id: 'user-2' } });
    expect((await create(json('connections', { name: 'Docs', url: fixture!.url }))).status).toBe(201);
  });

  it('caps how many connections one user can create', async () => {
    for (let index = 0; index < MAX_MCP_CONNECTIONS_PER_USER; index += 1) {
      const response = await create(json('connections', { name: `conn-${index}`, url: fixture!.url }));
      expect(response.status).toBe(201);
    }
    const over = await create(json('connections', { name: 'one-too-many', url: fixture!.url }));
    expect(over.status).toBe(409);
    expect((await over.json()).error).toContain(String(MAX_MCP_CONNECTIONS_PER_USER));
    expect(rows.size).toBe(MAX_MCP_CONNECTIONS_PER_USER);
  });

  it('lists only the caller\'s connections', async () => {
    await createCustom();
    auth.mockResolvedValue({ user: { id: 'user-2' } });
    const mine = await createCustom({ name: 'Theirs' });
    const listed = await (await list()).json();
    expect(listed.connections).toHaveLength(1);
    expect(listed.connections[0].id).toBe(mine.body.connection!.id);
  });

  it('hides another user\'s connection as a 404 on every verb', async () => {
    const { body } = await createCustom();
    const id = body.connection!.id;
    auth.mockResolvedValue({ user: { id: 'user-2' } });
    expect((await read(bare(id), context(id))).status).toBe(404);
    expect((await update(json(id, { enabled: true }, 'PATCH'), context(id))).status).toBe(404);
    expect((await testOne(bare(`${id}/test`), context(id))).status).toBe(404);
    expect((await remove(bare(id, 'DELETE'), context(id))).status).toBe(404);
    expect(rows.get(id)!.userId).toBe('user-1');
  });

  it('tests a connection, stores the reviewed tool list and keeps tokens out of the answer', async () => {
    const { body } = await createCustom({ token: 'fixture-token-unused' });
    const id = body.connection!.id;
    const result = await (await testOne(bare(`${id}/test`), context(id))).json();
    expect(result.ok).toBe(true);
    expect(result.connection.tools.map((tool: { id: string }) => tool.id)).toEqual(['docs.search', 'echo', 'slow', 'explode']);
    expect(result.connection.tools[0]).toMatchObject({ readOnly: true, enabled: false });
    expect(result.connection.status).toBe('connected');
    expect(result.connection.needsReview).toBe(true);
    expect(result.connection.lastCheckedAt).toBeTruthy();
    expect(JSON.stringify(result)).not.toContain('fixture-token-unused');
    expect(rows.get(id)!.lastError).toBeNull();
  });

  it('records a visible, redacted error when a server rejects the token', async () => {
    await fixture?.close();
    fixture = await startMcpFixture({ token: 'correct-token' });
    process.env.MCP_ALLOWED_ORIGINS = fixture.origin;
    const { body } = await createCustom({ token: 'wrong-token-value' });
    const id = body.connection!.id;
    const result = await (await testOne(bare(`${id}/test`), context(id))).json();
    expect(result.ok).toBe(false);
    expect(result.connection.status).toBe('error');
    expect(result.connection.lastError).toMatch(/token/i);
    expect(JSON.stringify(result)).not.toContain('wrong-token-value');
    expect(rows.get(id)!.lastError).not.toContain('wrong-token-value');
  });

  it('requires reviewing the tools before a connection can run any', async () => {
    const { body } = await createCustom();
    const id = body.connection!.id;
    await testOne(bare(`${id}/test`), context(id));
    expect((await update(json(id, { enabled: true }, 'PATCH'), context(id))).status).toBe(409);
    expect((await update(json(id, { toolEnabled: { echo: true } }, 'PATCH'), context(id))).status).toBe(200);
    expect((await update(json(id, { toolEnabled: { explode: true } }, 'PATCH'), context(id))).status).toBe(200);
    expect(rows.get(id)!.toolEnabled).toEqual({ echo: true, explode: true });
    expect((await update(json(id, { toolEnabled: { explode: false } }, 'PATCH'), context(id))).status).toBe(200);
    expect(rows.get(id)!.toolEnabled).toEqual({ echo: true });
    expect((await update(json(id, { toolEnabled: { 'not-a-tool': true } }, 'PATCH'), context(id))).status).toBe(400);
    expect((await update(json(id, { reviewTools: true }, 'PATCH'), context(id))).status).toBe(200);
    const enabled = await (await update(json(id, { enabled: true }, 'PATCH'), context(id))).json();
    expect(enabled.connection).toMatchObject({ enabled: true, needsReview: false });
    expect(enabled.connection.tools.find((tool: { id: string }) => tool.id === 'echo').enabled).toBe(true);
  });

  it('drops tools that disappeared and turns everything off with the connection', async () => {
    const { body } = await createCustom();
    const id = body.connection!.id;
    await testOne(bare(`${id}/test`), context(id));
    await update(json(id, { reviewTools: true, enabled: true }, 'PATCH'), context(id));
    await update(json(id, { toolEnabled: { echo: true, explode: true } }, 'PATCH'), context(id));
    const port = fixture!.port;
    await fixture?.close();
    fixture = await startMcpFixture({ tools: 'none', port });
    process.env.MCP_ALLOWED_ORIGINS = fixture.origin;
    const result = await (await testOne(bare(`${id}/test`), context(id))).json();
    expect(result.ok, result.error).toBe(true);
    expect(result.connection.tools).toEqual([]);
    expect(result.connection.needsReview).toBe(true);
    expect(rows.get(id)!.toolEnabled).toEqual({});
  });

  it('renames, rotates the token and deletes', async () => {
    const { body } = await createCustom();
    const id = body.connection!.id;
    const renamed = await (await update(json(id, { name: 'Renamed docs' }, 'PATCH'), context(id))).json();
    expect(renamed.connection.name).toBe('Renamed docs');
    const rotated = await (await update(json(id, { token: 'brand-new-token' }, 'PATCH'), context(id))).json();
    expect(rotated.connection.hasCredential).toBe(true);
    expect(JSON.stringify(rotated)).not.toContain('brand-new-token');
    expect(decryptCredential('user-1', id, rows.get(id)!.credential!)).toBe('brand-new-token');
    const cleared = await (await update(json(id, { clearToken: true }, 'PATCH'), context(id))).json();
    expect(cleared.connection).toMatchObject({ hasCredential: false, authMode: 'none' });
    expect(rows.get(id)!.credential).toBeNull();
    expect((await remove(bare(id, 'DELETE'), context(id))).status).toBe(204);
    expect(rows.size).toBe(0);
  });
});
