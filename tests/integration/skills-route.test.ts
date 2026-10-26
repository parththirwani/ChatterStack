import { beforeEach, describe, expect, it, vi } from 'vitest';
import crypto from 'node:crypto';
import { delta, sseResponse } from '../helpers/sse';

const auth = vi.fn();
type Row = { id: string; userId: string; name: string; description: string; instructions: string; source: string; createdAt: Date; updatedAt: Date };
const rows = new Map<string, Row>();
const unique = () => Object.assign(new Error('Unique constraint failed'), { code: 'P2002' });
const nameTaken = (userId: string, name: string, except?: string) =>
  [...rows.values()].some((row) => row.userId === userId && row.name === name && row.id !== except);

const db = {
  skill: {
    findMany: vi.fn(async ({ where }: { where: { userId: string; id?: { in: string[] } } }) =>
      [...rows.values()].filter((row) => row.userId === where.userId && (!where.id || where.id.in.includes(row.id)))
        .sort((a, b) => a.name.localeCompare(b.name))),
    count: vi.fn(async ({ where }: { where: { userId: string } }) => [...rows.values()].filter((row) => row.userId === where.userId).length),
    create: vi.fn(async ({ data }: { data: Omit<Row, 'id' | 'createdAt' | 'updatedAt'> }) => {
      if (nameTaken(data.userId, data.name)) throw unique();
      const row = { id: crypto.randomUUID(), createdAt: new Date(), updatedAt: new Date(), ...data };
      rows.set(row.id, row);
      return row;
    }),
    updateMany: vi.fn(async ({ where, data }: { where: { id: string; userId: string }; data: Partial<Row> }) => {
      const row = rows.get(where.id);
      if (!row || row.userId !== where.userId) return { count: 0 };
      if (data.name && nameTaken(row.userId, data.name, row.id)) throw unique();
      Object.assign(row, data, { updatedAt: new Date() });
      return { count: 1 };
    }),
    findUniqueOrThrow: vi.fn(async ({ where }: { where: { id: string } }) => rows.get(where.id)),
    findFirst: vi.fn(async ({ where }: { where: { id: string; userId: string } }) => {
      const row = rows.get(where.id);
      return row?.userId === where.userId ? row : null;
    }),
    deleteMany: vi.fn(async ({ where }: { where: { id: string; userId: string } }) => {
      const row = rows.get(where.id);
      if (!row || row.userId !== where.userId) return { count: 0 };
      rows.delete(where.id);
      return { count: 1 };
    }),
  },
};
const withLLMTokenLimit = vi.fn<(user: string, text: string, council: boolean) => Promise<Response | null>>(async () => null);
const recordLLMTokens = vi.fn(async () => {});
vi.mock('@/src/lib/auth', () => ({ auth: () => auth() }));
vi.mock('@/src/lib/prisma', () => ({ prisma: db }));
vi.mock('@/src/middleware/llmTokenRateLimit', () => ({
  withLLMTokenLimit: (user: string, text: string, council: boolean) => withLLMTokenLimit(user, text, council),
  recordLLMTokens: () => recordLLMTokens(),
  countTokens: (text: string) => text.length,
}));

const { GET: list, POST: create } = await import('@/src/app/api/skills/route');
const { GET: read, PATCH: update, DELETE: remove } = await import('@/src/app/api/skills/[id]/route');
const { GET: exportSkill } = await import('@/src/app/api/skills/[id]/export/route');
const { POST: importSkill } = await import('@/src/app/api/skills/import/route');
const { POST: generate } = await import('@/src/app/api/skills/generate/route');

const fetchMock = vi.fn();
const json = (path: string, body: unknown, method = 'POST') => new Request(`http://localhost/api/${path}`, {
  method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
});
const context = (id: string) => ({ params: Promise.resolve({ id }) });
const skill = { name: 'release-notes', description: 'Write release notes.', instructions: 'Lead with user-facing changes.' };

async function createOne(body: object = skill) {
  const response = await create(json('skills', body));
  return { response, body: await response.json() };
}

beforeEach(() => {
  rows.clear();
  vi.clearAllMocks();
  vi.stubEnv('OPENROUTER_API_KEY', 'test-key');
  vi.stubGlobal('fetch', fetchMock);
  auth.mockResolvedValue({ user: { id: 'user-1' } });
});

