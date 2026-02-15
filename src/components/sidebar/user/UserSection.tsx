import React from 'react';
import { LogOut, User, LogIn } from 'lucide-react';
import Image from 'next/image';
import { User as UserType } from '@/src/types/user.types';
import TooltipButton from '../../ui/tooltip/Tooltip';

interface UserSectionProps {
  user?: UserType | null;
  collapsed: boolean;
  isAuthenticated: boolean;
  onLoginClick: () => void;
  onLogout: () => void;
}

const UserSection: React.FC<UserSectionProps> = ({
  user,
  collapsed,
  isAuthenticated,
  onLoginClick,
  onLogout,
}) => {
  return (
    <div>
      {isAuthenticated ? (
        collapsed ? (
          // Collapsed - Icon only, vertical layout with logout at bottom
          <div className="flex flex-col items-center space-y-2">
            {/* Profile - smaller and minimalistic */}
            <button
              onClick={() => {}}
              className="group relative"
              title={user?.name || user?.email || 'Profile'}
            >
              {user?.avatarUrl ? (
                <Image
                  src={user.avatarUrl}
                  alt={user.name || 'User'}
                  width={28}
                  height={28}
                  className="w-7 h-7 rounded-full ring-1 ring-gray-700 hover:ring-gray-600 transition-all"
                />
              ) : (
                <div className="w-7 h-7 rounded-full bg-gradient-to-br from-yellow-400 to-yellow-600 flex items-center justify-center ring-1 ring-gray-700 hover:ring-gray-600 transition-all">
                  <User className="w-3.5 h-3.5 text-black" />
                </div>
              )}
            </button>

            {/* Logout - smaller and minimalistic */}
            <button
              onClick={onLogout}
              className="p-1 rounded-md hover:bg-red-500/10 text-gray-500 hover:text-red-400 transition-colors"
              title="Sign Out"
            >
              <LogOut className="w-3.5 h-3.5" />
            </button>
          </div>
        ) : (
          // Expanded - Full user card
          <div className="space-y-2">
            {/* User card - clean and minimal with dark colors */}
            <div className="flex items-center gap-3 p-2.5 rounded-lg bg-gray-900/50 border border-gray-800/50">
              {user?.avatarUrl ? (
                <Image
                  src={user.avatarUrl}
                  alt={user.name || 'User'}
                  width={36}
                  height={36}
                  className="w-9 h-9 rounded-full ring-2 ring-gray-800"
                />
              ) : (
                <div className="w-9 h-9 rounded-full bg-gradient-to-br from-yellow-400 to-yellow-600 flex items-center justify-center ring-2 ring-gray-800">
                  <User className="w-4 h-4 text-black" />
                </div>
              )}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-white truncate">
                  {user?.name || 'User'}
                </p>
                <p className="text-xs text-gray-400 truncate">
                  {user?.email || `Signed in with ${user?.provider}`}
                </p>
              </div>
            </div>

            {/* Logout button - minimal */}
            <button
              onClick={onLogout}
              className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg hover:bg-red-500/10 text-gray-400 hover:text-red-400 transition-colors text-sm font-medium"
            >
              <LogOut className="w-4 h-4" />
              <span>Sign Out</span>
            </button>
          </div>
        )
      ) : (
        // Not authenticated - Login button
        collapsed ? (
          <button
            onClick={onLoginClick}
            className="w-7 h-7 flex items-center justify-center rounded-md bg-gradient-to-br from-yellow-400 to-yellow-600 hover:from-yellow-500 hover:to-yellow-700 text-black transition-all active:scale-95"
            title="Sign In"
          >
            <LogIn className="w-3.5 h-3.5" />
          </button>
        ) : (
          <button
            onClick={onLoginClick}
            className="w-full px-4 py-2.5 flex items-center justify-center gap-2 rounded-lg bg-gradient-to-br from-yellow-400 to-yellow-600 hover:from-yellow-500 hover:to-yellow-700 text-black font-medium shadow-sm hover:shadow-md transition-all duration-200 active:scale-[0.98]"
          >
            <LogIn className="w-4 h-4" />
            <span className="text-sm">Sign In</span>
          </button>
        )
      )}
    </div>
  );
};

export default UserSection;