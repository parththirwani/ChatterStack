/**
 * Account menu and the mock profile modal: the menu opens upward from the
 * sidebar footer, and saving name, bio, or photo changes what the menu shows.
 */
import { expect, openApp, test } from './support/fixtures';

// 1x1 blue PNG; the mock upload only needs any image bytes.
const AVATAR_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64'
);

const trigger = (page: import('@playwright/test').Page) =>
  page.getByRole('button', { name: /account menu/i });

async function openAccountMenu(page: import('@playwright/test').Page) {
  await trigger(page).click();
  const menu = page.getByRole('menu');
  await expect(menu).toBeVisible();
  return menu;
}

test('the account menu opens upward from the sidebar footer', async ({ page }) => {
  await openApp(page);

  const menu = await openAccountMenu(page);
  await expect(menu.getByRole('menuitem', { name: 'View profile' })).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: 'Sign out' })).toBeVisible();

  const menuBox = await menu.boundingBox();
  const triggerBox = await trigger(page).boundingBox();
  expect(menuBox).not.toBeNull();
  expect(triggerBox).not.toBeNull();
  // The panel sits above the trigger instead of overflowing past the viewport bottom.
  expect(menuBox!.y + menuBox!.height).toBeLessThanOrEqual(triggerBox!.y);
});

test('the profile modal saves name, bio, and photo to the mock profile', async ({ page }) => {
  await openApp(page);

  const menu = await openAccountMenu(page);
  await menu.getByRole('menuitem', { name: 'View profile' }).click();
  const dialog = page.getByRole('dialog', { name: 'Profile' });
  await expect(dialog).toBeVisible();

  // The sidebar's aside captures fixed overlays (it sets a CSS translate),
  // so the modal must portal out and center against the viewport, not the sidebar.
  const dialogBox = await dialog.boundingBox();
  const viewport = page.viewportSize()!;
  expect(dialogBox).not.toBeNull();
  expect(Math.abs(dialogBox!.x - (viewport.width - dialogBox!.width) / 2)).toBeLessThan(2);

  await dialog.getByRole('textbox', { name: 'Name' }).fill('Grace Hopper');
  await dialog.getByRole('textbox', { name: 'Bio' }).fill('Rear Admiral. Ships, software.');
  await dialog.getByRole('button', { name: 'Add photo' }).click();
  await page
    .getByLabel('Choose a profile picture')
    .setInputFiles({ name: 'avatar.png', mimeType: 'image/png', buffer: AVATAR_PNG });
  await expect(dialog.getByRole('img', { name: 'Grace Hopper avatar' })).toHaveAttribute('src', /^data:image\/png/);
  await expect(dialog.getByText('Rear Admiral. Ships, software.')).toBeVisible();

  await dialog.getByRole('button', { name: 'Save changes' }).click();
  await expect(dialog).toBeHidden();

  // The trigger reflects the saved profile...
  await expect(trigger(page)).toHaveAccessibleName(/Grace Hopper/);
  await expect(trigger(page).locator('img[src^="data:image/png"]')).toBeVisible();

  // ...and reopening the modal shows the stored bio.
  await openAccountMenu(page);
  await page.getByRole('menu').getByRole('menuitem', { name: 'View profile' }).click();
  await expect(dialog.getByRole('textbox', { name: 'Bio' })).toHaveValue('Rear Admiral. Ships, software.');
});

test('sign out routes to the logout confirmation', async ({ page }) => {
  await openApp(page);

  const menu = await openAccountMenu(page);
  await menu.getByRole('menuitem', { name: 'Sign out' }).click();
  await expect(page.getByRole('dialog', { name: 'Sign out?' })).toBeVisible();
});
