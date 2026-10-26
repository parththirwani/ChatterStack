/**
 * The left rail in a real browser: the lines down the side of a chat, the
 * question/answer preview on hover, and the smooth jump when one is clicked.
 */
import type { Page } from '@playwright/test';
import { seedConversation } from './support/db';
import { deferred, expect, openApp, sendMessage, test } from './support/fixtures';

const CHAT = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const SINGLE = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

const rail = (page: Page) => page.getByRole('navigation', { name: 'Jump to question' });
const tick = (page: Page, number: number) =>
  rail(page).getByRole('button', { name: new RegExp(`^Question ${number} of `) });
const preview = (page: Page) => page.locator('.turn-preview');
const scroller = (page: Page) => page.locator('#chat-main .overflow-y-auto');

/** Long enough that the chat has to scroll, and each answer is many screens. */
const pages = (label: string, sentences: number) =>
  Array.from(
    { length: sentences },
    (_, i) =>
      `${label} point ${i}: the pipeline rebuilds every layer, so **cold** caches cost \`npm ci\` on each commit and the suite waits for all of it.`
  ).join('\n\n');

const QUESTIONS = [
  'Why is our build slow on CI but fast on my laptop?',
  'What should I change first so the queue stops blocking deploys?',
  'How do I keep the test suite honest without slowing it down again?',
];

test.beforeEach(() => {
  seedConversation({
    id: CHAT,
    title: 'Build performance review',
    updated: 5,
    messages: QUESTIONS.flatMap((question, i) => [
      { role: 'user' as const, content: question },
      { role: 'assistant' as const, content: pages(`Answer ${i + 1}`, 14) },
    ]),
  });
  seedConversation({
    id: SINGLE,
    title: 'Single question',
    updated: 6,
    messages: [{ role: 'user', content: 'Just one thing' }, { role: 'assistant', content: 'And one answer' }],
  });
});

/** Counts the scroll events the chat fires while it animates to a question. */
async function watchScrolls(page: Page) {
  await page.evaluate(() => {
    const scroller = document.querySelector<HTMLElement>('#chat-main .overflow-y-auto');
    const w = window as unknown as { __scrolls: number; __seen: number[] };
    w.__scrolls = 0;
    w.__seen = [];
    scroller?.addEventListener(
      'scroll',
      () => {
        w.__scrolls += 1;
        w.__seen.push(Math.round(scroller.scrollTop));
      },
      { passive: true }
    );
  });
}

const readScrollEvents = (page: Page) =>
  page.evaluate(() => (window as unknown as { __scrolls: number }).__scrolls);
const readScrollPath = (page: Page) =>
  page.evaluate(() => (window as unknown as { __seen: number[] }).__seen);

/** Waits until the chat stops moving, so the jump has finished animating. */
async function scrollSettled(page: Page) {
  await expect
    .poll(
      async () => {
        const before = await scroller(page).evaluate((node) => node.scrollTop);
        await page.waitForTimeout(150);
        const after = await scroller(page).evaluate((node) => node.scrollTop);
        return before === after ? Math.round(after) : -1;
      },
      { timeout: 10_000 }
    )
    .toBeGreaterThan(-1);
}

test('a chat with several questions gets one line per question', async ({ page }) => {
  await openApp(page, {}, `/${CHAT}`);

  await expect(rail(page)).toBeVisible();
  await expect(rail(page).getByRole('button')).toHaveCount(3);
  await expect(tick(page, 1)).toHaveAccessibleName(`Question 1 of 3: ${QUESTIONS[0]}`);
  await expect(page.locator('[data-turn-anchor]')).toHaveCount(3);

  // The chat opens at the bottom, so the last question is the one in view.
  await expect(tick(page, 3)).toHaveAttribute('aria-current', 'true');
});

test('hovering a line shows what was asked and what was answered', async ({ page }) => {
  await openApp(page, {}, `/${CHAT}`);

  await tick(page, 2).hover();

  await expect(preview(page)).toBeVisible();
  await expect(preview(page).locator('p').first()).toContainText('What should I change first');
  await expect(preview(page).locator('p').last()).toContainText('Answer 2 point 0');
  // The card is plain prose: the answer's markdown markers are gone.
  await expect(preview(page)).not.toContainText('**');
  await expect(preview(page)).not.toContainText('`');

  // It sits beside the rail and stays on screen.
  const box = await preview(page).boundingBox();
  const viewport = page.viewportSize();
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x).toBeLessThan(viewport.width / 2);
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);

  // Moving off the rail closes it.
  await page.mouse.move(viewport.width / 2, viewport.height / 2);
  await expect(preview(page)).toHaveCount(0);
});

