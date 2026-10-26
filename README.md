# ChatterStack

ChatterStack is a Next.js chat app with single-model conversations and a four-model AI Council. Chats use OpenRouter, with PostgreSQL for history, Redis for rate limits, and Qdrant for optional retrieval.

## Models

The current OpenRouter choices are DeepSeek V4.1 Flash, Gemini 4 Argon, GPT-6.1 Sol, and Claude Sonnet 5.5. The same four models participate in AI Council. Model IDs and displayed metadata live in [`src/config/models.ts`](src/config/models.ts). OpenRouter availability and pricing can change; check [its model catalog](https://openrouter.ai/models) before deployment.

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
