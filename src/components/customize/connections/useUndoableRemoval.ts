'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { deleteMcpConnection } from '@/src/lib/client/mcp';
import type { McpConnectionView } from '@/src/types/mcp.types';

/** How long the Undo bar stays open before the DELETE actually goes out. */
export const UNDO_WINDOW_MS = 6_000;

export interface PendingRemoval {
  connection: McpConnectionView;
  /** True while a pointer or keyboard focus rests on the bar; the countdown waits. */
  paused: boolean;
  /** True after Escape folded the bar away; the countdown keeps running. */
  hidden: boolean;
}

interface UseUndoableRemovalOptions {
  /** Called after a removal is committed or refused, for the polite live region. */
  announce: (message: string) => void;
  /** Called when the DELETE itself fails, so the row can come back with a reason. */
  fail: (message: string) => void;
  windowMs?: number;
}

/**
 * Client-deferred removal, the Arc way: the row disappears at once and the bar
 * offers Undo, but the DELETE request only leaves when the window closes or a
 * second removal starts. Deliberate limits, both in the safe direction:
 * - unmounting with the bar open drops the pending removal without sending
 *   anything, so the connection is still on the server after a reload;
 * - Escape only folds the bar away - the timer keeps running, and Ctrl/Cmd+Z
 *   brings the bar back while the removal is still pending.
 */
export function useUndoableRemoval({ announce, fail, windowMs = UNDO_WINDOW_MS }: UseUndoableRemovalOptions) {
  const [pending, setPending] = useState<PendingRemoval | null>(null);
  // Ids already sent (or assumed sent) so their rows stay hidden through the
  // refresh that follows; the page prunes the set once the list no longer has them.
  const [committed, setCommitted] = useState<string[]>([]);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const deadline = useRef(0);
  const remaining = useRef(windowMs);
  const pendingRef = useRef<PendingRemoval | null>(null);
  const pausedBy = useRef(new Set<string>());

  const setPendingBoth = useCallback((next: PendingRemoval | null) => {
    pendingRef.current = next;
    setPending(next);
  }, []);

  const disarm = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  }, []);

  const sendDelete = useCallback((connection: McpConnectionView) => {
    deleteMcpConnection(connection.id).then(
      () => announce(`${connection.name} removed.`),
      (error: Error) => {
        // The row comes back with a reason instead of silently pretending it is gone.
        setCommitted((ids) => ids.filter((id) => id !== connection.id));
        if (pendingRef.current?.connection.id === connection.id) setPendingBoth(null);
        fail(`Could not remove ${connection.name}: ${error.message}`);
      },
    );
  }, [announce, fail, setPendingBoth]);

  const arm = useCallback((ms: number) => {
    disarm();
    remaining.current = ms;
    deadline.current = Date.now() + ms;
    timer.current = setTimeout(() => {
      const current = pendingRef.current;
      if (!current) return;
      setPendingBoth(null);
      setCommitted((ids) => (ids.includes(current.connection.id) ? ids : [...ids, current.connection.id]));
      sendDelete(current.connection);
    }, ms);
  }, [disarm, sendDelete, setPendingBoth]);

  const start = useCallback((connection: McpConnectionView) => {
    const previous = pendingRef.current;
    if (previous) {
      // A second removal closes the first window: that DELETE goes out now.
      disarm();
      setCommitted((ids) => (ids.includes(previous.connection.id) ? ids : [...ids, previous.connection.id]));
      sendDelete(previous.connection);
    }
    setPendingBoth({ connection, paused: false, hidden: false });
    pausedBy.current.clear();
    arm(windowMs);
  }, [arm, disarm, sendDelete, setPendingBoth, windowMs]);

  const undo = useCallback(() => {
    if (!pendingRef.current) return;
    disarm();
    pausedBy.current.clear();
    const { connection } = pendingRef.current;
    setPendingBoth(null);
    announce(`${connection.name} kept. Nothing was deleted.`);
  }, [announce, disarm, setPendingBoth]);

  /** Escape: fold the bar away but keep the countdown, so removal still happens. */
  const hide = useCallback(() => {
    if (!pendingRef.current) return;
    setPendingBoth({ ...pendingRef.current, hidden: true });
  }, [setPendingBoth]);

  /** Ctrl/Cmd+Z: bring the folded bar back while the removal is still pending. */
  const show = useCallback(() => {
    if (!pendingRef.current) return;
    setPendingBoth({ ...pendingRef.current, hidden: false });
  }, [setPendingBoth]);

  const setPauseSource = useCallback((source: string, on: boolean) => {
    if (!pendingRef.current) return;
    if (on) pausedBy.current.add(source);
    else pausedBy.current.delete(source);
    const paused = pausedBy.current.size > 0;
    if (paused === pendingRef.current.paused) return;
    setPendingBoth({ ...pendingRef.current, paused });
    if (paused) {
      disarm();
      remaining.current = Math.max(0, deadline.current - Date.now());
    } else {
      arm(remaining.current);
    }
  }, [arm, disarm, setPendingBoth]);

  // Ctrl/Cmd+Z re-opens the folded bar. Kept away from text inputs so undoing
  // typing inside a field still belongs to the field.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.key !== 'z' && event.key !== 'Z') || !(event.ctrlKey || event.metaKey) || event.shiftKey || event.altKey) return;
      if (!pendingRef.current) return;
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target?.isContentEditable) return;
      event.preventDefault();
      show();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [show]);

  // Unmount with the bar open: stop the timer and send nothing. The connection
  // stays intact on the server - the safe direction - and reappears on remount.
  useEffect(() => () => { disarm(); }, [disarm]);

  /** Live countdown value for the bar's display: frozen while any pause source holds. */
  const getRemaining = useCallback(
    () => (pausedBy.current.size > 0 ? remaining.current : Math.max(0, deadline.current - Date.now())),
    [],
  );

  /** Forget committed ids the refreshed list no longer contains. */
  const pruneCommitted = useCallback((visibleIds: readonly string[]) => {
    setCommitted((ids) => {
      const stillThere = new Set(visibleIds);
      const next = ids.filter((id) => stillThere.has(id));
      return next.length === ids.length ? ids : next;
    });
  }, []);

  return { pending, committed, start, undo, hide, show, getRemaining, windowMs, setPauseSource, pruneCommitted };
}
