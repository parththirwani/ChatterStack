'use client';

import React, { useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Loader2, Sparkles, X } from 'lucide-react';
import { useModalFocus } from '@/src/hooks/useModalFocus';
import {
  MAX_SKILL_DESCRIPTION,
  MAX_SKILL_INSTRUCTIONS,
  MAX_SKILL_NAME,
  SkillInputSchema,
  normalizeSkillName,
  type ParsedSkill,
  type SkillSource,
} from '@/src/lib/skills/skill-file';
import { draftSkillWithAI, saveSkill } from '@/src/lib/client/skills';
import type { Skill } from '@/src/types/skill.types';

export interface SkillEditorInitial extends ParsedSkill {
  /** Set when editing a saved skill. */
  id?: string;
  source?: SkillSource;
  /** Problems found while importing, shown until the field is edited. */
  issues?: Array<{ field: string; message: string }>;
}

interface SkillEditorProps {
  initial?: SkillEditorInitial;
  onClose: () => void;
  onSaved?: (skill: Skill) => void;
}

type Field = keyof ParsedSkill;
const EMPTY: ParsedSkill = { name: '', description: '', instructions: '' };

export default function SkillEditor({ initial, onClose, onSaved }: SkillEditorProps) {
  const [values, setValues] = useState<ParsedSkill>({ ...EMPTY, ...initial });
  const [source, setSource] = useState<SkillSource>(initial?.source ?? 'created');
  const [touched, setTouched] = useState<Partial<Record<Field, boolean>>>(() =>
    Object.fromEntries((initial?.issues ?? []).map((issue) => [issue.field, true]))
  );
  const [ask, setAsk] = useState('');
  const [drafting, setDrafting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const dialogRef = useRef<HTMLElement>(null);
  const draftAbort = useRef<AbortController | null>(null);
  const ids = useId();
  const editing = !!initial?.id;
  const isEmpty = !values.name && !values.description && !values.instructions;

  const close = () => {
    draftAbort.current?.abort();
    onClose();
  };
  useModalFocus(true, close, dialogRef);

  const fieldErrors = useMemo(() => {
    const result = SkillInputSchema.safeParse(values);
    const errors: Partial<Record<Field, string>> = {};
    if (!result.success) {
      for (const issue of result.error.issues) {
        const field = issue.path[0] as Field;
        errors[field] ??= issue.message;
      }
    }
    return errors;
  }, [values]);

  const set = (field: Field) => (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setValues((current) => ({ ...current, [field]: event.target.value }));
  const touch = (field: Field) => () => setTouched((current) => ({ ...current, [field]: true }));

  const draft = async () => {
    if (!ask.trim() || drafting) return;
    setDrafting(true);
    setError('');
    draftAbort.current = new AbortController();
    try {
      const { draft: result } = await draftSkillWithAI(ask.trim(), isEmpty ? undefined : values, draftAbort.current.signal);
      setValues({ ...result, name: result.name || values.name });
      setTouched({ name: true, description: true, instructions: true });
      if (!editing) setSource('generated');
      setAsk('');
    } catch (failure) {
      if ((failure as Error).name !== 'AbortError') setError((failure as Error).message);
    } finally {
      setDrafting(false);
    }
  };

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    setTouched({ name: true, description: true, instructions: true });
    if (Object.keys(fieldErrors).length || saving) return;
    setSaving(true);
    setError('');
    try {
      const skill = await saveSkill({ ...values, source }, initial?.id);
      onSaved?.(skill);
      onClose();
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const fieldClass = (field: Field) =>
    `w-full rounded-lg border bg-[#181818] px-3 py-2 text-sm text-[#eee] placeholder:text-[#77736f] focus:outline-none focus:ring-1 ${
      touched[field] && fieldErrors[field] ? 'border-red-400/60 focus:ring-red-400/40' : 'border-white/[0.12] focus:border-white/30 focus:ring-white/20'
    }`;
  const hint = (field: Field, length: number, max: number) => (
    <p id={`${ids}-${field}-hint`} className="mt-1 flex justify-between gap-2 text-[11px]">
      <span className="text-red-300" role={touched[field] && fieldErrors[field] ? 'alert' : undefined}>{touched[field] ? fieldErrors[field] : ''}</span>
      <span className={length > max ? 'text-red-300' : 'text-[#8f8b86]'}>{length.toLocaleString('en-US')}/{max.toLocaleString('en-US')}</span>
    </p>
  );

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/75 p-4" onMouseDown={(event) => { if (event.target === event.currentTarget) close(); }}>
      <section ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby={`${ids}-title`} className="flex max-h-[min(92vh,900px)] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-white/15 bg-[#202020] shadow-2xl">
        <header className="flex items-center gap-3 border-b border-white/10 px-5 py-3">
          <h2 id={`${ids}-title`} className="flex-1 text-sm font-medium text-white">{editing ? `Edit /${initial?.name}` : source === 'imported' ? 'Review imported skill' : 'New skill'}</h2>
          <button type="button" onClick={close} aria-label="Close skill editor" className="rounded-lg p-2 text-[#c9c6c2] hover:bg-white/10 hover:text-white"><X className="h-4 w-4" /></button>
        </header>

        <form onSubmit={save} className="flex min-h-0 flex-1 flex-col" noValidate>
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
            <div className="rounded-xl border border-white/[0.09] bg-white/[0.03] p-3">
              <label htmlFor={`${ids}-ask`} className="flex items-center gap-1.5 text-xs font-medium text-[#d8d5d1]">
                <Sparkles className="h-3.5 w-3.5" /> Skill creator
              </label>
              <p className="mt-1 text-[11px] leading-4 text-[#8f8b86]">
                {isEmpty ? 'Describe what the skill should do, and AI drafts it for you to review.' : 'Describe a change, and AI revises the draft below.'}
              </p>
              <div className="mt-2 flex gap-2">
                <textarea
                  id={`${ids}-ask`}
                  value={ask}
                  onChange={(event) => setAsk(event.target.value)}
                  onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void draft(); } }}
                  rows={2}
                  maxLength={2000}
                  placeholder={isEmpty ? 'e.g. Review my code for security issues and list fixes by severity' : 'e.g. Make it shorter and add an output template'}
                  className="min-h-[52px] flex-1 resize-none rounded-lg border border-white/[0.12] bg-[#181818] px-3 py-2 text-sm text-[#eee] placeholder:text-[#77736f] focus:border-white/30 focus:outline-none"
                />
                <button type="button" onClick={() => void draft()} disabled={!ask.trim() || drafting} className="flex shrink-0 items-center gap-1.5 self-end rounded-lg bg-white/[0.1] px-3 py-2 text-xs text-white hover:bg-white/[0.16] disabled:opacity-40">
                  {drafting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                  {drafting ? 'Drafting…' : isEmpty ? 'Draft with AI' : 'Revise with AI'}
                </button>
              </div>
            </div>

            <div>
              <label htmlFor={`${ids}-name`} className="text-xs font-medium text-[#d8d5d1]">Name</label>
              <div className="mt-1 flex items-center">
                <span className="rounded-l-lg border border-r-0 border-white/[0.12] bg-white/[0.04] px-2.5 py-2 text-sm text-[#8f8b86]">/</span>
                <input
                  id={`${ids}-name`}
                  value={values.name}
                  onChange={set('name')}
                  onBlur={() => { touch('name')(); setValues((current) => ({ ...current, name: normalizeSkillName(current.name) })); }}
                  placeholder="code-review"
                  autoComplete="off"
                  spellCheck={false}
                  aria-invalid={!!(touched.name && fieldErrors.name)}
                  aria-describedby={`${ids}-name-hint`}
                  className={`${fieldClass('name')} rounded-l-none font-mono`}
                />
              </div>
              {hint('name', values.name.length, MAX_SKILL_NAME)}
            </div>

            <div>
              <label htmlFor={`${ids}-description`} className="text-xs font-medium text-[#d8d5d1]">Description</label>
              <textarea
                id={`${ids}-description`}
                value={values.description}
                onChange={set('description')}
                onBlur={touch('description')}
                rows={2}
                placeholder="What the skill does and when to use it"
                aria-invalid={!!(touched.description && fieldErrors.description)}
                aria-describedby={`${ids}-description-hint`}
                className={`${fieldClass('description')} mt-1 resize-y`}
              />
              {hint('description', values.description.length, MAX_SKILL_DESCRIPTION)}
            </div>

            <div>
              <label htmlFor={`${ids}-instructions`} className="text-xs font-medium text-[#d8d5d1]">Instructions</label>
              <textarea
                id={`${ids}-instructions`}
                value={values.instructions}
                onChange={set('instructions')}
                onBlur={touch('instructions')}
                rows={12}
                placeholder={'Markdown instructions for the model.\n\n## Steps\n1. …'}
                aria-invalid={!!(touched.instructions && fieldErrors.instructions)}
                aria-describedby={`${ids}-instructions-hint`}
                className={`${fieldClass('instructions')} mt-1 resize-y font-mono text-[13px] leading-5`}
              />
              {hint('instructions', values.instructions.length, MAX_SKILL_INSTRUCTIONS)}
              <p className="mt-1 text-[11px] leading-4 text-[#8f8b86]">Sent with every message you tag this skill on, and counted toward your daily token limit.</p>
            </div>
          </div>

          <footer className="flex items-center gap-2 border-t border-white/10 px-5 py-3">
            {error ? <p role="alert" className="flex-1 text-xs text-red-300">{error}</p> : <div className="flex-1" />}
            <button type="button" onClick={close} className="rounded-lg px-3 py-2 text-sm text-[#c9c6c2] hover:bg-white/10">Cancel</button>
            <button type="submit" disabled={saving || drafting} className="rounded-lg bg-[#f0eeeb] px-4 py-2 text-sm font-medium text-[#1c1b19] hover:bg-white disabled:opacity-50">
              {saving ? 'Saving…' : editing ? 'Save changes' : 'Create skill'}
            </button>
          </footer>
        </form>
      </section>
    </div>,
    document.body,
  );
}
