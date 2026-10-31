/**
 * Forking a chat from a message, in a real browser: the menu on a saved message,
 * the copy the server makes, and the two chats carrying on separately afterwards.
 */
import type { Page } from '@playwright/test';
import { conversationRow, forksOf, messageCount, savedMessages, seedConversation } from './support/db';
import { deferred, expect, MODELS, openApp, sendMessage, sidebar, test } from './support/fixtures';

const SOURCE = '11111111-1111-4111-8111-111111111111';

const CHAT: Array<{ role: 'user' | 'assistant'; content: string; modelId?: string }> = [
  { role: 'user', content: 'How does write-back caching work?' },
  { role: 'assistant', content: 'It defers writes to memory first.', modelId: MODELS.claude },
  { role: 'user', content: 'What are the risks?' },
  { role: 'assistant', content: 'A crash before the write is lost.' },
];

/** A saved message's More actions button, found by the row id it belongs to. */
const menu = (page: Page, messageId: string) =>
  page.locator(`[data-message-id="${messageId}"]`).getByRole('button', { name: 'More message actions' });

const forkItem = (page: Page) => page.getByRole('menuitem', { name: 'Fork in new chat' });

/** Forks at the given saved message and returns the copy's id. */
async function forkAt(page: Page, messageId: string) {
  await menu(page, messageId).click();
  await forkItem(page).click();
  await expect.poll(() => forksOf(SOURCE)).toHaveLength(1);
  return forksOf(SOURCE)[0].id;
}

const openSource = (page: Page) =>
  page.getByRole('region', { name: 'Recents' }).getByRole('button', { name: 'Caching plan', exact: true }).click();

test.beforeEach(() => {
  seedConversation({ id: SOURCE, title: 'Caching plan', updated: 30, messages: CHAT });
});

test('forks at an answer, opens the copy, and leaves the source whole', async ({ page, mockChat }) => {
  await openApp(page, {}, `/${SOURCE}`);
  const rows = savedMessages(SOURCE);

  const forkId = await forkAt(page, rows[3].id);

  // The copy opens as its own chat: everything through the chosen answer, in order.
  await expect(page).toHaveURL(new RegExp(`/${forkId}$`));
  const origin = page.getByLabel('Continued from Caching plan');
  await expect(origin).toBeVisible();
  expect(await origin.evaluate((element) => element.closest('.overflow-y-auto'))).toBeNull();
  await expect(page.getByLabel('Forked chat')).toBeVisible();
  await expect(origin.getByRole('button', { name: 'Caching plan' })).toBeVisible();
  await expect(page.getByText('It defers writes to memory first.')).toBeVisible();
  await expect.poll(() => savedMessages(forkId).map((row) => row.content)).toEqual(CHAT.map((row) => row.content));
  await expect.poll(() => savedMessages(forkId).map((row) => row.position)).toEqual([1, 2, 3, 4]);

  // Its own title on top of Recents, unpinned, with the source still under it.
  await expect(sidebar.titles(page, 'Recents')).toHaveText(['Fork of Caching plan', 'Caching plan']);
  expect(conversationRow(forkId)).toEqual({ title: 'Fork of Caching plan', pinned: false });

  // It survives a reload with the same prefix.
  await page.reload();
  await expect(page.getByLabel('Continued from Caching plan')).toBeVisible();
  await expect(page.getByText('A crash before the write is lost.')).toBeVisible();

  await page.getByLabel('Continued from Caching plan').getByRole('button', { name: 'Caching plan' }).click();
  await expect(page).toHaveURL(new RegExp(`/${SOURCE}$`));
  await expect(page.getByLabel('Continued from Caching plan')).toHaveCount(0);
  await sidebar.titles(page, 'Recents').first().click();
  await expect(page).toHaveURL(new RegExp(`/${forkId}$`));

  // And it takes a new prompt, saving it into the copy only.
  mockChat.next(async (stream) => {
    stream.send({ chunk: 'Use a battery-backed cache.' });
    stream.saveMessages('Use a battery-backed cache.');
    stream.end();
  });
  await sendMessage(page, 'How do I reduce that risk?');
  await expect(page.getByText('Use a battery-backed cache.')).toBeVisible();

  await expect.poll(() => messageCount(forkId)).toBe(6);
  expect(messageCount(SOURCE)).toBe(4);
  expect(mockChat.requests.at(-1)).toMatchObject({ conversationId: forkId });
});

