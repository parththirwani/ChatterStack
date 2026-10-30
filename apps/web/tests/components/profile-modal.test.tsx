import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ProfileModal from '@/src/components/sidebar/user/ProfileModal';
import { fillActivityDays } from '@/src/lib/client/activity';
import type { ChatActivity } from '@/src/hooks/useChatActivity';

const profile = { name: 'Ada', email: 'ada@example.com', bio: 'Computes things', avatarUrl: null };
const noActivity: ChatActivity = { status: 'ready', days: [] };

function renderModal(overrides: Partial<React.ComponentProps<typeof ProfileModal>> = {}) {
  const onClose = vi.fn();
  const onSave = vi.fn();
  render(
    <ProfileModal
      isOpen
      onClose={onClose}
      profile={profile}
      activity={noActivity}
      onSave={onSave}
      {...overrides}
    />
  );
  return { onClose, onSave };
}

describe('ProfileModal', () => {
  it('prefills the form with the current profile', () => {
    renderModal();
    expect(screen.getByRole('textbox', { name: /name/i })).toHaveValue('Ada');
    expect(screen.getByRole('textbox', { name: /bio/i })).toHaveValue('Computes things');
    expect(screen.getByText('ada@example.com')).toBeInTheDocument();
  });

  it('saves trimmed name and bio changes and closes', async () => {
    const user = userEvent.setup();
    const { onSave, onClose } = renderModal();

    await user.clear(screen.getByRole('textbox', { name: /name/i }));
    await user.type(screen.getByRole('textbox', { name: /name/i }), '  Grace Hopper  ');
    await user.clear(screen.getByRole('textbox', { name: /bio/i }));
    await user.type(screen.getByRole('textbox', { name: /bio/i }), 'Navy programmer');
    await user.click(screen.getByRole('button', { name: /save changes/i }));

    expect(onSave).toHaveBeenCalledWith({ name: 'Grace Hopper', bio: 'Navy programmer', avatarUrl: null });
    expect(onClose).toHaveBeenCalled();
  });

  it('blocks saving when the name is empty', async () => {
    const user = userEvent.setup();
    const { onSave } = renderModal();

    await user.clear(screen.getByRole('textbox', { name: /name/i }));
    const save = screen.getByRole('button', { name: /save changes/i });
    expect(save).toBeDisabled();
    await user.click(save);
    expect(onSave).not.toHaveBeenCalled();
  });

  it('removes the photo preview and reports it on save', async () => {
    const user = userEvent.setup();
    const { onSave } = renderModal({ profile: { ...profile, avatarUrl: 'data:image/png;base64,x' } });

    await user.click(screen.getByRole('button', { name: /remove/i }));
    expect(screen.queryByRole('img', { name: /avatar/i })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /save changes/i }));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ avatarUrl: null }));
  });

  it('closes on Escape', async () => {
    const user = userEvent.setup();
    const { onClose } = renderModal();
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalled();
  });

  describe('chat activity heatmap', () => {
    const windowUntil = new Date('2026-10-27T12:00:00Z');

    it('renders per-day message counts from the activity window', () => {
      const activity: ChatActivity = {
        status: 'ready',
        days: fillActivityDays([{ date: '2026-10-26', count: 5 }], 91, windowUntil),
      };
      renderModal({ activity });

      expect(screen.getByRole('grid', { name: 'Messages sent over the last 3 months' })).toBeInTheDocument();
      expect(screen.getByRole('status')).toHaveTextContent('5 messages in the last 3 months');
      expect(screen.getByRole('gridcell', { name: /^5 messages/ })).toBeInTheDocument();
    });

    it('shows a zero grid for a user who has not chatted', () => {
      const activity: ChatActivity = { status: 'ready', days: fillActivityDays([], 91, windowUntil) };
      renderModal({ activity });
      expect(screen.getByRole('status')).toHaveTextContent('0 messages in the last 3 months');
    });

    it('shows loading and error states without a grid', () => {
      const { rerender } = render(
        <ProfileModal isOpen onClose={vi.fn()} profile={profile} activity={{ status: 'loading', days: [] }} onSave={vi.fn()} />
      );
      expect(screen.getByText(/loading your chat history/i)).toBeInTheDocument();
      expect(screen.queryByRole('grid')).not.toBeInTheDocument();

      rerender(
        <ProfileModal isOpen onClose={vi.fn()} profile={profile} activity={{ status: 'error', days: [] }} onSave={vi.fn()} />
      );
      expect(screen.getByText(/couldn.t load your chat activity/i)).toBeInTheDocument();
      expect(screen.queryByRole('grid')).not.toBeInTheDocument();
    });
  });
});
