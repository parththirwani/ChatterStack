import { captureError } from '@/src/lib/observability/capture';
import { isCronRequest } from '@/src/lib/server/cron-auth';
import { runDueTasks } from '@/src/lib/server/scheduled-task-runner';

// One pass waits for the runs it starts.
export const maxDuration = 300;

/**
 * Scheduler tick: runs every scheduled task that is due. Call it every
 * minute with `Authorization: Bearer <CRON_SECRET>` (Vercel cron uses GET;
 * schedulers such as QStash use POST).
 */
async function tick(request: Request) {
  if (!isCronRequest(request)) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
    return Response.json(await runDueTasks());
  } catch (error) {
    captureError(error, { route: '/api/cron/scheduled-tasks', stage: 'tick' });
    throw error;
  }
}

export { tick as GET, tick as POST };
