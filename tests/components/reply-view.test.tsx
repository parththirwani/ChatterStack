import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PendingIndicator, ThinkingBlock } from '@/src/components/chat/messages/AIMessage/ThinkingBlock';
import CouncilProgressIndicator from '@/src/components/council/progress/ProgressIndicator';
import { CouncilSummary } from '@/src/components/council/summary/CouncilSummary';
import AIMessage from '@/src/components/chat/messages/AIMessage/AIMessage';
import type { CouncilDetails, CouncilProgress } from '@/src/types/chat.types';

const GPT = 'openai/gpt-6.1-sol';
const GEMINI = 'google/gemini-4-argon';
const CLAUDE = 'anthropic/claude-sonnet-5.5';
const DEEPSEEK = 'deepseek/deepseek-v4.1-flash-1017';

const orbs = (root: HTMLElement = document.body) =>
  Array.from(root.querySelectorAll<HTMLElement>('[data-testid="orb"]'));

describe('thinking display', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
    vi.setSystemTime(new Date('2026-10-26T09:00:10Z'));
  });
  afterEach(() => vi.useRealTimers());

  it('uses the composing orb from thinking-orbs while the model thinks', () => {
    render(<ThinkingBlock reasoning="Considering options" startedAt={Date.now() - 8000} active />);
    expect(orbs()).toHaveLength(1);
    expect(orbs()[0]).toHaveAttribute('data-state', 'composing');
    expect(screen.getByRole('button', { name: /Thinking · 8s/ })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('Considering options')).toBeVisible();
  });

  it('counts up while thinking', () => {
    render(<ThinkingBlock reasoning="…" startedAt={Date.now()} active />);
    act(() => vi.advanceTimersByTime(3000));
    expect(screen.getByRole('button', { name: /Thinking · 3s/ })).toBeInTheDocument();
  });

  it('folds into "Thought for Ns" once the answer starts', () => {
    const { rerender } = render(<ThinkingBlock reasoning="Considering options" startedAt={Date.now() - 14000} active />);
    rerender(<ThinkingBlock reasoning="Considering options" startedAt={Date.now() - 14000} durationMs={14000} active={false} />);

    const toggle = screen.getByRole('button', { name: /Thought for 14s/ });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(orbs()).toHaveLength(0);
    expect(screen.getByText('Considering options')).not.toBeVisible();
  });

  it('can be reopened, and stays how the user left it', async () => {
    vi.useRealTimers();
    const user = userEvent.setup();
    const { rerender } = render(<ThinkingBlock reasoning="Steps" durationMs={5000} active={false} />);
    await user.click(screen.getByRole('button', { name: /Thought for 5s/ }));
    expect(screen.getByText('Steps')).toBeVisible();
    rerender(<ThinkingBlock reasoning="Steps" durationMs={5000} active={false} />);
    expect(screen.getByText('Steps')).toBeVisible();
  });

  it('shows nothing when the model did not reason', () => {
    const { container } = render(<ThinkingBlock active={false} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows a composing orb before the first token arrives', () => {
    render(<PendingIndicator />);
    expect(screen.getByRole('status')).toHaveTextContent('Thinking');
    expect(orbs()[0]).toHaveAttribute('data-state', 'composing');
  });
});

const details: CouncilDetails = { members: [GPT, GEMINI, CLAUDE, DEEPSEEK], chair: GEMINI, answers: [], rankings: [] };

