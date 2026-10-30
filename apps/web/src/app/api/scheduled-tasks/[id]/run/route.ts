import { after } from 'next/server';
import { getTaskRow, serializeRun } from '@/src/lib/server/scheduled-tasks';
import { RunInProgressError, startManualRun } from '@/src/lib/server/scheduled-task-runner';
import { sessionUserId, taskNotFound, unauthorized } from '@/src/lib/server/scheduled-task-routes';

// The model call continues after the response; give it room to finish.
export const maxDuration = 300;

type Context = { params: Promise<{ id: string }> };

/** Run now: answers with the new run at once, then runs it. */
export async function POST(_request: Request, context: Context) {
  const userId = await sessionUserId();
  if (!userId) return unauthorized();
  const task = await getTaskRow(userId, (await context.params).id);
  if (!task) return taskNotFound();
  try {
    const { run, done } = await startManualRun(task);
    after(done);
    return Response.json({ run: serializeRun(run) }, { status: 202 });
  } catch (error) {
    if (error instanceof RunInProgressError) return Response.json({ error: error.message }, { status: 409 });
    throw error;
  }
}
