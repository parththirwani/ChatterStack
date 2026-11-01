'use client';
import React, { useEffect, useRef, useState } from 'react';
import { Undo2 } from 'lucide-react';
import { motion, useReducedMotion } from 'motion/react';
import type { PendingRemoval } from './useUndoableRemoval';

export interface UndoBarProps {
  pending: PendingRemoval;
  /** Remaining ms in the undo window; the bar polls it while mounted. */
  getRemaining: () => number;
  windowMs: number;
  onUndo: () => void;
  /** Escape / close: fold the bar away; the countdown keeps running. */
  onHide: () => void;
  onPauseSource: (source: string, on: boolean) => void;
}

/**
 * The Undo bar for deferred removals. The DELETE only goes out when the window
 * closes, so nothing here deletes anything: Undo cancels the pending request,
 * resting pointer or focus pauses the countdown, Escape folds the bar away
 * (Ctrl/Cmd+Z brings it back while the removal is still pending).
 */
export default function UndoBar({ pending, getRemaining, windowMs, onUndo, onHide, onPauseSource }: UndoBarProps) {
  const reduceMotion = useReducedMotion();
  const containerRef = useRef<HTMLDivElement>(null);
  const undoRef = useRef<HTMLButtonElement>(null);
  const wasHidden = useRef(pending.hidden);
  const [remainingMs, setRemainingMs] = useState(() => getRemaining());

  // Poll the countdown; a paused window simply stops moving.
  useEffect(() => {
    setRemainingMs(getRemaining());
    const tick = setInterval(() => setRemainingMs(getRemaining()), 250);
    return () => clearInterval(tick);
  }, [getRemaining, pending.paused]);

  // Ctrl/Cmd+Z re-opening the bar hands keyboard focus to Undo.
  useEffect(() => {
    if (wasHidden.current && !pending.hidden) undoRef.current?.focus();
    wasHidden.current = pending.hidden;
  }, [pending.hidden]);

  const seconds = Math.max(0, Math.ceil(remainingMs / 1000));
  const fraction = Math.max(0, Math.min(1, remainingMs / windowMs));

  return (
    <motion.div
      ref={containerRef}
      role="group"
      aria-label={`Removing ${pending.connection.name}`}
      tabIndex={-1}
      initial={reduceMotion ? false : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={reduceMotion ? { duration: 0 } : { type: 'spring', visualDuration: 0.26, bounce: 0 }}
      onPointerEnter={() => onPauseSource('pointer', true)}
      onPointerLeave={() => onPauseSource('pointer', false)}
      onFocus={() => onPauseSource('focus', true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) onPauseSource('focus', false);
      }}
      onKeyDown={(event) => { if (event.key === 'Escape') { event.preventDefault(); onHide(); } }}
      className="relative overflow-hidden rounded-b-2xl border-t border-amber-300/20 bg-amber-400/[0.07] px-4 py-3 outline-none"
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <p className="min-w-0 flex-1 text-sm text-[#f0e3c0]">
          Removing {pending.connection.name}.
          <span className="text-[#aaa6a2]"> The stored token goes with it.</span>
        </p>
        <span aria-hidden="true" className="shrink-0 text-[11px] tabular-nums text-[#aaa6a2]">
          {pending.paused ? 'paused' : `${seconds}s`}
        </span>
        <button
          ref={undoRef}
          type="button"
          onClick={onUndo}
          className="flex shrink-0 items-center gap-1.5 rounded-lg bg-[#f0eeeb] px-3 py-1.5 text-sm font-medium text-[#1c1b19] hover:bg-white"
        >
          <Undo2 className="h-3.5 w-3.5" aria-hidden="true" />
          Undo
        </button>
      </div>
      <p className="sr-only">
        {pending.paused
          ? 'The removal countdown is paused while you are on this bar. It resumes when the bar is left.'
          : `The connection is deleted in about ${seconds} seconds unless you undo.`}
      </p>
      <span
        aria-hidden="true"
        className={`absolute inset-x-0 bottom-0 h-0.5 origin-left bg-amber-300/80 ${reduceMotion ? '' : 'transition-[width] duration-300 ease-linear'}`}
        style={{ width: `${fraction * 100}%` }}
      />
    </motion.div>
  );
}
