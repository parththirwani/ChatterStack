import { expect, openApp, test } from './support/fixtures';

test('Resources can favourite a file and add it to the active chat', async ({ page }) => {
  const id = '0e7ba32e-05b0-477d-8e30-2bf0a849649e';
  let favorite: string | null = null;
  await page.route('**/api/documents', async (route) => {
    await route.fulfill({
      json: { documents: [{
        id, name: 'plan.md', mimeType: 'text/markdown', size: 2048,
        sha256: 'a'.repeat(64), createdAt: '2026-10-01T00:00:00.000Z',
        lastUsedAt: '2026-10-20T00:00:00.000Z', favoritedAt: favorite,
      }] },
    });
  });
  await page.route(`**/api/documents/${id}`, async (route) => {
    if (route.request().method() === 'PATCH') {
      favorite = JSON.parse(route.request().postData() ?? '{}').favorite ? new Date().toISOString() : null;
      await route.fulfill({ json: { document: { id, favoritedAt: favorite } } });
      return;
    }
    await route.fulfill({ status: 404 });
  });

  await openApp(page);
  await page.getByRole('tab', { name: 'Resources' }).click();
  await expect(page.getByRole('link', { name: 'plan.md' })).toBeVisible();
  await page.getByRole('button', { name: 'Favourite plan.md' }).click();
  await expect(page.getByRole('button', { name: 'Unfavourite plan.md' })).toBeVisible();
  await page.getByRole('button', { name: 'Add plan.md to chat' }).click();
  await expect(page.getByRole('button', { name: 'Remove plan.md' })).toBeVisible();
  await page.getByRole('button', { name: 'Add plan.md to chat' }).click();
  await expect(page.locator('#chat-sidebar').getByRole('alert')).toContainText('already has that file');
});
