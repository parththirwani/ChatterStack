'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ScheduledTaskInput } from '@/src/lib/scheduled-tasks/schedule';
import type { ScheduledTask, ScheduledTaskRun } from '@/src/types/scheduled-task.types';

/** Fired after any change to the user's scheduled tasks, so every view refreshes. */
export const SCHEDULED_TASKS_CHANGED_EVENT = 'chatterstack:scheduled-tasks-changed';
/** While a run is in progress, the task page re-reads its runs this often. */
const RUN_POLL_MS = 3000;

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: init?.body ? { 'Content-Type': 'application/json', ...init.headers } : init?.headers,
  });
  if (response.status === 204) return undefined as T;
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw Object.assign(new Error(body.error ?? 'Something went wrong. Try again.'), { field: body.field, status: response.status });
  }
  return body as T;
}

const changed = () => window.dispatchEvent(new Event(SCHEDULED_TASKS_CHANGED_EVENT));
const withChange = async <T,>(work: Promise<T>) => {
  const result = await work;
  changed();
  return result;
};

export const createScheduledTask = (input: ScheduledTaskInput) =>
  withChange(request<{ task: ScheduledTask }>('/api/scheduled-tasks', { method: 'POST', body: JSON.stringify(input) }).then((body) => body.task));

export const updateScheduledTask = (id: string, patch: Partial<ScheduledTaskInput> & { enabled?: boolean }) =>
  withChange(request<{ task: ScheduledTask }>(`/api/scheduled-tasks/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }).then((body) => body.task));

export const deleteScheduledTask = (id: string) => withChange(request<void>(`/api/scheduled-tasks/${id}`, { method: 'DELETE' }));

export const runScheduledTaskNow = (id: string) =>
  withChange(request<{ run: ScheduledTaskRun }>(`/api/scheduled-tasks/${id}/run`, { method: 'POST' }).then((body) => body.run));

/** Loads with `load` now and whenever tasks change; `reload` re-reads on demand. */
function useLoaded<T>(load: (() => Promise<T>) | null) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  // Only the newest request's answer is kept.
  const latest = useRef(0);

  const reload = useCallback(async () => {
    if (!load) return;
    const id = ++latest.current;
    try {
      const value = await load();
      if (id !== latest.current) return;
      setData(value);
      setError('');
    } catch (failure) {
      if (id === latest.current) setError((failure as Error).message);
    } finally {
      if (id === latest.current) setLoading(false);
    }
  }, [load]);

  useEffect(() => {
    setLoading(true);
    void reload();
    const onChange = () => void reload();
    window.addEventListener(SCHEDULED_TASKS_CHANGED_EVENT, onChange);
    return () => window.removeEventListener(SCHEDULED_TASKS_CHANGED_EVENT, onChange);
  }, [reload]);

  return { data, error, loading, reload };
}

const loadTasks = () => request<{ tasks: ScheduledTask[] }>('/api/scheduled-tasks').then((body) => body.tasks);

export function useScheduledTasks() {
  const { data, ...rest } = useLoaded(loadTasks);
  return { tasks: data ?? [], ...rest };
}

/** One task and its runs. Polls while a run is in progress. */
export function useScheduledTask(id: string) {
  const load = useCallback(() => request<{ task: ScheduledTask; runs: ScheduledTaskRun[] }>(`/api/scheduled-tasks/${id}`), [id]);
  const { data, error, loading, reload } = useLoaded(load);
  const running = !!data?.runs.some((run) => run.status === 'running');

  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => void reload(), RUN_POLL_MS);
    return () => window.clearInterval(timer);
  }, [running, reload]);

  return { task: data?.task ?? null, runs: data?.runs ?? [], running, error, loading, reload };
}
