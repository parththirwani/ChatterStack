import * as Sentry from '@sentry/nextjs';
import { clientSentryDsn, sentryBaseOptions } from './lib/observability/sentry-options';
import { scrubBreadcrumb, scrubEvent, type SentryEventLike, type SentryLikeBreadcrumb } from './lib/observability/sentry-filters';

/**
 * Browser SDK. `NEXT_PUBLIC_SENTRY_DSN` is inlined at build time, so the
 * Dockerfile declares it as a build ARG that defaults to empty: with no value
 * the SDK stays disabled and nothing is sent.
 */
Sentry.init({
  ...sentryBaseOptions(clientSentryDsn()),
  beforeSend: (event, hint) => scrubEvent(event as unknown as SentryEventLike, hint) as typeof event | null,
  beforeBreadcrumb: (breadcrumb) => scrubBreadcrumb(breadcrumb as unknown as SentryLikeBreadcrumb) as typeof breadcrumb | null,
});

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
