/**
 * Optional smoke test against the real OpenRouter models (costs a few cents).
 * Run with E2E_LIVE=1.
 */
import { conversationRow } from './support/db';
import { expect, MODELS, openApp, sendMessage, sidebar, test } from './support/fixtures';

test.skip(!process.env.E2E_LIVE, 'Set E2E_LIVE=1 to call the real models');
test.setTimeout(120_000);

test('real chat: listed immediately, titled by the small model, answered in the background', async ({ page }) => {
  const question = 'In two sentences, what does the TCP slow start algorithm do?';
  await openApp(page, { selectedModel: MODELS.deepseek, thinkingLevel: 'off' });

  const started = Date.now();
  await sendMessage(page, question);
  const row = sidebar.chats(page).getByRole('listitem').first();
  await expect(row.getByRole('button', { name: /, generating$/ })).toBeVisible({ timeout: 1_000 });
  expect(Date.now() - started).toBeLessThan(1_500);

  await expect(page).toHaveURL(/\/[0-9a-f-]{36}$/, { timeout: 10_000 });
  const id = page.url().split('/').pop()!;

  await page.getByRole('button', { name: 'New chat', exact: true }).first().click();
  await expect(row.getByRole('button', { name: /, generating$/ })).toBeVisible();

  await expect.poll(() => conversationRow(id)?.title, { timeout: 20_000 }).toBeTruthy();
  const title = conversationRow(id)!.title!;
  expect(title).not.toBe(question);
  expect(title.length).toBeLessThanOrEqual(80);

  await expect(row.locator('canvas')).toHaveCount(0, { timeout: 90_000 });
  await expect(row.getByRole('button', { name: title, exact: true })).toBeVisible();
});
