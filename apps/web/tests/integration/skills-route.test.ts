import { beforeEach, describe, expect, it, vi } from 'vitest';
import crypto from 'node:crypto';
import { strToU8, unzipSync, zipSync, strFromU8 } from 'fflate';

const auth = vi.fn();
type Row = {
  id: string; userId: string; name: string; description: string; instructions: string; source: string;
  enabled: boolean; categories: string[]; files: unknown; metadata: unknown; version: number; catalogId: string | null;
  createdAt: Date; updatedAt: Date;
};
const rows = new Map<string, Row>();
const unique = () => Object.assign(new Error('Unique constraint failed'), { code: 'P2002' });
const nameTaken = (userId: string, name: string, except?: string) =>
  [...rows.values()].some((row) => row.userId === userId && row.name === name && row.id !== except);
const matches = (row: Row, where: Record<string, unknown>) => Object.entries(where).every(([key, value]) =>
  value && typeof value === 'object' && 'in' in value ? (value.in as string[]).includes(String(row[key as keyof Row])) : row[key as keyof Row] === value);

const db = {
  skill: {
    findMany: vi.fn(async ({ where }: { where: Record<string, unknown> }) => [...rows.values()].filter((row) => matches(row, where))),
    count: vi.fn(async ({ where }: { where: Record<string, unknown> }) => [...rows.values()].filter((row) => matches(row, where)).length),
    findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) => [...rows.values()].find((row) => matches(row, where)) ?? null),
    create: vi.fn(async ({ data }: { data: Partial<Row> & { userId: string; name: string } }) => {
      if (nameTaken(data.userId, data.name)) throw unique();
      const row = { id: crypto.randomUUID(), enabled: true, version: 1, createdAt: new Date(), updatedAt: new Date(), ...data } as Row;
      rows.set(row.id, row);
      return row;
    }),
    update: vi.fn(async ({ where, data }: { where: { id: string }; data: Partial<Row> & { version?: { increment: number } } }) => {
      const row = rows.get(where.id)!;
      if (data.name && nameTaken(row.userId, data.name, row.id)) throw unique();
      const { version, ...rest } = data;
      Object.assign(row, rest, { updatedAt: new Date() });
      if (version) row.version += version.increment;
      return row;
    }),
    deleteMany: vi.fn(async ({ where }: { where: { id: string; userId: string } }) => {
      const row = rows.get(where.id);
      if (!row || row.userId !== where.userId) return { count: 0 };
      rows.delete(where.id);
      return { count: 1 };
    }),
  },
};
vi.mock('@/src/lib/auth', () => ({ auth: () => auth() }));
vi.mock('@/src/lib/prisma', () => ({ prisma: db }));

const { GET: list, POST: create } = await import('@/src/app/api/skills/route');
const { GET: read, PATCH: update, DELETE: remove } = await import('@/src/app/api/skills/[id]/route');
const { GET: download } = await import('@/src/app/api/skills/[id]/download/route');
const { POST: duplicate } = await import('@/src/app/api/skills/[id]/duplicate/route');
const { POST: upload } = await import('@/src/app/api/skills/upload/route');
const { POST: addFromCatalog } = await import('@/src/app/api/skills/catalog/route');

const json = (path: string, body: unknown, method = 'POST') => new Request(`http://localhost/api/${path}`, {
  method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
});
const bare = () => new Request('http://localhost');
const context = (id: string) => ({ params: Promise.resolve({ id }) });
const skill = { name: 'release-notes', description: 'Write release notes for a changelog.', instructions: 'Lead with user-facing changes.' };
const SKILL_MD = '---\nname: style-guide\ndescription: Apply our writing style.\nlicense: MIT\nmetadata:\n  version: "2"\n---\n\nUse short sentences.';

function uploadRequest(files: Array<[string, Uint8Array | string]>, replaceId?: string) {
  const form = new FormData();
  for (const [name, content] of files) form.append('files', new File([content as BlobPart], name));
  if (replaceId) form.append('replaceId', replaceId);
  return new Request('http://localhost/api/skills/upload', { method: 'POST', body: form });
}

