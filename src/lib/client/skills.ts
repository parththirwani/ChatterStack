'use client';
import { useCallback, useEffect, useSyncExternalStore } from 'react';
import type { ParsedSkill, SkillSource } from '@/src/lib/skills/skill-file';
import type { Skill, SkillTag } from '@/src/types/skill.types';

/** Fired after any change to the user's skills, so every list refreshes. */
export const SKILLS_CHANGED_EVENT = 'chatterstack:skills-changed';
/** Asks the composer to tag a skill; preventDefault() means it couldn't. */
export const ADD_SKILL_EVENT = 'chatterstack:add-skill';

export interface SkillDraftResult {
  draft: ParsedSkill;
  issues: Array<{ field: string; message: string }>;
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: init?.body ? { 'Content-Type': 'application/json', ...init.headers } : init?.headers,
  });
  if (response.status === 204) return undefined as T;
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(body.message ?? body.error ?? 'Something went wrong. Try again.');
  }
  return body as T;
}

const changed = () => window.dispatchEvent(new Event(SKILLS_CHANGED_EVENT));

export async function saveSkill(input: ParsedSkill & { source?: SkillSource }, id?: string): Promise<Skill> {
  const { skill } = await request<{ skill: Skill }>(id ? `/api/skills/${id}` : '/api/skills', {
    method: id ? 'PATCH' : 'POST',
    body: JSON.stringify(id ? { name: input.name, description: input.description, instructions: input.instructions } : input),
  });
  changed();
  return skill;
}

export async function deleteSkill(id: string) {
  await request(`/api/skills/${id}`, { method: 'DELETE' });
  changed();
}

export const importSkillFile = (content: string, fileName?: string) =>
  request<SkillDraftResult>('/api/skills/import', { method: 'POST', body: JSON.stringify({ content, fileName }) });

export const draftSkillWithAI = (ask: string, current?: ParsedSkill, signal?: AbortSignal) =>
  request<SkillDraftResult>('/api/skills/generate', { method: 'POST', body: JSON.stringify({ request: ask, current }), signal });

export const skillExportUrl = (id: string) => `/api/skills/${id}/export`;

export function tagSkill(skill: SkillTag) {
  return window.dispatchEvent(new CustomEvent<SkillTag>(ADD_SKILL_EVENT, { detail: skill, cancelable: true }));
}

// One shared list for the sidebar and the composer, loaded once per session
// and refreshed whenever skills change.
interface SkillsState { skills: Skill[]; loading: boolean; error: string }
let state: SkillsState = { skills: [], loading: true, error: '' };
// The user the list belongs to, so a different sign-in never sees it.
let loadedFor: string | null = null;
let inFlight: Promise<void> | null = null;
const listeners = new Set<() => void>();

function setState(next: Partial<SkillsState>) {
  state = { ...state, ...next };
  listeners.forEach((listener) => listener());
}

// Bumped when the user changes, so a response for the previous user is dropped.
let generation = 0;

export function refreshSkills() {
  const requested = generation;
  inFlight ??= request<{ skills: Skill[] }>('/api/skills')
    .then(({ skills }) => { if (requested === generation) setState({ skills, loading: false, error: '' }); })
    .catch((error: Error) => { if (requested === generation) setState({ loading: false, error: error.message }); })
    .finally(() => { if (requested === generation) inFlight = null; });
  return inFlight;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const SERVER_STATE: SkillsState = { skills: [], loading: true, error: '' };

/** The signed-in user's skills. Pass no id (or 'guest') when signed out. */
export function useSkills(userId?: string | null) {
  const enabled = !!userId && userId !== 'guest';
  const current = useSyncExternalStore(subscribe, () => state, () => SERVER_STATE);

  useEffect(() => {
    if (!enabled) return;
    if (loadedFor !== userId) {
      loadedFor = userId;
      generation += 1;
      inFlight = null;
      setState({ skills: [], loading: true, error: '' });
      void refreshSkills();
    }
    const onChange = () => void refreshSkills();
    window.addEventListener(SKILLS_CHANGED_EVENT, onChange);
    return () => window.removeEventListener(SKILLS_CHANGED_EVENT, onChange);
  }, [enabled, userId]);

  const refresh = useCallback(() => refreshSkills(), []);
  return enabled ? { ...current, refresh } : { skills: [], loading: false, error: '', refresh };
}

/** Test hook: forget the cached list. */
export function resetSkillsCache() {
  state = { skills: [], loading: true, error: '' };
  loadedFor = null;
  inFlight = null;
  generation += 1;
}
