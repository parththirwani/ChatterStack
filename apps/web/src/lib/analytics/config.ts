import { appEnvironment } from '@/src/lib/observability/environment';

export const DEFAULT_POSTHOG_HOST = 'https://us.i.posthog.com';

/** Everything the browser SDK needs. Read on the server, passed down as props. */
export interface PostHogClientConfig {
  key: string;
  host: string;
  sessionReplay: boolean;
  /** development / preview / production, attached to every browser event. */
  environment?: string;
}

const enabled = (value: string | undefined) => value?.trim().toLowerCase() === 'true';

/**
 * Null when POSTHOG_KEY is unset, which keeps the whole integration inert for
 * local development, tests and Docker builds that never see a key.
 */
export function postHogClientConfig(): PostHogClientConfig | null {
  const key = process.env.POSTHOG_KEY?.trim();
  if (!key) return null;

  return {
    key,
    host: process.env.POSTHOG_HOST?.trim() || DEFAULT_POSTHOG_HOST,
    sessionReplay: enabled(process.env.POSTHOG_SESSION_REPLAY),
    environment: appEnvironment(),
  };
}
