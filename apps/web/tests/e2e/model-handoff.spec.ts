import { expect, MODELS, openApp, sendMessage, test } from './support/fixtures';
import { seedConversation } from './support/db';

const CHAT_ID = '22222222-2222-4222-8222-222222222222';

test.beforeEach(() => {
  seedConversation({
    id: CHAT_ID,
    title: 'Plan the cache',
    updated: 10,
    messages: [
      { role: 'user', content: 'How should we cache reads?' },
      { role: 'assistant', content: 'Start with an LRU cache.', modelId: MODELS.gpt },
    ],
  });
});

test('shows the handoff when a new model answers and keeps it after reload', async ({ page, mockChat }) => {
  await openApp(page, { selectedModel: MODELS.gpt }, `/${CHAT_ID}`);
  await expect(page.getByLabel(/Model changed from/)).toHaveCount(0);

  await page.getByRole('button', { name: 'Model: GPT-6.1 Sol' }).click();
  const picker = page.getByRole('dialog', { name: 'Model settings' });
  await picker.getByRole('button', { name: /^Anthropic,/ }).click();
  await picker.getByRole('option', { name: /Claude Sonnet 5.5/ }).click();
  await expect(page.getByLabel(/Model changed from/)).toHaveCount(0);

  mockChat.next((stream) => {
    stream.send({ chunk: 'Use a short TTL.' });
    stream.saveMessages('Use a short TTL.');
    stream.end();
  });
  await sendMessage(page, 'What about stale reads?');

  const handoff = page.getByLabel('Model changed from GPT-6.1 Sol to Claude Sonnet 5.5');
  await expect(handoff).toBeVisible();
  await expect(handoff).toContainText('Model changed');
  expect(await handoff.evaluate((element) => element.nextElementSibling?.getAttribute('data-turn-anchor'))).toBe('2');
  await expect(page.getByText('Use a short TTL.')).toBeVisible();
  expect(mockChat.requests.at(-1)?.selectedModel).toBe(MODELS.claude);

  await page.reload();
  await expect(handoff).toBeVisible();
  await expect(page.getByLabel(/Model changed from/)).toHaveCount(1);
});
