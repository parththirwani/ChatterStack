/**
 * Pinning and renaming against the real API and database.
 */
import type { Page } from '@playwright/test';
import { conversationRow, seedConversation } from './support/db';
import { expect, openApp, sidebar, test } from './support/fixtures';

const IDS = {
  recent: '11111111-1111-4111-8111-111111111111',
  older: '22222222-2222-4222-8222-222222222222',
  oldest: '33333333-3333-4333-8333-333333333333',
};

test.beforeEach(() => {
  seedConversation({ id: IDS.recent, title: 'Recent chat', updated: 1, messages: [{ role: 'user', content: 'Hi' }, { role: 'assistant', content: 'Hello there' }] });
  seedConversation({ id: IDS.older, title: 'Older chat', updated: 60 });
  seedConversation({ id: IDS.oldest, title: 'Oldest chat', updated: 600 });
});

async function openActions(page: Page, title: string) {
  const row = sidebar.row(page, title);
  await row.hover();
  await row.getByRole('button', { name: `Actions for ${title}` }).click();
  return page.getByRole('menu', { name: 'Chat actions' });
}

test('lists chats by recent activity', async ({ page }) => {
  await openApp(page);
  await expect(sidebar.titles(page, 'Chats')).toHaveText(['Recent chat', 'Older chat', 'Oldest chat']);
  await expect(sidebar.pinned(page)).toHaveCount(0);
});

test('pins a chat to the top and keeps it there after a reload', async ({ page }) => {
  await openApp(page);
  await (await openActions(page, 'Oldest chat')).getByRole('menuitem', { name: 'Pin' }).click();

  await expect(sidebar.titles(page, 'Pinned chats')).toHaveText(['Oldest chat']);
  await expect(sidebar.titles(page, 'Chats')).toHaveText(['Recent chat', 'Older chat']);
  await expect.poll(() => conversationRow(IDS.oldest)?.pinned).toBe(true);

  await page.reload();
  await expect(sidebar.titles(page, 'Pinned chats')).toHaveText(['Oldest chat']);
});

test('the most recently pinned chat goes first, and unpinning puts it back', async ({ page }) => {
  await openApp(page);
  await (await openActions(page, 'Oldest chat')).getByRole('menuitem', { name: 'Pin' }).click();
  await expect.poll(() => conversationRow(IDS.oldest)?.pinned).toBe(true);
  await (await openActions(page, 'Older chat')).getByRole('menuitem', { name: 'Pin' }).click();
  await expect(sidebar.titles(page, 'Pinned chats')).toHaveText(['Older chat', 'Oldest chat']);

  await (await openActions(page, 'Older chat')).getByRole('menuitem', { name: 'Unpin' }).click();
  await expect(sidebar.titles(page, 'Pinned chats')).toHaveText(['Oldest chat']);
  await expect.poll(() => conversationRow(IDS.older)?.pinned).toBe(false);

  await page.reload();
  await expect(sidebar.titles(page, 'Pinned chats')).toHaveText(['Oldest chat']);
  await expect(sidebar.titles(page, 'Chats')).toHaveText(['Recent chat', 'Older chat']);
});

test('renames a chat from the menu and the new title persists', async ({ page }) => {
  await openApp(page);
  await (await openActions(page, 'Older chat')).getByRole('menuitem', { name: 'Rename' }).click();
  const input = page.getByRole('textbox', { name: 'Chat title' });
  await expect(input).toBeFocused();
  await expect(input).toHaveValue('Older chat');
  await input.fill('Database migration notes');
  await input.press('Enter');

  await expect(sidebar.chats(page).getByRole('button', { name: 'Database migration notes', exact: true })).toBeVisible();
  await expect.poll(() => conversationRow(IDS.older)?.title).toBe('Database migration notes');
  await page.reload();
  await expect(sidebar.chats(page).getByRole('button', { name: 'Database migration notes', exact: true })).toBeVisible();
});

test('renames by double-clicking the title; Escape cancels', async ({ page }) => {
  await openApp(page);
  await sidebar.chats(page).getByRole('button', { name: 'Recent chat', exact: true }).dblclick();
  const input = page.getByRole('textbox', { name: 'Chat title' });
  await input.fill('Never saved');
  await input.press('Escape');
  await expect(sidebar.chats(page).getByRole('button', { name: 'Recent chat', exact: true })).toBeVisible();
  expect(conversationRow(IDS.recent)?.title).toBe('Recent chat');

  await sidebar.chats(page).getByRole('button', { name: 'Recent chat', exact: true }).dblclick();
  await input.fill('Greetings');
  await input.press('Enter');
  await expect.poll(() => conversationRow(IDS.recent)?.title).toBe('Greetings');
});

test('renaming the open chat updates the sidebar without losing the conversation', async ({ page }) => {
  await openApp(page, {}, `/${IDS.recent}`);
  await expect(page.getByText('Hello there')).toBeVisible();
  await (await openActions(page, 'Recent chat')).getByRole('menuitem', { name: 'Rename' }).click();
  await page.getByRole('textbox', { name: 'Chat title' }).fill('Greeting thread');
  await page.keyboard.press('Enter');
  await expect(sidebar.chats(page).getByRole('button', { name: 'Greeting thread', exact: true })).toHaveAttribute('aria-current', 'page');
  await expect(page.getByText('Hello there')).toBeVisible();
});

test('pin and rename cannot touch another user’s chat', async ({ request }) => {
  const response = await request.patch('/api/conversations/00000000-0000-4000-8000-000000000000', { data: { title: 'Hijack' } });
  expect(response.status()).toBe(404);
  const anonymous = await request.patch(`/api/conversations/${IDS.recent}`, { data: { pinned: true }, headers: { cookie: '' } });
  expect([401, 404]).toContain(anonymous.status());
});

test('renames the open chat from the pencil next to its title in the header', async ({ page }) => {
  await openApp(page, {}, `/${IDS.recent}`);
  const header = page.locator('header').filter({ hasText: 'Recent chat' });
  const pencil = header.getByRole('button', { name: 'Rename chat' });
  await expect(pencil).toHaveCSS('opacity', '0');
  await header.getByText('Recent chat').hover();
  await expect(pencil).toHaveCSS('opacity', '1');

  await pencil.click();
  const input = page.getByRole('textbox', { name: 'Chat title' });
  await expect(input).toBeFocused();
  await expect(input).toHaveValue('Recent chat');
  await input.fill('Never saved');
  await input.press('Escape');
  expect(conversationRow(IDS.recent)?.title).toBe('Recent chat');

  await pencil.click();
  await input.fill('Header rename');
  await input.press('Enter');
  await expect(page.locator('header').getByText('Header rename')).toBeVisible();
  await expect(sidebar.chats(page).getByRole('button', { name: 'Header rename', exact: true })).toHaveAttribute('aria-current', 'page');
  await expect.poll(() => conversationRow(IDS.recent)?.title).toBe('Header rename');
  await expect(page.getByText('Hello there')).toBeVisible();
});

test('the new-chat screen has no rename pencil', async ({ page }) => {
  await openApp(page);
  await expect(page.getByRole('button', { name: 'Rename chat' })).toHaveCount(0);
});
