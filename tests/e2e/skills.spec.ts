import { strToU8, zipSync, unzipSync, strFromU8 } from 'fflate';
import { deferred, expect, openApp, sendMessage, test } from './support/fixtures';
import { E2E_USER_ID, literal, sql } from './support/db';

const SKILL_ID = '5b1f6c2a-7d3e-4f1a-9c2b-1e2d3c4b5a69';

function seedSkill(name = 'code-review', description = 'Review code and list bugs by severity.', enabled = true) {
  sql(`INSERT INTO skills (id, "userId", name, description, instructions, source, enabled, "createdAt", "updatedAt")
       VALUES (${literal(SKILL_ID)}, ${literal(E2E_USER_ID)}, ${literal(name)}, ${literal(description)}, 'List bugs by severity.', 'created', ${enabled}, now(), now())`);
}
const skillRows = () => sql(`SELECT name || ':' || source || ':' || enabled FROM skills WHERE "userId" = ${literal(E2E_USER_ID)} ORDER BY name`);

test.beforeEach(() => {
  sql(`DELETE FROM skills WHERE "userId" = ${literal(E2E_USER_ID)}`);
});

test('the sidebar has rows, not tabs, and Customize opens the Skills page', async ({ page }) => {
  await openApp(page);
  const nav = page.getByRole('navigation', { name: 'Main' });
  await expect(nav.getByRole('button')).toHaveText(['New chat', /Search/, 'Resources', 'Customize']);
  await expect(page.getByRole('tab')).toHaveCount(0);
  await nav.getByRole('button', { name: 'Customize' }).click();
  await expect(page).toHaveURL(/\/customize\/skills$/);
  await expect(page.getByRole('heading', { name: 'Customize', level: 1 })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Suggested skills' })).toBeVisible();
  // Reloading a page URL renders the same page.
  await page.reload();
  await expect(page.getByRole('radio', { name: 'Discover' })).toHaveAttribute('aria-checked', 'true');
});

test('uploads .md and .zip skills, keeps their files, and downloads them back', async ({ page }) => {
  await openApp(page);
  await page.goto('/customize/skills/new/upload');
  const md = '---\nname: style-guide\ndescription: Apply our writing style.\nlicense: MIT\n---\n\nUse short sentences.';
  const zip = zipSync({
    'brand-voice/SKILL.md': strToU8('---\nname: brand-voice\ndescription: Write in our brand voice.\n---\n\nBe warm.'),
    'brand-voice/references/words.md': strToU8('# Avoid\n\nsynergy'),
    'brand-voice/scripts/check.py': strToU8('print(1)'),
  });
  await page.getByLabel('Choose skill files').setInputFiles([
    { name: 'SKILL.md', mimeType: 'text/markdown', buffer: Buffer.from(md) },
    { name: 'brand-voice.zip', mimeType: 'application/zip', buffer: Buffer.from(zip) },
    { name: 'broken.skill', mimeType: 'application/octet-stream', buffer: Buffer.from('not a zip') },
  ]);
  await page.getByRole('button', { name: 'Upload' }).click();
  const results = page.getByRole('list', { name: 'Upload results' });
  await expect(results.getByText(/never run in ChatterStack: scripts\/check\.py/)).toBeVisible();
  await expect(results.getByText('The file is not a valid zip archive.')).toBeVisible();
  expect(skillRows()).toBe('brand-voice:uploaded:true\nstyle-guide:uploaded:true');

  await results.getByRole('button', { name: 'Open brand-voice' }).click();
  await page.getByRole('link', { name: 'Contents · 3' }).click();
  await page.getByRole('button', { name: 'references/words.md' }).click();
  await expect(page.getByRole('heading', { name: 'Avoid' })).toBeVisible();

  const id = page.url().split('/').at(-2)!;
  const download = await page.request.get(`/api/skills/${id}/download`);
  const entries = unzipSync(new Uint8Array(await download.body()));
  expect(Object.keys(entries).sort()).toEqual(['brand-voice/SKILL.md', 'brand-voice/references/words.md', 'brand-voice/scripts/check.py']);
  expect(strFromU8(entries['brand-voice/SKILL.md'])).toContain('name: brand-voice');
});

test('creates a skill in the dialog, turns it off and removes it', async ({ page }) => {
  await openApp(page);
  await page.goto('/customize/skills/yours');
  await page.getByRole('button', { name: 'Add skill' }).click();
  await page.getByRole('menuitem', { name: 'Create a skill' }).click();
  const dialog = page.getByRole('dialog', { name: 'Create a skill' });
  await dialog.getByLabel('Skill name').fill('Release Notes');
  await dialog.getByLabel('Description').fill('Write release notes for a changelog.');
  await dialog.getByLabel('Instructions').fill('Lead with user-facing changes.');
  await dialog.getByRole('button', { name: 'Add file' }).click();
  await dialog.getByLabel('File path').fill('templates/entry.md');
  await dialog.getByLabel('Contents of templates/entry.md').fill('## v1.0');
  await dialog.getByRole('button', { name: 'Create' }).click();
  await expect(dialog).toBeHidden();

  // Lands on the new skill's page.
  await expect(page.getByRole('heading', { name: 'release-notes' })).toBeVisible();
  await expect(page.getByText(/by you · v1/)).toBeVisible();
  await page.getByRole('switch', { name: 'release-notes' }).click();
  await expect(page.getByRole('switch', { name: 'release-notes' })).toHaveAttribute('aria-checked', 'false');
  expect(skillRows()).toBe('release-notes:created:false');

  await page.getByRole('button', { name: 'More options for release-notes' }).click();
  await page.getByRole('menuitem', { name: 'Remove' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Remove' }).click();
  await expect(page).toHaveURL(/\/customize\/skills\/yours$/);
  expect(skillRows()).toBe('');
});

test('Discover adds a suggested skill, and Try opens a chat with it tagged', async ({ page }) => {
  await openApp(page);
  await page.goto('/customize/skills');
  const suggested = page.getByRole('region', { name: 'Suggested skills' });
  await suggested.getByRole('button', { name: 'Add meeting-notes', exact: true }).click();
  await expect(suggested.getByLabel('meeting-notes added')).toBeVisible();
  await suggested.getByRole('button', { name: 'Add release-notes and try it in chat' }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole('textbox', { name: 'Message' })).toHaveValue('/release-notes ');
  await expect(page.locator('[data-skill-token="release-notes"]')).toBeVisible();
  expect(skillRows()).toBe('meeting-notes:catalog:true\nrelease-notes:catalog:true');
});

test('tags a skill inline with / and sends it with the message', async ({ page, mockChat }) => {
  seedSkill();
  await openApp(page);
  const input = page.getByRole('textbox', { name: 'Message' });
  await input.pressSequentially('Check my function /code');
  const option = page.getByRole('option', { name: /code-review/ });
  await expect(option).toContainText('Review code and list bugs by severity.');
  await input.press('Enter');
  await input.pressSequentially('please');
  await expect(input).toHaveValue('Check my function /code-review please');
  await expect(page.locator('[data-skill-token="code-review"]')).toBeVisible();

  mockChat.next((stream) => {
    stream.createConversation();
    stream.send({ chunk: 'No bugs found.' });
    stream.saveMessages('No bugs found.');
    stream.end();
  });
  await input.press('Enter');

  await expect(page.getByText('No bugs found.')).toBeVisible();
  expect(mockChat.requests[0].skills).toEqual([SKILL_ID]);
  expect(mockChat.requests[0].message).toBe('Check my function /code-review please');
  await expect(page.locator('#chat-main [data-skill-token="code-review"]')).toHaveCount(1);
});

test('turned-off skills are not offered in chat', async ({ page }) => {
  seedSkill('code-review', 'Review code.', false);
  await openApp(page);
  await page.getByRole('textbox', { name: 'Message' }).pressSequentially('/');
  await expect(page.getByRole('option', { name: /Add files/ })).toBeVisible();
  await expect(page.getByRole('option', { name: /code-review/ })).toHaveCount(0);
});

test('Create with AI starts a chat with skill-creator, and Save as skill keeps the draft', async ({ page, mockChat }) => {
  await openApp(page);
  await page.goto('/customize/skills/yours');
  await page.getByRole('button', { name: 'Add skill' }).click();
  await page.getByRole('menuitem', { name: 'Create with AI' }).click();
  const input = page.getByRole('textbox', { name: 'Message' });
  await expect(input).toHaveValue("Let's create a skill together using /skill-creator. First ask me what the skill should do.");
  await expect(page.locator('[data-skill-token="skill-creator"]')).toBeVisible();

  const draft = '---\nname: haiku-writer\ndescription: Answers as a haiku.\n---\n\nReply in 5-7-5 syllables.';
  mockChat.next((stream) => {
    stream.createConversation();
    stream.send({ chunk: `Here is your skill:\n\n\`\`\`markdown\n${draft}\n\`\`\`\n` });
    stream.saveMessages('done');
    stream.end();
  });
  await input.press('Enter');
  expect((await expect.poll(() => mockChat.requests.length).toBe(1), mockChat.requests[0].skills)).toHaveLength(1);

  await page.getByRole('button', { name: 'Save as skill' }).click();
  const dialog = page.getByRole('dialog', { name: 'Create a skill' });
  await expect(dialog.getByLabel('Skill name')).toHaveValue('haiku-writer');
  await dialog.getByRole('button', { name: 'Create' }).click();
  await expect(page.getByRole('heading', { name: 'haiku-writer' })).toBeVisible();
  expect(skillRows()).toBe('haiku-writer:generated:true\nskill-creator:catalog:true');
});

test('an open chat, even one still answering, is kept while Customize is open', async ({ page, mockChat }) => {
  await openApp(page);
  const done = deferred();
  mockChat.next(async (stream) => {
    stream.createConversation();
    stream.send({ chunk: 'First half, ' });
    await done.promise;
    stream.send({ chunk: 'second half.' });
    stream.saveMessages('First half, second half.');
    stream.end();
  });
  await sendMessage(page, 'Tell me something');
  await expect(page.getByText('First half,')).toBeVisible();
  await expect(page).toHaveURL(/\/[0-9a-f-]{36}$/);
  const chatUrl = page.url();

  await page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name: 'Customize' }).click();
  await expect(page.getByRole('heading', { name: 'Customize', level: 1 })).toBeVisible();
  // Like claude.ai, no chat is highlighted while a page is open.
  await expect(page.locator('#chat-sidebar [aria-current="page"]')).toHaveText('Customize');
  done.resolve();

  await page.goBack();
  await expect(page).toHaveURL(chatUrl);
  await expect(page.getByText('First half, second half.')).toBeVisible();
  await expect(page.getByRole('paragraph').filter({ hasText: 'Tell me something' })).toBeVisible();
});

test('unknown Customize and Resources paths are 404s', async ({ page }) => {
  for (const path of ['/customize/foo', '/resources/a/b', '/customize/skills/new', '/customize/skills/not-an-id']) {
    expect((await page.goto(path))?.status(), path).toBe(404);
  }
  expect((await page.goto(`/customize/skills/${SKILL_ID}/contents`))?.status()).toBe(200);
});
