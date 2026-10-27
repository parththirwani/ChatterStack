'use client';

import React, { useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { useModalFocus } from '@/src/hooks/useModalFocus';
import { CHAT_MODELS, DEFAULT_MODEL_ID } from '@/src/config/models';
import {
  FREQUENCIES,
  FREQUENCY_LABELS,
  localTimeZone,
  MAX_TASK_NAME,
  MAX_TASK_PROMPT,
  nextRunAfter,
  ScheduledTaskInputSchema,
  WEEKDAY_NAMES,
  formatRunTime,
  type Frequency,
} from '@/src/lib/scheduled-tasks/schedule';
import { createScheduledTask, updateScheduledTask } from '@/src/lib/client/scheduled-tasks';
import type { ScheduledTask } from '@/src/types/scheduled-task.types';

interface ScheduledTaskDialogProps {
  /** Set when editing a saved task. */
  task?: ScheduledTask | null;
  onClose: () => void;
  onSaved?: (task: ScheduledTask) => void;
}

type Field = 'name' | 'prompt' | 'model' | 'time';

/** New scheduled task / Edit scheduled task, with Claude's "Set up manually" fields. */
export default function ScheduledTaskDialog({ task, onClose, onSaved }: ScheduledTaskDialogProps) {
  const [name, setName] = useState(task?.name ?? '');
  const [prompt, setPrompt] = useState(task?.prompt ?? '');
  const [model, setModel] = useState(task?.model ?? DEFAULT_MODEL_ID);
  const [frequency, setFrequency] = useState<Frequency>(task?.frequency ?? 'daily');
  const [time, setTime] = useState(task?.time ?? '09:00');
  const [weekday, setWeekday] = useState(task?.weekday ?? 1);
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({});
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const dialogRef = useRef<HTMLElement>(null);
  const ids = useId();
  // Times are entered in the browser's zone, as in Claude.
  const timezone = useMemo(() => localTimeZone(), []);
  const editing = !!task;
  useModalFocus(true, onClose, dialogRef);

  const minute = Number(time.slice(3, 5)) || 0;
  const setMinute = (value: number) => setTime(`${time.slice(0, 2)}:${String(Math.min(59, Math.max(0, value))).padStart(2, '0')}`);
  const nextRun = useMemo(() => {
    try {
      return nextRunAfter({ frequency, time, weekday, timezone }, new Date());
    } catch {
      return null;
    }
  }, [frequency, time, weekday, timezone]);

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (saving) return;
    const parsed = ScheduledTaskInputSchema.safeParse({ name, prompt, model, thinkingLevel: task?.thinkingLevel, frequency, time, weekday, timezone });
    if (!parsed.success) {
      const next: Partial<Record<Field, string>> = {};
      for (const issue of parsed.error.issues) next[issue.path[0] as Field] ??= issue.message;
      setErrors(next);
      return;
    }
    setErrors({});
    setSaving(true);
    setError('');
    try {
      const saved = task ? await updateScheduledTask(task.id, parsed.data) : await createScheduledTask(parsed.data);
      onSaved?.(saved);
      onClose();
    } catch (failure) {
      const field = (failure as { field?: Field }).field;
      setError((failure as Error).message);
      if (field) setErrors((current) => ({ ...current, [field]: (failure as Error).message }));
    } finally {
      setSaving(false);
    }
  };

  const fieldClass = (field?: Field) =>
    `w-full rounded-lg border bg-[#181818] px-3 py-2 text-sm text-[#eee] placeholder:text-[#77736f] focus:outline-none focus:ring-1 ${
      field && errors[field] ? 'border-red-400/60 focus:ring-red-400/40' : 'border-white/[0.12] focus:border-white/30 focus:ring-white/20'
    }`;
  const label = 'text-xs font-medium text-[#d8d5d1]';
  const fieldError = (field: Field) => errors[field] && <p id={`${ids}-${field}-error`} role="alert" className="mt-1 text-[11px] text-red-300">{errors[field]}</p>;
  const described = (field: Field) => (errors[field] ? `${ids}-${field}-error` : undefined);

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/75 p-4" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby={`${ids}-title`} className="flex max-h-[min(92vh,820px)] w-full max-w-xl flex-col overflow-hidden rounded-2xl border border-white/15 bg-[#202020] shadow-2xl">
        <header className="flex items-center gap-3 px-5 pb-2 pt-4">
          <h2 id={`${ids}-title`} className="flex-1 text-base font-medium text-white">{editing ? 'Edit scheduled task' : 'New scheduled task'}</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-lg p-2 text-[#c9c6c2] hover:bg-white/10 hover:text-white"><X className="h-4 w-4" /></button>
        </header>

        <form onSubmit={save} noValidate className="flex min-h-0 flex-1 flex-col">
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 pb-4">
            <div>
              <label htmlFor={`${ids}-name`} className={label}>Name</label>
              <input
                id={`${ids}-name`}
                value={name}
                onChange={(event) => setName(event.target.value)}
                maxLength={MAX_TASK_NAME}
                placeholder="Morning AI news brief"
                autoComplete="off"
                aria-invalid={!!errors.name}
                aria-describedby={described('name')}
                className={`${fieldClass('name')} mt-1`}
              />
              {fieldError('name')}
            </div>

            <div>
              <label htmlFor={`${ids}-prompt`} className={label}>Instructions</label>
              <textarea
                id={`${ids}-prompt`}
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
                rows={6}
                maxLength={MAX_TASK_PROMPT}
                placeholder="Summarize the most important AI news from the last day in five bullet points, with one line on why each matters."
                aria-invalid={!!errors.prompt}
                aria-describedby={described('prompt') ?? `${ids}-prompt-hint`}
                className={`${fieldClass('prompt')} mt-1 resize-y`}
              />
              {fieldError('prompt') ?? <p id={`${ids}-prompt-hint`} className="mt-1 text-[11px] text-[#8f8b86]">Sent as the message on every run, so write it to stand on its own.</p>}
            </div>

            <div>
              <label htmlFor={`${ids}-model`} className={label}>Model</label>
              <select id={`${ids}-model`} value={model} onChange={(event) => setModel(event.target.value)} className={`${fieldClass('model')} mt-1`}>
                {CHAT_MODELS.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}
              </select>
              {fieldError('model')}
            </div>

            <div className="flex flex-wrap gap-3">
              <div className="min-w-[140px] flex-1">
                <label htmlFor={`${ids}-frequency`} className={label}>Frequency</label>
                <select id={`${ids}-frequency`} value={frequency} onChange={(event) => setFrequency(event.target.value as Frequency)} className={`${fieldClass()} mt-1`}>
                  {FREQUENCIES.map((value) => <option key={value} value={value}>{FREQUENCY_LABELS[value]}</option>)}
                </select>
              </div>
              {frequency === 'weekly' && (
                <div className="min-w-[140px] flex-1">
                  <label htmlFor={`${ids}-weekday`} className={label}>Day</label>
                  <select id={`${ids}-weekday`} value={weekday} onChange={(event) => setWeekday(Number(event.target.value))} className={`${fieldClass()} mt-1`}>
                    {WEEKDAY_NAMES.map((day, index) => <option key={day} value={index}>{day}</option>)}
                  </select>
                </div>
              )}
              {(frequency === 'daily' || frequency === 'weekdays' || frequency === 'weekly') && (
                <div className="min-w-[120px] flex-1">
                  <label htmlFor={`${ids}-time`} className={label}>Time</label>
                  <input id={`${ids}-time`} type="time" required value={time} onChange={(event) => event.target.value && setTime(event.target.value)} aria-invalid={!!errors.time} aria-describedby={described('time')} className={`${fieldClass('time')} mt-1 [color-scheme:dark]`} />
                </div>
              )}
              {frequency === 'hourly' && (
                <div className="min-w-[120px] flex-1">
                  <label htmlFor={`${ids}-minute`} className={label}>Minutes past the hour</label>
                  <input id={`${ids}-minute`} type="number" min={0} max={59} value={minute} onChange={(event) => setMinute(Number(event.target.value))} className={`${fieldClass('time')} mt-1 [color-scheme:dark]`} />
                </div>
              )}
            </div>
            {fieldError('time')}
            <p className="text-xs text-[#8f8b86]" aria-live="polite">
              {frequency === 'manual'
                ? 'Runs only when you click Run now.'
                : <>Times are in {timezone}.{nextRun && <> Next run: <span className="text-[#d8d5d1]">{formatRunTime(nextRun, timezone)}</span></>}</>}
            </p>
          </div>

          <footer className="flex items-center gap-2 border-t border-white/10 px-5 py-3">
            <p className="flex-1 text-xs text-[#8f8b86]">{error ? <span role="alert" className="text-red-300">{error}</span> : 'Each run counts toward your daily token limit.'}</p>
            <button type="button" onClick={onClose} className="rounded-lg px-3 py-2 text-sm text-[#c9c6c2] hover:bg-white/10">Cancel</button>
            <button type="submit" disabled={saving} className="rounded-lg bg-[#f0eeeb] px-4 py-2 text-sm font-medium text-[#1c1b19] hover:bg-white disabled:opacity-50">
              {saving ? 'Saving…' : editing ? 'Save changes' : 'Create'}
            </button>
          </footer>
        </form>
      </section>
    </div>,
    document.body,
  );
}
