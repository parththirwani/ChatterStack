import { captureError } from '@/src/lib/observability/capture';
import { runDueTasks } from './scheduled-task-runner';

/**
 * In-process scheduler for long-running servers (Docker, `npm run start`),
 * turned on with SCHEDULED_TASKS_TICKER=true. Serverless hosts call
 * /api/cron/scheduled-tasks instead. Several instances can tick at once:
 * each task is claimed by exactly one of them.
 */
const TICK_MS = 60 * 1000;

let started = false;

export function startScheduledTaskTicker() {
  if (started) return;
  started = true;
  let busy = false;
  const tick = async () => {
    // A slow pass (long model calls) never overlaps the next one.
    if (busy) return;
    busy = true;
    try {
      await runDueTasks();
    } catch (error) {
      captureError(error, { route: 'scheduled-task-ticker', stage: 'tick' });
    } finally {
      busy = false;
    }
  };
  // Start on the next minute boundary, then every minute.
  setTimeout(() => {
    void tick();
    setInterval(tick, TICK_MS).unref();
  }, TICK_MS - (Date.now() % TICK_MS)).unref();
}
