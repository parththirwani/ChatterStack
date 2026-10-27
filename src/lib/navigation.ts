/**
 * Point the URL at a chat without a Next.js navigation. The whole app is one
 * page, so a router.push would re-request it from the server and remount
 * everything (sidebar, composer, every message). Next mirrors pushState into
 * usePathname and keeps back/forward working.
 */
export function showConversation(conversationId: string | undefined, { replace = false } = {}) {
  navigateTo(conversationId ? `/${conversationId}` : '/', { replace });
}

/** Top-level paths that are app pages rather than chat ids. */
export const APP_PAGES = ['customize', 'resources'] as const;

export type AppView =
  | { kind: 'chat' }
  | { kind: 'resources' }
  /** `/customize/skills[/yours|/discover|/new/upload|/<id>[/contents]]` */
  | { kind: 'skills'; tab: 'discover' | 'yours' | 'upload' | 'skill'; skillId?: string; section?: 'overview' | 'contents' };

const SKILL_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The app page a path names, or null if it isn't one we have (a 404). */
export function appPageFromSegments(segments: string[]): Exclude<AppView, { kind: 'chat' }> | null {
  const [first, second, third, fourth, ...rest] = segments;
  if (rest.length) return null;
  if (first === 'resources') return second === undefined ? { kind: 'resources' } : null;
  if (first !== 'customize') return null;
  if (second === undefined) return { kind: 'skills', tab: 'discover' };
  if (second !== 'skills') return null;
  if (third === undefined) return { kind: 'skills', tab: 'discover' };
  if (third === 'yours' || third === 'discover') return fourth === undefined ? { kind: 'skills', tab: third } : null;
  if (third === 'new') return fourth === 'upload' ? { kind: 'skills', tab: 'upload' } : null;
  if (!SKILL_ID.test(third)) return null;
  if (fourth !== undefined && fourth !== 'contents') return null;
  return { kind: 'skills', tab: 'skill', skillId: third, section: fourth === 'contents' ? 'contents' : 'overview' };
}

/** Paths under an app page's prefix, valid or not (never a chat id). */
export function isAppPagePath(segments: string[]) {
  return (APP_PAGES as readonly string[]).includes(segments[0] ?? '');
}

export function appViewFromPath(pathname: string): AppView {
  const segments = pathname.split('/').filter(Boolean);
  if (!isAppPagePath(segments)) return { kind: 'chat' };
  return appPageFromSegments(segments) ?? { kind: 'skills', tab: 'discover' };
}

/**
 * Client-side navigation within the single app page: rewrites the URL with
 * history.pushState, which Next mirrors into usePathname.
 */
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
