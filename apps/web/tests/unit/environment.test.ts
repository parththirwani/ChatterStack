/**
 * One environment value for Sentry, PostHog and OpenObserve, so development,
 * Vercel previews and production can be filtered apart the same way everywhere.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/server', () => ({
  after: () => {
    throw new Error('outside a request scope');
  },
}));

const { appEnvironment, clientAppEnvironment } = await import('@/src/lib/observability/environment');
const { sentryBaseOptions } = await import('@/src/lib/observability/sentry-options');
const { postHogClientConfig } = await import('@/src/lib/analytics/config');
const { traceLlmCall } = await import('@/src/lib/observability/trace-llm-call');
const { resetObservability } = await import('@/src/lib/observability/openobserve');
const { toOtlpPayload } = await import('@/src/lib/observability/otlp-traces');

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('appEnvironment', () => {
  it('is development locally', () => {
    vi.stubEnv('VERCEL_ENV', '');
    vi.stubEnv('NODE_ENV', 'development');
    expect(appEnvironment()).toBe('development');
  });

  it('tells a Vercel preview apart from production, though both run NODE_ENV=production', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('VERCEL_ENV', 'preview');
    expect(appEnvironment()).toBe('preview');
    vi.stubEnv('VERCEL_ENV', 'production');
    expect(appEnvironment()).toBe('production');
  });

  it('lets APP_ENV override, and normalizes shorthands', () => {
    vi.stubEnv('VERCEL_ENV', 'production');
    vi.stubEnv('APP_ENV', 'dev');
    expect(appEnvironment()).toBe('development');
    vi.stubEnv('APP_ENV', 'staging');
    expect(appEnvironment()).toBe('staging');
  });

  it('uses only public variables in the browser', () => {
    vi.stubEnv('VERCEL_ENV', 'production');
    vi.stubEnv('NEXT_PUBLIC_VERCEL_ENV', 'preview');
    expect(clientAppEnvironment()).toBe('preview');
  });
});

describe('every service carries the same tag', () => {
  it('Sentry: environment follows appEnvironment, SENTRY_ENVIRONMENT still wins', () => {
    vi.stubEnv('VERCEL_ENV', 'preview');
    expect(sentryBaseOptions('https://k@o1.ingest.sentry.io/1').environment).toBe('preview');
    expect(sentryBaseOptions('https://k@o1.ingest.sentry.io/1', 'development').environment).toBe('development');
    vi.stubEnv('SENTRY_ENVIRONMENT', 'qa');
    expect(sentryBaseOptions('https://k@o1.ingest.sentry.io/1').environment).toBe('qa');
  });

  it('PostHog: the browser config carries it', () => {
    vi.stubEnv('POSTHOG_KEY', 'phc_test');
    vi.stubEnv('VERCEL_ENV', 'production');
    expect(postHogClientConfig()?.environment).toBe('production');
  });

  it('OpenObserve: log records and the trace resource carry it', async () => {
    vi.stubEnv('VERCEL_ENV', 'preview');
    vi.stubEnv('OPENOBSERVE_URL', 'https://observe.example.com');
    vi.stubEnv('OPENOBSERVE_AUTH', 'cmVhZABjb21wYW55OnNlY3JldA==');
    resetObservability();
    const bodies: unknown[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
      bodies.push(JSON.parse(init.body as string));
      return new Response(null, { status: 200 });
    }));
    await traceLlmCall({ traceId: 't', span: 'completion', model: 'm' }, async () => 'ok');
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect((bodies[0] as Array<{ environment: string }>)[0].environment).toBe('preview');

    const resource = toOtlpPayload([]).resourceSpans[0].resource.attributes;
    expect(resource).toContainEqual({ key: 'deployment.environment', value: { stringValue: 'preview' } });
  });
});
