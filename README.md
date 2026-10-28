# ChatterStack

ChatterStack is a Next.js chat app with single-model conversations and a four-model AI Council. Chats use OpenRouter, with PostgreSQL for history, Redis for the chat history cache and request rate limits, and Qdrant for optional retrieval.

## Models

ChatterStack mirrors the models offered by [t3.chat](https://t3.chat) that are also available on OpenRouter. The registry in [`src/config/models.ts`](src/config/models.ts) lists every OpenRouter chat model t3.chat offers, with display name, company, logo, context limit, maximum output, pricing, image support and reasoning levels. The composer, `/api/models`, cost estimates and council pickers all read from that one list. See [`docs/model-registry.md`](docs/model-registry.md) for the inclusion rules and update process.

The four original defaults (DeepSeek V4.1 Flash, Gemini 4 Argon, GPT-6.1 Sol, and Claude Sonnet 5.5) still participate in AI Council. To verify that a registered model actually routes on OpenRouter, run the opt-in smoke test; it sends one short prompt to every model:

```bash
OPENROUTER_API_KEY=sk-or-... npm run test:models
```

OpenRouter availability and pricing can change; check [its model catalog](https://openrouter.ai/models) before deployment.

## Run with Docker

Requires Docker Engine and Docker Compose.

1. Copy `.env.example` to `.env.local` and fill in `OPENROUTER_API_KEY`, `NEXTAUTH_SECRET`, and the Google or GitHub OAuth credentials you intend to use. Set the OAuth callback URL at the provider to `http://localhost:3000/api/auth/callback/google` or `/github`.
2. Run `docker compose up --build -d`.
3. Open http://localhost:3000.

Compose starts PostgreSQL, Redis, Qdrant, a one-shot Prisma schema setup job, and the app. It overrides the database, Redis, and Qdrant URLs from `.env.local` with internal container addresses. The `POSTGRES_PASSWORD` variable in your shell or a Compose `.env` file overrides the local development default. To stop the stack, run `docker compose down`; add `-v` only if you want to delete stored chats and service data.

## Run locally

Use Node.js 24 and running PostgreSQL, Redis, and Qdrant services. Copy `.env.example` to `.env.local`, set the service URLs and credentials, then run:

```bash
npm ci
npx prisma db push
npm run dev
```

`npm run build` checks the production build and prepares its standalone assets; `npm run start` serves that build. The app uses NextAuth with Google and GitHub sign-in. The optional retrieval flow is controlled by `RAG_ENABLED`.

## Rate limiting

There are no per-user token or AI Council quotas: chats, retries, compaction
and scheduled runs are not capped by usage. Each request is still bounded by
the selected model's context window, and the RAG and profile API routes keep
their per-minute request limits.

## Resources and document storage

Chat attachments are stored in a **private Vercel Blob store**. PostgreSQL keeps
only document metadata and object keys. A browser upload goes directly to Blob;
the chat request contains document IDs, so files do not count against Vercel's
function request body limit.

1. Create a private Blob store in the Vercel project's Storage tab and connect
   it to Production, Preview, and Development. The project needs
   `BLOB_READ_WRITE_TOKEN` for client upload tokens. For local development,
   pull the project environment with `vercel env pull`.
2. Set a random `CRON_SECRET` (at least 16 characters) in Vercel. The daily
   cron in `vercel.json` removes unfavourited files unused for 30 days and
   unfinished uploads after 24 hours.
3. Apply the Prisma schema with `npx prisma db push` before deploying this
   version. The Docker `schema` service runs that command automatically.
4. Run `node scripts/migrate-attachments.mjs` once against the database used
   by the old version, with `DATABASE_URL` and Blob credentials in the
   environment. It is resumable: it skips messages already converted to
   document references. Keep a database backup until the migration finishes.

The Docker app can use the same Blob store when its `.env.local` contains
`BLOB_READ_WRITE_TOKEN`. For a Docker-only deployment, invoke
`GET /api/cron/cleanup-documents` daily with
`Authorization: Bearer <CRON_SECRET>`.

## Skills

A skill is a reusable set of instructions you tag on a message, such as a
code-review checklist or a house writing style. Skills use the Agent Skills
format (a `SKILL.md` with YAML frontmatter holding `name` and `description`,
then Markdown instructions, plus optional supporting files). Skills from
Claude can be uploaded here, and ChatterStack skills download in a layout
Claude accepts. The UI follows claude.ai's Customize → Skills.

- **Find:** the sidebar's **Customize** row opens Skills. **Yours** lists the
  skills you made and the ones you added, each with an on/off toggle.
  **Discover** suggests built-in skills to **Try** or **Add**.
- **Stacks:** Discover includes the full skill lists from Matt Pocock, Theo,
  Poteto, Design Taste, Hairline, Anatomy, Ponytail and the Technical Article
  Writer. Filter by Coding, UI, Writing or source. Each entry links to its
  original SKILL.md. Adding a stack saves its individual skills to Yours.
- **Upload skill:** drag in several `.md`, `.zip` or `.skill` files at once. A
  `.md` must have the YAML frontmatter; an archive must contain a `SKILL.md` at
  its root or in one top-level folder. Uploads are checked for a valid
  SKILL.md, safe relative paths and size limits. Supporting text files are
  kept, binary files are skipped, and scripts are stored but never run.
- **Create a skill:** a dialog with name, description, SKILL.md and any extra
  files (**Add file**).
- **Create with AI:** opens a chat with the built-in `skill-creator`. When the
  answer contains a SKILL.md, **Save as skill** under it opens the create
  dialog prefilled.
- **Use in chat:** type `/` in the composer to pick **Add files** or one of
  your turned-on skills. The skill stays in the message as a highlighted
  `/name` token; up to three apply per message. Their instructions are added
  to the system prompt for that message only (in single-model and Council
  chats).
- **Skill page:** Overview and Contents (rendered SKILL.md and files), and
  Try in chat, Edit with AI, Edit, Replace, Duplicate, Download (`.zip`) and
  Remove.

Only the SKILL.md body is sent to the model: ChatterStack models can't open
bundled files or run scripts, and skills run only when tagged (Claude can also
pick skills automatically). Some catalog skills require tools or supporting
files from their source repository; Discover marks those entries. Each user
can keep 200 skills. Apply the Prisma
schema (`npx prisma db push`) before deploying this version.

## Scheduled tasks

A scheduled task is a saved prompt that runs on a schedule, such as a morning
news brief every weekday at 9:00. The UI follows Claude's scheduled tasks.

- **Find:** the sidebar's **Scheduled** row lists your tasks with their
  schedule, next run and an Active/Paused switch. **New task** opens a dialog
  with name, instructions, model and frequency (Manual, Hourly, Daily,
  Weekdays or Weekly, at a time in your browser's time zone).
- **Task page:** **Run now**, the Active/Paused switch, **Edit** and
  **Delete** (in the menu next to the name), and **History**. Each run is a
  new chat titled with the task name; click a run to open it and carry on.
  Run chats stay out of Recents. Deleting a task keeps them as ordinary chats.
- **Runs:** each run sends the saved prompt, with the run's local date and
  time, to the chosen model. Missed runs catch up
  once, and a run is skipped while the previous one is still going.

Something has to wake the scheduler every minute:

- **Docker / `npm run start`:** set `SCHEDULED_TASKS_TICKER=true` (Compose
  already does). The server then runs due tasks itself.
- **Vercel:** call `GET` or `POST /api/cron/scheduled-tasks` every minute with
  `Authorization: Bearer <CRON_SECRET>`. Vercel's Hobby plan only allows daily
  crons, so use an external scheduler (for example Upstash QStash or
  cron-job.org); on Pro, add `{ "path": "/api/cron/scheduled-tasks",
  "schedule": "* * * * *" }` to `vercel.json`.

Several schedulers or instances can call it at once: each due task is claimed
by exactly one of them. Apply the Prisma schema (`npx prisma db push`) before
deploying this version. See [docs/scheduled-tasks-plan.md](docs/scheduled-tasks-plan.md)
for the design.

## Forking a chat from a message

Every saved message has a **More actions** menu (`...`) with **Fork in new chat**.
It opens a separate conversation holding everything from the start of the chat
through that message, message included, and leaves the source as it was.

- A fork at a question ends with that question and does not generate a new answer;
  the next prompt you send is appended as usual. A fork at an answer includes it.
- The copy is a snapshot with its own URL and draft. It is titled `Fork of <source
  title>` (capped at the 80 character title limit) and starts unpinned. Replies,
  retries, renames and deletions in one chat never rewrite the other, and deleting
  the source leaves its forks usable.
- Attachments and tagged skills are copied as references, so an attachment deleted
  in the source still shows as removed in the fork. Nothing is re-uploaded, no
  embeddings are duplicated, and the fork's first send reads its own copied rows
  rather than the source's Redis history.
- Messages are numbered by a per-chat `position` assigned in the same write that
  saves them. A question and its answer are saved together, so `createdAt` alone is
  not enough to keep them in order, and a fork needs an exact cut point.
- The menu appears once the database saves a message. The server sends its row id
  back in the chat stream, so a new message can be forked without reloading.
- `POST /api/conversations/[id]/fork` is the only way to fork. It checks ownership,
  copies the prefix in one transaction (a failure leaves no empty chat behind) and
  returns the new conversation.

Apply the Prisma schema (`npx prisma db push`) before deploying this version, then
run `node scripts/backfill-message-positions.mjs` once against that database to
number messages saved before the column existed. See
[docs/chat-fork-plan.md](docs/chat-fork-plan.md) for the design.

## Long chats and context compaction

ChatterStack keeps every message in the transcript, but a long chat can exceed
the selected model's context window. Set `CHAT_COMPACTION_MODE=on` to replace
the model's view of older turns with a structured summary while the last two
completed exchanges stay verbatim. The summary is a separate user-role block,
not a system instruction, and the full transcript remains visible and saved.

- `CHAT_COMPACTION_MODE=shadow` measures and logs would-trigger turns without
  changing a prompt; use it before `on` for a rollout.
- `COMPACTION_MODEL` defaults to `openai/gpt-4o-mini`. Summaries are capped at
  1,600 tokens and validated; an empty, malformed or inflated summary leaves
  the previous context untouched.
- Snapshots live in `conversation_context_snapshots`, keyed by conversation and
  the last summarized message. Switching models cannot reuse a snapshot that
  no longer fits: the budget is rebuilt for the new model before the call.
- Apply the Prisma schema (`npx prisma db push`) before enabling it.
- `off` is the kill switch: new turns ignore snapshots, but the transcript and
  stored snapshots are not deleted.

See [docs/auto-compaction.md](docs/auto-compaction.md) for the design,
defaults and known limits.

## Environments in Sentry, PostHog and OpenObserve

All three tag what they send with the same value, so local testing never mixes
with real traffic: `development` (local `next dev`), `preview` (Vercel preview
deploys) or `production`. It comes from `src/lib/observability/environment.ts`:
`APP_ENV` if set, else Vercel's `VERCEL_ENV`, else `NODE_ENV` (the browser uses
`NEXT_PUBLIC_APP_ENV` / `NEXT_PUBLIC_VERCEL_ENV`). Filter with:

| Service | Where |
| --- | --- |
| Sentry | the environment selector at the top of Issues (`environment:development`) |
| PostHog | event property `environment` (filters, insights, breakdowns) |
| OpenObserve logs | field `environment` in `llm_calls` |
| OpenObserve traces | field `service_deployment_environment` (sent as the resource attribute `deployment.environment`) |

## Error tracking (Sentry)

Optional error monitoring for the browser and the Node server
(`@sentry/nextjs`, App Router + Turbopack). While `SENTRY_DSN` is unset the SDK
never initializes and nothing is sent, so local development, tests and Docker
need no Sentry configuration.

| Variable | Required | Purpose |
| --- | --- | --- |
| `SENTRY_DSN` | No | Server DSN. Unset ⇒ server capture is off. |
| `NEXT_PUBLIC_SENTRY_DSN` | No | Browser DSN. Inlined at build time; Docker and Compose pass it as a build ARG that defaults to empty. |
| `SENTRY_ENVIRONMENT` | No | Tag shown on issues (falls back to `NODE_ENV`). |
| `SENTRY_RELEASE` | No | Release/version tag. |
| `SENTRY_AUTH_TOKEN` | No | Only for uploading source maps at build time. |
| `SENTRY_ORG`, `SENTRY_PROJECT` | No | Only with the auth token: where to upload. |

Files: `src/instrumentation.ts` (server register + `onRequestError`),
`src/instrumentation-client.ts` (browser), `src/sentry.server.config.ts`,
`src/app/global-error.tsx`, `src/app/error.tsx`, and the shared scrubber plus
`captureError()` in `src/lib/observability/`. Existing `console.error` calls in
request paths were replaced with `captureError()` — they were stripped from
production builds by `compiler.removeConsole`, which is why these failures were
previously invisible.

Privacy and noise: `sendDefaultPii: false`, no tracing and no replay. Events
carry tags (`route`, `model`, `council`, `stage`) and, when known, the NextAuth
user id only — never an email. `beforeSend` drops the request object entirely
(no headers, cookies or bodies), removes any `content`, `message`, `title`,
`attachment`, `document`, `rag`-style field, truncates long provider messages
and strips base64/data-URL blobs, so chat text and file data cannot ride along.
Expected conditions are not reported: 401/403/404/409/429, aborted requests and
user Stop, and rate-limit rejections.

## Analytics (PostHog)

Optional product analytics with `posthog-js` (browser) and `posthog-node`
(server). Everything is inert while `POSTHOG_KEY` is unset, so local
development, tests and Docker need no configuration.

| Variable | Required | Purpose |
| --- | --- | --- |
| `POSTHOG_KEY` | No | Public project token (`phc_...`). Unset disables analytics entirely. |
| `POSTHOG_HOST` | No | Ingestion host, defaults to `https://us.i.posthog.com`. |
| `POSTHOG_SESSION_REPLAY` | No | `true` turns on session recording. Off by default. |

The key and host are read on the server in `src/app/layout.tsx` and passed to
the client provider as props, so a Docker image works without build-time args
and the values can be changed by restarting the container. A browser that sends
Do Not Track or Global Privacy Control loads nothing.

Event names and their property types live in `src/lib/analytics/events.ts`.
Server events go through `captureServerEvent()` in
`src/lib/analytics/posthog-server.ts`, which flushes with `after()` once the
response — including the chat SSE stream — has finished.

Nothing about the conversation itself is sent: no message text, chat titles,
file names, document contents or retrieved context. Messages are described by
model id, council yes/no, thinking level, attachment count and a length bucket;
uploads by mime type and a size bucket. Identity is the NextAuth user id only
(`identify()` on the client, `distinctId` on the server) — never an email,
display name or avatar — and it is reset on sign-out. Person profiles are
`identified_only`, element autocapture is off, and session replay masks all
inputs, text and element attributes.

## LLM observability (OpenObserve)

Every model call - the streamed chat answer, each council stage, the title model
and the embedding calls - can be recorded to an OpenObserve stream for latency,
token, cost and failure analysis. Nothing is sent unless both
`OPENOBSERVE_URL` and credentials are set.

| Variable | Required | Purpose |
| --- | --- | --- |
| `OPENOBSERVE_URL` | No | Base URL, e.g. `https://observe.example.com`. Unset disables everything. |
| `OPENOBSERVE_USER` / `OPENOBSERVE_PASSWORD` | No | Basic auth user and password. |
| `OPENOBSERVE_AUTH` | No | Instead of the pair: a ready base64 Basic token, or `user:password`. |
| `OPENOBSERVE_ORG` | No | Organisation, defaults to `default`. |
| `OPENOBSERVE_STREAM` | No | Stream name, defaults to `llm_calls`. |
| `OPENOBSERVE_LOG_CONTENT` | No | `true` also stores prompts and answers in the log records. See the warning below. |
| `OPENOBSERVE_TRACES` | No | `true` also sends one OTLP trace per chat request to OpenObserve's Traces view. |
| `OPENOBSERVE_TRACE_STREAM` | No | Traces stream, defaults to `default`. |
| `OPENOBSERVE_TRACE_CONTENT` | No | `true` attaches the user's message and the answer to trace spans. Separate from `OPENOBSERVE_LOG_CONTENT`. |

The client (`src/lib/observability/openobserve.ts`) is deliberately
dependency-free: it POSTs batches of JSON records to
`/api/{org}/{stream}/_json`. No OpenTelemetry provider is registered here -
Sentry's SDK owns the process-wide OTel setup, and registering a second one
would fight it. Records are buffered in memory (capped, oldest dropped first)
and flushed with `after()` from `next/server`, i.e. once the response -
including the chat's SSE stream - is finished. Sends time out after 3 seconds,
failures are swallowed, and a failing endpoint gets a 30 second backoff, so
observability can never slow down or break a chat.

Each record carries a `trace_id` shared by every call of one chat request, so a
council run (member answers, peer rankings, chair synthesis) and the embeddings
it triggered can be read back as one story. Fields: model, provider, thinking
level, status (`ok` / `error` / `aborted`), duration, time to first token, input
and output tokens (`estimated: true` when OpenRouter sent no usage), `cost_usd`
from the pricing in `src/config/models.ts`, finish reason, message count,
attachment count, whether retrieved context was used, and whether the user
pressed Stop. Query set and field notes:
[`docs/openobserve-llm-observability.md`](docs/openobserve-llm-observability.md).

**Traces.** With `OPENOBSERVE_TRACES=true`, each chat request also becomes one
trace in OpenObserve → Traces (`src/lib/observability/otlp-traces.ts`, OTLP/HTTP
JSON to `/api/{org}/v1/traces`, same auth, timeouts and never-throw rules as
above; at most 100 spans per POST, and a payload OpenObserve refuses outright is
dropped and counted instead of blocking later traces). The root span
`chat <model>` (or `council`) covers the whole turn; under it sit
`rag.retrieve` (with its query embedding nested inside), one span per model call
(`completion`, each `council-member-answer` / `council-ranking`,
`council-chair`, `title-generation`), `db.persist`, `rag.ingest` (with its
embeddings) and `profile.update`. Model spans carry `gen_ai.*` attributes for
model, tokens and finish reason, plus cost and time to first token. Requests
refused before streaming (sign-in, validation, ownership) are a
root span alone with status `rejected` and `http.response.status_code`.

With `OPENOBSERVE_TRACE_CONTENT=true`, model and root spans also carry the
user's own message and the model's answer (`gen_ai.input.messages` /
`gen_ai.output.messages`, each cut to 4,000 characters), so answer quality -
including every council member's answer and ranking - can be read side by side.
Only those two texts: never the system prompt, earlier turns, retrieved memory,
extracted attachment text, file bytes or embedding inputs.

**Privacy.** Prompts, answers, titles, filenames and document or retrieved
content are not recorded. `user_id` is the NextAuth id, never an email. Only
error types and truncated provider messages travel with failures. If you set
`OPENOBSERVE_LOG_CONTENT=true`, prompts and answers are stored in OpenObserve
too (each cut to 2,000 characters, attachment bytes never included), and
`OPENOBSERVE_TRACE_CONTENT=true` stores the user's message and the answer in
traces (4,000 characters each) - treat those streams as holding private user
content, and restrict who can query them. Error messages sent to OpenObserve
are one line, at most 300 characters, with credentials, data URLs and base64
removed.
