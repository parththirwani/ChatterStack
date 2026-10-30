/**
 * Composer controls in a real browser: thinking has its own dropdown with
 * per-model levels, menus open below their trigger, council settings are
 * themed, and nothing overlaps on a phone.
 */
import { expect, MODELS, openApp, test } from './support/fixtures';
import type { Locator, Page } from '@playwright/test';

const modelButton = (page: Page) => page.getByRole('button', { name: /^Model:|^Council settings$/ });
const thinkingButton = (page: Page) => page.getByRole('button', { name: /^Thinking:/ });
const levelNames = (listbox: Locator) =>
  listbox.getByRole('option').evaluateAll((options) => options.map((o) => o.querySelector('div > div')?.textContent));

async function box(locator: Locator) {
  const b = await locator.boundingBox();
  expect(b).not.toBeNull();
  return b!;
}

test.describe('thinking level', () => {
  test('is its own dropdown next to the model picker, not inside the model menu', async ({ page }) => {
    await openApp(page, { selectedModel: MODELS.claude });
    await expect(thinkingButton(page)).toHaveAccessibleName('Thinking: Medium');

    await modelButton(page).click();
    const modelMenu = page.getByRole('dialog', { name: 'Model settings' });
    await expect(modelMenu).toBeVisible();
    // No thinking control in the model menu (model descriptions may still mention thinking).
    await expect(modelMenu.getByRole('listbox', { name: /thinking/i })).toHaveCount(0);
    await expect(modelMenu.getByRole('button', { name: /thinking/i })).toHaveCount(0);
    await page.keyboard.press('Escape');

    // Side by side, on the same row.
    const model = await box(modelButton(page));
    const thinking = await box(thinkingButton(page));
    expect(Math.abs(model.y + model.height / 2 - (thinking.y + thinking.height / 2))).toBeLessThan(2);
    expect(thinking.x).toBeGreaterThanOrEqual(model.x + model.width);
  });

  test('offers the levels OpenRouter supports for each model, beyond High', async ({ page }) => {
    await openApp(page, { selectedModel: MODELS.claude });
    await thinkingButton(page).click();
    await expect.poll(() => levelNames(page.getByRole('listbox', { name: 'Thinking' }))).toEqual(['Low', 'Medium', 'High', 'Extra high', 'Max']);
    await page.keyboard.press('Escape');

    await modelButton(page).click();
    await page.getByRole('button', { name: /^Google,/ }).click();
    await page.getByRole('option', { name: /Gemini 4 Argon/ }).click();
    await thinkingButton(page).click();
    await expect.poll(() => levelNames(page.getByRole('listbox', { name: 'Thinking' }))).toEqual(['Low', 'Medium', 'High']);
  });

  test('remembers the chosen level after a reload', async ({ page }) => {
    await openApp(page, { selectedModel: MODELS.gpt });
    await thinkingButton(page).click();
    await page.getByRole('option', { name: /^Max/ }).click();
    await expect(thinkingButton(page)).toHaveAccessibleName('Thinking: Max');
    await page.reload();
    await expect(thinkingButton(page)).toHaveAccessibleName('Thinking: Max');
  });
});

test.describe('dropdown placement', () => {
  for (const [name, open, menu] of [
    ['model menu', modelButton, (page: Page) => page.locator('#chat-model-menu')],
    ['thinking menu', thinkingButton, (page: Page) => page.locator('#thinking-menu').locator('xpath=ancestor-or-self::*[@data-popover-menu][1]')],
  ] as const) {
    test(`the ${name} opens below its button`, async ({ page }) => {
      await openApp(page, { selectedModel: MODELS.claude });
      const trigger = await box(open(page));
      await open(page).click();
      const panel = await box(menu(page));
      expect(panel.y).toBeGreaterThanOrEqual(trigger.y + trigger.height);
      // Fully on screen.
      expect(panel.y + panel.height).toBeLessThanOrEqual(page.viewportSize()!.height);
    });
  }

  test('the council menu opens below too', async ({ page }) => {
    await openApp(page, { councilSettings: JSON.stringify({ enabled: true, members: Object.values(MODELS), chair: MODELS.gemini }) });
    const trigger = await box(modelButton(page));
    await modelButton(page).click();
    const panel = await box(page.locator('#chat-model-menu'));
    expect(panel.y).toBeGreaterThanOrEqual(trigger.y + trigger.height);
  });
});

