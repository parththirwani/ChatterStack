/**
 * The left rail in jsdom: what each tick is named, what the preview card shows,
 * and where a click tells the chat to scroll. Layout is stubbed, so the real
 * smooth-scroll animation and card placement are covered by the browser test.
 */
import React, { type RefObject } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import TurnNavigator from '@/src/components/chat/navigation/TurnNavigator';
import type { Turn } from '@/src/components/chat/navigation/turns';

const TURNS: Turn[] = [
  { anchorIndex: 0, question: 'Why is the build slow?', answer: 'Because `npm ci` runs on every commit.' },
  {
    anchorIndex: 2,
    question: 'What should I change first, so the pipeline stops reinstalling every dependency?',
    answer: '**Cache the install.**',
  },
  { anchorIndex: 4, question: 'And the tests?', answer: '' },
];

const ticks = () => screen.queryAllByRole('button', { name: /^Question \d+ of \d+/ });
const card = () => document.querySelector<HTMLElement>('.turn-preview');

function box(top: number, bottom: number): DOMRect {
  return { top, bottom, left: 0, right: 0, width: 0, height: bottom - top, x: 0, y: 0, toJSON: () => ({}) } as DOMRect;
}

interface MountOptions {
  turns?: Turn[];
  /** Height of the scrolling viewport. */
  viewHeight?: number;
  /** Offset of each anchor inside the scrolled element. */
  anchorTops?: number[];
  scrollTop?: number;
  scrollHeight?: number;
  reduceMotion?: boolean;
}

function mount({
  turns = TURNS,
  viewHeight = 600,
  anchorTops = [10, 900, 1800],
  scrollTop = 0,
  scrollHeight = 3000,
  reduceMotion = false,
}: MountOptions = {}) {
  const scroller = document.createElement('div');
  document.body.append(scroller);
  const anchors = turns.map((turn) => {
    const node = document.createElement('div');
    node.dataset.turnAnchor = String(turn.anchorIndex);
    scroller.append(node);
    return node;
  });

  Object.defineProperty(scroller, 'clientHeight', { value: viewHeight, configurable: true });
  Object.defineProperty(scroller, 'scrollHeight', { value: scrollHeight, configurable: true });
  Object.defineProperty(scroller, 'scrollTop', { value: scrollTop, configurable: true, writable: true });
  scroller.getBoundingClientRect = () => box(0, viewHeight);
  const scrollTo = vi.fn();
  scroller.scrollTo = scrollTo;
  anchors.forEach((node, index) => {
    const top = anchorTops[index] ?? 0;
    // A real box moves with the scroll, so the rail measures the same way.
    node.getBoundingClientRect = () => box(top - scroller.scrollTop, top - scroller.scrollTop + 120);
  });

  const matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: query === '(prefers-reduced-motion: reduce)' && reduceMotion,
    media: query,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
    onchange: null,
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
  vi.stubGlobal('matchMedia', matchMedia);

  const containerRef = { current: scroller } as RefObject<HTMLElement | null>;
  render(<TurnNavigator containerRef={containerRef} turns={turns} />);

  /** Lets the scroll-driven measurement run (it waits for a frame). */
  const settle = async () => {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
  };

  return { scroller, anchors, scrollTo, settle };
}

