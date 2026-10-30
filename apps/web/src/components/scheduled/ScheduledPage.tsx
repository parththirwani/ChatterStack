'use client';
import React, { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { CalendarClock, ChevronRight, Loader2, MoreHorizontal, PenLine, Play, Plus, Trash2 } from 'lucide-react';
import type { AppView } from '@/src/lib/navigation';
import { navigateTo, scheduledPath, showConversation } from '@/src/lib/navigation';
import { useModalFocus } from '@/src/hooks/useModalFocus';
import { CHAT_MODELS } from '@/src/config/models';
import { describeSchedule, formatRunTime } from '@/src/lib/scheduled-tasks/schedule';
import {
  deleteScheduledTask,
  runScheduledTaskNow,
  updateScheduledTask,
  useScheduledTask,
  useScheduledTasks,
} from '@/src/lib/client/scheduled-tasks';
import type { ScheduledTask, ScheduledTaskRun } from '@/src/types/scheduled-task.types';
import Menu from '@/src/components/customize/Menu';
import { PageHeaderToggle } from '@/src/components/customize/SkillsPage';
import ScheduledTaskDialog from './ScheduledTaskDialog';

type ScheduledView = Extract<AppView, { kind: 'scheduled' }>;
/** null = closed, 'new' = create, a task = edit it. */
type DialogState = null | 'new' | ScheduledTask;

const modelName = (id: string) => CHAT_MODELS.find((model) => model.id === id)?.name ?? id;

function ActiveSwitch({ task, onError }: { task: ScheduledTask; onError: (message: string) => void }) {
  const [pending, setPending] = useState(false);
  const toggle = async () => {
    setPending(true);
    try {
      await updateScheduledTask(task.id, { enabled: !task.enabled });
    } catch (failure) {
      onError((failure as Error).message);
    } finally {
      setPending(false);
    }
  };
  return (
    <button
      type="button"
      role="switch"
      aria-checked={task.enabled}
      aria-label={`${task.name} active`}
      title={task.enabled ? 'Active: runs on schedule' : 'Paused: runs only when you click Run now'}
      disabled={pending}
      onClick={toggle}
      className={`relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-60 ${task.enabled ? 'bg-[#8f7bd8]' : 'bg-white/[0.15]'}`}
    >
      <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all ${task.enabled ? 'left-[22px]' : 'left-0.5'}`} />
    </button>
  );
}

/** "Next run Wed, Oct 28, 9:00 AM", "Paused" or "Manual". */
function nextRunLabel(task: ScheduledTask) {
  if (task.frequency === 'manual') return 'Runs when you click Run now';
  if (!task.enabled) return 'Paused';
  return task.nextRunAt ? `Next run ${formatRunTime(task.nextRunAt)}` : '';
}

function TaskList({ onNew }: { onNew: () => void }) {
  const { tasks, loading, error } = useScheduledTasks();
  const [actionError, setActionError] = useState('');
  if (loading) return <p className="text-sm text-[#aaa6a2]">Loading scheduled tasks…</p>;
  return (
    <>
      {(error || actionError) && <p role="alert" className="mb-4 text-sm text-red-300">{error || actionError}</p>}
      {!tasks.length ? (
        <div className="rounded-2xl border border-dashed border-white/[0.12] px-6 py-12 text-center">
          <CalendarClock className="mx-auto h-6 w-6 text-[#8f8b86]" aria-hidden="true" />
          <p className="mt-3 text-base text-[#e5e2de]">No scheduled tasks yet</p>
          <p className="mx-auto mt-1 max-w-md text-sm text-[#aaa6a2]">
            Save a prompt and choose how often it runs, like a morning news brief or a weekly review. Each run opens as its own chat.
          </p>
          <button type="button" onClick={onNew} className="mt-5 rounded-lg bg-[#f0eeeb] px-3 py-1.5 text-sm font-medium text-[#1c1b19] hover:bg-white">New task</button>
        </div>
      ) : (
        <ul aria-label="Scheduled tasks">
          {tasks.map((task) => (
            <li key={task.id} className={`relative flex items-center gap-4 border-b border-white/[0.06] px-3 py-3 hover:bg-white/[0.025] ${task.enabled ? '' : 'opacity-70'}`}>
              <button type="button" aria-label={`View ${task.name}`} onClick={() => navigateTo(scheduledPath.task(task.id))} className="absolute inset-0 rounded-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-white/40" />
              <span className="pointer-events-none flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white/[0.05] text-[#aaa6a2]"><CalendarClock className="h-4 w-4" /></span>
              <div className="pointer-events-none min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-[#eee]">{task.name}</span>
                <p className="mt-0.5 truncate text-xs text-[#8f8b86]">{describeSchedule(task)}</p>
              </div>
              <span className="pointer-events-none hidden shrink-0 text-xs text-[#8f8b86] sm:block">{nextRunLabel(task)}</span>
              <div className="relative z-10"><ActiveSwitch task={task} onError={setActionError} /></div>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function ConfirmDelete({ task, onCancel, onConfirm }: { task: ScheduledTask; onCancel: () => void; onConfirm: () => void }) {
  const ref = useRef<HTMLElement>(null);
  useModalFocus(true, onCancel, ref);
  return createPortal(
    <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/70 p-4">
      <section ref={ref} role="alertdialog" aria-modal="true" aria-labelledby="delete-task-title" className="w-full max-w-sm rounded-2xl border border-white/15 bg-[#202020] p-5 shadow-2xl">
        <h2 id="delete-task-title" className="text-base font-medium text-white">Delete {task.name}?</h2>
        <p className="mt-2 text-sm text-[#aaa6a2]">It stops running and its history is removed. Chats from past runs stay in Recents.</p>
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onCancel} className="rounded-lg px-3 py-2 text-sm text-[#c9c6c2] hover:bg-white/10">Cancel</button>
          <button type="button" onClick={onConfirm} className="rounded-lg bg-red-500/90 px-3 py-2 text-sm font-medium text-white hover:bg-red-500">Delete</button>
        </div>
      </section>
    </div>,
    document.body,
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="border-b border-white/[0.06] py-4">
      <h3 className="text-xs font-medium text-[#8f8b86]">{label}</h3>
      <div className="mt-1.5 text-sm text-[#e5e2de]">{children}</div>
    </div>
  );
}

function RunStatus({ run }: { run: ScheduledTaskRun }) {
  if (run.status === 'running') return <span className="flex items-center gap-1.5 text-xs text-[#c9c5c0]"><Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> Running</span>;
  if (run.status === 'failed') return <span className="text-xs text-red-300">Error</span>;
  if (run.status === 'skipped') return <span className="text-xs text-[#d6b46a]">Skipped</span>;
  return null;
}

function RunRow({ run }: { run: ScheduledTaskRun }) {
  const when = formatRunTime(run.startedAt);
  const content = (
    <>
      <div className="min-w-0 flex-1">
        <span className="block text-sm text-[#e5e2de]">{when}</span>
        <span className="block truncate text-xs text-[#8f8b86]">
          {run.trigger === 'manual' ? 'Run now' : 'Scheduled'}
          {run.error && <> · {run.error}</>}
          {!run.conversationId && run.status !== 'skipped' && run.status !== 'running' && <> · chat deleted</>}
        </span>
      </div>
      <RunStatus run={run} />
      {run.conversationId && <ChevronRight className="h-4 w-4 shrink-0 text-[#77736f]" aria-hidden="true" />}
    </>
  );
  const rowClass = 'flex w-full items-center gap-3 border-b border-white/[0.06] px-3 py-2.5 text-left';
  return (
    <li>
      {run.conversationId ? (
        <button type="button" onClick={() => showConversation(run.conversationId!)} aria-label={`Open the run from ${when}`} className={`${rowClass} hover:bg-white/[0.03]`}>{content}</button>
      ) : (
        <div className={rowClass}>{content}</div>
      )}
    </li>
  );
}

function TaskDetail({ taskId, onEdit }: { taskId: string; onEdit: (task: ScheduledTask) => void }) {
  const { task, runs, running, loading, error } = useScheduledTask(taskId);
  const [actionError, setActionError] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [starting, setStarting] = useState(false);

  if (loading) return <p className="text-sm text-[#aaa6a2]">Loading…</p>;
  if (!task) {
    return (
      <div>
        <p role="alert" className="text-sm text-[#aaa6a2]">{error || 'This scheduled task does not exist.'}</p>
        <button type="button" onClick={() => navigateTo(scheduledPath.list)} className="mt-3 text-sm text-[#e5e2de] underline">All scheduled tasks</button>
      </div>
    );
  }

  const runNow = async () => {
    setStarting(true);
    setActionError('');
    try {
      await runScheduledTaskNow(task.id);
    } catch (failure) {
      setActionError((failure as Error).message);
    } finally {
      setStarting(false);
    }
  };

  const remove = async () => {
    setDeleting(false);
    try {
      await deleteScheduledTask(task.id);
      navigateTo(scheduledPath.list);
    } catch (failure) {
      setActionError((failure as Error).message);
    }
  };

  return (
    <div>
      {deleting && <ConfirmDelete task={task} onCancel={() => setDeleting(false)} onConfirm={remove} />}
      <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 text-sm text-[#aaa6a2]">
        <a href={scheduledPath.list} onClick={(event) => { event.preventDefault(); navigateTo(scheduledPath.list); }} className="hover:text-white">Scheduled tasks</a>
        <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
        <span aria-current="page" className="truncate text-[#e5e2de]">{task.name}</span>
      </nav>

      <div className="mt-5 flex flex-wrap items-center gap-3">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-white/[0.06] text-[#aaa6a2]"><CalendarClock className="h-5 w-5" /></span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1">
            <h2 className="truncate text-xl font-medium text-white">{task.name}</h2>
            <Menu
              label={`More options for ${task.name}`}
              align="start"
              trigger={<MoreHorizontal className="h-4 w-4" />}
              items={[
                { label: 'Edit', icon: <PenLine className="h-4 w-4" />, onSelect: () => onEdit(task) },
                { label: 'Delete', icon: <Trash2 className="h-4 w-4" />, onSelect: () => setDeleting(true), danger: true },
              ]}
              triggerClassName="flex h-8 w-8 items-center justify-center rounded-md text-[#aaa6a2] hover:bg-white/[0.08] hover:text-white"
            />
          </div>
          <p className="mt-0.5 text-sm text-[#8f8b86]">{nextRunLabel(task)}</p>
        </div>
        <label className="flex items-center gap-2 text-sm text-[#c9c5c0]">
          {task.enabled ? 'Active' : 'Paused'}
          <ActiveSwitch task={task} onError={setActionError} />
        </label>
        <button type="button" onClick={runNow} disabled={running || starting} className="flex items-center gap-1.5 rounded-lg bg-[#f0eeeb] px-3 py-1.5 text-sm font-medium text-[#1c1b19] hover:bg-white disabled:opacity-50">
          <Play className="h-3.5 w-3.5" /> {running ? 'Running…' : 'Run now'}
        </button>
      </div>
      {actionError && <p role="alert" className="mt-3 text-sm text-red-300">{actionError}</p>}

      <div className="mt-4 grid gap-x-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div>
          <Field label="Instructions"><p className="whitespace-pre-wrap">{task.prompt}</p></Field>
          <Field label="Schedule">{describeSchedule(task)}<span className="block text-xs text-[#8f8b86]">Time zone: {task.timezone}</span></Field>
          <Field label="Model">{modelName(task.model)}</Field>
        </div>
        <section aria-label="History" className="py-4">
          <h3 className="mb-1.5 text-xs font-medium text-[#8f8b86]">History</h3>
          {runs.length ? <ul>{runs.map((run) => <RunRow key={run.id} run={run} />)}</ul> : <p className="text-sm text-[#8f8b86]">No runs yet. Click Run now to try it.</p>}
        </section>
      </div>
    </div>
  );
}

/** Scheduled tasks: the list at /scheduled and a task's page at /scheduled/<id>, like Claude's. */
export default function ScheduledPage({ view }: { view: ScheduledView }) {
  const [dialog, setDialog] = useState<DialogState>(null);
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto bg-[#191919]">
      <div className="mx-auto w-full max-w-5xl px-5 pb-16 pt-6 sm:px-8">
        <div className="flex items-center">
          <PageHeaderToggle />
          <h1 className="flex-1 text-2xl font-medium text-white">Scheduled tasks</h1>
          {!view.taskId && (
            <button type="button" onClick={() => setDialog('new')} className="flex h-8 items-center gap-1.5 rounded-lg bg-[#f0eeeb] px-3 text-sm font-medium text-[#1c1b19] hover:bg-white">
              <Plus className="h-4 w-4" /> New task
            </button>
          )}
        </div>
        {!view.taskId && <p className="mt-1 text-sm text-[#aaa6a2]">Prompts that run on a schedule. Each run is a new chat you can open from the task.</p>}

        <div className="mt-6">
          {view.taskId ? <TaskDetail taskId={view.taskId} onEdit={setDialog} /> : <TaskList onNew={() => setDialog('new')} />}
        </div>
      </div>
      {dialog && (
        <ScheduledTaskDialog
          task={dialog === 'new' ? null : dialog}
          onClose={() => setDialog(null)}
          // Like Claude, a new task opens on its own page.
          onSaved={(saved) => { if (dialog === 'new') navigateTo(scheduledPath.task(saved.id)); }}
        />
      )}
    </div>
  );
}
