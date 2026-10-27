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
| `OPENOBSERVE_LOG_CONTENT` | No | `true` also stores prompts and answers. See the warning below. |

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

**Privacy.** Prompts, answers, titles, filenames and document or retrieved
content are not recorded. `user_id` is the NextAuth id, never an email. Only
error types and truncated provider messages travel with failures. If you set
`OPENOBSERVE_LOG_CONTENT=true`, prompts and answers are stored in OpenObserve
too (each cut to 2,000 characters, attachment bytes never included) - treat that
stream as holding private user content, and restrict who can query it.
