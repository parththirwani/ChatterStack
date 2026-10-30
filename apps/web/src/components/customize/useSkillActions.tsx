'use client';
import React, { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Copy, Download, MessageSquare, PenLine, RefreshCw, Sparkles, Trash2 } from 'lucide-react';
import { useModalFocus } from '@/src/hooks/useModalFocus';
import { navigateTo, skillsPath } from '@/src/lib/navigation';
import {
  deleteSkill,
  duplicateSkill,
  editSkillWithAI,
  openSkillEditor,
  skillDownloadUrl,
  trySkillInChat,
  updateSkill,
  uploadSkills,
} from '@/src/lib/client/skills';
import type { Skill } from '@/src/types/skill.types';
import type { MenuItem } from './Menu';

function ConfirmRemove({ skill, onCancel, onConfirm }: { skill: Skill; onCancel: () => void; onConfirm: () => void }) {
  const ref = useRef<HTMLElement>(null);
  useModalFocus(true, onCancel, ref);
  return createPortal(
    <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/70 p-4">
      <section ref={ref} role="alertdialog" aria-modal="true" aria-labelledby="remove-skill-title" className="w-full max-w-sm rounded-2xl border border-white/15 bg-[#202020] p-5 shadow-2xl">
        <h2 id="remove-skill-title" className="text-base font-medium text-white">Remove {skill.name}?</h2>
        <p className="mt-2 text-sm text-[#aaa6a2]">It will no longer be available in chat. Messages that used it keep their text.</p>
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onCancel} className="rounded-lg px-3 py-2 text-sm text-[#c9c6c2] hover:bg-white/10">Cancel</button>
          <button type="button" onClick={onConfirm} className="rounded-lg bg-red-500/90 px-3 py-2 text-sm font-medium text-white hover:bg-red-500">Remove</button>
        </div>
      </section>
    </div>,
    document.body,
  );
}

/**
 * Actions shared by skill rows and the skill page. Returns menu items plus
 * the element that hosts the confirm dialog and the hidden Replace input.
 */
export function useSkillActions(onRemoved?: () => void) {
  const [error, setError] = useState('');
  const [removing, setRemoving] = useState<Skill | null>(null);
  const replaceInput = useRef<HTMLInputElement>(null);
  const replacing = useRef<Skill | null>(null);

  const run = (work: () => Promise<unknown>) => {
    setError('');
    work().catch((failure: Error) => setError(failure.message));
  };

  const toggle = (skill: Skill) => run(() => updateSkill(skill.id, { enabled: !skill.enabled }));

  const remove = (skill: Skill) => setRemoving(skill);

  const items = (skill: Skill): MenuItem[] => [
    { label: 'Try in chat', icon: <MessageSquare className="h-4 w-4" />, onSelect: () => run(() => trySkillInChat(skill)) },
    { label: 'Edit with AI', icon: <Sparkles className="h-4 w-4" />, onSelect: () => run(() => editSkillWithAI(skill)) },
    { label: 'Edit', icon: <PenLine className="h-4 w-4" />, onSelect: () => openSkillEditor({ id: skill.id, name: skill.name, description: skill.description, instructions: skill.instructions, files: skill.files, frontmatter: skill.frontmatter }) },
    { label: 'Replace', icon: <RefreshCw className="h-4 w-4" />, onSelect: () => { replacing.current = skill; replaceInput.current?.click(); } },
    { label: 'Duplicate', icon: <Copy className="h-4 w-4" />, onSelect: () => run(async () => navigateTo(skillsPath.skill((await duplicateSkill(skill.id)).id))) },
    { label: 'Download', icon: <Download className="h-4 w-4" />, onSelect: () => { window.location.href = skillDownloadUrl(skill.id); } },
    { label: 'Remove', icon: <Trash2 className="h-4 w-4" />, onSelect: () => remove(skill), danger: true },
  ];

  const host = (
    <>
      <input
        ref={replaceInput}
        type="file"
        accept=".zip,.skill,.md"
        aria-label="Choose a replacement skill file"
        className="sr-only"
        onChange={(event) => {
          const file = event.target.files?.[0];
          const skill = replacing.current;
          event.target.value = '';
          if (!file || !skill) return;
          run(async () => {
            const [result] = await uploadSkills([file], skill.id);
            if (result.error) throw new Error(`Could not replace ${skill.name}: ${result.error}`);
          });
        }}
      />
      {removing && <ConfirmRemove
        skill={removing}
        onCancel={() => setRemoving(null)}
        onConfirm={() => {
          const skill = removing;
          setRemoving(null);
          run(async () => { await deleteSkill(skill.id); onRemoved?.(); });
        }}
      />}
      {error && <p role="alert" className="mb-3 text-sm text-red-300">{error}</p>}
    </>
  );

  return { items, toggle, remove, host };
}
