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
