// frontend/app/components/UserSection.tsx
import React from 'react';
import { LogOut, User, LogIn } from 'lucide-react';
import Image from 'next/image';
import TooltipButton from './Tooltip';
import { UserType } from '@/app/types';


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
    <div className="mt-auto p-4 border-t border-gray-700/50">
      {isAuthenticated ? (
        collapsed ? (
          <div className="flex flex-col items-center space-y-3">
            <TooltipButton
              icon={
                user?.avatarUrl ? (
                  <Image
                    src={user.avatarUrl}
                    alt={user.name || 'User'}
                    width={32}
                    height={32}
                    className="w-8 h-8 rounded-full"
                  />
                ) : (
                  <User className="w-5 h-5 text-white" />
                )
              }
              tooltip={user?.name || user?.email || 'User Profile'}
              onClick={() => {}}
            />
            <TooltipButton
              icon={<LogOut className="w-5 h-5 text-red-400" />}
              tooltip="Sign Out"
              onClick={onLogout}
              className="hover:bg-red-500/10"
            />
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center space-x-3 p-3 rounded-lg bg-gray-800/30 border border-gray-600/20">
              {user?.avatarUrl ? (
                <Image
                  src={user.avatarUrl}
                  alt={user.name || 'User'}
                  width={40}
                  height={40}
                  className="w-10 h-10 rounded-full"
                />
              ) : (
                <div className="w-10 h-10 rounded-full bg-yellow-500 flex items-center justify-center">
                  <User className="w-5 h-5 text-black" />
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
            <button
              onClick={onLogout}
              className="w-full flex items-center space-x-3 px-4 py-3 rounded-lg hover:bg-red-500/10 transition-colors text-red-400 hover:text-red-300"
            >
              <LogOut className="w-5 h-5" />
              <span className="font-medium">Logout</span>
            </button>
          </div>
        )
      ) : (
        <button
          onClick={onLoginClick}
          className={`${
            collapsed ? 'w-12 h-12' : 'w-full px-4 py-3'
          } flex items-center justify-center space-x-3 rounded-lg bg-yellow-500 hover:bg-yellow-400 transition-colors text-black font-medium`}
        >
          <LogIn className="w-5 h-5" />
          {!collapsed && <span>Login</span>}
        </button>
      )}
    </div>
  );
};

export default UserSection;