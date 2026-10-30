'use client';

import React, { useEffect } from 'react';
import { usePathname } from 'next/navigation';
import type { PostHogClientConfig } from '@/src/lib/analytics/config';
import { capturePageview, initPostHog, identifyUser } from '@/src/lib/analytics/posthog-client';
import { useAppStore } from '@/src/store/rootStore';

interface PostHogAnalyticsProps {
  /** Read from the environment on the server, so Docker needs no build args. */
  config: PostHogClientConfig | null;
  children: React.ReactNode;
}

/**
 * Initializes posthog-js once per page and tracks a pageview for every route,
 * including the catch-all chat route whose chat switches happen with
 * history.pushState. Does nothing at all when `config` is null.
 */
const PostHogAnalytics: React.FC<PostHogAnalyticsProps> = ({ config, children }) => {
  const pathname = usePathname();
  const userId = useAppStore((state) => state.user?.id);

  useEffect(() => {
    initPostHog(config);
  }, [config]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    capturePageview(window.location.href);
  }, [pathname]);

  useEffect(() => {
    if (userId && userId !== 'guest') identifyUser(userId);
  }, [userId]);

  return <>{children}</>;
};

export default PostHogAnalytics;
