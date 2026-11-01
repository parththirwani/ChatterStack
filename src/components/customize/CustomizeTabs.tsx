'use client';
import React from 'react';
import { connectionsPath, navigateTo, skillsPath } from '@/src/lib/navigation';

const TABS = [
  { kind: 'skills', label: 'Skills', path: skillsPath.discover },
  { kind: 'connections', label: 'Connections', path: connectionsPath.list },
] as const;

/** The Customize section tabs: Skills and Connections. */
export default function CustomizeTabs({ active }: { active: 'skills' | 'connections' }) {
  return (
    <div role="tablist" aria-label="Customize" className="flex gap-1">
      {TABS.map((tab) => (
        <button
          key={tab.kind}
          type="button"
          role="tab"
          aria-selected={tab.kind === active}
          onClick={() => navigateTo(tab.path)}
          className={`rounded-lg px-3 py-1 text-sm ${tab.kind === active ? 'bg-white/[0.09] text-white' : 'text-[#aaa6a2] hover:bg-white/[0.05] hover:text-white'}`}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}
