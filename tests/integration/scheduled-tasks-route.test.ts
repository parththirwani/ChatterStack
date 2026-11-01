/**
 * Scheduled tasks: the CRUD routes, Run now, the cron tick and the runner
 * (claiming, catch-up, skips, failures), against an in-memory Prisma.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import crypto from 'node:crypto';

type Row = Record<string, unknown> & { id: string };
const tables = { scheduledTask: new Map<string, Row>(), scheduledTaskRun: new Map<string, Row>(), conversation: new Map<string, Row>() };

const same = (a: unknown, b: unknown) => (a instanceof Date && b instanceof Date ? a.getTime() === b.getTime() : a === b);
function matches(row: Row, where: Record<string, unknown> = {}) {
  return Object.entries(where).every(([key, condition]) => {
    const value = row[key];
    if (condition && typeof condition === 'object' && !(condition instanceof Date)) {
      const c = condition as { in?: unknown[]; lte?: Date; lt?: Date };
      if (c.in) return c.in.includes(value);
      if (c.lte) return value instanceof Date && value <= c.lte;
      if (c.lt) return value instanceof Date && value < c.lt;
    }
    return same(value, condition);
  });
}
function table(name: keyof typeof tables, defaults: () => Record<string, unknown>) {
  const rows = tables[name];
  const sorted = (list: Row[], orderBy?: Record<string, 'asc' | 'desc'>) => {
    if (!orderBy) return list;
    const [[key, dir]] = Object.entries(orderBy);
    return [...list].sort((a, b) => ((a[key] as Date).getTime() - (b[key] as Date).getTime()) * (dir === 'asc' ? 1 : -1));
  };
  return {
    findMany: vi.fn(async ({ where, orderBy, take }: { where?: Record<string, unknown>; orderBy?: Record<string, 'asc' | 'desc'>; take?: number } = {}) =>
      sorted([...rows.values()].filter((row) => matches(row, where)), orderBy).slice(0, take ?? Infinity).map((row) => ({ ...row }))),
    findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
      const row = [...rows.values()].find((item) => matches(item, where));
      return row ? { ...row } : null;
    }),
    count: vi.fn(async ({ where }: { where: Record<string, unknown> }) => [...rows.values()].filter((row) => matches(row, where)).length),
    create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
      const row = { id: crypto.randomUUID(), ...defaults(), ...data } as Row;
      rows.set(row.id, row);
      return { ...row };
    }),
    update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
      const row = rows.get(where.id);
      if (!row) throw new Error('Record not found');
      Object.assign(row, data);
      return { ...row };
    }),
    updateMany: vi.fn(async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
      const hit = [...rows.values()].filter((row) => matches(row, where));
      hit.forEach((row) => Object.assign(row, data));
      return { count: hit.length };
    }),
    deleteMany: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
      const hit = [...rows.values()].filter((row) => matches(row, where));
      hit.forEach((row) => rows.delete(row.id));
      return { count: hit.length };
    }),
  };
}
const now = () => new Date();
const db = {
  scheduledTask: table('scheduledTask', () => ({ enabled: true, thinkingLevel: 'medium', time: '09:00', weekday: 1, lastRunAt: null, nextRunAt: null, createdAt: now(), updatedAt: now() })),
  scheduledTaskRun: table('scheduledTaskRun', () => ({ error: null, conversationId: null, scheduledFor: null, startedAt: now(), finishedAt: null })),
  conversation: table('conversation', () => ({ createdAt: now() })),
};

const auth = vi.fn();
const createCompletion = vi.fn<(...args: unknown[]) => Promise<string>>(async () => 'Here is your brief.');
const addMessages = vi.fn<(...args: unknown[]) => Promise<void>>(async () => {});
const afterCallbacks: Array<() => Promise<void>> = [];

vi.mock('@/src/lib/auth', () => ({ auth: () => auth() }));
vi.mock('@/src/lib/prisma', () => ({ prisma: db }));
vi.mock('@/src/lib/api/chat/openrouter', () => ({ createCompletion: (...args: unknown[]) => createCompletion(...args) }));
vi.mock('@/src/lib/api/chat/conversation-persistance', () => ({ addMessagesToConversation: (...args: unknown[]) => addMessages(...args) }));
vi.mock('@/src/lib/observability/otlp-traces', () => ({ recordRequestSpan: () => {} }));
vi.mock('@/src/lib/observability/capture', () => ({ captureError: () => {} }));
vi.mock('next/server', () => ({ after: (fn: () => Promise<void>) => { afterCallbacks.push(fn); } }));

const { GET: list, POST: create } = await import('@/src/app/api/scheduled-tasks/route');
const { GET: read, PATCH: patch, DELETE: remove } = await import('@/src/app/api/scheduled-tasks/[id]/route');
const { POST: runNow } = await import('@/src/app/api/scheduled-tasks/[id]/run/route');
const { GET: tick } = await import('@/src/app/api/cron/scheduled-tasks/route');
const { runDueTasks } = await import('@/src/lib/server/scheduled-task-runner');

const json = (body: unknown, method = 'POST') => new Request('http://localhost/api/scheduled-tasks', {
  method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
});
const bare = () => new Request('http://localhost');
const context = (id: string) => ({ params: Promise.resolve({ id }) });
const input = { name: 'Morning brief', prompt: 'Summarize AI news.', model: 'anthropic/claude-sonnet-5.5', frequency: 'daily', time: '09:00', weekday: 1, timezone: 'UTC' };
const signIn = (id = 'user-1') => auth.mockResolvedValue({ user: { id } });

async function createTask(overrides: Record<string, unknown> = {}) {
  const response = await create(json({ ...input, ...overrides }));
  expect(response.status).toBe(201);
  return (await response.json()).task as { id: string; nextRunAt: string | null; enabled: boolean };
}
const runs = () => [...tables.scheduledTaskRun.values()];
/** Makes the task due as of `minutesAgo`. */
const makeDue = (id: string, minutesAgo = 1) => { tables.scheduledTask.get(id)!.nextRunAt = new Date(Date.now() - minutesAgo * 60000); };

