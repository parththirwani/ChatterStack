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
  await page.route(`**/api/documents/${id}/content?preview=1`, async (route) => {
    await route.fulfill({ contentType: 'text/plain', body: '# Project plan' });
  });

  await openApp(page);
  await page.getByRole('tab', { name: 'Resources' }).click();
  await page.getByRole('button', { name: 'Preview plan.md' }).click();
  await expect(page.getByRole('dialog', { name: 'plan.md' })).toBeVisible();
  await expect(page.getByText('# Project plan')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Download plan.md' })).toHaveAttribute('href', `/api/documents/${id}/content`);
  await page.getByRole('button', { name: 'Close preview' }).click();
  await page.getByRole('button', { name: 'Favourite plan.md' }).click();
  await expect(page.getByRole('button', { name: 'Unfavourite plan.md' })).toBeVisible();
  await page.getByRole('button', { name: 'Add plan.md to chat' }).click();
  await expect(page.getByRole('button', { name: 'Remove plan.md' })).toBeVisible();
  await page.getByRole('button', { name: 'Add plan.md to chat' }).click();
  await expect(page.locator('#chat-sidebar').getByRole('alert')).toContainText('already has that file');
});

test('Resources previews images and PDFs in the dialog', async ({ page }) => {
  await page.route('**/api/documents', async (route) => {
    await route.fulfill({ json: { documents: [
      { id: 'image', name: 'image.png', mimeType: 'image/png', size: 67, createdAt: new Date().toISOString(), lastUsedAt: null, favoritedAt: null },
      { id: 'pdf', name: 'report.pdf', mimeType: 'application/pdf', size: 24, createdAt: new Date().toISOString(), lastUsedAt: null, favoritedAt: null },
    ] } });
  });
  await page.route('**/api/documents/image/content?preview=1', async (route) => {
    await route.fulfill({ contentType: 'image/png', body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jR5kAAAAASUVORK5CYII=', 'base64') });
  });
  await page.route('**/api/documents/pdf/content?preview=1', async (route) => {
    await route.fulfill({ contentType: 'application/pdf', body: '%PDF-1.4\n%%EOF' });
  });

  await openApp(page);
  await page.getByRole('tab', { name: 'Resources' }).click();
  await page.getByRole('button', { name: 'Preview image.png' }).click();
  await expect(page.getByRole('dialog', { name: 'image.png' }).getByRole('img', { name: 'image.png' })).toBeVisible();
  await page.getByRole('button', { name: 'Close preview' }).click();
  await page.getByRole('button', { name: 'Preview report.pdf' }).click();
  await expect(page.getByRole('dialog', { name: 'report.pdf' }).getByTitle('Preview of report.pdf')).toBeVisible();
});
