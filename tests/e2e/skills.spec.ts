import { expect, openApp, test } from './support/fixtures';
import { E2E_USER_ID, literal, sql } from './support/db';

const SKILL_ID = '5b1f6c2a-7d3e-4f1a-9c2b-1e2d3c4b5a69';

function seedSkill(name = 'code-review', description = 'Review code and list bugs by severity.') {
  sql(`INSERT INTO skills (id, "userId", name, description, instructions, source, "createdAt", "updatedAt")
       VALUES (${literal(SKILL_ID)}, ${literal(E2E_USER_ID)}, ${literal(name)}, ${literal(description)}, 'List bugs by severity.', 'created', now(), now())`);
}

test.beforeEach(() => {
  sql(`DELETE FROM skills WHERE "userId" = ${literal(E2E_USER_ID)}`);
});

test('creates, exports, imports and deletes skills from the Skills tab', async ({ page }) => {
  await openApp(page);
  await page.getByRole('tab', { name: 'Skills' }).click();
  await expect(page.getByText(/Skills are reusable instructions/)).toBeVisible();

  await page.getByRole('button', { name: 'New skill' }).click();
  const editor = page.getByRole('dialog', { name: 'New skill' });
  await editor.getByLabel('Name').fill('Release Notes');
  await editor.getByLabel('Description').fill('Write release notes in our house style.');
  await editor.getByLabel('Instructions').fill('Lead with user-facing changes.');
  await expect(editor.getByLabel('Name')).toHaveValue('release-notes'); // normalized on blur
  await editor.getByRole('button', { name: 'Create skill' }).click();
  await expect(editor).toBeHidden();
  await expect(page.getByRole('button', { name: 'Edit release-notes' }).first()).toBeVisible();

  const href = await page.getByRole('link', { name: 'Export release-notes' }).getAttribute('href');
  const exported = await page.request.get(href!);
  expect(exported.headers()['content-disposition']).toContain('release-notes.SKILL.md');
  const file = await exported.text();
  expect(file).toBe('---\nname: release-notes\ndescription: "Write release notes in our house style."\n---\n\nLead with user-facing changes.\n');

  // Importing the same name shows the conflict, and renaming fixes it.
  await page.getByRole('button', { name: 'Import' }).click();
  await page.getByRole('dialog', { name: 'Import a skill' }).getByLabel('Skill file text').fill(file);
  await page.getByRole('button', { name: 'Continue' }).click();
  const review = page.getByRole('dialog', { name: 'Review imported skill' });
  await review.getByRole('button', { name: 'Create skill' }).click();
  await expect(review.getByRole('alert')).toContainText('already exists');
  await review.getByLabel('Name').fill('release-notes-copy');
  await review.getByRole('button', { name: 'Create skill' }).click();
  await expect(review).toBeHidden();
  await expect(page.getByText('Imported', { exact: true })).toBeVisible();
  expect(sql(`SELECT name || ':' || source FROM skills WHERE "userId" = ${literal(E2E_USER_ID)} ORDER BY name`))
    .toBe('release-notes:created\nrelease-notes-copy:imported');

  await page.getByRole('button', { name: 'Delete release-notes-copy' }).click();
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Edit release-notes-copy' })).toHaveCount(0);
});

test('drafts a skill with the skill creator', async ({ page }) => {
  let requestBody: unknown;
  await page.route('**/api/skills/generate', async (route) => {
    requestBody = route.request().postDataJSON();
    await route.fulfill({ json: {
      draft: { name: 'haiku-writer', description: 'Answers as a haiku.', instructions: 'Reply in 5-7-5 syllables.' },
      issues: [],
    } });
  });
  await openApp(page);
  await page.getByRole('tab', { name: 'Skills' }).click();
  await page.getByRole('button', { name: 'New skill' }).click();
  const editor = page.getByRole('dialog', { name: 'New skill' });
  await editor.getByLabel('Skill creator').fill('Make every answer a haiku');
  await editor.getByRole('button', { name: 'Draft with AI' }).click();
  await expect(editor.getByLabel('Name')).toHaveValue('haiku-writer');
  expect(requestBody).toEqual({ request: 'Make every answer a haiku' });
  await editor.getByRole('button', { name: 'Create skill' }).click();
  await expect(editor).toBeHidden();
  expect(sql(`SELECT source FROM skills WHERE "userId" = ${literal(E2E_USER_ID)}`)).toBe('generated');
});

test('tags a skill with / and sends it with the message', async ({ page, mockChat }) => {
  seedSkill();
  await openApp(page);
  const input = page.getByRole('textbox', { name: 'Message' });
  await input.pressSequentially('Check my function /code');
  const option = page.getByRole('option', { name: /code-review/ });
  await expect(option).toBeVisible();
  await expect(option).toContainText('Review code and list bugs by severity.');
  await input.press('Enter');
  await expect(input).toHaveValue('Check my function ');
  await expect(page.getByRole('button', { name: 'Remove skill code-review' })).toBeVisible();

  mockChat.next((stream) => {
    stream.createConversation();
    stream.send({ chunk: 'No bugs found.' });
    stream.saveMessages('No bugs found.');
    stream.end();
  });
  await input.press('Enter');

  await expect(page.getByText('No bugs found.')).toBeVisible();
  expect((mockChat.requests[0] as unknown as { skills: string[] }).skills).toEqual([SKILL_ID]);
  await expect(page.getByRole('list', { name: 'Skills used' })).toHaveText('/code-review');
  await expect(page.getByRole('button', { name: 'Remove skill code-review' })).toHaveCount(0);
});

test('the Skills tab tags a skill on the open composer', async ({ page }) => {
  seedSkill();
  await openApp(page);
  await page.getByRole('tab', { name: 'Skills' }).click();
  await page.getByRole('button', { name: 'Use code-review in chat' }).click();
  await expect(page.getByRole('button', { name: 'Remove skill code-review' })).toBeVisible();
  await page.getByRole('button', { name: 'Use code-review in chat' }).click();
  await expect(page.locator('#chat-sidebar').getByRole('alert')).toContainText('already has that skill');
});
