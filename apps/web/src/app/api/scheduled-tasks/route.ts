import { ScheduledTaskInputSchema } from '@/src/lib/scheduled-tasks/schedule';
import { createTask, listTasks } from '@/src/lib/server/scheduled-tasks';
import { invalid, sessionUserId, taskErrorResponse, unauthorized } from '@/src/lib/server/scheduled-task-routes';

export async function GET() {
  const userId = await sessionUserId();
  if (!userId) return unauthorized();
  return Response.json({ tasks: await listTasks(userId) });
}

export async function POST(request: Request) {
  const userId = await sessionUserId();
  if (!userId) return unauthorized();
  const parsed = ScheduledTaskInputSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return invalid(parsed.error);
  try {
    return Response.json({ task: await createTask(userId, parsed.data) }, { status: 201 });
  } catch (error) {
    return taskErrorResponse(error);
  }
}
