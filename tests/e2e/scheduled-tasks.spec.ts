import { expect, openApp, test } from './support/fixtures';
import { E2E_USER_ID, literal, sql } from './support/db';

const TASK_ID = '7c0e2b9a-1f3d-4e5a-8b6c-2d4e6f8a0b1c';

const tasks = () => sql(`SELECT name || ':' || frequency || ':' || weekday || ':' || enabled || ':' || coalesce(to_char("nextRunAt" AT TIME ZONE 'UTC', 'Dy HH24:MI'), '-') FROM scheduled_tasks WHERE "userId" = ${literal(E2E_USER_ID)} ORDER BY name`);

test.beforeEach(() => {
  sql(`DELETE FROM scheduled_tasks WHERE "userId" = ${literal(E2E_USER_ID)}`);
});

test('creates, pauses, edits and deletes a scheduled task', async ({ page }) => {
  await openApp(page);
  await page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name: 'Scheduled' }).click();
  await expect(page).toHaveURL(/\/scheduled$/);
  await expect(page.getByRole('heading', { name: 'Scheduled tasks', level: 1 })).toBeVisible();
  await expect(page.getByText('No scheduled tasks yet')).toBeVisible();

  await page.getByRole('button', { name: 'New task' }).first().click();
  const dialog = page.getByRole('dialog', { name: 'New scheduled task' });
  // Required fields are checked before anything is sent.
  await dialog.getByRole('button', { name: 'Create' }).click();
  await expect(dialog.getByText('Give the task a name')).toBeVisible();

  await dialog.getByLabel('Name').fill('Weekly review');
  await dialog.getByLabel('Instructions').fill('List three things to review this week.');
  await dialog.getByLabel('Frequency').selectOption('weekdays');
  await dialog.getByLabel('Time').fill('08:15');
  await expect(dialog.getByText(/Next run: /)).toBeVisible();
  await dialog.getByRole('button', { name: 'Create' }).click();

  // A new task opens on its own page.
  await expect(page).toHaveURL(/\/scheduled\/[0-9a-f-]{36}$/);
  await expect(page.getByRole('heading', { name: 'Weekly review', level: 2 })).toBeVisible();
  await expect(page.getByText('Weekdays at 8:15 AM')).toBeVisible();
  await expect(page.getByText('No runs yet. Click Run now to try it.')).toBeVisible();

  const active = page.getByRole('switch', { name: 'Weekly review active' });
  await active.click();
  await expect(active).toHaveAttribute('aria-checked', 'false');
  await expect(page.getByText('Paused', { exact: true }).first()).toBeVisible();
  expect(tasks()).toBe('Weekly review:weekdays:1:false:-');
  await active.click();
  await expect(active).toHaveAttribute('aria-checked', 'true');

  await page.getByRole('button', { name: 'More options for Weekly review' }).click();
  await page.getByRole('menuitem', { name: 'Edit' }).click();
  const edit = page.getByRole('dialog', { name: 'Edit scheduled task' });
  await expect(edit.getByLabel('Name')).toHaveValue('Weekly review');
  await edit.getByLabel('Frequency').selectOption('weekly');
  await edit.getByLabel('Day').selectOption('Friday');
  await edit.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByText('Every Friday at 8:15 AM')).toBeVisible();
  expect(tasks()).toMatch(/^Weekly review:weekly:5:true:Fri /);

  await page.getByRole('link', { name: 'Scheduled tasks' }).click();
  await expect(page.getByRole('list', { name: 'Scheduled tasks' }).getByText('Every Friday at 8:15 AM')).toBeVisible();
  await page.getByRole('button', { name: 'View Weekly review' }).click();
  await page.getByRole('button', { name: 'More options for Weekly review' }).click();
  await page.getByRole('menuitem', { name: 'Delete' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Delete' }).click();
  await expect(page).toHaveURL(/\/scheduled$/);
  await expect(page.getByText('No scheduled tasks yet')).toBeVisible();
  expect(tasks()).toBe('');
});

test('lists runs, opens a run as a chat, and keeps run chats out of Recents', async ({ page }) => {
  sql(`INSERT INTO scheduled_tasks (id, "userId", name, prompt, model, frequency, timezone, "updatedAt")
       VALUES (${literal(TASK_ID)}, ${literal(E2E_USER_ID)}, 'Morning brief', 'Summarize the news.', 'anthropic/claude-sonnet-5.5', 'manual', 'UTC', now())`);
  sql(`INSERT INTO conversations (id, title, "userId", "scheduledTaskId", "createdAt", "updatedAt")
       VALUES ('8d1f3a5b-7c9e-4b2d-a6f8-0e2c4a6b8d0f', 'Morning brief', ${literal(E2E_USER_ID)}, ${literal(TASK_ID)}, now(), now())`);
  sql(`INSERT INTO messages (id, "conversationId", content, role, "createdAt", "updatedAt") VALUES
       ('m-sched-1', '8d1f3a5b-7c9e-4b2d-a6f8-0e2c4a6b8d0f', 'Summarize the news.', 'user', now(), now()),
       ('m-sched-2', '8d1f3a5b-7c9e-4b2d-a6f8-0e2c4a6b8d0f', 'Here is today''s brief.', 'assistant', now() + interval '1 ms', now())`);
  sql(`INSERT INTO scheduled_task_runs (id, "taskId", trigger, status, "conversationId", "startedAt", "finishedAt") VALUES
       ('r-ok', ${literal(TASK_ID)}, 'manual', 'succeeded', '8d1f3a5b-7c9e-4b2d-a6f8-0e2c4a6b8d0f', now() - interval '1 hour', now()),
       ('r-skip', ${literal(TASK_ID)}, 'schedule', 'skipped', NULL, now() - interval '2 hours', now())`);
  sql(`UPDATE scheduled_task_runs SET error = 'The previous run was still in progress.' WHERE id = 'r-skip'`);

  await openApp(page);
  const recents = page.getByRole('complementary', { name: 'Chat navigation' });
  await expect(recents.getByText('Morning brief')).toHaveCount(0);

  await page.goto(`/scheduled/${TASK_ID}`);
  const history = page.getByRole('region', { name: 'History' });
  await expect(history.getByText('Skipped')).toBeVisible();
  await expect(history.getByText(/The previous run was still in progress\./)).toBeVisible();
  await history.getByRole('button', { name: /^Open the run from/ }).click();
  await expect(page).toHaveURL(/\/8d1f3a5b-7c9e-4b2d-a6f8-0e2c4a6b8d0f$/);
  await expect(page.getByText("Here is today's brief.")).toBeVisible();
  // Opening it doesn't add it to Recents.
  await expect(recents.getByText('Morning brief')).toHaveCount(0);
});
