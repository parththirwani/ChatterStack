import type { ScheduledTask as TaskRow, ScheduledTaskRun as RunRow } from '@prisma/client';
import { prisma } from '@/src/lib/prisma';
import { MAX_TASKS_PER_USER, nextRunAfter, type Frequency, type ScheduledTaskInput } from '@/src/lib/scheduled-tasks/schedule';
import type { ThinkingLevel } from '@/src/config/models';
import type { ScheduledTask, ScheduledTaskRun } from '@/src/types/scheduled-task.types';

/** CRUD for a user's scheduled tasks. Every function scopes to `userId`. */

export class ScheduledTaskError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

export function serializeTask(row: TaskRow): ScheduledTask {
  return {
    id: row.id,
    name: row.name,
    prompt: row.prompt,
    model: row.model,
    thinkingLevel: row.thinkingLevel as ThinkingLevel,
    frequency: row.frequency as Frequency,
    time: row.time,
    weekday: row.weekday,
    timezone: row.timezone,
    enabled: row.enabled,
    nextRunAt: row.nextRunAt?.toISOString() ?? null,
    lastRunAt: row.lastRunAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function serializeRun(row: RunRow, liveConversations?: Set<string>): ScheduledTaskRun {
  const conversationId = row.conversationId && (!liveConversations || liveConversations.has(row.conversationId)) ? row.conversationId : null;
  return {
    id: row.id,
    trigger: row.trigger as ScheduledTaskRun['trigger'],
    status: row.status as ScheduledTaskRun['status'],
    error: row.error,
    conversationId,
    scheduledFor: row.scheduledFor?.toISOString() ?? null,
    startedAt: row.startedAt.toISOString(),
    finishedAt: row.finishedAt?.toISOString() ?? null,
  };
}

/** When the task should next run on schedule, from `now`. */
export function scheduleFrom(task: Pick<TaskRow, 'enabled' | 'frequency' | 'time' | 'weekday' | 'timezone'>, now = new Date()) {
  if (!task.enabled) return null;
  return nextRunAfter({ frequency: task.frequency as Frequency, time: task.time, weekday: task.weekday, timezone: task.timezone }, now);
}

export async function listTasks(userId: string) {
  const rows = await prisma.scheduledTask.findMany({ where: { userId }, orderBy: { createdAt: 'desc' } });
  return rows.map(serializeTask);
}

export async function getTaskRow(userId: string, id: string) {
  return prisma.scheduledTask.findFirst({ where: { id, userId } });
}

/** The task and its latest runs, newest first. Runs whose chat was deleted lose the link. */
export async function getTaskWithRuns(userId: string, id: string, limit = 50) {
  const row = await getTaskRow(userId, id);
  if (!row) return null;
  const runs = await prisma.scheduledTaskRun.findMany({ where: { taskId: id }, orderBy: { startedAt: 'desc' }, take: limit });
  const ids = runs.map((run) => run.conversationId).filter((value): value is string => !!value);
  const live = ids.length
    ? new Set((await prisma.conversation.findMany({ where: { id: { in: ids }, userId }, select: { id: true } })).map((c) => c.id))
    : new Set<string>();
  return { task: serializeTask(row), runs: runs.map((run) => serializeRun(run, live)) };
}

export async function createTask(userId: string, input: ScheduledTaskInput) {
  const count = await prisma.scheduledTask.count({ where: { userId } });
  if (count >= MAX_TASKS_PER_USER) {
    throw new ScheduledTaskError(`You can have up to ${MAX_TASKS_PER_USER} scheduled tasks. Delete one to add another.`, 409);
  }
  const row = await prisma.scheduledTask.create({
    data: { ...input, userId, enabled: true, nextRunAt: scheduleFrom({ ...input, enabled: true }) },
  });
  return serializeTask(row);
}

/** Edits fields and/or pauses or resumes. The next run is recomputed from now. */
export async function updateTask(userId: string, id: string, patch: Partial<ScheduledTaskInput> & { enabled?: boolean }) {
  const current = await getTaskRow(userId, id);
  if (!current) return null;
  const merged = { ...current, ...patch };
  const row = await prisma.scheduledTask.update({
    where: { id },
    data: { ...patch, nextRunAt: scheduleFrom(merged) },
  });
  return serializeTask(row);
}

/** Deletes the task and its run history. Its run chats stay, as ordinary chats. */
export async function deleteTask(userId: string, id: string) {
  const { count } = await prisma.scheduledTask.deleteMany({ where: { id, userId } });
  return count > 0;
}