test('hovering a line the model is still answering says so', async ({ page, mockChat }) => {
  mockChat.next(async (stream) => {
    stream.createConversation();
    stream.send({ chunk: 'Because the cache is cold.' });
    stream.saveMessages('Because the cache is cold.');
    stream.end();
  });

  await openApp(page);
  await sendMessage(page, QUESTIONS[0]);
  await expect(page.getByText('Because the cache is cold.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Send message' })).toBeVisible();

  const thinking = deferred();
  mockChat.next(async (stream) => {
    await thinking.promise;
    stream.send({ chunk: 'Start with the install step.' });
    stream.end();
  });
  await sendMessage(page, QUESTIONS[1]);

  // Two questions now, and the fresh one has no answer to show yet.
  await expect(rail(page).getByRole('button')).toHaveCount(2);
  await tick(page, 2).hover();
  await expect(preview(page)).toContainText('No answer yet.');

  // The open preview keeps up with the stream.
  thinking.resolve();
  await expect(preview(page)).toContainText('Start with the install step.');
});

test('clicking a line glides the chat to that question', async ({ page }) => {
  await openApp(page, {}, `/${CHAT}`);
  await expect(tick(page, 3)).toHaveAttribute('aria-current', 'true');
  await watchScrolls(page);

  await tick(page, 1).click();
  await scrollSettled(page);

  // It landed just below the top edge, with a little of the question above it.
  const offset = await page.evaluate(() => {
    const scroller = document.querySelector<HTMLElement>('#chat-main .overflow-y-auto');
    const anchor = scroller.querySelector<HTMLElement>('[data-turn-anchor="0"]');
    return anchor.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
  });
  expect(Math.abs(offset - 16)).toBeLessThanOrEqual(2);

  // The journey was animated: many positions on the way, not one jump.
  await expect.poll(() => readScrollEvents(page)).toBeGreaterThan(4);
  const path = await readScrollPath(page);
  expect(new Set(path).size).toBeGreaterThan(4);

  await expect(tick(page, 1)).toHaveAttribute('aria-current', 'true');
  await expect(tick(page, 3)).not.toHaveAttribute('aria-current');
});

test('the highlighted line follows the scroll', async ({ page }) => {
  await openApp(page, {}, `/${CHAT}`);
  const height = await scroller(page).evaluate((node) => node.scrollHeight);
  expect(height).toBeGreaterThan(1000);

  await scroller(page).evaluate((node) => {
    node.scrollTop = 0;
  });
  await expect(tick(page, 1)).toHaveAttribute('aria-current', 'true');

  await scroller(page).evaluate((node) => {
    node.scrollTop = node.scrollHeight;
  });
  await expect(tick(page, 3)).toHaveAttribute('aria-current', 'true');
});

test('the keyboard can walk the rail and jump between questions', async ({ page }) => {
  await openApp(page, {}, `/${CHAT}`);

  // The chat opens at the bottom, so the last line is the single tab stop.
  await expect(rail(page).locator('[tabindex="0"]')).toHaveCount(1);
  await tick(page, 3).focus();

  await page.keyboard.press('ArrowUp');
  await expect(tick(page, 2)).toBeFocused();
  await expect(preview(page)).toContainText('What should I change first');

  await page.keyboard.press('Enter');
  await scrollSettled(page);
  await expect(tick(page, 2)).toHaveAttribute('aria-current', 'true');

  await page.keyboard.press('Escape');
  await expect(preview(page)).toHaveCount(0);
});

test('a chat with one question, and a new chat, show no rail', async ({ page }) => {
  await openApp(page, {}, `/${SINGLE}`);
  await expect(rail(page)).toHaveCount(0);

  await openApp(page);
  await expect(rail(page)).toHaveCount(0);
});

test('the rail stays off narrow screens', async ({ page }) => {
  await page.setViewportSize({ width: 560, height: 900 });
  await openApp(page, {}, `/${CHAT}`);

  await expect(page.locator('[data-turn-anchor]')).toHaveCount(3);
  await expect(rail(page)).toBeHidden();
});
