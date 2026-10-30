"use client";

import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";

/**
 * Last-resort boundary for the whole App Router (including the catch-all
 * chat route). Reports the error, then shows the same dark shell the app
 * uses elsewhere. Nothing from the failed render is attached to the event.
 */
export default function GlobalError({ error }: { error: Error & { digest?: string } }) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="en">
      <body style={{ margin: 0, background: "#191919", color: "#f3f1ee", fontFamily: "system-ui, sans-serif" }}>
        <main
          style={{
            minHeight: "100vh",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: "12px",
            padding: "24px",
            textAlign: "center",
          }}
        >
          <h1 style={{ margin: 0, fontSize: "19px", fontWeight: 600 }}>Something went wrong</h1>
          <p style={{ margin: 0, fontSize: "13.5px", color: "#a7a39e" }}>
            ChatterStack hit an unexpected error. Reloading usually fixes it.
          </p>
        </main>
      </body>
    </html>
  );
}
