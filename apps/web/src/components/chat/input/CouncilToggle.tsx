"use client";
import React, { memo } from 'react';
import { UsersRound } from 'lucide-react';
import { useModelSelection } from '@/src/context/ModelSelectionContext';

// Memoized: the composer re-renders on every keystroke.
export const CouncilToggle = memo(function CouncilToggle() {
  const { councilMode, setCouncilMode, councilMembers } = useModelSelection();

  return (
    <button
      type="button"
      aria-pressed={councilMode}
      onClick={() => setCouncilMode(!councilMode)}
      title={councilMode ? 'Council on: several models answer, review each other, and the chair combines their findings' : 'Ask several models at once'}
      className={`flex h-8 shrink-0 items-center gap-1.5 rounded-lg border px-2.5 text-[12.5px] font-medium transition-colors ${
        councilMode
          ? 'border-white/[0.14] bg-white/[0.08] text-[#f0eeeb] hover:bg-white/[0.11]'
          : 'border-transparent text-[#cfcbc5] hover:bg-white/[0.06] hover:text-white'
      }`}
    >
      <UsersRound className="h-4 w-4" strokeWidth={1.7} aria-hidden="true" />
      <span className="max-sm:sr-only">Council</span>
      {councilMode && <><span className="text-[#a9a5a0] max-sm:hidden" aria-hidden="true">· {councilMembers.length}</span><span className="sr-only">({councilMembers.length} members)</span></>}
    </button>
  );
});
