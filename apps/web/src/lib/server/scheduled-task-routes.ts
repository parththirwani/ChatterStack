import { z } from 'zod';
import { auth } from '@/src/lib/auth';
import { ScheduledTaskError } from './scheduled-tasks';

/** Shared pieces of the /api/scheduled-tasks routes. */

export async function sessionUserId() {
  const session = await auth();
  return session?.user?.id ?? null;
}

export const unauthorized = () => Response.json({ error: 'Unauthorized' }, { status: 401 });
export const taskNotFound = () => Response.json({ error: 'Scheduled task not found' }, { status: 404 });

export function invalid(error: z.ZodError) {
  const issue = error.issues[0];
  return Response.json({ error: issue?.message ?? 'Invalid scheduled task', field: issue ? String(issue.path[0]) : undefined, issues: error.issues }, { status: 400 });
}

/** Turns a ScheduledTaskError into its response; anything else is rethrown. */
export function taskErrorResponse(error: unknown) {
  if (error instanceof ScheduledTaskError) return Response.json({ error: error.message }, { status: error.status });
  throw error;
}
