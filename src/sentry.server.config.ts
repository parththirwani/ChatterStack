import * as Sentry from '@sentry/nextjs';
import { sentryBaseOptions, serverSentryDsn } from './lib/observability/sentry-options';
import { scrubBreadcrumb, scrubEvent, type SentryEventLike, type SentryLikeBreadcrumb } from './lib/observability/sentry-filters';

/**
 * Server SDK (Node runtime). Disabled while SENTRY_DSN is unset, so local
 * development, tests and Docker keep working with no configuration.
 */
Sentry.init({
  ...sentryBaseOptions(serverSentryDsn()),
  beforeSend: (event, hint) => scrubEvent(event as unknown as SentryEventLike, hint) as typeof event | null,
  beforeBreadcrumb: (breadcrumb) => scrubBreadcrumb(breadcrumb as unknown as SentryLikeBreadcrumb) as typeof breadcrumb | null,
});
