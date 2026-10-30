import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs/config";

const nextConfig: NextConfig = {
  devIndicators: false,
  compiler: {
    removeConsole: process.env.NODE_ENV === "production",
  },

  experimental: {
    // Reuse RSC payloads for a short window so back/forward and repeated
    // clicks on the same conversation are instant instead of refetching.
    staleTimes: {
      dynamic: 30,
      static: 300,
    },
  },

  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "**.googleusercontent.com",
      },
      {
        protocol: "https",
        hostname: "avatars.githubusercontent.com",
      },
    ],
  },

  output: "standalone",
};

// Runtime error capture works with or without these values. Source maps are
// only uploaded when SENTRY_AUTH_TOKEN exists, so builds without a Sentry
// account (Docker, forks, CI secrets absent) stay untouched.
export default withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG || undefined,
  project: process.env.SENTRY_PROJECT || undefined,
  ...(process.env.SENTRY_AUTH_TOKEN ? { authToken: process.env.SENTRY_AUTH_TOKEN } : {}),
  // Turbopack (this repo's build command) has no webpack hook: build-time
  // server instrumentation is a webpack-only feature, so it stays off.
  buildTimeInstrumentation: false,
  silent: true,
  telemetry: false,
});