describe('council progress card', () => {
  const stage1: CouncilProgress[] = [
    { stage: 'stage1', model: GPT, progress: 100 },
    { stage: 'stage1', model: GEMINI, progress: 0 },
    { stage: 'stage1', model: DEEPSEEK, progress: -1 },
  ];

  it('uses composing for the council and searching for each model working on its own', () => {
    render(<CouncilProgressIndicator progress={stage1} details={details} />);

    const header = screen.getByRole('heading', { name: 'Council is deliberating' }).closest('div')!.parentElement!;
    expect(orbs(header)[0]).toHaveAttribute('data-state', 'composing');
    expect(orbs(header)[0]).toHaveAttribute('data-size', '32');

    const step = screen.getByText('Independent answers', { selector: 'div' }).closest('li')!;
    const [marker, ...memberOrbs] = orbs(step);
    expect(marker).toHaveAttribute('data-state', 'searching');
    expect(memberOrbs.map((orb) => orb.dataset.state)).toEqual(['searching']);
  });

  it('shows each member as done, working, queued or skipped', () => {
    render(<CouncilProgressIndicator progress={stage1} details={details} />);
    const row = (name: string) => screen.getByText(name).closest('li')!;
    expect(within(row('GPT-6.1 Sol')).getByText('Done')).toBeInTheDocument();
    expect(within(row('Gemini 4 Argon')).getByText('Working')).toBeInTheDocument();
    expect(within(row('Claude Sonnet 5.5')).getByText('Queued')).toBeInTheDocument();
    expect(within(row('DeepSeek V4.1 Flash')).getByText('Skipped')).toBeInTheDocument();
  });

  it('moves through the three steps and names the chair', () => {
    const stage2: CouncilProgress[] = [
      ...stage1.filter((p) => p.model !== GEMINI),
      { stage: 'stage1', model: GEMINI, progress: 100 },
      { stage: 'stage1', model: CLAUDE, progress: 100 },
      { stage: 'stage2', model: GPT, progress: 100 },
      { stage: 'stage2', model: GEMINI, progress: 0 },
    ];
    render(<CouncilProgressIndicator progress={stage2} details={details} />);

    expect(screen.getByText(/Step 2 of 3 · Peer review/)).toBeInTheDocument();
    expect(screen.getByText('3 of 4 members answered · 1 skipped')).toBeInTheDocument();
    expect(screen.getByText('Chair · Gemini 4 Argon')).toBeInTheDocument();

    const review = screen.getByText('Peer review', { selector: 'div' }).closest('li')!;
    const [marker, ...memberOrbs] = orbs(review);
    expect(marker).toHaveAttribute('data-state', 'composing');
    expect(memberOrbs.map((orb) => orb.dataset.state)).toEqual(['searching']);
    // Skipped members don't take part in peer review.
    expect(within(review).queryByText(/DeepSeek/)).toBeNull();
  });
});

describe('council summary', () => {
  const finished: CouncilDetails = {
    ...details,
    answers: [
      { model: GEMINI, response: 'Gemini says **batch it**.' },
      { model: GPT, response: 'GPT says expand/contract.' },
      { model: CLAUDE, response: 'Claude says dual-write.' },
    ],
    rankings: [
      { model: GPT, averageRank: 1.3 },
      { model: CLAUDE, averageRank: 2 },
      { model: GEMINI, averageRank: 2.7 },
    ],
  };

  it('collapses to one line naming the top-ranked member', () => {
    render(<CouncilSummary details={finished} />);
    const toggle = screen.getByRole('button', { name: /Council of 3 · ranked GPT-6.1 Sol first/ });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
  });

  it('expands to each member’s answer in rank order', async () => {
    const user = userEvent.setup();
    render(<CouncilSummary details={finished} />);
    await user.click(screen.getByRole('button', { name: /View individual answers/ }));

    const members = screen.getAllByRole('button', { name: /Rank \d/ });
    expect(members.map((b) => b.textContent)).toEqual([
      'GPT-6.1 SolRank 1 · avg 1.3',
      'Claude Sonnet 5.5Rank 2 · avg 2.0',
      'Gemini 4 ArgonRank 3 · avg 2.7',
    ]);

    await user.click(members[2]);
    expect(screen.getByText('batch it')).toBeVisible();
  });
});

describe('AI message', () => {
  it('shows the live council card while the council works, then the summary', () => {
    const { rerender } = render(
      <AIMessage content="" modelId="council" loading isLastMessage council={details} councilProgress={[{ stage: 'stage1', model: GPT, progress: 0 }]} />
    );
    expect(screen.getByRole('heading', { name: 'Council is deliberating' })).toBeInTheDocument();

    rerender(
      <AIMessage
        content="Final answer"
        modelId="council"
        loading={false}
        isLastMessage
        council={{ ...details, answers: [{ model: GPT, response: 'x' }] }}
      />
    );
    expect(screen.queryByRole('heading', { name: 'Council is deliberating' })).toBeNull();
    expect(screen.getByRole('button', { name: /Council of 1/ })).toBeInTheDocument();
  });

  it('shows the thinking block above the answer', () => {
    render(<AIMessage content="Answer" modelId={CLAUDE} reasoning="My reasoning" reasoningDurationMs={4000} />);
    expect(screen.getByRole('button', { name: /Thought for 4s/ })).toBeInTheDocument();
    expect(screen.getByText('Answer')).toBeInTheDocument();
  });

  it('shows the pending orb before any token arrives', () => {
    render(<AIMessage content="" modelId={CLAUDE} loading isLastMessage />);
    expect(screen.getByRole('status')).toHaveTextContent('Thinking');
  });
});
