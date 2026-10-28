/**
 * Sidebar behaviour while chats stream: a new chat appears immediately, keeps
 * generating after "New chat", and gets a generated title.
 */
import { conversationRow, literal, sql } from './support/db';
import { deferred, expect, MODELS, openApp, sendMessage, sidebar, test } from './support/fixtures';

const QUESTION = 'Explain how TCP congestion control works, covering slow start and fast recovery';
const TITLE = 'TCP Congestion Control Explained';
const ANSWER = 'Slow start doubles the window every round trip until loss.';

test('a new chat shows in the sidebar right away, keeps streaming after New chat, then gets its title', async ({ page, mockChat }) => {
  const created = deferred();
  const titled = deferred();
  const finished = deferred();
  mockChat.next(async (stream) => {
    await created.promise;
    stream.createConversation();
    stream.send({ chunk: 'Slow start ' });
    await titled.promise;
    // Like the real route: save the title only if the chat is still untitled, then stream it.
    sql(`UPDATE conversations SET title = ${literal(TITLE)} WHERE id = ${literal(stream.body.conversationId!)} AND title IS NULL`);
    stream.send({ title: TITLE });
    await finished.promise;
    stream.send({ chunk: 'doubles the window every round trip until loss.' });
    stream.saveMessages(ANSWER);
    stream.end();
  });

  await openApp(page, { selectedModel: MODELS.deepseek, thinkingLevel: 'off' });
  await sendMessage(page, QUESTION);

  // Before the server has said anything, the chat is listed and generating.
  const row = sidebar.chats(page).getByRole('listitem').first();
  await expect(row).toContainText(QUESTION.slice(0, 30));
  await expect(row.getByRole('button', { name: /, generating$/ })).toBeVisible();
  await expect(row.locator('canvas')).toHaveCount(1);

  created.resolve();
  await expect(page).toHaveURL(new RegExp(`/${mockChat.requests[0].conversationId}$`));

  // Start another chat while the first is still writing.
  await page.getByRole('button', { name: 'New chat', exact: true }).first().click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole('textbox', { name: 'Message' })).toHaveValue('');
  await expect(sidebar.chats(page).getByRole('listitem')).toHaveCount(1);
  await expect(row.getByRole('button', { name: /, generating$/ })).toBeVisible();

  // The title is generated, not a copy of the message, and shows up live.
  titled.resolve();
  await expect(row.getByRole('button', { name: new RegExp(`^${TITLE} ?, generating$`) })).toBeVisible();

  finished.resolve();
  await expect(row.getByRole('button', { name: TITLE, exact: true })).toBeVisible();
  await expect(row.locator('canvas')).toHaveCount(0);
  expect(conversationRow(mockChat.requests[0].conversationId!)).toEqual({ title: TITLE, pinned: false });

  // It finished in the background: open it and the full answer is there.
  await row.getByRole('button', { name: TITLE, exact: true }).click();
  await expect(page.getByText(ANSWER)).toBeVisible();

  // And it survives a reload.
  await page.reload();
  await expect(page.getByText(ANSWER)).toBeVisible();
  await expect(sidebar.chats(page).getByRole('button', { name: TITLE, exact: true })).toBeVisible();
});

test('a failed send does not leave a phantom chat behind', async ({ page, mockChat }) => {
  mockChat.next((stream) => {
    stream.send({ error: 'Rate limit exceeded' });
    stream.end();
  });
  await openApp(page, { selectedModel: MODELS.deepseek });
  await sendMessage(page, 'This one fails');
  await expect(page.getByText('Rate limit exceeded')).toBeVisible();
  await expect(page.locator('section li')).toHaveCount(0);
  await expect(page).toHaveURL(/\/$/);
});
