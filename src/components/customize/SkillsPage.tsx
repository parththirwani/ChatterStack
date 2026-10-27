'use client';
import React, { useMemo, useState } from 'react';
import { ChevronRight, PanelLeft, PenLine, Plus, Search, Sparkles, Upload } from 'lucide-react';
import type { AppView } from '@/src/lib/navigation';
import { navigateTo, skillsPath } from '@/src/lib/navigation';
import { useAppStore } from '@/src/store/rootStore';
import { createSkillWithAI, openSkillEditor, useSkills } from '@/src/lib/client/skills';
import type { Skill } from '@/src/types/skill.types';
import Menu from './Menu';
import SkillsYours from './SkillsYours';
import SkillsDiscover from './SkillsDiscover';
import SkillUpload from './SkillUpload';
import SkillDetail from './SkillDetail';

type SkillsView = Extract<AppView, { kind: 'skills' }>;

export function PageHeaderToggle() {
  const collapsed = useAppStore((state) => state.sidebarCollapsed);
  return (
    <button
      type="button"
      onClick={() => window.dispatchEvent(new Event('chatterstack:toggle-sidebar'))}
      aria-label="Open navigation"
      aria-controls="chat-sidebar"
      className={`-ml-2 mr-1 h-9 w-9 items-center justify-center rounded-lg text-[#aaa7a3] hover:bg-white/[0.07] hover:text-white ${collapsed ? 'flex' : 'flex lg:hidden'}`}
    >
      <PanelLeft className="h-[18px] w-[18px]" strokeWidth={1.7} />
    </button>
  );
}

/** "Your skills > …" trail used on the upload and skill pages. */
export function Breadcrumb({ current }: { current: string }) {
  return (
    <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 text-sm text-[#aaa6a2]">
      <a href={skillsPath.yours} onClick={(event) => { event.preventDefault(); navigateTo(skillsPath.yours); }} className="hover:text-white">Your skills</a>
      <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
      <span aria-current="page" className="truncate text-[#e5e2de]">{current}</span>
    </nav>
  );
}

/** Add skill: Upload skill / Create a skill / Create with AI. */
export function AddSkillMenu() {
  const [error, setError] = useState('');
  return (
    <div className="relative">
      <Menu
        label="Add skill"
        trigger={<><Plus className="h-4 w-4" /> Add</>}
        triggerClassName="flex h-8 items-center gap-1.5 rounded-lg bg-[#f0eeeb] px-3 text-sm font-medium text-[#1c1b19] hover:bg-white"
        items={[
          { label: 'Upload skill', icon: <Upload className="h-4 w-4" />, onSelect: () => navigateTo(skillsPath.upload) },
          { label: 'Create a skill', icon: <PenLine className="h-4 w-4" />, onSelect: () => openSkillEditor() },
          {
            label: 'Create with AI',
            icon: <Sparkles className="h-4 w-4" />,
            onSelect: () => { setError(''); createSkillWithAI().catch((failure: Error) => setError(failure.message)); },
          },
        ]}
      />
      {error && <p role="alert" className="absolute right-0 top-full mt-1 w-64 text-right text-xs text-red-300">{error}</p>}
    </div>
  );
}

export const sourceLabel = (skill: Pick<Skill, 'source'>) => (skill.source === 'catalog' ? 'from ChatterStack' : 'by you');

export default function SkillsPage({ view }: { view: SkillsView }) {
  const userId = useAppStore((state) => state.user?.id);
  const { skills, loading, error } = useSkills(userId);
  const [query, setQuery] = useState('');
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return skills;
    return skills.filter((skill) => skill.name.includes(q) || skill.description.toLowerCase().includes(q) ||
      skill.categories.some((category) => category.toLowerCase().includes(q)));
  }, [skills, query]);

  const listView = view.tab === 'yours' || view.tab === 'discover';

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto bg-[#191919]">
      <div className="mx-auto w-full max-w-5xl px-5 pb-16 pt-6 sm:px-8">
        <div className="flex items-center">
          <PageHeaderToggle />
          <h1 className="text-2xl font-medium text-white">Customize</h1>
        </div>

        {listView ? (
          <div className="mt-5 flex flex-wrap items-center gap-3">
            <div role="tablist" aria-label="Customize" className="flex gap-1">
              <button type="button" role="tab" aria-selected="true" className="rounded-lg bg-white/[0.09] px-3 py-1 text-sm text-white">Skills</button>
            </div>
            <div role="radiogroup" aria-label="Show" className="flex rounded-lg border border-white/[0.1] p-0.5">
              {(['yours', 'discover'] as const).map((tab) => (
                <button
                  key={tab}
                  type="button"
                  role="radio"
                  aria-checked={view.tab === tab}
                  onClick={() => navigateTo(skillsPath[tab])}
                  className={`rounded-md px-3 py-0.5 text-sm capitalize ${view.tab === tab ? 'bg-white/[0.1] text-white' : 'text-[#aaa6a2] hover:text-white'}`}
                >
                  {tab === 'yours' ? 'Yours' : 'Discover'}
                </button>
              ))}
            </div>
            <div className="flex-1" />
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#8f8b86]" />
              <input
                type="search"
                aria-label="Search skills"
                placeholder="Search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                maxLength={200}
                className="h-8 w-52 rounded-lg border border-white/[0.1] bg-white/[0.03] pl-8 pr-2 text-sm text-white placeholder:text-[#8a8681] focus:border-white/30 focus:outline-none"
              />
            </div>
            <AddSkillMenu />
          </div>
        ) : null}

        <div className="mt-6">
          {error && <p role="alert" className="mb-4 text-sm text-red-300">{error}</p>}
          {view.tab === 'yours' && <SkillsYours skills={filtered} loading={loading} query={query} />}
          {view.tab === 'discover' && <SkillsDiscover skills={skills} query={query} />}
          {view.tab === 'upload' && <SkillUpload />}
          {view.tab === 'skill' && view.skillId && <SkillDetail skillId={view.skillId} section={view.section ?? 'overview'} skills={skills} loading={loading} />}
        </div>
      </div>
    </div>
  );
}

