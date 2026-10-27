/**
 * Queue and steer in a real browser: messages sent while a reply streams wait
 * in a panel above the composer and go out in order; Steer interrupts.
 */
import { deferred, expect, openApp, sendMessage, test } from './support/fixtures';
import type { Page } from '@playwright/test';

const composer = (page: Page) => page.getByRole('textbox', { name: 'Message' });
const panel = (page: Page) => page.getByRole('region', { name: 'Queued messages' });

async function queue(page: Page, text: string) {
  await composer(page).fill(text);
  await composer(page).press('Enter');
}

test('queues messages while a reply streams and sends them in order', async ({ page, mockChat }) => {
  const first = deferred();
  mockChat.next(async (stream) => {
    stream.createConversation();
    stream.send({ chunk: 'Working on it…' });
    await first.promise;
    stream.end();
  });
  mockChat.next((stream) => {
    stream.send({ chunk: 'Second answer.' });
    stream.end();
  });

  await openApp(page);
  await sendMessage(page, 'Plan the migration');
  await expect(page.getByRole('button', { name: 'Stop generating' })).toBeVisible();

  await queue(page, 'i want to add features like queue and steer for the chat so when a message comes it gets queued and the user can decide');
  await expect(panel(page)).toBeVisible();
  await expect(panel(page).getByRole('button', { name: /Queued\s*1/ })).toBeVisible();
  await expect(composer(page)).toHaveValue('');
  // Empty composer while streaming: the button is Stop again.
  await expect(page.getByRole('button', { name: 'Stop generating' })).toBeVisible();
  await page.locator('.max-w-\\[720px\\]').first().screenshot({ path: 'test-results/queue-panel.png' });

  first.resolve();
  await expect(page.getByText('Second answer.')).toBeVisible();
  await expect(panel(page)).toHaveCount(0);
  expect(mockChat.requests.map((r) => r.message)).toEqual([
    'Plan the migration',
    expect.stringMatching(/^i want to add features/),
  ]);
});

test('Steer stops the current reply and sends the steered message', async ({ page, mockChat }) => {
  mockChat.next(async (stream) => {
    stream.createConversation();
    stream.send({ chunk: 'A long answer that will be cut short' });
    await new Promise(() => {}); // never finishes on its own
  });
  mockChat.next((stream) => {
    stream.send({ chunk: 'Steered answer.' });
    stream.end();
  });

  await openApp(page);
  await sendMessage(page, 'Write an essay');
  await expect(page.getByText('A long answer that will be cut short')).toBeVisible();
  await queue(page, 'Actually, keep it to one line');
  await panel(page).getByRole('button', { name: 'Steer' }).click();

  await expect(page.getByText('Steered answer.')).toBeVisible();
  await expect(page.getByText('A long answer that will be cut short')).toBeVisible();
  expect(mockChat.requests.map((r) => r.message)).toEqual(['Write an essay', 'Actually, keep it to one line']);
});
