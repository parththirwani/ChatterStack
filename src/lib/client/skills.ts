'use client';
import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { MAX_SKILLS_PER_MESSAGE, type ParsedSkill, type SkillFile } from '@/src/lib/skills/skill-file';
import type { Skill, SkillTag, SkillUploadResult } from '@/src/types/skill.types';
import { skillsInText } from '@/src/lib/skills/slash';
import { SKILL_CREATOR_ID } from '@/src/config/skill-catalog';
import { useAppStore } from '@/src/store/rootStore';

/** Fired after any change to the user's skills, so every list refreshes. */
export const SKILLS_CHANGED_EVENT = 'chatterstack:skills-changed';
/** Fills the new chat's composer, if it's the one open: `detail` is the text. */
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
const listeners = new Set<() => void>();

function setState(next: Partial<SkillsState>) {
  state = { ...state, ...next };
  listeners.forEach((listener) => listener());
}

// Each refresh gets a number and only the newest one's answer is kept, so a
// list fetched before a later change never replaces one fetched after it.
// Changing user also bumps it, dropping the previous user's responses.
let latestRequest = 0;

let latestRefresh: Promise<void> = Promise.resolve();
// False while the newest refresh hasn't answered.
let current = true;

export function refreshSkills() {
  const requested = ++latestRequest;
  current = false;
  const settle = (next: Partial<SkillsState>) => {
    if (requested !== latestRequest) return;
    current = true;
    setState(next);
  };
  latestRefresh = request<{ skills: Skill[] }>('/api/skills')
    .then(({ skills }) => settle({ skills, loading: false, error: '' }))
    .catch((error: Error) => settle({ loading: false, error: error.message }));
  return latestRefresh;
}

/** Starts loading `userId`'s list unless it's the one already held. */
function loadSkillsFor(userId: string) {
  if (loadedFor === userId) return;
  loadedFor = userId;
  latestRequest += 1;
  setState({ skills: [], loading: true, error: '' });
  void refreshSkills();
}

/**
 * The user's skills as of now, waiting for a load or refresh in progress,
 * so a message sent right after sign-in or a change still gets its skills.
 */
export async function currentSkills(userId: string | undefined): Promise<Skill[]> {
  if (!userId || userId === 'guest') return [];
  loadSkillsFor(userId);
  let waited: Promise<void>;
  do {
    waited = latestRefresh;
    await waited;
  } while (waited !== latestRefresh);
  return loadedFor === userId ? state.skills : [];
}

const tagsFrom = (text: string, skills: Skill[]): SkillTag[] =>
  skillsInText(text, skills.filter((skill) => skill.enabled))
    .slice(0, MAX_SKILLS_PER_MESSAGE)
    .map(({ id, name }) => ({ id, name }));

/**
 * The skills a message tags: its `/name` tokens for turned-on skills, the
 * first few. Answers right away when the list is up to date (the usual case),
 * otherwise once the load or refresh in progress has answered.
 */
export function skillTagsIn(text: string, userId: string | undefined): SkillTag[] | Promise<SkillTag[]> {
  if (!userId || userId === 'guest') return [];
  if (loadedFor === userId && current && !state.loading) return tagsFrom(text, state.skills);
  return currentSkills(userId).then((skills) => tagsFrom(text, skills));
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

let watchers = 0;
const onSkillsChanged = () => void refreshSkills();

const SERVER_STATE: SkillsState = { skills: [], loading: true, error: '' };

/** The signed-in user's skills. Pass no id (or 'guest') when signed out. */
export function useSkills(userId?: string | null) {
  const enabled = !!userId && userId !== 'guest';
  const current = useSyncExternalStore(subscribe, () => state, () => SERVER_STATE);

  useEffect(() => {
    if (!enabled || !userId) return;
    loadSkillsFor(userId);
    // One refresh per change, however many components use the list.
    if (watchers++ === 0) window.addEventListener(SKILLS_CHANGED_EVENT, onSkillsChanged);
    return () => {
      if (--watchers === 0) window.removeEventListener(SKILLS_CHANGED_EVENT, onSkillsChanged);
    };
  }, [enabled, userId]);

  const refresh = useCallback(() => refreshSkills(), []);
  return enabled ? { ...current, refresh } : { skills: [], loading: false, error: '', refresh };
}

/** Test hook: forget the cached list. */
export function resetSkillsCache() {
  state = { skills: [], loading: true, error: '' };
  loadedFor = null;
  latestRequest += 1;
  latestRefresh = Promise.resolve();
  current = true;
}

/**
 * Opens a new chat whose composer holds `text` (kept ahead of any existing
 * new-chat draft). The text goes in the new chat's stored draft, which the
 * composer loads when it switches to that chat; COMPOSE_EVENT covers a
 * composer that is already on the new chat and so won't reload it.
 */
function startChat(text: string, { replace = false } = {}) {
  const store = useAppStore.getState();
  const existing = replace ? '' : (store.drafts.new ?? '').trim();
  const composed = existing ? `${text}${existing}` : text;
  store.setDraft('new', composed);
  window.dispatchEvent(new CustomEvent(COMPOSE_EVENT, { detail: composed }));
  window.dispatchEvent(new Event('chatterstack:new-chat'));
}

/** Turns a skill on if needed: the composer only applies skills that are on. */
async function ensureEnabled(skill: Pick<Skill, 'id' | 'enabled'>) {
  if (!skill.enabled) await updateSkill(skill.id, { enabled: true });
}

/** "Try in chat": a new chat with `/name ` ready to use. */
export async function trySkillInChat(skill: Pick<Skill, 'id' | 'name' | 'enabled'>) {
  await ensureEnabled(skill);
  startChat(`/${skill.name} `);
}

/** "Create with AI": a chat with skill-creator, which drafts a SKILL.md to save. */
export async function createSkillWithAI() {
  // The user's copy may have another name (renamed, or theirs took the name).
  const creator = await addCatalogSkill(SKILL_CREATOR_ID);
  startChat(`Let's create a skill together using /${creator.name}. First ask me what the skill should do.`, { replace: true });
}

/** "Edit with AI": skill-creator plus the skill itself, so the model sees its text. */
export async function editSkillWithAI(skill: Pick<Skill, 'id' | 'name' | 'enabled'>) {
  const creator = await addCatalogSkill(SKILL_CREATOR_ID);
  await ensureEnabled(skill);
  startChat(`Use /${creator.name} to help me improve my /${skill.name} skill. Ask me what I want to change, then show the full updated SKILL.md.`, { replace: true });
}
