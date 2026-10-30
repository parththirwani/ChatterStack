"use client";

import React, { useEffect } from 'react';
import { AlertCircle, X } from 'lucide-react';
import { useToastStore, type Toast } from '@/src/lib/client/toast';

/** How long a toast stays up before it dismisses itself. */
export const TOAST_DURATION_MS = 5000;

function ToastItem({ toast }: { toast: Toast }) {
  const dismiss = useToastStore((state) => state.dismiss);

  useEffect(() => {
    const timer = window.setTimeout(() => dismiss(toast.id), TOAST_DURATION_MS);
    return () => window.clearTimeout(timer);
  }, [dismiss, toast.id]);

  const error = toast.tone === 'error';
  return (
    <div
      role={error ? 'alert' : 'status'}
      className="pointer-events-auto flex w-full max-w-[360px] items-start gap-2.5 rounded-xl border border-white/[0.09] bg-[#202020] px-3.5 py-3 text-[13px] leading-5 text-[#e6e3de] shadow-[0_12px_40px_rgba(0,0,0,0.45)]"
    >
      {error && <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-400" strokeWidth={1.8} aria-hidden="true" />}
      <p className="min-w-0 flex-1">{toast.message}</p>
      <button
        type="button"
        onClick={() => dismiss(toast.id)}
        className="-m-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-[#8f8b86] transition-colors hover:bg-white/[0.06] hover:text-white"
        aria-label="Dismiss notification"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

/** Stack of toasts at the bottom of the screen. Mount once per page. */
export default function Toaster() {
  const toasts = useToastStore((state) => state.toasts);
  if (toasts.length === 0) return null;

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-4 z-[10000] flex flex-col items-center gap-2 px-4">
      {toasts.map((item) => <ToastItem key={item.id} toast={item} />)}
    </div>
  );
}
