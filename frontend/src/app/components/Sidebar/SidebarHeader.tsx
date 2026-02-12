// frontend/app/components/Sidebar/SidebarHeader.tsx
import React from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';

interface SidebarHeaderProps {
  collapsed: boolean;
  onToggleCollapse: () => void;
}

const SidebarHeader: React.FC<SidebarHeaderProps> = ({
  collapsed,
  onToggleCollapse,
}) => {
  return (
    <div className="p-4 border-b border-gray-700">
      <div className="flex items-center justify-between">
        {collapsed ? (
          <div className="relative group">
            <Link href="/" className="block">
              <Image
                src="/logo.png"
                alt="Logo"
                width={32}
                height={32}
                className="transition-opacity duration-200 cursor-pointer hover:opacity-80"
              />
            </Link>
            <button
              onClick={onToggleCollapse}
              className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity duration-200"
            >
              <ChevronRight className="w-6 h-6 text-white" />
            </button>
          </div>
        ) : (
          <>
            <Link href="/" className="flex items-center space-x-2 hover:opacity-80 transition-opacity">
              <Image src="/logo.png" alt="Logo" width={32} height={32} />
              <h2 className="text-xl font-bold text-white">
                Chatter<span className="text-yellow-500">Stack</span>
              </h2>
            </Link>
            <button
              onClick={onToggleCollapse}
              className="p-2 rounded-lg hover:bg-white/10 transition-colors duration-200 text-white hover:text-yellow-500"
            >
              <ChevronLeft className="w-5 h-5" />
            </button>
          </>
        )}
      </div>
    </div>
  );
};

export default SidebarHeader;