describe('skill routes', () => {
  it('require a session', async () => {
    auth.mockResolvedValue(null);
    expect((await list()).status).toBe(401);
    expect((await create(json('skills', skill))).status).toBe(401);
    expect((await read(new Request('http://localhost'), context('x'))).status).toBe(401);
    expect((await update(json('skills/x', skill, 'PATCH'), context('x'))).status).toBe(401);
    expect((await remove(new Request('http://localhost'), context('x'))).status).toBe(401);
    expect((await exportSkill(new Request('http://localhost'), context('x'))).status).toBe(401);
    expect((await importSkill(json('skills/import', { content: 'x' }))).status).toBe(401);
    expect((await generate(json('skills/generate', { request: 'x' }))).status).toBe(401);
  });

  it('create, list, update and delete a skill', async () => {
    const { response, body } = await createOne();
    expect(response.status).toBe(201);
    expect(body.skill).toMatchObject({ ...skill, source: 'created' });

    expect((await (await list()).json()).skills).toHaveLength(1);

    const changed = await update(json(`skills/${body.skill.id}`, { ...skill, description: 'Shorter.' }, 'PATCH'), context(body.skill.id));
    expect((await changed.json()).skill.description).toBe('Shorter.');

    expect((await remove(new Request('http://localhost'), context(body.skill.id))).status).toBe(204);
    expect((await (await list()).json()).skills).toEqual([]);
  });

  it('rejects invalid fields and duplicate names', async () => {
    const invalid = await createOne({ ...skill, name: 'Not A Slug' });
    expect(invalid.response.status).toBe(400);
    expect(invalid.body.error).toMatch(/lowercase/);

    await createOne();
    const duplicate = await createOne();
    expect(duplicate.response.status).toBe(409);

    const other = await createOne({ ...skill, name: 'other' });
    const rename = await update(json('skills/x', skill, 'PATCH'), context(other.body.skill.id));
    expect(rename.status).toBe(409);
  });

  it('caps the number of skills per user', async () => {
    for (let index = 0; index < 50; index += 1) await createOne({ ...skill, name: `skill-${index}` });
    const over = await createOne({ ...skill, name: 'one-more' });
    expect(over.response.status).toBe(409);
    expect(over.body.error).toMatch(/up to 50/);
  });

  it("never exposes or changes another user's skill", async () => {
    const { body } = await createOne();
    auth.mockResolvedValue({ user: { id: 'user-2' } });
    expect((await (await list()).json()).skills).toEqual([]);
    expect((await read(new Request('http://localhost'), context(body.skill.id))).status).toBe(404);
    expect((await update(json('skills/x', skill, 'PATCH'), context(body.skill.id))).status).toBe(404);
    expect((await remove(new Request('http://localhost'), context(body.skill.id))).status).toBe(404);
    expect((await exportSkill(new Request('http://localhost'), context(body.skill.id))).status).toBe(404);
    expect(rows.size).toBe(1);
  });

  it('exports a SKILL.md that imports back to the same skill', async () => {
    const { body } = await createOne();
    const exported = await exportSkill(new Request('http://localhost'), context(body.skill.id));
    expect(exported.headers.get('Content-Disposition')).toContain('release-notes.SKILL.md');
    const text = await exported.text();
    expect(text).toMatch(/^---\nname: release-notes\n/);

    const imported = await (await importSkill(json('skills/import', { content: text, fileName: 'SKILL.md' }))).json();
    expect(imported).toEqual({ draft: skill, issues: [] });
  });

  it('imports a file with problems as a draft and lists the issues', async () => {
    const response = await importSkill(json('skills/import', { content: '# Notes Helper\n\nBody only', fileName: 'notes.md' }));
    const body = await response.json();
    expect(body.draft).toMatchObject({ name: 'notes-helper', description: 'Body only' });
    expect(body.issues).toEqual([]);

    const empty = await (await importSkill(json('skills/import', { content: '---\nname: x\n---\n' }))).json();
    expect(empty.issues.map((issue: { field: string }) => issue.field)).toEqual(['description', 'instructions']);

    expect((await importSkill(json('skills/import', { content: 'x'.repeat(65 * 1024) }))).status).toBe(400);
  });
});

describe('skill creator', () => {
  const file = '```markdown\n---\nname: haiku-writer\ndescription: Answers as a haiku.\n---\n\nReply in 5-7-5 syllables.\n```';

  it('drafts a skill with the creator model and counts its tokens', async () => {
    fetchMock.mockResolvedValueOnce(sseResponse([delta({ content: file }), '[DONE]']));
    const response = await generate(json('skills/generate', { request: 'make answers haiku' }));
    expect(await response.json()).toEqual({
      draft: { name: 'haiku-writer', description: 'Answers as a haiku.', instructions: 'Reply in 5-7-5 syllables.' },
      issues: [],
    });
    const sent = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(sent.messages[0].content).toMatch(/SKILL\.md/);
    expect(sent.messages[1].content).toContain('make answers haiku');
    expect(recordLLMTokens).toHaveBeenCalledTimes(1);
  });

  it('revises the current draft when one is given', async () => {
    fetchMock.mockResolvedValueOnce(sseResponse([delta({ content: file }), '[DONE]']));
    await generate(json('skills/generate', { request: 'shorter', current: { name: 'old', description: 'Old.', instructions: 'Old body' } }));
    const sent = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(sent.messages[1].content).toContain('Revise this skill');
    expect(sent.messages[1].content).toContain('Old body');
  });

  it('respects the rate limit and reports model failures', async () => {
    withLLMTokenLimit.mockResolvedValueOnce(new Response('{}', { status: 429 }));
    expect((await generate(json('skills/generate', { request: 'x' }))).status).toBe(429);
    expect(fetchMock).not.toHaveBeenCalled();

    fetchMock.mockResolvedValueOnce(new Response('nope', { status: 500 }));
    const failed = await generate(json('skills/generate', { request: 'x' }));
    expect(failed.status).toBe(502);
  });
});
