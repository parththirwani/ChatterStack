'use client';
import React, { useMemo, useState } from 'react';
import { Check, Plus, Sparkles } from 'lucide-react';
import { SKILL_CATALOG, SKILL_STACKS, type CatalogSkill } from '@/src/config/skill-catalog';
import { addCatalogSkill, addCatalogSkills, trySkillInChat } from '@/src/lib/client/skills';
import { MAX_SKILLS_PER_USER } from '@/src/lib/skills/skill-file';
import type { Skill } from '@/src/types/skill.types';

function useCatalogActions(skills: Skill[]) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [progress, setProgress] = useState<{ completed: number; total: number } | null>(null);
  const added = useMemo(() => new Map(skills.filter((skill) => skill.catalogId).map((skill) => [skill.catalogId!, skill])), [skills]);

  const add = async (entry: CatalogSkill) => {
    setBusy(entry.id);
    setError('');
    try {
      return await addCatalogSkill(entry.id);
    } catch (failure) {
      setError((failure as Error).message);
      return null;
    } finally {
      setBusy(null);
    }
  };

  // "Try" adds the skill (if needed) and opens a chat with it tagged.
  const tryIt = async (entry: CatalogSkill) => {
    const skill = await add(entry);
    if (skill) await trySkillInChat(skill);
  };

  const addStack = async (stackName: string, entries: CatalogSkill[]) => {
    const newSkills = entries.filter((entry) => !added.has(entry.id));
    if (skills.length + newSkills.length > MAX_SKILLS_PER_USER) {
      setError(`This stack needs ${newSkills.length} free skill slots. You can keep up to ${MAX_SKILLS_PER_USER} skills.`);
      return;
    }
    setBusy(`stack:${stackName}`);
    setError('');
    const pending = entries.filter((entry) => !added.get(entry.id)?.enabled);
    setProgress({ completed: 0, total: pending.length });
    try {
      await addCatalogSkills(pending.map((entry) => entry.id), (completed) => setProgress({ completed, total: pending.length }));
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      setBusy(null);
      setProgress(null);
    }
  };

  return { added, busy, error, progress, add, tryIt, addStack };
}

