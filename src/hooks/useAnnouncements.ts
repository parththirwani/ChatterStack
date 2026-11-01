"use client";

import { useCallback, useRef, useState } from 'react';

/**
 * Drives the block's polite live regions.
 *
 * A screen reader only speaks a change of text, so a second
 * "GitHub (read only) removed." right after the first would be swallowed on
 * the page that already said it. Messages therefore alternate between two
 * parked regions: every announcement is an insertion into a region that was
 * just emptied, so nothing is silently dropped. Both regions render, and each
 * message appears in exactly one of them.
 */
export function useAnnouncements() {
  const [messages, setMessages] = useState<[string, string]>(['', '']);
  const slot = useRef(0);

  const announce = useCallback((message: string) => {
    const next = slot.current === 0 ? 1 : 0;
    slot.current = next;
    setMessages(next === 0 ? [message, ''] : ['', message]);
  }, []);

  return { messages, announce };
}
