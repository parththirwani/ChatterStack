import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import UserSection from '@/src/components/sidebar/user/UserSection';
import { useProfileStore } from '@/src/store/profileStore';
import type { User } from '@/src/types/user.types';

// Keep the heatmap data fetch out of this wiring test; ProfileModal's own
// tests cover activity rendering.
vi.mock('@/src/hooks/useChatActivity', () => ({
  useChatActivity: () => ({ status: 'ready', days: [] }),
}));

const user: User = { id: 'u1', name: 'Ada', email: 'ada@example.com', avatarUrl: null };

function renderSection(props: Partial<React.ComponentProps<typeof UserSection>> = {}) {
  const onLogoutClick = vi.fn();
  render(
    <UserSection
      user={user}
      collapsed={false}
      isAuthenticated
      onLoginClick={vi.fn()}
      onLogoutClick={onLogoutClick}
      {...props}
    />
  );
  return { onLogoutClick };
}

async function openMenu(userEventApi: ReturnType<typeof userEvent.setup>) {
  await userEventApi.click(screen.getByRole('button', { name: /account menu/i }));
  return screen.findByRole('menu');
}

describe('UserSection', () => {
  beforeEach(() => {
    useProfileStore.getState().resetProfile();
  });

  it('opens the account menu upward from the avatar', async () => {
    const user_ = userEvent.setup();
    renderSection();

    const trigger = screen.getByRole('button', { name: /account menu, ada/i });
    expect(trigger).toHaveAttribute('data-side', 'top');

    await user_.click(trigger);
    const menu = await openMenu(user_);
    expect(within(menu).getByRole('menuitem', { name: /view profile/i })).toBeInTheDocument();
    expect(within(menu).getByRole('menuitem', { name: /sign out/i })).toBeInTheDocument();
  });

  it('opens the profile modal from the menu and saves edits back to the store', async () => {
    const user_ = userEvent.setup();
    renderSection();

    await user_.click(screen.getByRole('button', { name: /account menu/i }));
    const menu = await openMenu(user_);
    await user_.click(within(menu).getByRole('menuitem', { name: /view profile/i }));

    const dialog = await screen.findByRole('dialog');
    await user_.clear(within(dialog).getByRole('textbox', { name: /name/i }));
    await user_.type(within(dialog).getByRole('textbox', { name: /name/i }), 'Grace');
    await user_.type(within(dialog).getByRole('textbox', { name: /bio/i }), 'Rear Admiral');
    await user_.click(within(dialog).getByRole('button', { name: /save changes/i }));

    expect(useProfileStore.getState().name).toBe('Grace');
    expect(useProfileStore.getState().bio).toBe('Rear Admiral');
    // The trigger now shows the saved display name.
    expect(screen.getByRole('button', { name: /account menu, grace/i })).toBeInTheDocument();
  });

  it('routes sign out through the existing logout flow', async () => {
    const user_ = userEvent.setup();
    const { onLogoutClick } = renderSection();

    await user_.click(screen.getByRole('button', { name: /account menu/i }));
    const menu = await openMenu(user_);
    await user_.click(within(menu).getByRole('menuitem', { name: /sign out/i }));

    expect(onLogoutClick).toHaveBeenCalled();
  });

  it('keeps the sign-in buttons for guests', () => {
    renderSection({ isAuthenticated: false });
    expect(screen.getByRole('button', { name: /sign in/i })).toBeInTheDocument();
  });

  describe('provider avatar', () => {
    const googlePhoto = 'https://lh3.googleusercontent.com/a/abc=s96-c';
    const avatarTrigger = () => screen.getByRole('button', { name: /account menu, ada/i });

    it('routes the provider photo through the image optimizer', () => {
      renderSection({ user: { ...user, avatarUrl: googlePhoto } });

      const image = avatarTrigger().querySelector('img');
      const encoded = encodeURIComponent(googlePhoto);
      expect(image).toHaveAttribute('src', `/_next/image?url=${encoded}&w=64&q=75`);
      expect(image).toHaveAttribute('srcSet', expect.stringContaining(`w=128&q=75 2x`));
    });

    it('falls back to initials when the photo fails to load', async () => {
      renderSection({ user: { ...user, avatarUrl: googlePhoto } });

      const trigger = avatarTrigger();
      fireEvent.error(trigger.querySelector('img')!);

      expect(await within(trigger).findByText('A')).toBeInTheDocument();
      expect(trigger.querySelector('img')).toBeNull();
    });

    it('falls back to initials when the photo failed before hydration', async () => {
      vi.spyOn(HTMLImageElement.prototype, 'complete', 'get').mockReturnValue(true);
      vi.spyOn(HTMLImageElement.prototype, 'naturalWidth', 'get').mockReturnValue(0);

      try {
        renderSection({ user: { ...user, avatarUrl: googlePhoto } });

        const trigger = avatarTrigger();
        expect(await within(trigger).findByText('A')).toBeInTheDocument();
        expect(trigger.querySelector('img')).toBeNull();
      } finally {
        vi.restoreAllMocks();
      }
    });

    it('leaves a locally picked photo as a data URL', async () => {
      useProfileStore.getState().updateProfile({
        ownerId: user.id,
        avatarUrl: 'data:image/png;base64,abc',
      });
      renderSection();

      await waitFor(() => {
        expect(avatarTrigger().querySelector('img')).toHaveAttribute('src', 'data:image/png;base64,abc');
      });
    });
  });
});
