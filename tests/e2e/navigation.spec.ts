/**
 * Switching chats is client-side: no server round-trip, nothing remounts,
 * and no frame shows the wrong chat or the wrong scroll position. Direct
 * loads are still fully server-rendered.
 */
import type { Page } from '@playwright/test';
import { seedConversation } from './support/db';
import { expect, openApp, sidebar, test } from './support/fixtures';

const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const answer = (name: string) =>
  Array.from({ length: 10 }, (_, i) => `## ${name} part ${i}\n\nSome **bold** text.\n\n\`\`\`ts\nconst x${i} = ${i};\n\`\`\`\n`).join('\n');

test.beforeEach(() => {
  seedConversation({ id: A, title: 'Chat A', updated: 1, messages: [{ role: 'user', content: 'Question A' }, { role: 'assistant', content: answer('Alpha') }] });
  seedConversation({ id: B, title: 'Chat B', updated: 2, messages: [{ role: 'user', content: 'Question B' }, { role: 'assistant', content: answer('Beta') }] });
});

interface Frame { title: string; atBottom: boolean; skeleton: boolean }

/** Records every animation frame while `action` runs, plus what was remounted. */
async function watch(page: Page, action: () => Promise<unknown>) {
  const serverRequests: string[] = [];
  const onRequest = (request: { url(): string; headers(): Record<string, string>; resourceType(): string }) => {
    if (request.headers()['rsc'] || request.resourceType() === 'document') serverRequests.push(request.url());
  };
  page.on('request', onRequest);
  await page.evaluate(() => {
    const w = window as unknown as Record<string, unknown>;
    w.__sidebar = document.querySelector('#chat-sidebar');
    w.__composer = document.querySelector('textarea[aria-label="Message"]');
    const frames: Frame[] = [];
    w.__frames = frames;
    const started = performance.now();
    const tick = () => {
      const scroller = document.querySelector<HTMLElement>('#chat-main .overflow-y-auto');
      frames.push({
        title: document.querySelector('header span')?.textContent ?? '',
        atBottom: !scroller || scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 2,
        skeleton: Boolean(document.querySelector('#chat-main .animate-pulse')),
      });
      if (performance.now() - started < 1000) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  await action();
  await page.waitForTimeout(1100);
  page.off('request', onRequest);
  const result = await page.evaluate(() => {
    const w = window as unknown as Record<string, unknown>;
    return {
      frames: w.__frames as Frame[],
      sidebarRemounted: w.__sidebar !== document.querySelector('#chat-sidebar'),
      composerRemounted: w.__composer !== document.querySelector('textarea[aria-label="Message"]'),
    };
  });
  return { ...result, serverRequests };
}

const click = (page: Page, title: string) => sidebar.chats(page).getByRole('button', { name: title, exact: true }).click();

test('switching to a visited chat is instant: no server request, no remount, no flicker', async ({ page }) => {
  await openApp(page, {}, `/${A}`);
  await click(page, 'Chat B');
  await expect(page.getByText('Beta part 9')).toBeVisible();

  const result = await watch(page, () => click(page, 'Chat A'));

  expect(result.serverRequests).toEqual([]);
  expect(result.sidebarRemounted).toBe(false);
  expect(result.composerRemounted).toBe(false);
  const shown = result.frames.filter((frame) => frame.title === 'Chat A');
  expect(shown.length).toBeGreaterThan(0);
  // Every frame of the new chat is already scrolled to the latest message.
  expect(shown.every((frame) => frame.atBottom && !frame.skeleton)).toBe(true);
  // Once the switch happens, the old chat never comes back.
  expect(result.frames.slice(result.frames.findIndex((frame) => frame.title === 'Chat A')).every((frame) => frame.title === 'Chat A')).toBe(true);

  await expect(page).toHaveURL(`/${A}`);
  await expect(page).toHaveTitle('Chat A · ChatterStack');
  await expect(sidebar.chats(page).getByRole('button', { name: 'Chat A', exact: true })).toHaveAttribute('aria-current', 'page');
});

test('opening a chat for the first time loads only its messages, never the page', async ({ page }) => {
  await openApp(page, {}, `/${A}`);
  const result = await watch(page, () => click(page, 'Chat B'));

  expect(result.serverRequests).toEqual([]);
  expect(result.sidebarRemounted).toBe(false);
  // The loaded chat appears already scrolled to the bottom.
  const loaded = result.frames.filter((frame) => frame.title === 'Chat B' && !frame.skeleton);
  expect(loaded.length).toBeGreaterThan(0);
  expect(loaded.every((frame) => frame.atBottom)).toBe(true);
  await expect(page.getByText('Beta part 9')).toBeVisible();
});

test('hovering a chat prefetches it, so the click shows it without a skeleton', async ({ page }) => {
  await openApp(page, {}, `/${A}`);
  const loaded = page.waitForResponse(`**/api/conversations/${B}`);
  await sidebar.chats(page).getByRole('button', { name: 'Chat B', exact: true }).hover();
  await loaded;

  const result = await watch(page, () => click(page, 'Chat B'));
  expect(result.frames.some((frame) => frame.skeleton)).toBe(false);
});

test('clicking the open chat again does nothing', async ({ page }) => {
  await openApp(page, {}, `/${A}`);
  // The initial scroll-to-bottom effect may still be settling after openApp.
  await page.waitForFunction(() => {
    const scroller = document.querySelector<HTMLElement>('#chat-main .overflow-y-auto');
    return scroller && scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 2;
  });
  const result = await watch(page, () => click(page, 'Chat A'));
  expect(result.serverRequests).toEqual([]);
  expect(new Set(result.frames.map((frame) => JSON.stringify(frame))).size).toBe(1);
});

test('the logo opens a new chat without requesting the page', async ({ page }) => {
  await openApp(page, {}, `/${A}`);
  const result = await watch(page, () => page.getByRole('button', { name: 'ChatterStack home' }).click());
  expect(result.serverRequests).toEqual([]);
  expect(result.sidebarRemounted).toBe(false);
  await expect(page).toHaveURL('/chat');
});

test('back and forward move between chats without reloading', async ({ page }) => {
  await openApp(page, {}, `/${A}`);
  await click(page, 'Chat B');
  await page.getByRole('button', { name: 'New chat', exact: true }).first().click();
  await expect(page.getByRole('heading', { name: 'What can I help you work on?' })).toBeVisible();

  const back = await watch(page, () => page.goBack());
  expect(back.serverRequests).toEqual([]);
  expect(back.sidebarRemounted).toBe(false);
  await expect(page).toHaveURL(`/${B}`);
  await expect(page.getByText('Beta part 9')).toBeVisible();

  await page.goBack();
  await expect(page).toHaveURL(`/${A}`);
  await expect(page.getByText('Alpha part 9')).toBeVisible();

  await page.goForward();
  await expect(page).toHaveURL(`/${B}`);
  await expect(page.getByText('Beta part 9')).toBeVisible();
});

test('a direct load is server-rendered with the conversation in the HTML', async ({ page, request }) => {
  const html = await (await request.get(`/${A}`)).text();
  expect(html).toContain('Question A');
  expect(html).toContain('Alpha part 9');
  expect(html).toContain('<title>Chat A · ChatterStack</title>');

  // And the first paint already shows it: no skeleton, no hero.
  await page.goto(`/${A}`, { waitUntil: 'commit' });
  await expect(page.getByText('Alpha part 9')).toBeVisible();
  await expect(page.locator('#chat-main .animate-pulse')).toHaveCount(0);
});

test('an unknown chat id shows the not-available state, client-side or on load', async ({ page }) => {
  await page.goto('/00000000-0000-4000-8000-000000000000');
  await expect(page.getByText('This conversation isn’t available.').or(page.getByText("This conversation isn't available."))).toBeVisible();
});
