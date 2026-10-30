import { z } from 'zod';
import { ScheduledTaskInputSchema } from '@/src/lib/scheduled-tasks/schedule';
import { deleteTask, getTaskWithRuns, updateTask } from '@/src/lib/server/scheduled-tasks';
import { invalid, sessionUserId, taskNotFound, unauthorized } from '@/src/lib/server/scheduled-task-routes';

type Context = { params: Promise<{ id: string }> };

// Any subset: field edits, or just { enabled } to pause or resume. No
// defaults here, so a partial edit never resets fields it didn't send.
const patchSchema = ScheduledTaskInputSchema.extend({
  thinkingLevel: ScheduledTaskInputSchema.shape.thinkingLevel.removeDefault(),
  time: ScheduledTaskInputSchema.shape.time.removeDefault(),
  weekday: ScheduledTaskInputSchema.shape.weekday.removeDefault(),
}).partial().extend({ enabled: z.boolean().optional() })
  .refine((patch) => Object.keys(patch).length > 0, 'Nothing to change');

export async function GET(_request: Request, context: Context) {
  const userId = await sessionUserId();
  if (!userId) return unauthorized();
  const result = await getTaskWithRuns(userId, (await context.params).id);
  return result ? Response.json(result) : taskNotFound();
}

export async function PATCH(request: Request, context: Context) {
  const userId = await sessionUserId();
  if (!userId) return unauthorized();
  const parsed = patchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return invalid(parsed.error);
  const task = await updateTask(userId, (await context.params).id, parsed.data);
  return task ? Response.json({ task }) : taskNotFound();
}

export async function DELETE(_request: Request, context: Context) {
  const userId = await sessionUserId();
  if (!userId) return unauthorized();
  return (await deleteTask(userId, (await context.params).id)) ? new Response(null, { status: 204 }) : taskNotFound();
}
