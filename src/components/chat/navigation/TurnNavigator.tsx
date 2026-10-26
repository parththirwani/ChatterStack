"use client";

/**
 * The rail of lines down the left edge of a chat: one tick per question.
 * Hovering (or focusing) a tick previews what was asked and what was answered;
 * clicking it glides the chat to that question instead of scrolling by hand.
 */
import React, { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

import type { Turn } from './turns';
import { summarize, tickWidth } from './turns';

/** A turn counts as "in view" once its top passes this fraction of the viewport. */
const READING_LINE = 0.32;
/** Leaves a little of the question above the top edge when jumping to it. */
const ANCHOR_PADDING = 16;
/** Gap between the rail and the preview card. */
const CARD_GAP = 10;
/** Keeps the card inside the viewport. */
const CARD_MARGIN = 16;
/** Used for the first placement, before the card can be measured. */
const CARD_FALLBACK_HEIGHT = 150;
/** Extra width a tick grows by while its preview is open. */
const TICK_HIGHLIGHT = 6;

interface TurnNavigatorProps {
  /** The scrolling element the ticks jump around inside. */
  containerRef: React.RefObject<HTMLElement | null>;
  turns: Turn[];
}

const TurnNavigator: React.FC<TurnNavigatorProps> = ({ containerRef, turns }) => {
  const [active, setActive] = useState(0);
  const [open, setOpen] = useState<number | null>(null);
  const [focused, setFocused] = useState<number | null>(null);
  const [card, setCard] = useState<{ left: number; bottom: number } | null>(null);

  const cardRef = useRef<HTMLDivElement>(null);
  const tickRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const anchorFor = useCallback(
    (turnIndex: number) => {
      const turn = turns[turnIndex];
      if (!turn) return null;
      return (
        containerRef.current?.querySelector<HTMLElement>(`[data-turn-anchor="${turn.anchorIndex}"]`) ?? null
      );
    },
    [containerRef, turns]
  );

  // Which question the reader is on, so its tick stands out.
  useEffect(() => {
    const container = containerRef.current;
    if (!container || turns.length === 0) return;

    let frame = 0;
    const measure = () => {
      frame = 0;
      const line = container.getBoundingClientRect().top + container.clientHeight * READING_LINE;
      let current = 0;
      container.querySelectorAll<HTMLElement>('[data-turn-anchor]').forEach((node) => {
        const index = turns.findIndex((turn) => turn.anchorIndex === Number(node.dataset.turnAnchor));
        if (index >= 0 && node.getBoundingClientRect().top <= line) current = index;
      });
      setActive((previous) => (previous === current ? previous : current));
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(measure);
    };

    measure();
    container.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      container.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
    };
  }, [containerRef, turns]);

  // Drop tick nodes left over from a shorter chat.
  useEffect(() => {
    tickRefs.current.length = turns.length;
  }, [turns.length]);

  // Keep the card beside its tick, and fully on screen. Re-runs once the card
  // exists so its measured height replaces the estimate used for the first frame.
  useLayoutEffect(() => {
    if (open === null) {
      setCard(null);
      return;
    }
    const place = () => {
      const tick = tickRefs.current[open];
      if (!tick) return;
      const rect = tick.getBoundingClientRect();
      const height = cardRef.current?.offsetHeight ?? CARD_FALLBACK_HEIGHT;
      const highest = Math.max(CARD_MARGIN, window.innerHeight - height - CARD_MARGIN);
      const bottom = Math.min(Math.max(window.innerHeight - rect.bottom + 2, CARD_MARGIN), highest);
      const left = rect.right + CARD_GAP;
      setCard((previous) =>
        previous && previous.left === left && previous.bottom === bottom ? previous : { left, bottom }
      );
    };

    place();
    window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
  }, [open, card]);

  const jumpTo = useCallback(
    (turnIndex: number) => {
      const container = containerRef.current;
      const anchor = anchorFor(turnIndex);
      if (!container || !anchor) return;

      const top =
        container.scrollTop +
        anchor.getBoundingClientRect().top -
        container.getBoundingClientRect().top -
        ANCHOR_PADDING;
      const limit = Math.max(0, container.scrollHeight - container.clientHeight);
      const target = Math.min(Math.max(top, 0), limit);
      const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

      if (typeof container.scrollTo === 'function') {
        container.scrollTo({ top: target, behavior: reduceMotion ? 'auto' : 'smooth' });
      } else {
        container.scrollTop = target;
      }
      setActive(turnIndex);
    },
    [anchorFor, containerRef]
  );

  const focusTick = useCallback((index: number) => {
    setOpen(index);
    setFocused(index);
    tickRefs.current[index]?.focus();
  }, []);

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLElement>) => {
      const last = turns.length - 1;
      const from = focused ?? open ?? active;
      let next: number | null = null;

      if (event.key === 'ArrowDown') next = Math.min(last, from + 1);
      else if (event.key === 'ArrowUp') next = Math.max(0, from - 1);
      else if (event.key === 'Home') next = 0;
      else if (event.key === 'End') next = last;
      else if (event.key === 'Escape') setOpen(null);
      else return;

      if (next === null) return;
      event.preventDefault();
      if (next !== from) focusTick(next);
    },
    [active, focusTick, focused, open, turns.length]
  );

  const shown = open === null ? undefined : turns[open];
  const roving = focused ?? active;
  const widths = useMemo(() => turns.map((turn) => tickWidth(turn.question)), [turns]);

  if (turns.length < 2) return null;

  return (
    <nav
      aria-label="Jump to question"
      onKeyDown={handleKeyDown}
      className="group/rail pointer-events-none absolute inset-y-0 left-0 z-20 hidden w-9 items-center md:flex"
    >
      <div
        className="pointer-events-auto flex flex-col items-start gap-1.5 px-2 py-2"
        onMouseLeave={() => setOpen(null)}
      >
        {turns.map((turn, index) => {
          const isActive = index === active;
          const isOpen = index === open;
          return (
            <button
              key={turn.anchorIndex}
              ref={(node) => {
                tickRefs.current[index] = node;
              }}
              type="button"
              tabIndex={index === roving ? 0 : -1}
              aria-current={isActive ? 'true' : undefined}
              aria-label={`Question ${index + 1} of ${turns.length}: ${summarize(turn.question, 90)}`}
              onClick={() => jumpTo(index)}
              onMouseEnter={() => setOpen(index)}
              onFocus={() => setOpen(index)}
              onBlur={() => {
                setFocused((previous) => (previous === index ? null : previous));
                setOpen((previous) => (previous === index ? null : previous));
              }}
              style={{ width: widths[index] + (isOpen ? TICK_HIGHLIGHT : 0) }}
              className={`relative h-[3px] shrink-0 rounded-full transition-[width,background-color] duration-150 ease-out before:absolute before:-inset-y-1 before:left-0 before:right-0 before:content-[''] ${
                isActive
                  ? 'bg-white/90'
                  : 'bg-white/25 group-hover/rail:bg-white/40 hover:bg-white/75 focus-visible:bg-white/75'
              }`}
            />
          );
        })}
      </div>

      {shown && card && (
        <div
          ref={cardRef}
          aria-hidden="true"
          style={{ left: card.left, bottom: card.bottom }}
          className="turn-preview pointer-events-none fixed z-40 w-[300px] max-w-[calc(100vw_-_32px)] rounded-xl border border-white/[0.09] bg-[#232323] px-3.5 py-3 shadow-[0_14px_36px_rgba(0,0,0,0.5)]"
        >
          <p className="line-clamp-1 text-[13px] font-medium leading-5 text-[#f2f0ed]">{summarize(shown.question)}</p>
          <p className="mt-1 line-clamp-3 text-[12.5px] leading-[1.45] text-[#9d9994]">
            {summarize(shown.answer) || 'No answer yet.'}
          </p>
        </div>
      )}
    </nav>
  );
};

export default memo(TurnNavigator);
