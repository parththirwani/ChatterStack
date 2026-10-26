import React, { memo } from 'react';
import { LogOut, User, LogIn } from 'lucide-react';
import Image from 'next/image';
import { User as UserType } from '@/src/types/user.types';

interface UserSectionProps {
  user?: UserType | null;
  collapsed: boolean;
  isAuthenticated: boolean;
  onLoginClick: () => void;
  onLogoutClick: () => void;
}

const UserSection: React.FC<UserSectionProps> = ({
  user,
  collapsed,
  isAuthenticated,
  onLoginClick,
  onLogoutClick,
}) => {
  const avatar = user?.avatarUrl ? (
    <Image
      src={user.avatarUrl}
      alt={user.name || 'User'}
      width={32}
      height={32}
      className="h-8 w-8 rounded-full ring-1 ring-white/10"
    />
  ) : (
    <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[#3a3a3a] ring-1 ring-white/10">
      <User className="h-3.5 w-3.5 text-[#e2dfda]" strokeWidth={1.8} />
    </div>
  );

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

  if (collapsed) {
    return (
      <div className="flex flex-col items-center gap-2">
        <button
          onClick={() => {}}
          className="relative cursor-pointer rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-white/30"
          title={user?.name || user?.email || 'Profile'}
        >
          {avatar}
        </button>
        <button
          onClick={onLogoutClick}
          className="rounded-md p-1.5 text-[#8f8b86] transition-colors hover:bg-red-500/10 hover:text-red-400"
          title="Sign out"
          aria-label="Sign out"
        >
          <LogOut className="h-3.5 w-3.5" />
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2.5 rounded-lg border border-white/[0.06] bg-white/[0.03] p-2.5">
        {avatar}
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-medium text-[#f0eeeb]">
            {user?.name || 'User'}
          </p>
          <p className="truncate text-[11.5px] text-[#8f8b86]">
            {user?.email || `Signed in with ${user?.provider}`}
          </p>
        </div>
      </div>

      <button
        onClick={onLogoutClick}
        className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-[12.5px] font-medium text-[#9d9994] transition-colors hover:bg-red-500/10 hover:text-red-400"
      >
        <LogOut className="h-3.5 w-3.5" />
        <span>Sign out</span>
      </button>
    </div>
  );
};

export default memo(UserSection);
