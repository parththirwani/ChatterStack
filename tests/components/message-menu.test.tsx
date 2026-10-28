/**
 * The More actions menu on a saved message, in both roles: what it offers, how
 * it opens and closes by pointer and keyboard, and when it is not offered at all.
 */
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AIMessage from '@/src/components/chat/messages/AIMessage/AIMessage';
import UserMessage from '@/src/components/chat/messages/UserMessage/UserMessage';

const SAVED = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const trigger = () => screen.getByRole('button', { name: 'More message actions' });
const anyTrigger = () => screen.queryByRole('button', { name: 'More message actions' });
const forkItem = () => screen.getByRole('menuitem', { name: 'Fork in new chat' });

describe('a saved assistant reply', () => {
  it('keeps its own actions and gains a fork choice', async () => {
    const user = userEvent.setup();
    const onFork = vi.fn();
    render(<AIMessage content="Slow start doubles cwnd." modelId="openai/gpt-6.1-sol" messageId={SAVED} onFork={onFork} />);

    expect(screen.getByRole('button', { name: 'Copy message' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Download message' })).toBeInTheDocument();

    await user.click(trigger());
    expect(screen.getByRole('menu', { name: 'More message actions' })).toBeInTheDocument();
    await user.click(forkItem());

    expect(onFork).toHaveBeenCalledWith(SAVED);
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('leaves copy, download and retry working when it is the last reply', async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();
    const onCopy = vi.fn();
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: onCopy }, configurable: true });
    render(<AIMessage content="An answer" isLastMessage onRetry={onRetry} messageId={SAVED} onFork={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: 'Retry message' }));
    await user.click(screen.getByRole('button', { name: 'Copy message' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onCopy).toHaveBeenCalledWith('An answer');
  });

  it('offers nothing while it is still streaming', () => {
    render(<AIMessage content="Half an answer" loading isLastMessage messageId={SAVED} onFork={vi.fn()} />);
    expect(anyTrigger()).not.toBeInTheDocument();
  });

  it('offers nothing for a reply that was never saved', () => {
    render(<AIMessage content="Just written" messageId="assistant-local-1761548400000-2" onFork={vi.fn()} />);
    expect(anyTrigger()).not.toBeInTheDocument();
  });

  it('does not offer it on a reply that is only being forked into another chat', async () => {
    const user = userEvent.setup();
    const onFork = vi.fn();
    render(<AIMessage content="An answer" messageId={SAVED} onFork={onFork} forking />);

    expect(trigger()).toHaveAttribute('aria-disabled', 'true');
    await user.click(trigger());
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(onFork).not.toHaveBeenCalled();
  });

  it('closes on Escape and hands focus back to the button', async () => {
    const user = userEvent.setup();
    render(<AIMessage content="An answer" messageId={SAVED} onFork={vi.fn()} />);

    await user.click(trigger());
    expect(forkItem()).toHaveFocus();
    await user.keyboard('{Escape}');

    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(trigger()).toHaveFocus();
  });

  it('opens by keyboard and forks with Enter', async () => {
    const user = userEvent.setup();
    const onFork = vi.fn();
    render(<AIMessage content="An answer" messageId={SAVED} onFork={onFork} />);

    trigger().focus();
    await user.keyboard('{Enter}');
    expect(screen.getByRole('menu')).toBeInTheDocument();
    await user.keyboard('{Enter}');

    expect(onFork).toHaveBeenCalledWith(SAVED);
  });

  it('closes when something else is clicked', async () => {
    const user = userEvent.setup();
    render(
      <div>
        <button type="button">Elsewhere</button>
        <AIMessage content="An answer" messageId={SAVED} onFork={vi.fn()} />
      </div>
    );

    await user.click(trigger());
    await user.click(screen.getByRole('button', { name: 'Elsewhere' }));
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('portals the menu and opens upward when its trigger is near the bottom', async () => {
    const user = userEvent.setup();
    const rect = (top: number, left: number, width: number, height: number) => ({
      top, left, width, height, right: left + width, bottom: top + height,
      x: left, y: top, toJSON: () => ({}),
    } as DOMRect);
    const measure = vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
      if (this.getAttribute('role') === 'menu') return rect(0, 0, 190, 80);
      if (this.getAttribute('aria-label') === 'More message actions') return rect(500, 300, 32, 32);
      return rect(0, 0, 0, 0);
    });
    const viewport = vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(600);
    try {
      render(<AIMessage content="Last answer" messageId={SAVED} onFork={vi.fn()} />);
      await user.click(trigger());
      const dropdown = screen.getByRole('menu', { name: 'More message actions' });
      expect(dropdown.parentElement).toBe(document.body);
      expect(dropdown).toHaveStyle({ top: '416px' });
    } finally {
      measure.mockRestore();
      viewport.mockRestore();
    }
  });

  it('asks about the message that was clicked, not the last one', async () => {
    const user = userEvent.setup();
    const onFork = vi.fn();
    render(
      <div>
        <AIMessage content="First answer" messageId={SAVED} onFork={onFork} />
        <AIMessage content="Second answer" messageId={OTHER} onFork={onFork} />
      </div>
    );

    await user.click(screen.getAllByRole('button', { name: 'More message actions' })[0]);
    await user.click(forkItem());
    expect(onFork).toHaveBeenCalledWith(SAVED);
  });
});

describe('a saved user question', () => {
  it('gets the same fork choice as a reply', async () => {
    const user = userEvent.setup();
    const onFork = vi.fn();
    render(<UserMessage content="Explain TCP" messageId={SAVED} onFork={onFork} />);

    await user.click(trigger());
    await user.click(forkItem());
    expect(onFork).toHaveBeenCalledWith(SAVED);
  });

  it('shows nothing while it has only a local id, or no callback', () => {
    const { rerender } = render(<UserMessage content="Explain TCP" messageId="user-local-1761548400000-1" onFork={vi.fn()} />);
    expect(anyTrigger()).not.toBeInTheDocument();

    rerender(<UserMessage content="Explain TCP" messageId={SAVED} />);
    expect(anyTrigger()).not.toBeInTheDocument();
  });

  it('keeps showing attachments and tagged skills next to the menu', async () => {
    const user = userEvent.setup();
    render(
      <UserMessage
        content="Read /review and explain TCP"
        attachments={[{ documentId: 'doc-1', name: 'spec.pdf', mimeType: 'application/pdf', size: 12 }]}
        skills={[{ id: 'skill-1', name: 'review' }]}
        messageId={SAVED}
        onFork={vi.fn()}
      />
    );

    expect(screen.getByRole('list', { name: 'Attachments' })).toBeInTheDocument();
    expect(screen.getByText('spec.pdf')).toBeInTheDocument();
    expect(screen.getByText('/review')).toHaveAttribute('data-skill-token', 'review');
    await user.click(trigger());
    expect(forkItem()).toBeInTheDocument();
  });
});
