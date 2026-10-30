import * as Sentry from '@sentry/nextjs';
import { errorTags, type ErrorTagContext } from './sentry-filters';

export interface CaptureContext extends ErrorTagContext {
  /** NextAuth user id only. Never an email or a name. */
  userId?: string;
}

/**
 * Replacement for the `console.error` calls that Next.js strips from
 * production builds (`compiler.removeConsole`).
 *
 * A no-op while Sentry is not configured, and it only ever attaches
 * low-cardinality tags plus the error itself - never a prompt, an answer, a
 * file or a retrieved document.
 */
export function captureError(error: unknown, context: CaptureContext = {}): void {
  try {
    Sentry.captureException(error, (scope) => {
      scope.setTags(errorTags(context));
      if (context.userId) scope.setUser({ id: context.userId });
      return scope;
    });
  } catch {
    // Reporting must never break the request it is reporting on.
  }
}
