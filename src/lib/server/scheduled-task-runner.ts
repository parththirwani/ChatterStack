import crypto from 'node:crypto';
import type { ScheduledTask as TaskRow } from '@prisma/client';
import { prisma } from '@/src/lib/prisma';
import { createCompletion } from '@/src/lib/api/chat/openrouter';
import { addMessagesToConversation } from '@/src/lib/api/chat/conversation-persistance';
import { countTokens, recordLLMTokens, withLLMTokenLimit } from '@/src/middleware/llmTokenRateLimit';
import { captureError } from '@/src/lib/observability/capture';
import { recordRequestSpan } from '@/src/lib/observability/otlp-traces';
import { formatRunTime } from '@/src/lib/scheduled-tasks/schedule';
import type { ThinkingLevel } from '@/src/config/models';
import { scheduleFrom } from './scheduled-tasks';

/**
 * Runs scheduled tasks. `runDueTasks` is one scheduler pass, called every
 * minute by the cron route or the in-process ticker; `startManualRun` backs
 * Run now. Both record every attempt in the task's run history, including
 * runs that were skipped.
 */

/** Tasks started per pass; the rest wait for the next minute. */
const BATCH_SIZE = 10;
/** A model call longer than this is cut off and the run fails. */
const RUN_TIMEOUT_MS = 4 * 60 * 1000;
/** A run still "running" after this is from a process that died. */
const STALE_RUN_MS = 15 * 60 * 1000;
const MAX_ERROR_LENGTH = 500;

export class RunInProgressError extends Error {
  constructor() {
    super('This task is already running. Wait for it to finish.');
  }
}

const shortError = (error: unknown) => {
  const message = error instanceof Error ? error.message : 'The run failed.';
  return message.length > MAX_ERROR_LENGTH ? `${message.slice(0, MAX_ERROR_LENGTH - 1)}…` : message;
};

async function hasRunningRun(taskId: string) {
  return (await prisma.scheduledTaskRun.count({ where: { taskId, status: 'running' } })) > 0;
}

/**
 * Executes a run row already marked `running`: reserves the budget, makes the
 * run's chat, calls the model and saves the exchange. Never throws; the
 * outcome is written to the run.
 */
async function executeRun(task: TaskRow, runId: string) {
  const startedAt = Date.now();
  const traceId = crypto.randomUUID();
  const finishRun = (status: 'succeeded' | 'failed' | 'skipped', error?: string) =>
    prisma.scheduledTaskRun.update({ where: { id: runId }, data: { status, error: error ?? null, finishedAt: new Date() } });

  // Same budget as chat: a run that doesn't fit is skipped, not queued.
  const limited = await withLLMTokenLimit(task.userId, task.prompt, false);
  if (limited) {
    const body = await limited.json().catch(() => ({}));
    await finishRun('skipped', body.message ?? 'Your daily usage limit was reached.');
    return;
  }

  let answer = '';
  let failure: unknown;
  let conversationId: string | undefined;
  try {
    const id = crypto.randomUUID();
    await prisma.conversation.create({ data: { id, userId: task.userId, title: task.name, scheduledTaskId: task.id } });
    conversationId = id;
    await prisma.scheduledTaskRun.update({ where: { id: runId }, data: { conversationId } });

    // The saved prompt is the user's own instruction; the header only tells
    // the model when this run is happening in the user's time zone.
    const header = `This is a scheduled run of the task "${task.name}", started ${formatRunTime(new Date(), task.timezone)} (${task.timezone}).`;
    answer = await createCompletion([{ role: 'user', content: `${header}\n\n${task.prompt}` }], task.model, {
      thinkingLevel: task.thinkingLevel as ThinkingLevel,
      signal: AbortSignal.timeout(RUN_TIMEOUT_MS),
      trace: {
        traceId,
        span: 'completion',
        inRequest: true,
        contentPrompt: task.prompt,
        userId: task.userId,
        conversationId,
        thinkingLevel: task.thinkingLevel,
        messageCount: 1,
      },
    });
  } catch (error) {
    failure = error;
  }

  try {
    await recordLLMTokens(task.userId, countTokens(task.prompt) + countTokens(answer), false);
  } catch (error) {
    captureError(error, { route: 'scheduled-task', stage: 'token-record', userId: task.userId });
  }

  try {
    if (conversationId) await addMessagesToConversation(conversationId, task.prompt, answer, task.model);
  } catch (error) {
    failure ??= error;
  }

  if (failure) captureError(failure, { route: 'scheduled-task', model: task.model, stage: 'run', userId: task.userId });
  await finishRun(failure ? 'failed' : 'succeeded', failure ? shortError(failure) : undefined).catch((error) =>
    captureError(error, { route: 'scheduled-task', stage: 'run-finish', userId: task.userId })
  );
  recordRequestSpan({
    traceId,
    startedAt,
    status: failure ? 'error' : 'ok',
    model: task.model,
    council: false,
    userId: task.userId,
    conversationId,
    question: task.prompt,
    answer,
    error: failure,
    attributes: { 'chatterstack.scheduled_task': true },
  });
}

