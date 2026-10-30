'use client';

import React, { useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { FileText, Plus, Trash2, X } from 'lucide-react';
import { useModalFocus } from '@/src/hooks/useModalFocus';
import {
  estimateTokens,
  MAX_SKILL_DESCRIPTION,
  MAX_SKILL_NAME,
  normalizeSkillName,
  normalizeSkillPath,
  SkillFilesSchema,
  SkillInputSchema,
  type SkillFile,
} from '@/src/lib/skills/skill-file';
import { createSkill, updateSkill, type SkillContentInput } from '@/src/lib/client/skills';
import type { Skill } from '@/src/types/skill.types';

export interface SkillEditorInitial extends SkillContentInput {
  /** Set when editing a saved skill. */
  id?: string;
  source?: 'created' | 'generated';
}

interface SkillEditorDialogProps {
  initial?: SkillEditorInitial | null;
  onClose: () => void;
  onSaved?: (skill: Skill) => void;
}

const SKILL_MD = 'SKILL.md';
type Field = 'name' | 'description' | 'instructions' | 'files';

/** Create a skill / edit a skill, laid out like claude.ai's dialog. */
export default function SkillEditorDialog({ initial, onClose, onSaved }: SkillEditorDialogProps) {
  const [name, setName] = useState(initial?.name ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [instructions, setInstructions] = useState(initial?.instructions ?? '');
  // Paths are edited freely and checked on save, so "Add file" can start blank.
  const [files, setFiles] = useState<SkillFile[]>(initial?.files ?? []);
  const [open, setOpen] = useState<number>(-1); // -1 = SKILL.md
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({});
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const dialogRef = useRef<HTMLElement>(null);
  const ids = useId();
  const editing = !!initial?.id;
  useModalFocus(true, onClose, dialogRef);

  const current = open === -1 ? { path: SKILL_MD, content: instructions } : files[open];
  const tokens = useMemo(() => estimateTokens(`${description}\n${instructions}`), [description, instructions]);
  const lineCount = Math.max(1, current.content.split('\n').length);

  const setContent = (content: string) => {
    if (open === -1) setInstructions(content);
    else setFiles((list) => list.map((file, index) => (index === open ? { ...file, content } : file)));
  };

  const addFile = () => {
    setFiles((list) => [...list, { path: '', content: '' }]);
    setOpen(files.length);
  };

  const removeFile = (index: number) => {
    setFiles((list) => list.filter((_, item) => item !== index));
    setOpen(-1);
  };

  const validate = () => {
    const next: Partial<Record<Field, string>> = {};
    const content = SkillInputSchema.safeParse({ name: normalizeSkillName(name), description, instructions });
    if (!content.success) {
      for (const issue of content.error.issues) next[issue.path[0] as Field] ??= issue.message;
    }
    const cleaned = files.map((file) => ({ ...file, path: normalizeSkillPath(file.path) ?? file.path }));
    const checked = SkillFilesSchema.safeParse(cleaned);
    if (!checked.success) next.files = checked.error.issues[0]?.message.replace(/^Invalid.*$/, 'Check the file paths');
    setErrors(next);
    return Object.keys(next).length ? null : { cleaned, name: normalizeSkillName(name) };
  };

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    const valid = validate();
    if (!valid || saving) return;
    setSaving(true);
    setError('');
    const content = { name: valid.name, description: description.trim(), instructions: instructions.trim(), files: valid.cleaned, frontmatter: initial?.frontmatter };
    try {
      const skill = initial?.id ? await updateSkill(initial.id, content) : await createSkill(content, initial?.source ?? 'created');
      onSaved?.(skill);
      onClose();
    } catch (failure) {
      const field = (failure as { field?: string }).field;
      setError((failure as Error).message);
      if (field) setErrors((current) => ({ ...current, [field]: (failure as Error).message }));
    } finally {
      setSaving(false);
    }
  };

  const fieldClass = (field: Field) =>
    `w-full rounded-lg border bg-[#181818] px-3 py-2 text-sm text-[#eee] placeholder:text-[#77736f] focus:outline-none focus:ring-1 ${
      errors[field] ? 'border-red-400/60 focus:ring-red-400/40' : 'border-white/[0.12] focus:border-white/30 focus:ring-white/20'
    }`;

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/75 p-4" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby={`${ids}-title`} className="flex max-h-[min(92vh,900px)] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-white/15 bg-[#202020] shadow-2xl">
        <header className="flex items-center gap-3 px-5 pb-2 pt-4">
          <h2 id={`${ids}-title`} className="flex-1 text-base font-medium text-white">{editing ? 'Edit skill' : 'Create a skill'}</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-lg p-2 text-[#c9c6c2] hover:bg-white/10 hover:text-white"><X className="h-4 w-4" /></button>
        </header>

        <form onSubmit={save} noValidate className="flex min-h-0 flex-1 flex-col">
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 pb-4">
            <div>
              <label htmlFor={`${ids}-name`} className="text-xs font-medium text-[#d8d5d1]">Skill name</label>
              <input
                id={`${ids}-name`}
                value={name}
                onChange={(event) => setName(event.target.value)}
                onBlur={() => setName((value) => (value ? normalizeSkillName(value) : value))}
                maxLength={MAX_SKILL_NAME + 20}
                placeholder="weekly-status-report"
                autoComplete="off"
                spellCheck={false}
                aria-invalid={!!errors.name}
                aria-describedby={errors.name ? `${ids}-name-error` : undefined}
                className={`${fieldClass('name')} mt-1`}
              />
              {errors.name && <p id={`${ids}-name-error`} role="alert" className="mt-1 text-[11px] text-red-300">{errors.name}</p>}
            </div>

            <div>
              <label htmlFor={`${ids}-description`} className="text-xs font-medium text-[#d8d5d1]">Description</label>
              <textarea
                id={`${ids}-description`}
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                rows={2}
                maxLength={MAX_SKILL_DESCRIPTION}
                placeholder="Generate weekly status reports from recent work. Use when asked for updates or progress summaries."
                aria-invalid={!!errors.description}
                aria-describedby={errors.description ? `${ids}-description-error` : undefined}
                className={`${fieldClass('description')} mt-1 resize-y`}
              />
              {errors.description && <p id={`${ids}-description-error`} role="alert" className="mt-1 text-[11px] text-red-300">{errors.description}</p>}
            </div>

            <div className="flex min-h-[340px] overflow-hidden rounded-xl border border-white/[0.12]">
              <div className="flex w-52 shrink-0 flex-col border-r border-white/[0.08] bg-white/[0.02]">
                <ul aria-label="Skill files" className="min-h-0 flex-1 overflow-y-auto p-1.5">
                  {[{ path: SKILL_MD, index: -1 }, ...files.map((file, index) => ({ path: file.path || 'untitled', index }))].map((item) => (
                    <li key={item.index}>
                      <button type="button" onClick={() => setOpen(item.index)} aria-current={open === item.index ? 'true' : undefined} className={`flex w-full items-center gap-2 truncate rounded-md px-2 py-1.5 text-left font-mono text-xs ${open === item.index ? 'bg-white/[0.09] text-white' : 'text-[#c9c5c0] hover:bg-white/[0.05]'}`}>
                        <FileText className="h-3.5 w-3.5 shrink-0 text-[#8f8b86]" /><span className="truncate">{item.path}</span>
                      </button>
                    </li>
                  ))}
                </ul>
                <button type="button" onClick={addFile} className="m-1.5 flex items-center gap-1.5 rounded-md px-2 py-1.5 text-xs text-[#c9c5c0] hover:bg-white/[0.06]"><Plus className="h-3.5 w-3.5" /> Add file</button>
              </div>
              <div className="flex min-w-0 flex-1 flex-col">
                <div className="flex h-10 items-center gap-2 border-b border-white/[0.08] px-3">
                  {open === -1 ? (
                    <span className="flex-1 font-mono text-xs text-[#aaa6a2]">/SKILL.md</span>
                  ) : (
                    <>
                      <span className="font-mono text-xs text-[#77736f]">/</span>
                      <input
                        aria-label="File path"
                        value={current.path}
                        onChange={(event) => setFiles((list) => list.map((file, index) => (index === open ? { ...file, path: event.target.value } : file)))}
                        placeholder="path/to/file.md"
                        spellCheck={false}
                        className="min-w-0 flex-1 bg-transparent font-mono text-xs text-[#eee] placeholder:text-[#77736f] focus:outline-none"
                      />
                      <button type="button" onClick={() => removeFile(open)} aria-label={`Delete ${current.path || 'file'}`} className="rounded-md p-1.5 text-[#aaa6a2] hover:bg-white/[0.08] hover:text-red-300"><Trash2 className="h-3.5 w-3.5" /></button>
                    </>
                  )}
                </div>
                <div className="flex min-h-0 flex-1 overflow-auto bg-[#181818]">
                  <div aria-hidden="true" className="select-none px-2 py-2 text-right font-mono text-[12px] leading-5 text-[#5f5b57]">
                    {Array.from({ length: lineCount }, (_, line) => <div key={line}>{line + 1}</div>)}
                  </div>
                  <textarea
                    aria-label={open === -1 ? 'Instructions' : `Contents of ${current.path || 'new file'}`}
                    value={current.content}
                    onChange={(event) => setContent(event.target.value)}
                    onKeyDown={(event) => {
                      // Tab indents, as in Claude's editor; Escape then Tab leaves.
                      if (event.key === 'Tab' && !event.shiftKey && !event.nativeEvent.isComposing && event.currentTarget.dataset.escaped !== '1') {
                        event.preventDefault();
                        const el = event.currentTarget;
                        const { selectionStart, selectionEnd, value } = el;
                        setContent(`${value.slice(0, selectionStart)}  ${value.slice(selectionEnd)}`);
                        window.requestAnimationFrame(() => el.setSelectionRange(selectionStart + 2, selectionStart + 2));
                      }
                      event.currentTarget.dataset.escaped = event.key === 'Escape' ? '1' : '0';
                      if (event.key === 'Escape') event.stopPropagation();
                    }}
                    spellCheck={false}
                    wrap="off"
                    placeholder={open === -1 ? 'Summarize my recent work in three sections: wins, blockers, and next steps. Keep the tone professional but not stiff...' : ''}
                    aria-invalid={open === -1 && !!errors.instructions}
                    style={{ height: `${Math.max(320, lineCount * 20 + 16)}px` }}
                    className="min-w-0 flex-1 resize-none bg-transparent py-2 pr-3 font-mono text-[12px] leading-5 text-[#eee] placeholder:text-[#5f5b57] focus:outline-none"
                  />
                </div>
              </div>
            </div>
            {(errors.instructions || errors.files) && <p role="alert" className="text-[11px] text-red-300">{errors.instructions ?? errors.files}</p>}
            <p className="text-[11px] text-[#8f8b86]">Tab inserts indentation. Press Escape then Tab to move focus out of the editor.</p>
          </div>

          <footer className="flex items-center gap-2 border-t border-white/10 px-5 py-3">
            <p className="flex-1 text-xs text-[#8f8b86]">{error ? <span role="alert" className="text-red-300">{error}</span> : `About ${tokens.toLocaleString('en-US')} token${tokens === 1 ? '' : 's'} each time it's used`}</p>
            <button type="button" onClick={onClose} className="rounded-lg px-3 py-2 text-sm text-[#c9c6c2] hover:bg-white/10">Cancel</button>
            <button type="submit" disabled={saving} className="rounded-lg bg-[#f0eeeb] px-4 py-2 text-sm font-medium text-[#1c1b19] hover:bg-white disabled:opacity-50">
              {saving ? 'Saving…' : editing ? 'Save' : 'Create'}
            </button>
          </footer>
        </form>
      </section>
    </div>,
    document.body,
  );
}