async function createOne(body: object = skill) {
  const response = await create(json('skills', body));
  return { response, body: await response.json() };
}

beforeEach(() => {
  rows.clear();
  vi.clearAllMocks();
  auth.mockResolvedValue({ user: { id: 'user-1' } });
});

describe('skill routes', () => {
  it('require a session', async () => {
    auth.mockResolvedValue(null);
    expect((await list()).status).toBe(401);
    expect((await create(json('skills', skill))).status).toBe(401);
    expect((await read(bare(), context('x'))).status).toBe(401);
    expect((await update(json('skills/x', skill, 'PATCH'), context('x'))).status).toBe(401);
    expect((await remove(bare(), context('x'))).status).toBe(401);
    expect((await download(bare(), context('x'))).status).toBe(401);
    expect((await duplicate(bare(), context('x'))).status).toBe(401);
    expect((await upload(uploadRequest([['SKILL.md', SKILL_MD]]))).status).toBe(401);
    expect((await addFromCatalog(json('skills/catalog', { id: 'code-review' }))).status).toBe(401);
  });

  it('creates a skill with supporting files and guessed categories', async () => {
    const { response, body } = await createOne({ ...skill, files: [{ path: 'templates/entry.md', content: '## v1' }] });
    expect(response.status).toBe(201);
    expect(body.skill).toMatchObject({
      ...skill, source: 'created', enabled: true, version: 1, files: [{ path: 'templates/entry.md', content: '## v1' }],
    });
    expect(body.skill.categories).toContain('Writing');
    expect((await (await list()).json()).skills).toHaveLength(1);
  });

  it('rejects invalid fields, unsafe file paths and duplicate names', async () => {
    expect((await createOne({ ...skill, name: 'Not A Slug' })).response.status).toBe(400);
    const unsafe = await createOne({ ...skill, files: [{ path: '../secret.md', content: 'x' }] });
    expect(unsafe.response.status).toBe(400);
    expect(unsafe.body.error).toMatch(/relative path/);
    expect((await createOne({ ...skill, files: [{ path: 'SKILL.md', content: 'x' }] })).response.status).toBe(400);

    await createOne();
    expect((await createOne()).response.status).toBe(409);
    const other = await createOne({ ...skill, name: 'other' });
    expect((await update(json('x', { name: 'release-notes' }, 'PATCH'), context(other.body.skill.id))).status).toBe(409);
  });

  it('turns a skill off without a new version, and bumps the version on edits', async () => {
    const { body } = await createOne();
    const off = await (await update(json('x', { enabled: false }, 'PATCH'), context(body.skill.id))).json();
    expect(off.skill).toMatchObject({ enabled: false, version: 1 });
    const edited = await (await update(json('x', { instructions: 'Shorter.' }, 'PATCH'), context(body.skill.id))).json();
    expect(edited.skill).toMatchObject({ instructions: 'Shorter.', version: 2, description: skill.description });
    expect((await update(json('x', {}, 'PATCH'), context(body.skill.id))).status).toBe(400);
  });

  it('caps the number of skills per user', async () => {
    for (let index = 0; index < 200; index += 1) await createOne({ ...skill, name: `skill-${index}` });
    const over = await createOne({ ...skill, name: 'one-more' });
    expect(over.response.status).toBe(409);
    expect(over.body.error).toMatch(/up to 200/);
  });

  it("never exposes or changes another user's skill", async () => {
    const { body } = await createOne();
    auth.mockResolvedValue({ user: { id: 'user-2' } });
    expect((await (await list()).json()).skills).toEqual([]);
    expect((await read(bare(), context(body.skill.id))).status).toBe(404);
    expect((await update(json('x', { enabled: false }, 'PATCH'), context(body.skill.id))).status).toBe(404);
    expect((await remove(bare(), context(body.skill.id))).status).toBe(404);
    expect((await download(bare(), context(body.skill.id))).status).toBe(404);
    expect((await duplicate(bare(), context(body.skill.id))).status).toBe(404);
    expect((await upload(uploadRequest([['SKILL.md', SKILL_MD]], body.skill.id))).status).toBe(400);
    expect(rows.get(body.skill.id)?.enabled).toBe(true);
  });

  it('duplicates under a free name', async () => {
    const { body } = await createOne();
    const first = await (await duplicate(bare(), context(body.skill.id))).json();
    const second = await (await duplicate(bare(), context(body.skill.id))).json();
    expect([first.skill.name, second.skill.name]).toEqual(['release-notes-copy', 'release-notes-copy-2']);
  });

  it('adds Discover skills once, and turns an added one back on', async () => {
    const added = await (await addFromCatalog(json('skills/catalog', { id: 'code-review' }))).json();
    expect(added.skill).toMatchObject({ name: 'code-review', source: 'catalog', catalogId: 'code-review', categories: ['Code'] });
    await update(json('x', { enabled: false }, 'PATCH'), context(added.skill.id));
    const again = await (await addFromCatalog(json('skills/catalog', { id: 'code-review' }))).json();
    expect(again.skill).toMatchObject({ id: added.skill.id, enabled: true });
    expect(rows.size).toBe(1);
    expect((await addFromCatalog(json('skills/catalog', { id: 'nope' }))).status).toBe(404);
  });

  it('saves full upstream instructions for an external catalog skill', async () => {
    const response = await addFromCatalog(json('skills/catalog', { id: 'mattpocock-ask-matt' }));
    expect(response.status).toBe(200);
    const { skill: added } = await response.json();
    expect(added).toMatchObject({ name: 'ask-matt', catalogId: 'mattpocock-ask-matt', categories: ['Coding'] });
    expect(added.instructions).toContain('# Ask Matt');
    expect(added.instructions.length).toBeGreaterThan(1000);
  });

  it('adds a Discover skill under a free name when the user has one with its name', async () => {
    const { body: mine } = await createOne({ ...skill, name: 'skill-creator' });
    const added = await (await addFromCatalog(json('skills/catalog', { id: 'skill-creator' }))).json();
    expect(added.skill).toMatchObject({ name: 'skill-creator-2', catalogId: 'skill-creator' });
    expect(rows.get(mine.skill.id)!.name).toBe('skill-creator');
    // Adding again finds the copy by catalog id, whatever it's called.
    const again = await (await addFromCatalog(json('skills/catalog', { id: 'skill-creator' }))).json();
    expect(again.skill.id).toBe(added.skill.id);
  });
});

