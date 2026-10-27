'use client';
import React from 'react';
import { MoreHorizontal, Sparkles, Upload } from 'lucide-react';
import { navigateTo, skillsPath } from '@/src/lib/navigation';
import { openSkillEditor } from '@/src/lib/client/skills';
import type { Skill } from '@/src/types/skill.types';
import Menu from './Menu';
import { shortDate } from './format';
import { sourceLabel } from './SkillsPage';
import { useSkillActions } from './useSkillActions';

function SkillRow({ skill, actions }: { skill: Skill; actions: ReturnType<typeof useSkillActions> }) {
  const [first, ...rest] = skill.categories;
  return (
    <li className={`relative flex items-center gap-4 border-b border-white/[0.06] px-3 py-3 hover:bg-white/[0.025] ${skill.enabled ? '' : 'opacity-60'}`}>
      <button type="button" aria-label={`View ${skill.name}`} onClick={() => navigateTo(skillsPath.skill(skill.id))} className="absolute inset-0 rounded-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-white/40" />
      <span className="pointer-events-none flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white/[0.05] text-[#aaa6a2]"><Sparkles className="h-4 w-4" /></span>
      <div className="pointer-events-none min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium text-[#eee]">{skill.name}</span>
          {first && <span className="shrink-0 rounded-md bg-white/[0.06] px-1.5 py-0.5 text-[11px] text-[#aaa6a2]">{first}</span>}
          {rest.length > 0 && <span className="shrink-0 text-[11px] text-[#8f8b86]">+{rest.length}</span>}
          {!skill.enabled && <span className="shrink-0 text-[11px] text-[#8f8b86]">Off</span>}
        </div>
        <p className="mt-0.5 truncate text-xs text-[#8f8b86]">{sourceLabel(skill)} · {skill.description}</p>
      </div>
      <span className="pointer-events-none hidden shrink-0 text-xs text-[#8f8b86] sm:block">{shortDate(skill.updatedAt)}</span>
      <div className="relative z-10 flex shrink-0 items-center gap-1">
        <button type="button" onClick={() => actions.toggle(skill)} aria-label={`${skill.enabled ? 'Turn off' : 'Turn on'} ${skill.name}`} className="rounded-md border border-white/[0.1] px-2.5 py-1 text-xs text-[#d7d4d0] hover:bg-white/[0.07]">
          {skill.enabled ? 'Turn off' : 'Turn on'}
        </button>
        <Menu label={`More actions for ${skill.name}`} trigger={<MoreHorizontal className="h-4 w-4" />} items={actions.items(skill, { full: false })} triggerClassName="flex h-7 w-7 items-center justify-center rounded-md text-[#aaa6a2] hover:bg-white/[0.08] hover:text-white" />
      </div>
    </li>
  );
}

function Section({ title, skills, actions }: { title: string; skills: Skill[]; actions: ReturnType<typeof useSkillActions> }) {
  if (!skills.length) return null;
  return (
    <section aria-label={title} className="mb-8">
      <h2 className="mb-1 flex items-center gap-2 px-3 text-sm font-medium text-[#d8d5d1]">
        {title}<span className="rounded-full bg-white/[0.07] px-1.5 text-[11px] text-[#aaa6a2]">{skills.length}</span>
      </h2>
      <ul>{skills.map((skill) => <SkillRow key={skill.id} skill={skill} actions={actions} />)}</ul>
    </section>
  );
}

/** Customize → Skills → Yours: skills you made, then ones added from Discover. */
export default function SkillsYours({ skills, loading, query }: { skills: Skill[]; loading: boolean; query: string }) {
  const actions = useSkillActions();
  if (loading) return <p className="text-sm text-[#aaa6a2]">Loading skills…</p>;
  const mine = skills.filter((skill) => skill.source !== 'catalog');
  const added = skills.filter((skill) => skill.source === 'catalog');
  return (
    <>
      {actions.host}
      {!skills.length ? (
        query ? <p className="text-sm text-[#aaa6a2]">No skills match “{query}”.</p> : (
          <div className="rounded-2xl border border-dashed border-white/[0.12] px-6 py-12 text-center">
            <p className="text-base text-[#e5e2de]">No skills yet</p>
            <p className="mx-auto mt-1 max-w-md text-sm text-[#aaa6a2]">Skills are reusable instructions. Type <span className="font-mono text-[#d8d5d1]">/</span> in a chat to use one.</p>
            <div className="mt-5 flex flex-wrap justify-center gap-2">
              <button type="button" onClick={() => navigateTo(skillsPath.discover)} className="rounded-lg bg-[#f0eeeb] px-3 py-1.5 text-sm font-medium text-[#1c1b19] hover:bg-white">Browse skills</button>
              <button type="button" onClick={() => openSkillEditor()} className="rounded-lg border border-white/[0.12] px-3 py-1.5 text-sm text-[#e5e2de] hover:bg-white/[0.06]">Create a skill</button>
              <button type="button" onClick={() => navigateTo(skillsPath.upload)} className="flex items-center gap-1.5 rounded-lg border border-white/[0.12] px-3 py-1.5 text-sm text-[#e5e2de] hover:bg-white/[0.06]"><Upload className="h-3.5 w-3.5" /> Upload</button>
            </div>
          </div>
        )
      ) : (
        <>
          <Section title="Created by you" skills={mine} actions={actions} />
          <Section title="From ChatterStack" skills={added} actions={actions} />
        </>
      )}
    </>
  );
}
