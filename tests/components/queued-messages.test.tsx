/**
 * The queue panel above the composer: edit, steer, remove and reorder
 * messages written while a reply streams.
 */
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import QueuedMessages from '@/src/components/chat/input/QueuedMessages';
import { useAppStore } from '@/src/store/rootStore';

const KEY = 'c1';
const EMPTY: never[] = [];
const queued = () => (useAppStore.getState().queues[KEY] ?? []).map((item) => item.content);

function Panel({ loading = true, onSteer = vi.fn() }: { loading?: boolean; onSteer?: (id: string) => void }) {
  const queue = useAppStore((state) => state.queues[KEY] ?? EMPTY);
  return <QueuedMessages conversationKey={KEY} queue={queue} loading={loading} onSteer={onSteer} />;
}

beforeEach(() => {
  useAppStore.setState({ queues: {} });
  const store = useAppStore.getState();
  store.enqueueMessage(KEY, { id: 'a', content: 'First question', attachments: [] });
  store.enqueueMessage(KEY, { id: 'b', content: 'Second question', attachments: [] });
});

const rows = () => within(screen.getByRole('region', { name: 'Queued messages' })).getAllByRole('listitem');

describe('queued messages panel', () => {
  it('lists queued messages with a count, and collapses', async () => {
    const user = userEvent.setup();
    render(<Panel />);
    expect(screen.getByRole('button', { name: /Queued\s*2/ })).toHaveAttribute('aria-expanded', 'true');
    expect(rows().map((row) => row.textContent)).toEqual([
      expect.stringContaining('First question'),
      expect.stringContaining('Second question'),
    ]);
    await user.click(screen.getByRole('button', { name: /Queued/ }));
    expect(screen.queryAllByRole('listitem')).toHaveLength(0);
  });

  it('renders nothing when the queue is empty', () => {
    useAppStore.setState({ queues: {} });
    const { container } = render(<Panel />);
    expect(container).toBeEmptyDOMElement();
  });

  it('edits a message in place (Enter saves, Escape cancels)', async () => {
    const user = userEvent.setup();
    render(<Panel />);
    await user.click(within(rows()[0]).getByRole('button', { name: 'Edit queued message' }));
    const input = screen.getByRole('textbox', { name: 'Edit queued message' });
    await user.clear(input);
    await user.type(input, 'Rewritten{Enter}');
    expect(queued()).toEqual(['Rewritten', 'Second question']);

    await user.click(within(rows()[1]).getByRole('button', { name: 'Edit queued message' }));
    await user.type(screen.getByRole('textbox', { name: 'Edit queued message' }), ' extra{Escape}');
    expect(queued()).toEqual(['Rewritten', 'Second question']);
  });

  it('Steer hands the message id to the composer; it reads Send when nothing streams', async () => {
    const user = userEvent.setup();
    const onSteer = vi.fn();
    const { rerender } = render(<Panel onSteer={onSteer} />);
    await user.click(within(rows()[1]).getByRole('button', { name: 'Steer' }));
    expect(onSteer).toHaveBeenCalledWith('b');

    rerender(<Panel onSteer={onSteer} loading={false} />);
    expect(within(rows()[0]).getByRole('button', { name: 'Send' })).toBeInTheDocument();
  });

  it('removes a message', async () => {
    const user = userEvent.setup();
    render(<Panel />);
    await user.click(within(rows()[0]).getByRole('button', { name: 'Remove queued message' }));
    expect(queued()).toEqual(['Second question']);
  });

  it('reorders by moving a message to a new position', () => {
    useAppStore.getState().moveQueuedMessage(KEY, 'b', 0);
    expect(queued()).toEqual(['Second question', 'First question']);
  });
});
