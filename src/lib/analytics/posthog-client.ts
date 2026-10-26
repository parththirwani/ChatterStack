import posthog, { type Properties } from 'posthog-js';
import type { PostHogClientConfig } from './config';
import type { AnalyticsEventName, AnalyticsEventProps } from './events';

/**
 * Anything that could carry private chat data is dropped before it leaves the
 * browser, even if a caller passes it by mistake.
 */
export const DENIED_PROPERTIES = [
  'content',
  'message',
  'messages',
  'prompt',
  'response',
  'completion',
  'reasoning',
  'title',
  'text',
  'filename',
  'file_name',
  'name',
  'email',
  'avatar',
  'image',
  'attachment',
  'attachments',
  'context',
  'rag',
  'token',
  'password',
  'secret',
  'authorization',
] as const;

/** Removes denied keys (recursively) so no chat text can ride along. */
export function sanitizeAnalyticsProperties<T>(properties: T, denied: readonly string[] = DENIED_PROPERTIES): T {
  if (Array.isArray(properties)) {
    return properties.map((item) => sanitizeAnalyticsProperties(item, denied)) as unknown as T;
  }
  if (!properties || typeof properties !== 'object') return properties;

  const clean: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(properties as Record<string, unknown>)) {
    if (denied.includes(key.toLowerCase())) continue;
    clean[key] = sanitizeAnalyticsProperties(value, denied);
  }
  return clean as T;
}

/** Do Not Track / Global Privacy Control: the browser is asked not to be tracked. */
export function isDoNotTrack(): boolean {
  if (typeof window === 'undefined') return true;
  const nav = window.navigator as (Navigator & { globalPrivacyControl?: boolean }) | undefined;
  const dnt = String(nav?.doNotTrack ?? '');
  return dnt === '1' || dnt === 'yes' || (window as Window & { doNotTrack?: string }).doNotTrack === '1'
    || nav?.globalPrivacyControl === true;
}

let initialized = false;

/**
 * Initializes once. Without a key (or with DNT on) nothing is loaded, so the
 * integration stays completely inert.
 */
export function initPostHog(config: PostHogClientConfig | null | undefined): boolean {
  if (initialized || !config?.key) return initialized;
  if (typeof window === 'undefined' || isDoNotTrack()) return false;

  posthog.init(config.key, {
    api_host: config.host,
    defaults: '2026-08-30',
    person_profiles: 'identified_only',
    // Pageviews are captured explicitly by the provider so the App Router's
    // pushState navigation between chats is counted exactly once.
    capture_pageview: false,
    // No element autocapture at all, so no input value is ever read.
    autocapture: false,
    capture_dead_clicks: false,
    capture_exceptions: false,
    capture_performance: false,
    disable_scroll_properties: true,
    disable_surveys: true,
    disable_product_tours: true,
    // Session replay is off unless POSTHOG_SESSION_REPLAY=true.
    disable_session_recording: !config.sessionReplay,
    session_recording: {
      maskAllInputs: true,
      maskAllElementAttributes: true,
      maskTextSelector: '*',
      maskTextFn: () => '[masked]',
      recordCrossOriginIframes: false,
      captureJsonLd: false,
    },
    mask_all_text: true,
    mask_all_element_attributes: true,
    property_denylist: [...DENIED_PROPERTIES],
    sanitize_properties: (properties) => sanitizeAnalyticsProperties(properties as Record<string, unknown>) as Properties,
  });

  initialized = true;
  return true;
}

/** Test hook: forget that init ran. */
export function resetPostHogClient(): void {
  initialized = false;
}

export function isPostHogReady(): boolean {
  return initialized;
}

function capture(name: string, props: object): void {
  if (!initialized) return;
  try {
    posthog.capture(name, sanitizeAnalyticsProperties(props) as Properties);
  } catch {
    // Analytics never breaks the UI.
  }
}

export function captureClientEvent<E extends AnalyticsEventName>(name: E, props: AnalyticsEventProps[E]): void {
  capture(name, props);
}

export function capturePageview(url: string): void {
  if (!initialized) return;
  try {
    posthog.capture('$pageview', { $current_url: url });
  } catch {
    // Analytics never breaks the UI.
  }
}

/** Identity is the NextAuth user id only: never an email, name or avatar. */
export function identifyUser(userId: string): void {
  if (!initialized || !userId || userId === 'guest') return;
  try {
    posthog.identify(userId);
  } catch {
    // ignore
  }
}

export function resetUser(): void {
  if (!initialized) return;
  try {
    posthog.reset();
  } catch {
    // ignore
  }
}
