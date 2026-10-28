import * as Sentry from '@sentry/nextjs';

/**
 * Server-side entry point. Every route in this app runs on the Node runtime
 * (no edge handlers), so only the Node SDK is registered.
 *
 * Next.js loads this file before the first request; Sentry.init inside
 * `./sentry.server.config` is a no-op while SENTRY_DSN is unset.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('./sentry.server.config');
    // Long-running servers run scheduled tasks themselves; serverless hosts
    // call /api/cron/scheduled-tasks from a scheduler instead.
    if (process.env.SCHEDULED_TASKS_TICKER === 'true') {
      const { startScheduledTaskTicker } = await import('./lib/server/scheduled-task-ticker');
      startScheduledTaskTicker();
    }
  }
}

/** Captures unhandled errors from Server Components and route handlers. */
export const onRequestError = Sentry.captureRequestError;