beforeEach(() => {
  Object.values(tables).forEach((rows) => rows.clear());
  afterCallbacks.length = 0;
  vi.clearAllMocks();
  createCompletion.mockResolvedValue('Here is your brief.');
  signIn();
});

describe('scheduled task routes', () => {
  it('requires a session', async () => {
    auth.mockResolvedValue(null);
    expect((await list()).status).toBe(401);
    expect((await create(json(input))).status).toBe(401);
    expect((await runNow(bare(), context('x'))).status).toBe(401);
  });

  it('creates a task with its next run, and lists only the user\'s own', async () => {
    const task = await createTask();
    expect(task.enabled).toBe(true);
    expect(new Date(task.nextRunAt!).getTime()).toBeGreaterThan(Date.now());
    expect(new Date(task.nextRunAt!).toISOString()).toMatch(/T09:00:00\.000Z$/);
    signIn('user-2');
    expect((await (await list()).json()).tasks).toEqual([]);
    expect((await read(bare(), context(task.id))).status).toBe(404);
    expect((await patch(json({ enabled: false }, 'PATCH'), context(task.id))).status).toBe(404);
    expect((await remove(bare(), context(task.id))).status).toBe(404);
  });

  it('gives manual tasks no next run', async () => {
    expect((await createTask({ frequency: 'manual' })).nextRunAt).toBeNull();
  });

  it('rejects invalid input with the field that failed', async () => {
    const response = await create(json({ ...input, timezone: 'Nowhere/Land' }));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ field: 'timezone' });
    expect((await create(json({ ...input, model: 'council' }))).status).toBe(400);
  });

  it('caps tasks per user', async () => {
    for (let i = 0; i < 20; i += 1) await createTask({ name: `Task ${i}` });
    const response = await create(json(input));
    expect(response.status).toBe(409);
  });

  it('pauses, resumes and reschedules', async () => {
    const task = await createTask();
    const paused = (await (await patch(json({ enabled: false }, 'PATCH'), context(task.id))).json()).task;
    expect(paused).toMatchObject({ enabled: false, nextRunAt: null });
    const resumed = (await (await patch(json({ enabled: true }, 'PATCH'), context(task.id))).json()).task;
    expect(resumed.nextRunAt).not.toBeNull();
    // A partial edit keeps the other fields (no schema defaults applied).
    const edited = (await (await patch(json({ frequency: 'weekly', weekday: 5 }, 'PATCH'), context(task.id))).json()).task;
    expect(edited).toMatchObject({ frequency: 'weekly', weekday: 5, time: '09:00' });
    expect(new Date(edited.nextRunAt).getUTCDay()).toBe(5);
    expect((await patch(json({}, 'PATCH'), context(task.id))).status).toBe(400);
  });

  it('deletes a task', async () => {
    const task = await createTask();
    expect((await remove(bare(), context(task.id))).status).toBe(204);
    expect((await read(bare(), context(task.id))).status).toBe(404);
  });
});