test.describe('council settings', () => {
  test('turning council on shows member and chair settings', async ({ page }) => {
    await openApp(page, { selectedModel: MODELS.gpt });
    await page.getByRole('button', { name: /Council/, pressed: false }).click();
    await expect(page.getByRole('button', { name: /Council/, pressed: true })).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'Message' })).toHaveAttribute('placeholder', 'Ask the council anything');

    await modelButton(page).click();
    const dialog = page.getByRole('dialog', { name: 'Council settings' });
    // Providers first; rows with members name them. Any model can join.
    const providers = dialog.getByRole('list', { name: 'Providers' });
    await expect(providers.getByRole('button', { name: /, members / })).not.toHaveCount(0);
    await providers.getByRole('button', { name: /^OpenAI,/ }).click();
    const members = dialog.getByRole('group', { name: 'Council members' });
    expect(await members.getByRole('checkbox').count()).toBeGreaterThan(1);
    await dialog.getByRole('button', { name: 'Back to providers from OpenAI' }).click();
    await expect(providers).toBeVisible();
    await expect(dialog.getByRole('button', { name: /Chair/ })).toBeVisible();
  });

  test('the chair picker is a themed list, not the native select', async ({ page }) => {
    await openApp(page, { councilSettings: JSON.stringify({ enabled: true, members: [MODELS.gpt, MODELS.gemini, MODELS.claude], chair: MODELS.gemini }) });
    await modelButton(page).click();
    const dialog = page.getByRole('dialog', { name: 'Council settings' });
    await expect(dialog.locator('select')).toHaveCount(0);

    await dialog.getByRole('button', { name: /Chair/ }).click();
    const list = dialog.getByRole('listbox', { name: 'Chair' });
    await expect(list.getByRole('option')).toHaveText(['GPT-6.1 Sol', 'Gemini 4 Argon', 'Claude Sonnet 5.5']);

    // Dark like the menu around it, with light text.
    const [background, text] = await list.getByRole('option').first().evaluate((option) => {
      let node: Element | null = option;
      let bg = 'rgba(0, 0, 0, 0)';
      while (node && (bg === 'rgba(0, 0, 0, 0)' || bg === 'transparent')) {
        bg = getComputedStyle(node).backgroundColor;
        node = node.parentElement;
      }
      return [bg, getComputedStyle(option).color];
    });
    const luminance = (rgb: string) => {
      const [r, g, b] = rgb.match(/\d+(\.\d+)?/g)!.map(Number);
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    expect(luminance(background)).toBeLessThan(60);
    expect(luminance(text)).toBeGreaterThan(150);

    await list.getByRole('option', { name: 'Claude Sonnet 5.5' }).click();
    await expect(dialog.getByRole('button', { name: /Chair/ })).toContainText('Claude Sonnet 5.5');
  });

  test('in council mode the thinking menu says which members use a lower level', async ({ page }) => {
    await openApp(page, {
      councilSettings: JSON.stringify({ enabled: true, members: Object.values(MODELS), chair: MODELS.gemini }),
      thinkingLevel: 'max',
    });
    await thinkingButton(page).click();
    await expect(page.getByText('Gemini 4 Argon uses High.')).toBeVisible();
  });
});

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('model and thinking controls do not overlap and stay inside the composer', async ({ page }) => {
    await openApp(page, { selectedModel: MODELS.claude, thinkingLevel: 'xhigh' });
    const model = await box(modelButton(page));
    const thinking = await box(thinkingButton(page));
    const send = await box(page.getByRole('button', { name: 'Send message' }));
    expect(model.x + model.width).toBeLessThanOrEqual(thinking.x + 0.5);
    expect(thinking.x + thinking.width).toBeLessThanOrEqual(send.x + 0.5);
    expect(send.x + send.width).toBeLessThanOrEqual(390);
  });
});
