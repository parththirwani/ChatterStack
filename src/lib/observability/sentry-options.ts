import { isSentryDisabled } from './sentry-filters';

/**
 * Values shared by the browser and the server SDK. Error monitoring only: no
 * tracing, no replay, no PII, and disabled entirely without a DSN.
 */
export function sentryBaseOptions(dsn: string | undefined | null) {
  const trimmed = dsn?.trim();

  return {
    dsn: trimmed || undefined,
    enabled: !isSentryDisabled(trimmed),
    sendDefaultPii: false as const,
    environment: process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV,
    release: process.env.SENTRY_RELEASE || process.env.VERCEL_GIT_COMMIT_SHA || undefined,
    tracesSampleRate: 0,
    // The app already shows failures to the user; the SDK must not add noise.
    autoSessionTracking: false,
  };
}

export const serverSentryDsn = () => process.env.SENTRY_DSN;

/**
 * The browser needs the DSN at build time (it is inlined into the bundle), so
 * Docker exposes it as a build ARG that defaults to empty.
 */
export const clientSentryDsn = () => process.env.NEXT_PUBLIC_SENTRY_DSN;
