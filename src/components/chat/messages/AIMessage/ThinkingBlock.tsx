"use client";
import React, { useEffect, useId, useRef, useState } from 'react';
import { ChevronRight, Sparkle } from 'lucide-react';
import { Orb } from '@/src/components/ui/orb/Orb';

interface ThinkingBlockProps {
  reasoning?: string;
  startedAt?: number;
  durationMs?: number;
  /** The model is still reasoning (no answer tokens yet). */
  active: boolean;
}

function formatSeconds(ms: number): string {
  const seconds = Math.max(1, Math.round(ms / 1000));
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

function useElapsed(startedAt: number | undefined, running: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!running) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [running]);
  return startedAt ? now - startedAt : 0;
}

/** Shown before the first token of a reply arrives. */
export const PendingIndicator: React.FC<{ label?: string }> = ({ label = 'Thinking' }) => (
  <span role="status" className="flex items-center gap-2 text-[13px] text-[#a9a5a0]">
    <Orb />
    <span>{label}</span>
  </span>
);

export const ThinkingBlock: React.FC<ThinkingBlockProps> = ({ reasoning, startedAt, durationMs, active }) => {
  const panelId = useId();
  const [expanded, setExpanded] = useState(active);
  const userToggledRef = useRef(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const elapsed = useElapsed(startedAt, active);

  // Follow the stream open, then fold away once the answer starts, unless the
  // user has taken control of the disclosure.
  useEffect(() => {
    if (!userToggledRef.current) setExpanded(active);
  }, [active]);

  useEffect(() => {
    const el = scrollRef.current;
    if (active && el) el.scrollTop = el.scrollHeight;
  }, [reasoning, active]);

  if (!reasoning) return null;

  const label = active
    ? `Thinking · ${formatSeconds(elapsed)}`
    : durationMs !== undefined
      ? `Thought for ${formatSeconds(durationMs)}`
      : 'Thoughts';

  return (
    <div className="not-prose mb-3">
      <button
        type="button"
        aria-expanded={expanded}
        aria-controls={panelId}
        onClick={() => {
          userToggledRef.current = true;
          setExpanded((value) => !value);
        }}
        className="-ml-1.5 flex min-h-8 items-center gap-2 rounded-lg px-1.5 text-[13px] text-[#a9a5a0] transition-colors hover:bg-white/[0.05] hover:text-[#e6e3de]"
      >
        {active ? <Orb /> : <span className="flex h-5 w-5 items-center justify-center"><Sparkle className="h-4 w-4" strokeWidth={1.7} aria-hidden="true" /></span>}
        <span className={active ? 'text-[#cfcbc5]' : undefined}>{label}</span>
        <ChevronRight className={`h-3.5 w-3.5 transition-transform ${expanded ? 'rotate-90' : ''}`} strokeWidth={1.7} aria-hidden="true" />
      </button>
      {active && <span className="sr-only" role="status">Thinking</span>}
      <div
        id={panelId}
        ref={scrollRef}
        hidden={!expanded}
        className="ml-[9px] mt-2 max-h-72 overflow-y-auto whitespace-pre-wrap break-words border-l-2 border-white/10 py-0.5 pl-3 text-[13px] leading-[1.55] text-[#8f8b86]"
      >
        {reasoning}
      </div>
    </div>
  );
};
