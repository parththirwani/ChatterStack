import React from 'react';
import { PanelLeftClose } from 'lucide-react';
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
    <div className="flex items-center justify-between">
      {collapsed ? (
        <div className="w-full flex flex-col items-center gap-2">
          <Link href="/" className="block">
            <div className="w-7 h-7 rounded-lg overflow-hidden">
              <Image
                src="/logo.png"
                alt="ChatterStack"
                width={28}
                height={28}
                className="w-full h-full object-cover"
              />
            </div>
          </Link>
          <button
            onClick={onToggleCollapse}
            className="p-1 rounded-md hover:bg-gray-800/50 transition-colors duration-200 text-gray-500 hover:text-gray-300"
            aria-label="Expand sidebar"
          >
            <PanelLeftClose className="h-[18px] w-[18px]" strokeWidth={1.7} />
          </button>
        </div>
      ) : (
        <>
          <Link href="/" className="flex items-center space-x-2.5 hover:opacity-80 transition-opacity group">
            <div className="w-8 h-8 rounded-lg overflow-hidden shadow-sm group-hover:shadow-md transition-shadow">
              <Image
                src="/logo.png"
                alt="ChatterStack"
                width={32}
                height={32}
                className="w-full h-full object-cover"
              />
            </div>
            <div className="flex flex-col">
              <span className="text-[13px] font-semibold tracking-tight text-[#f0eeeb]">
                ChatterStack
              </span>
              <span className="text-[11px] text-[#8f8b86]">
                AI Assistant
              </span>
            </div>
          </Link>
          <button
            onClick={onToggleCollapse}
            className="hidden h-9 w-9 items-center justify-center rounded-lg text-[#aaa7a3] transition-colors hover:bg-white/[0.07] hover:text-white lg:flex"
            aria-label="Close sidebar"
            aria-controls="chat-sidebar"
            aria-expanded="true"
          >
            <PanelLeftClose className="h-[18px] w-[18px]" strokeWidth={1.7} />
          </button>
        </>
      )}
    </div>
  );
};

export default SidebarHeader;