describe('upload and download', () => {
  it('uploads a SKILL.md and keeps extra frontmatter for export', async () => {
    const response = await upload(uploadRequest([['SKILL.md', SKILL_MD]]));
    const { results } = await response.json();
    expect(results[0].skill).toMatchObject({
      name: 'style-guide', source: 'uploaded', instructions: 'Use short sentences.',
      frontmatter: 'license: MIT\nmetadata:\n  version: "2"',
    });
    expect(results[0].checks).toContain('SKILL.md frontmatter is valid');

    const zip = await download(bare(), context(results[0].skill.id));
    expect(zip.headers.get('Content-Disposition')).toContain('style-guide.zip');
    const entries = unzipSync(new Uint8Array(await zip.arrayBuffer()));
    expect(strFromU8(entries['style-guide/SKILL.md'])).toBe(
      '---\nname: style-guide\ndescription: "Apply our writing style."\nlicense: MIT\nmetadata:\n  version: "2"\n---\n\nUse short sentences.\n'
    );
  });

  it('uploads .zip and .skill archives with their text files, and reports skipped ones', async () => {
    const archive = zipSync({
      'brand-voice/SKILL.md': strToU8('---\nname: brand-voice\ndescription: Write in our brand voice.\n---\nBody'),
      'brand-voice/references/words.md': strToU8('Avoid: synergy'),
      'brand-voice/scripts/check.py': strToU8('print("hi")'),
      'brand-voice/assets/logo.png': new Uint8Array([137, 80, 78, 71, 0, 1, 2]),
      '__MACOSX/brand-voice/._SKILL.md': strToU8('junk'),
    });
    const { results } = await (await upload(uploadRequest([['brand-voice.zip', archive], ['copy.skill', archive]]))).json();
    expect(results[0].skill.files).toEqual([
      { path: 'references/words.md', content: 'Avoid: synergy' },
      { path: 'scripts/check.py', content: 'print("hi")' },
    ]);
    expect(results[0].warnings.join(' ')).toMatch(/Skipped 1 file.*assets\/logo\.png/);
    expect(results[0].warnings.join(' ')).toMatch(/never run.*scripts\/check\.py/);
    // The second copy has the same name, so it fails on its own.
    expect(results[1].error).toMatch(/already exists/);

    const zip = unzipSync(new Uint8Array(await (await download(bare(), context(results[0].skill.id))).arrayBuffer()));
    expect(Object.keys(zip).sort()).toEqual(['brand-voice/SKILL.md', 'brand-voice/references/words.md', 'brand-voice/scripts/check.py']);
  });

  it('accepts SKILL.md at the archive root', async () => {
    const archive = zipSync({ 'SKILL.md': strToU8('---\nname: rooted\ndescription: At the root.\n---\nBody'), 'notes.txt': strToU8('n') });
    const { results } = await (await upload(uploadRequest([['rooted.skill', archive]]))).json();
    expect(results[0].skill).toMatchObject({ name: 'rooted', files: [{ path: 'notes.txt', content: 'n' }] });
  });

  it.each([
    ['notes.md', '# Just a heading\n\nNo frontmatter', /must start with YAML frontmatter/],
    ['SKILL.md', '---\nname: x\n---\nBody', /description/],
    ['skill.pdf', 'x', /\.md, \.zip or \.skill/],
    ['broken.zip', 'not a zip', /not a valid zip/],
  ])('refuses %s with a clear error', async (name, content, message) => {
    const response = await upload(uploadRequest([[name, content]]));
    expect(response.status).toBe(400);
    expect((await response.json()).results[0].error).toMatch(message);
  });

  it('refuses archives without SKILL.md, with unsafe paths, or that unpack too large', async () => {
    const cases: Array<[Record<string, Uint8Array>, RegExp]> = [
      [{ 'a/readme.md': strToU8('x') }, /must contain a SKILL\.md/],
      [{ 'a/b/c/SKILL.md': strToU8('---\nname: deep\ndescription: d\n---\nx') }, /must contain a SKILL\.md/],
      [{ 'SKILL.md': strToU8('---\nname: x\ndescription: d\n---\nx'), '../evil.md': strToU8('x') }, /Unsafe path/],
      [{ 'SKILL.md': strToU8('---\nname: x\ndescription: d\n---\nx'), 'big.txt': new Uint8Array(3 * 1024 * 1024) }, /too large/],
    ];
    for (const [entries, message] of cases) {
      const { results } = await (await upload(uploadRequest([['s.zip', zipSync(entries)]]))).json();
      expect(results[0].error).toMatch(message);
    }
  });

  it('replaces a skill in place with a new version', async () => {
    const { body } = await createOne();
    const archive = zipSync({ 'release-notes/SKILL.md': strToU8('---\nname: release-notes\ndescription: Newer.\n---\nNew body') });
    const { results } = await (await upload(uploadRequest([['r.zip', archive]], body.skill.id))).json();
    expect(results[0].skill).toMatchObject({ id: body.skill.id, description: 'Newer.', instructions: 'New body', version: 2 });
    expect(rows.size).toBe(1);
  });

  it('reports a replaced skill that no longer exists as an error', async () => {
    const md = '---\nname: gone\ndescription: d\n---\nx';
    const missing = await upload(uploadRequest([['SKILL.md', md]], crypto.randomUUID()));
    expect(missing.status).toBe(400);
    expect((await missing.json()).results[0]).toMatchObject({ error: 'Skill not found' });

    // Deleted between the read and the write.
    const { body } = await createOne();
    db.skill.update.mockRejectedValueOnce(Object.assign(new Error('Record not found'), { code: 'P2025' }));
    const raced = await (await upload(uploadRequest([['SKILL.md', md]], body.skill.id))).json();
    expect(raced.results[0]).toMatchObject({ error: 'Skill not found' });
    expect(raced.results[0].skill).toBeUndefined();
  });
});
