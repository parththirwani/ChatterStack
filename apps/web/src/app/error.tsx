"use client";

import * as Sentry from "@sentry/nextjs";
import { AlertCircle } from "lucide-react";
import { useEffect } from "react";

/**
 * Error boundary for the app tree. Keeps the look of the in-chat error banner
 * and reports the render failure; retrying never re-sends the same event.
 */
export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <div className="flex min-h-dvh items-center justify-center bg-[#191919] px-6" role="alert">
      <div className="flex w-full max-w-[520px] items-start gap-2.5 rounded-xl border border-red-500/20 bg-red-500/[0.07] px-3.5 py-2.5 text-[13px] text-red-200">
        <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-300" />
        <div className="min-w-0 flex-1">
          <p className="font-medium">This page failed to load.</p>
          <p className="mt-1 text-red-200/80">The error was reported. Try again, or open another chat.</p>
        </div>
        <button
          onClick={reset}
          className="shrink-0 rounded-md px-2 py-0.5 text-[12px] font-medium text-red-300/80 transition-colors hover:bg-red-500/10 hover:text-red-200"
        >
          Try again
        </button>
      </div>
    </div>
  );
}