/**
 * Run now: records a running run and returns it with the work to do, so the
 * route can answer at once and finish the run after the response.
 */
export async function startManualRun(task: TaskRow) {
  if (await hasRunningRun(task.id)) throw new RunInProgressError();
  const run = await prisma.scheduledTaskRun.create({ data: { taskId: task.id, trigger: 'manual', status: 'running' } });
  await prisma.scheduledTask.update({ where: { id: task.id }, data: { lastRunAt: run.startedAt } });
  return { run, done: () => executeRun(task, run.id) };
}

/** Marks runs from a crashed process as failed, so the task can run again. */
async function failStaleRuns(now: Date) {
  const { count } = await prisma.scheduledTaskRun.updateMany({
    where: { status: 'running', startedAt: { lt: new Date(now.getTime() - STALE_RUN_MS) } },
    data: { status: 'failed', error: 'The run stopped before it finished.', finishedAt: now },
  });
  return count;
}

/**
 * Claims a due task by moving its next run forward. The update matches the
 * `nextRunAt` value read, so when two passes overlap only one wins. The next
 * time is computed from now, so missed runs collapse into this one.
 */
async function claim(task: TaskRow, now: Date) {
  const { count } = await prisma.scheduledTask.updateMany({
    where: { id: task.id, enabled: true, nextRunAt: task.nextRunAt },
    data: { nextRunAt: scheduleFrom(task, now), lastRunAt: now },
  });
  return count === 1;
}

export interface TickResult {
  due: number;
  started: number;
  skipped: number;
  staleFailed: number;
}

/** One scheduler pass. Waits for the runs it starts. */
export async function runDueTasks(now = new Date()): Promise<TickResult> {
  const staleFailed = await failStaleRuns(now);
  const due = await prisma.scheduledTask.findMany({
    where: { enabled: true, nextRunAt: { lte: now } },
    orderBy: { nextRunAt: 'asc' },
    take: BATCH_SIZE,
  });

  let skipped = 0;
  const runs: Promise<void>[] = [];
  for (const task of due) {
    if (!(await claim(task, now))) continue;
    const scheduledFor = task.nextRunAt;
    if (await hasRunningRun(task.id)) {
      skipped += 1;
      await prisma.scheduledTaskRun.create({
        data: { taskId: task.id, trigger: 'schedule', status: 'skipped', error: 'The previous run was still in progress.', scheduledFor, finishedAt: now },
      });
      continue;
    }
    const run = await prisma.scheduledTaskRun.create({ data: { taskId: task.id, trigger: 'schedule', status: 'running', scheduledFor } });
    runs.push(executeRun(task, run.id));
  }
  await Promise.allSettled(runs);
  return { due: due.length, started: runs.length, skipped, staleFailed };
}
