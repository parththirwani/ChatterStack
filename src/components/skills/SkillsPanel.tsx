'use client';
import React, { useState } from 'react';
import { Download, FileUp, Pencil, Plus, Sparkles, Trash2 } from 'lucide-react';
import { useAppStore } from '@/src/store/rootStore';
import { deleteSkill, skillExportUrl, tagSkill, useSkills, type SkillDraftResult } from '@/src/lib/client/skills';
import type { Skill } from '@/src/types/skill.types';
import SkillEditor, { type SkillEditorInitial } from './SkillEditor';
import SkillImport from './SkillImport';

const SOURCE_LABELS: Record<Skill['source'], string> = { created: 'Created', generated: 'AI drafted', imported: 'Imported' };

export default function SkillsPanel() {
  const userId = useAppStore((state) => state.user?.id);
  const { skills, loading, error: loadError } = useSkills(userId);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState<SkillEditorInitial | null>(null);
  const [importing, setImporting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const use = (skill: Skill) => {
    if (tagSkill({ id: skill.id, name: skill.name })) setError('');
    else setError('This message already has that skill or has 3 skills tagged.');
  };

  const remove = async (skill: Skill) => {
    try {
      await deleteSkill(skill.id);
      setConfirmDelete(null);
      setError('');
    } catch (failure) {
      setError((failure as Error).message);
    }
  };

  const imported = ({ draft, issues }: SkillDraftResult) => {
    setImporting(false);
    setEditing({ ...draft, source: 'imported', issues });
  };

  return (
    <section aria-label="Skills" className="space-y-2 py-3">
      <div className="flex gap-1.5 px-1">
        <button type="button" onClick={() => setEditing({ name: '', description: '', instructions: '' })} className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-white/[0.09] px-2 py-1.5 text-xs text-[#d7d4d0] hover:bg-white/[0.06]"><Plus className="h-3.5 w-3.5" /> New skill</button>
        <button type="button" onClick={() => setImporting(true)} className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-white/[0.09] px-2 py-1.5 text-xs text-[#d7d4d0] hover:bg-white/[0.06]"><FileUp className="h-3.5 w-3.5" /> Import</button>
      </div>
      {loading && <p className="px-3 text-xs text-[#aaa6a2]">Loading skills…</p>}
      {(error || loadError) && <p role="alert" className="px-3 text-xs text-red-300">{error || loadError}</p>}
      {!loading && skills.length === 0 && !loadError && (
        <p className="px-3 text-xs leading-5 text-[#aaa6a2]">Skills are reusable instructions you tag on a message. Create one, or import a SKILL.md, then type <span className="font-mono text-[#d8d5d1]">/</span> in the chat to use it.</p>
      )}
      {skills.map((skill) => (
        <div key={skill.id} className="rounded-xl border border-white/[0.07] bg-white/[0.025] p-3">
          <div className="flex min-w-0 items-center gap-2">
            <Sparkles className="h-4 w-4 shrink-0 text-[#aaa6a2]" />
            <button type="button" onClick={() => setEditing(skill)} className="min-w-0 truncate text-left font-mono text-[13px] text-[#eee] hover:underline" title={`/${skill.name}`} aria-label={`Edit ${skill.name}`}>/{skill.name}</button>
          </div>
          <p className="mt-1 line-clamp-2 pl-6 text-[11px] leading-4 text-[#aaa6a2]" title={skill.description}>{skill.description}</p>
          <p className="mt-1 pl-6 text-[10px] uppercase tracking-wide text-[#77736f]">{SOURCE_LABELS[skill.source] ?? skill.source}</p>
          {confirmDelete === skill.id ? (
            <div className="mt-2 flex items-center gap-1 pl-5 text-xs">
              <span className="px-1 text-[#d7d4d0]">Delete?</span>
              <button type="button" onClick={() => void remove(skill)} className="rounded-md px-2 py-1 text-red-300 hover:bg-red-400/10">Delete</button>
              <button type="button" onClick={() => setConfirmDelete(null)} className="rounded-md px-2 py-1 text-[#aaa6a2] hover:bg-white/[0.08]">Keep</button>
            </div>
          ) : (
            <div className="mt-2 flex items-center gap-1 pl-5">
              <button type="button" onClick={() => use(skill)} aria-label={`Use ${skill.name} in chat`} className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-[#d7d4d0] hover:bg-white/[0.08]"><Plus className="h-3 w-3" /> Use</button>
              <button type="button" onClick={() => setEditing(skill)} aria-label={`Edit ${skill.name}`} className="rounded-md p-1.5 text-[#aaa6a2] hover:bg-white/[0.08] hover:text-white"><Pencil className="h-3.5 w-3.5" /></button>
              <a href={skillExportUrl(skill.id)} download aria-label={`Export ${skill.name}`} title="Export as SKILL.md" className="rounded-md p-1.5 text-[#aaa6a2] hover:bg-white/[0.08] hover:text-white"><Download className="h-3.5 w-3.5" /></a>
              <button type="button" onClick={() => setConfirmDelete(skill.id)} aria-label={`Delete ${skill.name}`} className="rounded-md p-1.5 text-[#aaa6a2] hover:bg-white/[0.08] hover:text-red-300"><Trash2 className="h-3.5 w-3.5" /></button>
            </div>
          )}
        </div>
      ))}
      {importing && <SkillImport onClose={() => setImporting(false)} onImported={imported} />}
      {editing && <SkillEditor initial={editing} onClose={() => setEditing(null)} />}
    </section>
  );
}
