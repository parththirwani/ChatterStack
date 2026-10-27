'use client';
import { useCallback, useEffect, useSyncExternalStore } from 'react';
import type { ParsedSkill, SkillFile } from '@/src/lib/skills/skill-file';
import type { Skill, SkillUploadResult } from '@/src/types/skill.types';
import { SKILL_CREATOR_ID } from '@/src/config/skill-catalog';
import { useAppStore } from '@/src/store/rootStore';

/** Fired after any change to the user's skills, so every list refreshes. */
export const SKILLS_CHANGED_EVENT = 'chatterstack:skills-changed';
/** Replaces the open composer's text: `detail` is the new text. */
export const COMPOSE_EVENT = 'chatterstack:compose';
/** Opens the create-skill dialog, optionally prefilled (Save as skill). */
export const OPEN_SKILL_EDITOR_EVENT = 'chatterstack:open-skill-editor';

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const isForm = init?.body instanceof FormData;
  const response = await fetch(url, {
    ...init,
    headers: init?.body && !isForm ? { 'Content-Type': 'application/json', ...init.headers } : init?.headers,
  });
  if (response.status === 204) return undefined as T;
  const body = await response.json().catch(() => ({}));
  if (!response.ok && !body.results) {
    throw Object.assign(new Error(body.message ?? body.error ?? 'Something went wrong. Try again.'), { field: body.field });
  }
  return body as T;
}

const changed = () => window.dispatchEvent(new Event(SKILLS_CHANGED_EVENT));
const withChange = async <T,>(work: Promise<T>) => {
  const result = await work;
  changed();
  return result;
};

export interface SkillContentInput extends ParsedSkill {
  files?: SkillFile[];
}

export const createSkill = (content: SkillContentInput, source: 'created' | 'generated' = 'created') =>
  withChange(request<{ skill: Skill }>('/api/skills', { method: 'POST', body: JSON.stringify({ ...content, source }) }).then((body) => body.skill));

export const updateSkill = (id: string, patch: Partial<SkillContentInput> & { enabled?: boolean }) =>
  withChange(request<{ skill: Skill }>(`/api/skills/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }).then((body) => body.skill));

export const deleteSkill = (id: string) => withChange(request<void>(`/api/skills/${id}`, { method: 'DELETE' }));

export const duplicateSkill = (id: string) =>
  withChange(request<{ skill: Skill }>(`/api/skills/${id}/duplicate`, { method: 'POST' }).then((body) => body.skill));

export const addCatalogSkill = (id: string) =>
  withChange(request<{ skill: Skill }>('/api/skills/catalog', { method: 'POST', body: JSON.stringify({ id }) }).then((body) => body.skill));

/** Uploads .md, .zip or .skill files; each file gets its own result. */
export function uploadSkills(files: File[], replaceId?: string) {
  const form = new FormData();
  for (const file of files) form.append('files', file);
  if (replaceId) form.append('replaceId', replaceId);
  return withChange(request<{ results: SkillUploadResult[] }>('/api/skills/upload', { method: 'POST', body: form }).then((body) => body.results));
}

export const skillDownloadUrl = (id: string) => `/api/skills/${id}/download`;

export function openSkillEditor(draft?: SkillContentInput & { id?: string; source?: 'created' | 'generated' }) {
  window.dispatchEvent(new CustomEvent(OPEN_SKILL_EDITOR_EVENT, { detail: draft ?? null }));
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

/** Opens a new chat whose composer holds `text` (kept ahead of any existing new-chat draft). */
function startChat(text: string, { replace = false } = {}) {
  const store = useAppStore.getState();
  const existing = replace ? '' : (store.drafts.new ?? '').trim();
  const composed = existing ? `${text}${existing}` : text;
  store.setDraft('new', composed);
  window.dispatchEvent(new Event('chatterstack:new-chat'));
  // After the switch to the new chat renders, so the text can't be saved as
  // the draft of the chat that was open before.
  window.setTimeout(() => {
    window.dispatchEvent(new CustomEvent(COMPOSE_EVENT, { detail: composed }));
    window.requestAnimationFrame(() => {
      const input = document.querySelector<HTMLTextAreaElement>('textarea[aria-label="Message"]');
      input?.focus();
      input?.setSelectionRange(input.value.length, input.value.length);
    });
  }, 50);
}

/** "Try in chat": a new chat with `/name ` ready to use. */
export const trySkillInChat = (skill: Pick<Skill, 'name'>) => startChat(`/${skill.name} `);

/** "Create with AI": a chat with skill-creator, which drafts a SKILL.md to save. */
export async function createSkillWithAI() {
  await addCatalogSkill(SKILL_CREATOR_ID);
  startChat("Let's create a skill together using /skill-creator. First ask me what the skill should do.", { replace: true });
}

/** "Edit with AI": skill-creator plus the skill itself, so the model sees its text. */
export async function editSkillWithAI(skill: Pick<Skill, 'name'>) {
  await addCatalogSkill(SKILL_CREATOR_ID);
  startChat(`Use /skill-creator to help me improve my /${skill.name} skill. Ask me what I want to change, then show the full updated SKILL.md.`, { replace: true });
}
