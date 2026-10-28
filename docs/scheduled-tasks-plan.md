# Scheduled tasks plan

A **scheduled task** is a saved prompt that ChatterStack runs on a schedule, such as "every weekday at 9:00, summarize the AI news I should know about". Each run is a new chat that the user can open, read, and continue.

The feature follows Claude's scheduled tasks (Cowork, and Claude Code's cloud and Desktop tasks): a **Scheduled** row in the sidebar, a **Scheduled tasks** page with **New task**, a create/edit dialog, and a task page with **Run now**, an Active/Paused switch, **Edit**, **Delete**, and a **History** of runs.

## 1. What Claude offers, and what we take

| Claude | ChatterStack |
| --- | --- |
| Sidebar **Scheduled** → Scheduled tasks page, **New task** (upper right) | Same |
| **Set up manually**: name, prompt, model, frequency | Same fields |
| Frequencies: Hourly, Daily, Weekdays, Weekly, Manual (+ Custom cron in edit) | Hourly, Daily, Weekdays, Weekly, Manual. No custom cron yet. |
| Times entered in local time | Same: the browser's IANA time zone is saved with the task |
| Minimum interval 1 hour in the forms | Same (Hourly is the shortest) |
| Each run is its own session | Each run is its own chat, titled with the task name |
| Detail page: Run now, Active/Paused switch, menu with Edit and Delete, History (click a run to open it) | Same |
| History rows end with **Error** / **Cancelled**; skipped runs say why | Rows show Running, Failed (with the error), or Skipped (with the reason) |
| Missed runs: one catch-up run for the most recent missed time, older ones dropped (Desktop) | Same |
| A run that starts while the previous one is still going is skipped (Desktop) | Same |
| **Create with Claude** (describe it in a chat) | Not yet: needs tool calling in the chat route |
| Approval mode, folder, repositories, connectors, API and GitHub triggers, one-off runs | Not applicable or not yet |
| Runs count against usage limits | No usage limits for now; runs are not capped. |

## 2. Data model

`ScheduledTask` (owned by a user, cascade delete):

| Field | Notes |
| --- | --- |
| `name` | 1–100 characters, shown in the list and used as each run's chat title |
| `prompt` | 1–8,000 characters, sent as the user message on every run |
| `model`, `thinkingLevel` | One of the chat models (not Council) |
| `frequency` | `manual`, `hourly`, `daily`, `weekdays` or `weekly` |
| `time` | `HH:MM` local time. Hourly uses only the minutes. |
| `weekday` | 0 (Sunday) – 6, used by Weekly |
| `timezone` | IANA zone, from the browser |
| `enabled` | Active or Paused |
| `nextRunAt` | Null for Manual and paused tasks. The scheduler's index. |
| `lastRunAt` | |

`ScheduledTaskRun`: `taskId` (cascade), `trigger` (`schedule` or `manual`), `status` (`running`, `succeeded`, `failed`, `skipped`), `error`, `conversationId`, `scheduledFor`, `startedAt`, `finishedAt`.

`Conversation.scheduledTaskId` marks run chats. They are left out of **Recents** (an hourly task would flood it) and are opened from the task's History. Deleting a task keeps its run chats; they become ordinary chats and show in Recents.

Limit: 20 tasks per user.

## 3. Scheduler

`runDueTasks(now)` does one pass:

1. Fail runs stuck in `running` for over 15 minutes (the process died).
2. Find up to 10 active tasks with `nextRunAt <= now`.
3. Claim each one with a conditional update (`WHERE id = ? AND nextRunAt = <value read>`), which moves `nextRunAt` to the next time after *now*. Only one caller wins a claim, so overlapping ticks and several instances never run a task twice. Computing from *now* drops older missed times, so a task catches up once.
4. Skip the run (recorded in History) if the previous run is still going, otherwise run the claimed tasks in parallel.

Running a task: reserve the prompt against the user's token budget (a refusal records a skipped run), create the chat, call the model with the run's local date and time, save both messages, reconcile the token count, and mark the run succeeded or failed.

Two ways to call `runDueTasks`:

- **`GET`/`POST /api/cron/scheduled-tasks`** with `Authorization: Bearer <CRON_SECRET>`. Call it every minute from any scheduler. Vercel's Hobby plan only allows daily crons, so on Hobby use an external one (cron-job.org, Upstash QStash, a GitHub Actions schedule). A Vercel Pro project can add `* * * * *` to `vercel.json`.
- **In-process ticker** for Docker and `npm run start`: with `SCHEDULED_TASKS_TICKER=true`, `instrumentation.ts` calls `runDueTasks` every minute. `compose.yaml` turns it on.

**Run now** (`POST /api/scheduled-tasks/[id]/run`) records the run and returns at once; the model call continues with `after()`. The task page polls while a run is in progress.

## 4. API

| Route | Purpose |
| --- | --- |
| `GET /api/scheduled-tasks` | List the user's tasks |
| `POST /api/scheduled-tasks` | Create a task |
| `GET /api/scheduled-tasks/[id]` | One task and its latest 50 runs |
| `PATCH /api/scheduled-tasks/[id]` | Edit fields, or `{ enabled }` to pause/resume. Recomputes `nextRunAt`. |
| `DELETE /api/scheduled-tasks/[id]` | Delete the task and its run history |
| `POST /api/scheduled-tasks/[id]/run` | Run now. 409 while a run is in progress. |
| `GET/POST /api/cron/scheduled-tasks` | Scheduler tick (bearer secret) |

## 5. UI

- Sidebar row **Scheduled** under Resources.
- `/scheduled`: **Scheduled tasks** with **New task**. Each row shows the name, the schedule ("Weekdays at 9:00 AM"), the next run, and an Active/Paused switch. Empty state explains what a task is.
- Dialog **New scheduled task** / **Edit scheduled task**: Name, Instructions, Model, Frequency, then time, minute, or day controls as the frequency needs. Shows the time zone.
- `/scheduled/<id>`: breadcrumb, name with a menu (**Edit**, **Delete**), Active/Paused switch, **Run now**, the instructions, schedule, model, next run, and **History**.

## 6. Delivery steps

1. Plan (this file).
2. Schema and the schedule module (`nextRunAfter`, `describeSchedule`, validation) with unit tests.
3. Server library, runner, API and cron routes, ticker, with integration tests.
4. Sidebar row, pages, dialog, with component and e2e tests.
