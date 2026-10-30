import { after } from 'next/server';
import { PostHog } from 'posthog-node';
import { DEFAULT_POSTHOG_HOST } from './config';
import { appEnvironment } from '@/src/lib/observability/environment';
import type { AnalyticsEventName, AnalyticsEventProps } from './events';

type PostHogClient = InstanceType<typeof PostHog>;

// Cached across module reloads so dev hot reloads don't open a new client (and
// a new flush timer) on every edit.
const cache = globalThis as typeof globalThis & { __chatterstackPostHog?: PostHogClient | null };

function readKey(): string | undefined {
  return process.env.POSTHOG_KEY?.trim() || undefined;
}

/** Null (and therefore inert) whenever POSTHOG_KEY is unset. */
export function getPostHogClient(): PostHogClient | null {
  const key = readKey();
  if (!key) return null;
  if (cache.__chatterstackPostHog === undefined) {
    cache.__chatterstackPostHog = new PostHog(key, {
      host: process.env.POSTHOG_HOST?.trim() || DEFAULT_POSTHOG_HOST,
      // Ship each event as it arrives; the process may not live long enough
      // for a batch, and delivery is waited on with after() below.
      flushAt: 1,
      flushInterval: 0,
      requestTimeout: 5000,
    });
    // Never let telemetry problems surface in the app (and console output is
    // stripped from production builds anyway).
    cache.__chatterstackPostHog.on('error', () => {});
  }
  return cache.__chatterstackPostHog;
}

async function flushQuietly(): Promise<void> {
  try {
    await cache.__chatterstackPostHog?.flush();
  } catch {
    // Telemetry must never fail a request.
  }
}

/**
 * Flushes once the response is done, so the SSE stream and every render stay
 * untouched. Outside a request scope (scripts, unit tests) there is nothing to
 * wait for, so the flush simply runs in the background.
 */
function scheduleFlush(): void {
  try {
    after(() => flushQuietly());
  } catch {
    void flushQuietly();
  }
}

/**
 * Server-side capture. The distinct id is always the NextAuth user id, never an
 * email or name; property types keep message content out of the payload.
 */
export function captureServerEvent<E extends AnalyticsEventName>(
  userId: string | undefined | null,
  event: E,
  props: AnalyticsEventProps[E]
): void {
  const client = getPostHogClient();
  if (!client || !userId) return;

  try {
    client.capture({ distinctId: userId, event, properties: { ...props, environment: appEnvironment() } });
    scheduleFlush();
  } catch {
    // Ignore: analytics is never worth a failed request.
  }
}

/** Test/shutdown helper: waits for anything already queued. */
export async function flushServerEvents(): Promise<void> {
  await flushQuietly();
}
