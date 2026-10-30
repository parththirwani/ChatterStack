/**
 * Without a DSN nothing may leave the process: no client, no transport, no
 * fetch - and a failing reporter must never break the code that calls it.
 */
import * as Sentry from '@sentry/nextjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { captureError } from '@/src/lib/observability/capture';
import { sentryBaseOptions } from '@/src/lib/observability/sentry-options';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('sentryBaseOptions', () => {
  it('disables the SDK while no DSN is configured', () => {
    expect(sentryBaseOptions(undefined)).toMatchObject({ dsn: undefined, enabled: false, sendDefaultPii: false });
    expect(sentryBaseOptions('')).toMatchObject({ enabled: false });
    expect(sentryBaseOptions('   ')).toMatchObject({ enabled: false });
    expect(sentryBaseOptions('https://abc@o0.ingest.sentry.io/1')).toMatchObject({
      dsn: 'https://abc@o0.ingest.sentry.io/1',
      enabled: true,
    });
  });

  it('turns off tracing and PII by default', () => {
    const options = sentryBaseOptions(undefined);
    expect(options.tracesSampleRate).toBe(0);
    expect(options.sendDefaultPii).toBe(false);
  });
});

describe('captureError', () => {
  it('is inert with no DSN: no client exists and nothing is sent', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    expect(Sentry.getClient()).toBeUndefined();
    captureError(new Error('Qdrant upsert failed'), { route: '/api/rag/ingest', stage: 'ingest', userId: 'user-1' });
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(fetchMock).not.toHaveBeenCalled();
    expect(Sentry.getClient()).toBeUndefined();
  });

  it('never throws, whatever it is handed', () => {
    expect(() => captureError(undefined)).not.toThrow();
    expect(() => captureError('a string')).not.toThrow();
    expect(() => captureError({ weird: true })).not.toThrow();
    expect(() => captureError(new Error('boom'))).not.toThrow();
  });
});
