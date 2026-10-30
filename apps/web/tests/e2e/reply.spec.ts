/**
 * Replies in a real browser with a scripted model stream: the thinking display
 * and the council card, including which thinking orb each part uses.
 */
import { deferred, expect, MODELS, openApp, sendMessage, test } from './support/fixtures';

const composing = 'canvas[aria-label="Composing…"]';
const searching = 'canvas[aria-label="Searching…"]';

test('shows the send arrow as soon as the answer ends, while saving continues', async ({ page, mockChat }) => {
  const finishSaving = deferred();
  mockChat.next(async (stream) => {
    stream.createConversation();
    stream.send({ chunk: 'Finished answer.' });
    stream.send({ done: true });
    await finishSaving.promise;
    stream.saveMessages('Finished answer.');
    stream.end();
  });

  await openApp(page);
  await sendMessage(page, 'Explain this');
  await expect(page.getByText('Finished answer.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Stop generating' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Queue message' })).toBeDisabled();

  finishSaving.resolve();
  await expect(page.getByRole('button', { name: 'Send message' })).toBeVisible();
});

test('sends the chosen model and thinking level, and shows the model thinking', async ({ page, mockChat }) => {
  const answerGate = deferred();
  const finishGate = deferred();
  mockChat.next(async (stream) => {
    stream.createConversation();
    stream.send({ reasoning: 'First, check whether the change is additive.' });
    await answerGate.promise;
    stream.send({ chunk: 'Add the column as nullable, then backfill.' });
    await finishGate.promise;
    stream.saveMessages('Add the column as nullable, then backfill.');
    stream.end();
  });

  await openApp(page, { selectedModel: MODELS.claude, thinkingLevel: 'xhigh' });
  await sendMessage(page, 'Plan a zero-downtime migration');

  await expect.poll(() => mockChat.requests[0]).toMatchObject({
    selectedModel: MODELS.claude,
    thinkingLevel: 'xhigh',
    newConversation: true,
  });

  const log = page.getByRole('log').or(page.locator('main'));
  const thinking = log.getByRole('button', { name: /^Thinking · \d+s/ });
  await expect(thinking).toBeVisible();
  await expect(thinking.locator(composing)).toHaveCount(1);
  await expect(log.getByText('First, check whether the change is additive.')).toBeVisible();

  answerGate.resolve();
  const thought = log.getByRole('button', { name: /^Thought for \d+s/ });
  await expect(thought).toBeVisible();
  await expect(thought).toHaveAttribute('aria-expanded', 'false');
  await expect(log.getByText('Add the column as nullable, then backfill.')).toBeVisible();

  // Can be reopened.
  await thought.click();
  await expect(log.getByText('First, check whether the change is additive.')).toBeVisible();
  finishGate.resolve();
  await expect(page.getByRole('button', { name: 'Send message' })).toBeVisible();
});

test('the council uses the composing orb, members answering on their own use searching', async ({ page, mockChat }) => {
  const [gpt, gemini, claude] = [MODELS.gpt, MODELS.gemini, MODELS.claude];
  const stage2 = deferred();
  const stage3 = deferred();
  const finish = deferred();
  const progress = (stage: string, model: string, value: number) => ({ status: 'progress', stage, model, progress: value });

  mockChat.next(async (stream) => {
    stream.createConversation();
    for (const m of [gpt, gemini, claude]) stream.send(progress('stage1', m, 0));
    stream.send(progress('stage1', gpt, 100));
    stream.send({ councilAnswer: { model: gpt, response: 'GPT: expand and contract.' } });
    await stage2.promise;
    stream.send(progress('stage1', gemini, 100));
    stream.send({ councilAnswer: { model: gemini, response: 'Gemini: batch the backfill.' } });
    stream.send(progress('stage1', claude, -1));
    stream.send(progress('stage2', gpt, 0));
    await stage3.promise;
    stream.send(progress('stage2', gpt, 100));
    stream.send(progress('stage2', gemini, 100));
    stream.send({ councilRankings: [{ model: gemini, averageRank: 1.5 }, { model: gpt, averageRank: 1.5 }] });
    stream.send(progress('stage3', claude, 0));
    await finish.promise;
    stream.send({ chunk: 'Chair: batch it, then expand and contract.' });
    stream.send(progress('stage3', claude, 100));
    stream.saveMessages('Chair: batch it, then expand and contract.');
    stream.end();
  });

  await openApp(page, { councilSettings: JSON.stringify({ enabled: true, members: [gpt, gemini, claude], chair: claude }), thinkingLevel: 'high' });
  await sendMessage(page, 'How should I migrate this table?');

  await expect.poll(() => mockChat.requests[0]).toMatchObject({
    selectedModel: 'council',
    thinkingLevel: 'high',
    council: { members: [gpt, gemini, claude], chair: claude },
  });

  // The innermost element holding both the heading and the step list.
  const card = page.locator('div')
    .filter({ has: page.getByRole('heading', { name: 'Council is deliberating' }) })
    .filter({ has: page.locator('ol') })
    .last();
  await expect(card).toBeVisible();
  // Header: the council as a whole is composing.
  await expect(card.locator(`${composing}`).first()).toBeVisible();
  await expect(card.getByText(/Step 1 of 3 · Independent answers/)).toBeVisible();

  const step1 = card.locator('li').filter({ hasText: 'Independent answers' }).first();
  // Independent answers: the step and each working member use searching.
  const memberRow = (name: string) => step1.locator('li').filter({ hasText: name });
  await expect(memberRow('Gemini 4 Argon').locator(searching)).toHaveCount(1);
  await expect(memberRow('Claude Sonnet 5.5').locator(searching)).toHaveCount(1);
  await expect(memberRow('GPT-6.1 Sol').locator('canvas')).toHaveCount(0);
  await expect(memberRow('GPT-6.1 Sol')).toContainText('Done');
  await expect(card.locator(composing)).toHaveCount(1);

  stage2.resolve();
  await expect(card.getByText(/Step 2 of 3 · Peer review/)).toBeVisible();
  await expect(card.getByText('2 of 3 members answered · 1 skipped')).toBeVisible();

  stage3.resolve();
  await expect(card.getByText(/Step 3 of 3 ·/)).toBeVisible();
  await expect(card.getByText('Chair · Claude Sonnet 5.5')).toBeVisible();

  finish.resolve();
  await expect(page.getByRole('heading', { name: 'Council is deliberating' })).toHaveCount(0);
  await expect(page.getByText('Chair: batch it, then expand and contract.')).toBeVisible();

  const summary = page.getByRole('button', { name: /Council of 2 · ranked .* first/ });
  await expect(summary).toBeVisible();
  await summary.click();
  await page.getByRole('button', { name: /Gemini 4 Argon.*Rank/ }).click();
  await expect(page.getByText('Gemini: batch the backfill.')).toBeVisible();
});
