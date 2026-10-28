'use client';

import React, { memo, useEffect, useState } from 'react';
import { LogIn, UserRound } from 'lucide-react';
import { User as UserType } from '@/src/types/user.types';
import { UserMenu } from '@/src/components/arc/user-menu/user-menu';
import { useShallow } from 'zustand/react/shallow';
import { overridesFor, useProfileStore } from '@/src/store/profileStore';
import { useChatActivity } from '@/src/hooks/useChatActivity';
import ProfileModal, { ACTIVITY_WINDOW_DAYS } from '@/src/components/sidebar/user/ProfileModal';

interface UserSectionProps {
  user?: UserType | null;
  collapsed: boolean;
  isAuthenticated: boolean;
  onLoginClick: () => void;
  onLogoutClick: () => void | Promise<unknown>;
}

/**
 * Signed-in footer of the sidebar: the account menu (Arc registry UserMenu)
 * opens upward from the avatar, with a mock profile modal for name, photo,
 * and bio. Profile edits are kept in the local profile store only.
 */
const UserSection: React.FC<UserSectionProps> = ({
  user,
  collapsed,
  isAuthenticated,
  onLoginClick,
  onLogoutClick,
}) => {
  const [profileOpen, setProfileOpen] = useState(false);
  // Render the session identity on the first client paint (matching the
  // server), then reveal the locally-persisted profile overrides.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // Edits saved on this device by a different account are not shown.
  const { name: storedName, bio: storedBio, avatarUrl: storedAvatar } = useProfileStore(
    useShallow((state) => overridesFor(state, user?.id))
  );
  const updateProfile = useProfileStore((state) => state.updateProfile);
  const activity = useChatActivity(profileOpen, ACTIVITY_WINDOW_DAYS);

  if (!isAuthenticated) {
    return collapsed ? (
      <button
        onClick={onLoginClick}
        className="flex h-8 w-8 items-center justify-center rounded-md border border-white/10 bg-white/[0.05] text-[#d8d4ce] transition-colors hover:bg-white/[0.09]"
        title="Sign in"
        aria-label="Sign in"
      >
        <LogIn className="h-3.5 w-3.5" />
      </button>
    ) : (
      <button
        onClick={onLoginClick}
        className="flex h-10 w-full items-center gap-3 rounded-lg px-3 text-[13px] font-medium text-[#c9c5c0] transition-colors hover:bg-white/[0.06] hover:text-white"
      >
        <LogIn className="h-4 w-4 text-[#b3afa9]" strokeWidth={1.8} />
        <span>Sign in</span>
      </button>
    );
  }

  const email = user?.email || '';
  const name = (mounted && storedName) || user?.name || 'User';
  // storedAvatar: null = never edited (use the provider's photo), '' = removed here.
  const avatarSrc = mounted && storedAvatar !== null ? storedAvatar || undefined : user?.avatarUrl || undefined;
  const bio = mounted ? storedBio : '';

  const handleSaveProfile = ({ name: nextName, bio: nextBio, avatarUrl }: { name: string; bio: string; avatarUrl: string | null }) => {
    updateProfile({ ownerId: user?.id ?? null, name: nextName, bio: nextBio, avatarUrl: avatarUrl ?? '' });
  };

  return (
    <>
      <div className={collapsed ? 'flex justify-center' : undefined}>
        <UserMenu
          side="top"
          align={collapsed ? 'center' : 'start'}
          showName={!collapsed}
          showTheme={false}
          user={{ name, email, avatarSrc }}
          items={[
            {
              label: 'View profile',
              icon: <UserRound size={16} strokeWidth={1.75} />,
              onSelect: () => setProfileOpen(true),
            },
          ]}
          onSignOut={onLogoutClick}
        />
      </div>

      <ProfileModal
        isOpen={profileOpen}
        onClose={() => setProfileOpen(false)}
        profile={{ name, email, bio, avatarUrl: avatarSrc ?? null }}
        activity={activity}
        onSave={handleSaveProfile}
      />
    </>
  );
};

export default memo(UserSection);
