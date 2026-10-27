/**
 * Point the URL at a chat without a Next.js navigation. The whole app is one
 * page, so a router.push would re-request it from the server and remount
 * everything (sidebar, composer, every message). Next mirrors pushState into
 * usePathname and keeps back/forward working.
 */
export function showConversation(conversationId: string | undefined, { replace = false } = {}) {
  const path = conversationId ? `/${conversationId}` : '/';
  if (window.location.pathname === path) return;
  window.history[replace ? 'replaceState' : 'pushState'](null, '', path);
}

/** Top-level paths that are app pages rather than chat ids. */
export const APP_PAGES = ['customize', 'resources'] as const;

export type AppView =
  | { kind: 'chat' }
  | { kind: 'resources' }
  /** `/customize/skills[/yours|/discover|/new/upload|/<id>[/contents]]` */
  | { kind: 'skills'; tab: 'discover' | 'yours' | 'upload' | 'skill'; skillId?: string; section?: 'overview' | 'contents' };

export function isAppPagePath(segments: string[]) {
  return (APP_PAGES as readonly string[]).includes(segments[0] ?? '');
}

export function appViewFromPath(pathname: string): AppView {
  const [first, second, third, fourth] = pathname.split('/').filter(Boolean);
  if (first === 'resources') return { kind: 'resources' };
  if (first !== 'customize') return { kind: 'chat' };
  if (second !== 'skills' || !third) return { kind: 'skills', tab: 'discover' };
  if (third === 'yours' || third === 'discover') return { kind: 'skills', tab: third };
  if (third === 'new') return { kind: 'skills', tab: 'upload' };
  return { kind: 'skills', tab: 'skill', skillId: third, section: fourth === 'contents' ? 'contents' : 'overview' };
}

/** Client-side navigation within the single app page (see showConversation). */
export function navigateTo(path: string, { replace = false } = {}) {
  if (window.location.pathname === path) return;
  window.history[replace ? 'replaceState' : 'pushState'](null, '', path);
}

export const skillsPath = {
  discover: '/customize/skills',
  yours: '/customize/skills/yours',
  upload: '/customize/skills/new/upload',
  skill: (id: string, section: 'overview' | 'contents' = 'overview') =>
    `/customize/skills/${id}${section === 'contents' ? '/contents' : ''}`,
};
