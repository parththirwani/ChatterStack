/**
 * Unsent drafts: one per chat, kept across chat switches and reloads, shown
 * in the sidebar, and gone once sent.
 */
import type { Page } from '@playwright/test';
import { seedConversation } from './support/db';
import { expect, MODELS, openApp, sidebar, test } from './support/fixtures';

const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

test.beforeEach(() => {
  seedConversation({ id: A, title: 'Chat A', updated: 1, messages: [{ role: 'user', content: 'Question A' }, { role: 'assistant', content: 'Answer A' }] });
  seedConversation({ id: B, title: 'Chat B', updated: 2, messages: [{ role: 'user', content: 'Question B' }, { role: 'assistant', content: 'Answer B' }] });
});

const composer = (page: Page) => page.getByRole('textbox', { name: 'Message' });
const open = (page: Page, title: string) => sidebar.chats(page).getByRole('button', { name: new RegExp(`^${title}`) }).click();
const row = (page: Page, title: string) => sidebar.chats(page).getByRole('button', { name: new RegExp(`^${title}`) });

test('each chat keeps its own draft, shown in the sidebar while you are elsewhere', async ({ page }) => {
  await openApp(page, {}, `/${A}`);
  await composer(page).fill('Follow-up for A');
  // The chat you're in doesn't show its own draft.
  await expect(row(page, 'Chat A')).not.toContainText('Draft');

  await open(page, 'Chat B');
  await expect(page.getByText('Answer B')).toBeVisible();
  await expect(composer(page)).toHaveValue('');
  await expect(row(page, 'Chat A')).toContainText('Draft');
  await expect(row(page, 'Chat A')).toContainText('Follow-up for A');
  await expect(row(page, 'Chat A')).toHaveAccessibleName(/unsent draft/);

  await composer(page).fill('Follow-up for B');
  await open(page, 'Chat A');
  await expect(composer(page)).toHaveValue('Follow-up for A');
  await expect(row(page, 'Chat B')).toContainText('Follow-up for B');
  await expect(row(page, 'Chat A')).not.toContainText('Draft');
});

test('drafts survive a reload', async ({ page }) => {
  await openApp(page, {}, `/${A}`);
  await composer(page).fill('Still thinking about this');
  await open(page, 'Chat B');
  await expect(row(page, 'Chat A')).toContainText('Still thinking about this');

  await page.reload();
  await expect(row(page, 'Chat A')).toContainText('Still thinking about this');
  await open(page, 'Chat A');
  await expect(composer(page)).toHaveValue('Still thinking about this');

  // Including the draft of the chat that's open when you reload.
  await page.reload();
  await expect(composer(page)).toHaveValue('Still thinking about this');
});

test('an unsent new chat is listed in the sidebar and reopens with its text', async ({ page }) => {
  await openApp(page);
  await composer(page).fill('An idea for a new chat');
  const unsent = page.getByRole('region', { name: 'Unsent new chat' });
  await expect(unsent).toHaveCount(0);

  await open(page, 'Chat A');
  await expect(unsent).toBeVisible();
  await expect(unsent).toContainText('An idea for a new chat');
  await expect(composer(page)).toHaveValue('');

  await unsent.getByRole('button').click();
  await expect(page).toHaveURL(/\/$/);
  await expect(composer(page)).toHaveValue('An idea for a new chat');
  await expect(unsent).toHaveCount(0);
});

test('sending a message clears its draft', async ({ page, mockChat }) => {
  mockChat.next((stream) => {
    stream.send({ chunk: 'Got it.' });
    stream.saveMessages('Got it.');
    stream.end();
  });
  await openApp(page, { selectedModel: MODELS.deepseek }, `/${A}`);
  await composer(page).fill('Send this one');
  await page.keyboard.press('Enter');
  await expect(page.getByText('Got it.')).toBeVisible();
  await expect(composer(page)).toHaveValue('');

  await open(page, 'Chat B');
  await expect(row(page, 'Chat A')).not.toContainText('Draft');
  await page.reload();
  await expect(row(page, 'Chat A')).not.toContainText('Draft');
  await open(page, 'Chat A');
  await expect(composer(page)).toHaveValue('');
});

test('a draft that is deleted by hand disappears from the sidebar', async ({ page }) => {
  await openApp(page, {}, `/${A}`);
  await composer(page).fill('Never mind');
  await open(page, 'Chat B');
  await expect(row(page, 'Chat A')).toContainText('Draft');
  await open(page, 'Chat A');
  await composer(page).fill('');
  await open(page, 'Chat B');
  await expect(row(page, 'Chat A')).not.toContainText('Draft');
});