describe('Run now', () => {
  it('records a running run, answers 202, and finishes after the response', async () => {
    const task = await createTask({ frequency: 'manual' });
    const response = await runNow(bare(), context(task.id));
    expect(response.status).toBe(202);
    expect((await response.json()).run).toMatchObject({ trigger: 'manual', status: 'running' });
    // A second click while it runs is refused.
    expect((await runNow(bare(), context(task.id))).status).toBe(409);

    await afterCallbacks[0]();
    const detail = await (await read(bare(), context(task.id))).json();
    expect(detail.runs).toHaveLength(1);
    expect(detail.runs[0]).toMatchObject({ status: 'succeeded', error: null });
    const conversation = tables.conversation.get(detail.runs[0].conversationId)!;
    expect(conversation).toMatchObject({ userId: 'user-1', title: 'Morning brief', scheduledTaskId: task.id });
    expect(addMessages).toHaveBeenCalledWith(conversation.id, 'Summarize AI news.', 'Here is your brief.', input.model);
    // The model sees when the run happens, then the saved prompt.
    const [messages, model] = createCompletion.mock.calls[0] as [Array<{ content: string }>, string];
    expect(model).toBe(input.model);
    expect(messages[0].content).toMatch(/^This is the scheduled task "Morning brief", started by hand with Run now at .+\(UTC\), outside its usual schedule\.\n\nSummarize AI news\.$/);
  });

  it('drops the link to a run chat the user deleted', async () => {
    const task = await createTask({ frequency: 'manual' });
    await runNow(bare(), context(task.id));
    await afterCallbacks[0]();
    tables.conversation.clear();
    expect((await (await read(bare(), context(task.id))).json()).runs[0].conversationId).toBeNull();
  });
});

describe('scheduler', () => {
  it('runs due tasks once, even when two passes overlap', async () => {
    const task = await createTask();
    makeDue(task.id);
    const [first, second] = await Promise.all([runDueTasks(), runDueTasks()]);
    expect(first.started + second.started).toBe(1);
    expect(runs()).toHaveLength(1);
    expect(runs()[0]).toMatchObject({ trigger: 'schedule', status: 'succeeded' });
    expect((createCompletion.mock.calls[0][0] as Array<{ content: string }>)[0].content).toMatch(/^This is a scheduled run of the task "Morning brief", started .+\(UTC\)\.\n\n/);
    // The next run moved past now.
    expect((tables.scheduledTask.get(task.id)!.nextRunAt as Date).getTime()).toBeGreaterThan(Date.now());
  });

  it('catches up once for many missed runs', async () => {
    const task = await createTask();
    makeDue(task.id, 6 * 24 * 60);
    await runDueTasks();
    await runDueTasks();
    expect(runs()).toHaveLength(1);
  });

  it('ignores paused, manual and future tasks', async () => {
    const paused = await createTask({ name: 'paused' });
    makeDue(paused.id);
    tables.scheduledTask.get(paused.id)!.enabled = false;
    await createTask({ name: 'manual', frequency: 'manual' });
    await createTask({ name: 'future' });
    expect(await runDueTasks()).toMatchObject({ due: 0, started: 0 });
  });

  it('skips a run while the previous one is still going', async () => {
    const task = await createTask();
    await db.scheduledTaskRun.create({ data: { taskId: task.id, trigger: 'manual', status: 'running' } });
    makeDue(task.id);
    expect(await runDueTasks()).toMatchObject({ started: 0, skipped: 1 });
    expect(runs().find((run) => run.status === 'skipped')).toMatchObject({ error: 'The previous run was still in progress.' });
    expect(createCompletion).not.toHaveBeenCalled();
  });

  it('records a failed run and keeps the question in its chat', async () => {
    createCompletion.mockRejectedValue(new Error('OpenRouter API error: 502'));
    const task = await createTask();
    makeDue(task.id);
    await runDueTasks();
    expect(runs()[0]).toMatchObject({ status: 'failed', error: 'OpenRouter API error: 502' });
    expect(addMessages).toHaveBeenCalledWith(runs()[0].conversationId, 'Summarize AI news.', '', input.model);
  });

  it('sends no tool list to the model even when MCP tools are switched on', async () => {
    // The runner's in-memory database has no mcpConnection table at all, so a
    // scheduled path that tried to load connections would crash outright.
    vi.stubEnv('MCP_TOOLS', 'on');
    try {
      const task = await createTask();
      makeDue(task.id);
      expect(await runDueTasks()).toMatchObject({ started: 1 });
      expect(createCompletion).toHaveBeenCalled();
      const options = createCompletion.mock.calls.at(-1)![2] as Record<string, unknown>;
      expect(options).not.toHaveProperty('tools');
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('fails runs left running by a crashed process', async () => {
    const task = await createTask({ frequency: 'manual' });
    const stale = await db.scheduledTaskRun.create({ data: { taskId: task.id, trigger: 'manual', status: 'running', startedAt: new Date(Date.now() - 20 * 60000) } });
    expect((await runDueTasks()).staleFailed).toBe(1);
    expect(tables.scheduledTaskRun.get(stale.id)).toMatchObject({ status: 'failed' });
  });
});

describe('GET /api/cron/scheduled-tasks', () => {
  it('needs the cron secret', async () => {
    vi.stubEnv('CRON_SECRET', 'cron-secret-value-1234567890');
    expect((await tick(new Request('http://localhost'))).status).toBe(401);
    expect((await tick(new Request('http://localhost', { headers: { authorization: 'Bearer nope' } }))).status).toBe(401);
    const response = await tick(new Request('http://localhost', { headers: { authorization: 'Bearer cron-secret-value-1234567890' } }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ due: 0, started: 0, skipped: 0, staleFailed: 0 });
    vi.unstubAllEnvs();
  });
});