function CatalogCard({ entry, actions }: { entry: CatalogSkill; actions: ReturnType<typeof useCatalogActions> }) {
  const copy = actions.added.get(entry.id);
  const isAdded = !!copy?.enabled;
  return (
    <li className="flex flex-col rounded-xl border border-white/[0.08] bg-white/[0.02] p-4">
      <div className="flex items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white/[0.05] text-[#aaa6a2]"><Sparkles className="h-4 w-4" /></span>
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-sm font-medium text-[#eee]">{entry.name}</h3>
          <p className="mt-1 line-clamp-3 text-xs leading-5 text-[#aaa6a2]">{entry.description}</p>
        </div>
      </div>
      <div className="mt-3 flex items-center gap-2 pl-12">
        <span className="flex-1 text-[11px] text-[#8f8b86]">
          {entry.sourceUrl ? <a href={entry.sourceUrl} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 hover:text-white">{entry.sourceName}</a> : 'by ChatterStack'}
        </span>
        {entry.requiresFiles && <span title="This skill refers to files or tools in its source repository" className="text-[11px] text-[#8f8b86]">Uses source files</span>}
        <button type="button" onClick={() => void actions.tryIt(entry)} disabled={!!actions.busy} aria-label={isAdded ? `Try ${entry.name} in chat` : `Add ${entry.name} and try it in chat`} className="rounded-md border border-white/[0.1] px-2.5 py-1 text-xs text-[#d7d4d0] hover:bg-white/[0.07] disabled:opacity-50">Try</button>
        {isAdded
          ? <span aria-label={`${entry.name} added`} className="flex h-7 w-7 items-center justify-center text-[#9fd49f]"><Check className="h-4 w-4" /></span>
          : <button type="button" onClick={() => void actions.add(entry)} disabled={!!actions.busy} aria-label={`Add ${entry.name}`} className="flex h-7 w-7 items-center justify-center rounded-md border border-white/[0.1] text-[#d7d4d0] hover:bg-white/[0.07] disabled:opacity-50"><Plus className="h-4 w-4" /></button>}
      </div>
    </li>
  );
}

/** Customize → Skills → Discover: suggested skills from the built-in catalog. */
export default function SkillsDiscover({ skills, query }: { skills: Skill[]; query: string }) {
  const actions = useCatalogActions(skills);
  const [category, setCategory] = useState<string | null>(null);
  const [source, setSource] = useState<string | null>(null);
  const categories = useMemo(() => {
    const counts = new Map<string, number>();
    for (const entry of SKILL_CATALOG) for (const name of entry.categories) {
      if (['Coding', 'UI', 'Writing', 'Code'].includes(name)) continue;
      counts.set(name, (counts.get(name) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, []);
  const sources = useMemo(() => {
    const counts = new Map<string, number>();
    for (const entry of SKILL_CATALOG) if (entry.sourceName) counts.set(entry.sourceName, (counts.get(entry.sourceName) ?? 0) + 1);
    return [...counts.entries()];
  }, []);
  const q = query.trim().toLowerCase();
  // The featured skill gets the large card, so the grid leaves it out.
  const featured = !q && !category && !source ? SKILL_CATALOG.find((entry) => entry.featured) : undefined;
  const shown = SKILL_CATALOG.filter((entry) => entry !== featured &&
    (!category || entry.categories.includes(category) || (category === 'Coding' && entry.categories.includes('Code'))) &&
    (!source || entry.sourceName === source) &&
    (!q || entry.name.includes(q) || entry.description.toLowerCase().includes(q) || entry.sourceName?.toLowerCase().includes(q) || entry.stack?.toLowerCase().includes(q)));
  const stackEntries = SKILL_STACKS.map((stack) => ({
    ...stack,
    entries: category && SKILL_STACKS.some((item) => item.name === category)
      ? (category === stack.name ? shown.filter((entry) => entry.categories.includes(stack.name)) : [])
      : shown.filter((entry) => entry.stack === stack.name),
  })).filter((stack) => stack.entries.length);
  const otherEntries = shown.filter((entry) => !entry.stack);

  const featuredAdded = featured && actions.added.get(featured.id)?.enabled;

  return (
    <div>
      {actions.error && <p role="alert" className="mb-4 text-sm text-red-300">{actions.error}</p>}
      {featured && (
        <section aria-label="From ChatterStack" className="mb-8 rounded-2xl border border-white/[0.08] bg-gradient-to-br from-[#2a2533] to-[#1f1f1f] p-6">
          <p className="text-xs text-[#aaa6a2]">From ChatterStack</p>
          <h2 className="mt-2 text-lg font-medium text-white">{featured.name}</h2>
          <p className="mt-1 max-w-2xl text-sm text-[#c9c5c0]">{featured.description}</p>
          <div className="mt-4 flex gap-2">
            {featuredAdded
              ? <span className="flex items-center gap-1.5 text-sm text-[#9fd49f]"><Check className="h-4 w-4" /> Added</span>
              : <button type="button" onClick={() => void actions.add(featured)} aria-label={`Add ${featured.name}`} className="rounded-lg bg-[#f0eeeb] px-3 py-1.5 text-sm font-medium text-[#1c1b19] hover:bg-white">Add</button>}
            <button type="button" onClick={() => void actions.tryIt(featured)} className="rounded-lg border border-white/[0.14] px-3 py-1.5 text-sm text-[#e5e2de] hover:bg-white/[0.06]">Try</button>
          </div>
        </section>
      )}

      <section aria-label="Stacks" className="mb-7">
        <h2 className="mb-3 text-sm font-medium text-[#d8d5d1]">Stacks</h2>
        <div className="flex flex-wrap gap-2">
          {SKILL_STACKS.map((stack) => <button key={stack.name} type="button" aria-pressed={category === stack.name} onClick={() => setCategory((current) => current === stack.name ? null : stack.name)} className={`rounded-lg border px-3 py-1.5 text-sm ${category === stack.name ? 'border-white/30 bg-white/[0.09] text-white' : 'border-white/[0.08] text-[#c9c5c0] hover:bg-white/[0.05]'}`}>{stack.name}</button>)}
        </div>
      </section>

      <section aria-label="Sources" className="mb-7">
        <h2 className="mb-3 text-sm font-medium text-[#d8d5d1]">Sources</h2>
        <div className="flex flex-wrap gap-2">
          {sources.map(([name, count]) => <button key={name} type="button" aria-pressed={source === name} onClick={() => setSource((current) => current === name ? null : name)} className={`rounded-lg border px-3 py-1.5 text-sm ${source === name ? 'border-white/30 bg-white/[0.09] text-white' : 'border-white/[0.08] text-[#c9c5c0] hover:bg-white/[0.05]'}`}>{name} <span className="text-xs text-[#8f8b86]">{count}</span></button>)}
        </div>
      </section>

      <section aria-label="Categories" className="mb-7">
        <h2 className="mb-3 text-sm font-medium text-[#d8d5d1]">Categories</h2>
        <div className="flex flex-wrap gap-2">
          {categories.map(([name, count]) => (
            <button
              key={name}
              type="button"
              aria-pressed={category === name}
              onClick={() => setCategory((current) => (current === name ? null : name))}
              className={`flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm ${category === name ? 'border-white/30 bg-white/[0.09] text-white' : 'border-white/[0.08] text-[#c9c5c0] hover:bg-white/[0.05]'}`}
            >
              {name}<span className="text-xs text-[#8f8b86]">{count}</span>
            </button>
          ))}
        </div>
      </section>

      <section aria-label="Suggested skills" className="mb-8">
        <h2 className="mb-3 text-sm font-medium text-[#d8d5d1]">{category ?? (q ? 'Results' : 'Suggested skills')}</h2>
        {stackEntries.length > 0 && <p className="mb-4 text-xs text-[#8f8b86]">These skills keep their original instructions. Some need files or agent tools from their source projects to run as written.</p>}
        {otherEntries.length > 0 && <ul className="grid gap-3 sm:grid-cols-2">{otherEntries.map((entry) => <CatalogCard key={entry.id} entry={entry} actions={actions} />)}</ul>}
        {stackEntries.map((stack) => {
          const allEntries = SKILL_CATALOG.filter((entry) => entry.categories.includes(stack.name) && (!source || entry.sourceName === source));
          const remaining = allEntries.filter((entry) => !actions.added.get(entry.id)?.enabled).length;
          return <div key={stack.name} className="mt-7" aria-label={`${stack.name} stack`}>
            <div className="mb-3 flex flex-wrap items-center gap-3">
              <div className="flex-1">
                <h3 className="text-base font-medium text-white">{stack.name}</h3>
                <p className="text-xs text-[#aaa6a2]">{stack.description}</p>
              </div>
              <button type="button" onClick={() => void actions.addStack(stack.name, allEntries)} disabled={!remaining || !!actions.busy} className="rounded-lg border border-white/[0.14] px-3 py-1.5 text-xs text-[#e5e2de] hover:bg-white/[0.06] disabled:opacity-50">
                {actions.busy === `stack:${stack.name}` && actions.progress
                  ? `Adding ${actions.progress.completed}/${actions.progress.total}`
                  : remaining ? `Add ${stack.name} stack` : 'Added'}
              </button>
            </div>
            <ul className="grid gap-3 sm:grid-cols-2">{stack.entries.map((entry) => <CatalogCard key={entry.id} entry={entry} actions={actions} />)}</ul>
          </div>;
        })}
        {!shown.length && <p className="text-sm text-[#aaa6a2]">No suggested skills match.</p>}
      </section>
    </div>
  );
}
