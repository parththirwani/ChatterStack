/**
 * Which deployment this process (or browser bundle) belongs to, so Sentry,
 * PostHog and OpenObserve can all be filtered the same way:
 * `development` (local), `preview` (Vercel previews) or `production`.
 *
 * Order: an explicit `APP_ENV` override, then Vercel's own `VERCEL_ENV`, then
 * `NODE_ENV`. Vercel previews run with NODE_ENV=production, which is why
 * NODE_ENV alone would label them as production.
 */
export type AppEnvironment = 'development' | 'preview' | 'production' | (string & {});

function normalize(value: string | undefined): AppEnvironment | undefined {
  const trimmed = value?.trim().toLowerCase();
  if (!trimmed) return undefined;
  if (trimmed === 'dev' || trimmed === 'local' || trimmed === 'test') return 'development';
  if (trimmed === 'prod') return 'production';
  return trimmed;
}

/** Server side: API routes, server components, instrumentation. */
export function appEnvironment(): AppEnvironment {
  return (
    normalize(process.env.APP_ENV) ??
    normalize(process.env.VERCEL_ENV) ??
    normalize(process.env.NODE_ENV) ??
    'development'
  );
}

/**
 * Browser side. Only NEXT_PUBLIC_* values exist in the bundle: Vercel exposes
 * NEXT_PUBLIC_VERCEL_ENV automatically (System Environment Variables), and
 * NODE_ENV is inlined at build time ('development' under `next dev`).
 */
export function clientAppEnvironment(): AppEnvironment {
  return (
    normalize(process.env.NEXT_PUBLIC_APP_ENV) ??
    normalize(process.env.NEXT_PUBLIC_VERCEL_ENV) ??
    normalize(process.env.NODE_ENV) ??
    'development'
  );
}