test('a fork at a question stops at the question, without its answer', async ({ page }) => {
  await openApp(page, {}, `/${SOURCE}`);
  const rows = savedMessages(SOURCE);

  const forkId = await forkAt(page, rows[2].id);

  await expect.poll(() => savedMessages(forkId).map((row) => row.role)).toEqual(['user', 'assistant', 'user']);
  await expect(page.getByText('A crash before the write is lost.')).toHaveCount(0);
});

test('two forks of one chat are separate chats, each with its own cut point', async ({ page }) => {
  await openApp(page, {}, `/${SOURCE}`);
  const rows = savedMessages(SOURCE);

  const first = await forkAt(page, rows[1].id);
  await openSource(page);
  await expect(page).toHaveURL(new RegExp(`/${SOURCE}$`));

  await menu(page, rows[0].id).click();
  await forkItem(page).click();
  await expect.poll(() => forksOf(SOURCE)).toHaveLength(2);

  const second = forksOf(SOURCE).find((row) => row.id !== first)!.id;
  expect(messageCount(first)).toBe(2);
  expect(messageCount(second)).toBe(1);
  expect(savedMessages(second)[0].content).toBe('How does write-back caching work?');
  expect(forksOf(SOURCE).map((row) => row.forkedFromMessageId).sort()).toEqual([rows[0].id, rows[1].id].sort());
});

test('forking an older message leaves the answer that is still streaming alone', async ({ page, mockChat }) => {
  await openApp(page, {}, `/${SOURCE}`);
  const rows = savedMessages(SOURCE);

  const hold = deferred();
  mockChat.next(async (stream) => {
    stream.send({ chunk: 'Read cache is the' });
    stream.send({ chunk: ' other half.' });
    await hold.promise;
    stream.saveMessages('Read cache is the other half.');
    stream.end();
  });
  await sendMessage(page, 'And read caching?');
  await expect(page.getByText('Read cache is the other half.')).toBeVisible();

  const forkId = await forkAt(page, rows[0].id);

  // The copy holds the first question only: the newer exchange never made it in.
  await expect.poll(() => savedMessages(forkId).map((row) => row.content)).toEqual(['How does write-back caching work?']);
  expect(messageCount(SOURCE)).toBe(4);

  // The source turn the fork walked away from still finishes and saves itself.
  hold.resolve();
  await expect.poll(() => messageCount(SOURCE)).toBe(6);
  await expect(page).toHaveURL(new RegExp(`/${forkId}$`));
});

test('deleting the source leaves its fork usable', async ({ page }) => {
  await openApp(page, {}, `/${SOURCE}`);
  const rows = savedMessages(SOURCE);
  const forkId = await forkAt(page, rows[1].id);

  const row = page.getByRole('region', { name: 'Recents' }).getByRole('button', { name: 'Caching plan', exact: true }).locator('..');
  await row.hover();
  await row.getByRole('button', { name: 'Actions for Caching plan' }).click();
  await page.getByRole('menuitem', { name: 'Delete' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Delete' }).click();

  await expect(sidebar.titles(page, 'Recents')).toHaveText(['Fork of Caching plan']);
  await page.reload();
  await page.goto(`/${forkId}`);
  await expect(page.getByText('It defers writes to memory first.')).toBeVisible();
  await expect(page.getByLabel('Continued from Caching plan')).toBeVisible();
  await expect(page.getByLabel('Continued from Caching plan').getByRole('button')).toHaveCount(0);
  expect(messageCount(forkId)).toBe(2);
});

test('a message written in this tab gets its menu as soon as it is saved', async ({ page, mockChat }) => {
  await openApp(page);
  mockChat.next(async (stream) => {
    stream.createConversation();
    stream.send({ chunk: 'An answer.' });
    stream.saveMessages('An answer.');
    stream.end();
  });
  await sendMessage(page, 'A fresh question');
  await expect(page.getByText('An answer.')).toBeVisible();

  await expect(page.getByRole('button', { name: 'More message actions' })).toHaveCount(2);
  const sourceId = page.url().split('/').at(-1)!;
  const rows = savedMessages(sourceId);
  await menu(page, rows[1].id).click();
  await forkItem(page).click();
  await expect.poll(() => forksOf(sourceId)).toHaveLength(1);
});