afterEach(() => {
  cleanup();
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

describe('the rail', () => {
  it('shows one tick per question, in order', () => {
    mount();
    expect(ticks()).toHaveLength(3);
    expect(ticks()[0]).toHaveAccessibleName('Question 1 of 3: Why is the build slow?');
    expect(ticks()[2]).toHaveAccessibleName('Question 3 of 3: And the tests?');
  });

  it('stays out of the way until there is something to navigate', () => {
    cleanup();
    mount({ turns: [{ anchorIndex: 0, question: 'Only one', answer: 'Answer' }] });
    expect(ticks()).toHaveLength(0);
  });

  it('gives a longer question a longer tick', () => {
    mount();
    const [first, second] = ticks();
    expect(Number(first.style.width.replace('px', ''))).toBeLessThan(Number(second.style.width.replace('px', '')));
  });

  it('marks the question the reader is on', async () => {
    const { scroller, settle } = mount({ scrollTop: 0 });
    await settle();
    expect(ticks()[0]).toHaveAttribute('aria-current', 'true');
    expect(ticks()[1]).not.toHaveAttribute('aria-current');

    // Scroll down to the second question.
    Object.defineProperty(scroller, 'scrollTop', { value: 1200, configurable: true, writable: true });
    fireEvent.scroll(scroller);
    await settle();

    expect(ticks()[1]).toHaveAttribute('aria-current', 'true');
    expect(ticks()[0]).not.toHaveAttribute('aria-current');
  });

  it('is one tab stop, and the arrows walk the rail', async () => {
    const user = userEvent.setup();
    mount();
    expect(ticks().filter((tick) => tick.tabIndex === 0)).toHaveLength(1);

    ticks()[0].focus();
    await user.keyboard('{ArrowDown}');
    expect(ticks()[1]).toHaveFocus();
    expect(card()?.textContent).toContain('What should I change first');

    await user.keyboard('{End}');
    expect(ticks()[2]).toHaveFocus();

    await user.keyboard('{Home}');
    expect(ticks()[0]).toHaveFocus();

    await user.keyboard('{ArrowUp}');
    expect(ticks()[0]).toHaveFocus();

    await user.keyboard('{Escape}');
    expect(card()).toBeNull();
  });
});

describe('the preview card', () => {
  it('shows what was asked and what was answered, without the markdown', async () => {
    const user = userEvent.setup();
    mount();

    await user.hover(ticks()[1]);

    const shown = card();
    expect(shown).not.toBeNull();
    expect(shown).toHaveTextContent('What should I change first');
    expect(shown).toHaveTextContent('Cache the install.');
    expect(shown?.textContent).not.toContain('**');
    expect(shown).toHaveAttribute('aria-hidden', 'true');
  });

  it('says when the answer has not arrived yet', async () => {
    const user = userEvent.setup();
    mount();

    await user.hover(ticks()[2]);

    expect(card()).toHaveTextContent('No answer yet.');
  });

  it('follows the pointer from one question to the next and closes on leave', async () => {
    const user = userEvent.setup();
    mount();

    await user.hover(ticks()[0]);
    expect(card()).toHaveTextContent('Why is the build slow?');

    await user.hover(ticks()[1]);
    expect(card()).toHaveTextContent('What should I change first');

    await user.unhover(ticks()[1]);
    expect(card()).toBeNull();
  });

  it('replaces estimate with the measured position once it is on screen', async () => {
    const user = userEvent.setup();
    mount();

    await user.hover(ticks()[0]);
    const shown = card();
    expect(shown?.style.left).toBe('10px');
    expect(Number.parseFloat(shown?.style.bottom ?? '')).toBeGreaterThan(0);
  });
});

describe('jumping to a question', () => {
  it('glides the chat to just above the question', async () => {
    const user = userEvent.setup();
    const { scrollTo } = mount({ scrollTop: 1200 });

    await user.click(ticks()[1]);

    // The question starts 900px into the chat, and the rail leaves 16px above it.
    expect(scrollTo).toHaveBeenCalledWith({ top: 884, behavior: 'smooth' });
  });

  it('keeps the jump inside the scrollable range', async () => {
    const user = userEvent.setup();
    const { scrollTo } = mount({ scrollTop: 0, scrollHeight: 500 });

    await user.click(ticks()[2]);

    // The chat is shorter than its viewport, so there is nowhere to go.
    expect(scrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'smooth' });
  });

  it('moves without animating when the reader asks for less motion', async () => {
    const user = userEvent.setup();
    const { scrollTo } = mount({ reduceMotion: true });

    await user.click(ticks()[1]);

    expect(scrollTo).toHaveBeenCalledWith(expect.objectContaining({ behavior: 'auto' }));
  });

  it('marks the jumped question as the current one right away', async () => {
    const user = userEvent.setup();
    mount();

    await user.click(ticks()[2]);

    expect(ticks()[2]).toHaveAttribute('aria-current', 'true');
  });
});
