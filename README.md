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

## Rate limiting

Free-tier usage is capped per user over a rolling 24-hour window: 4,000 LLM
tokens and 2 AI Council messages. The counters live in Redis (one sorted set
per user), so the caps hold across serverless instances and survive cold
starts. A request atomically reserves an estimate of its full prompt with a
Lua script and the actual usage is reconciled afterwards, so concurrent
requests can't both spend the same budget. If Redis is unavailable the
limiter fails closed with a 503 in production; in development and tests it
falls back to in-process counters with a console warning. The limiter's
integration-style tests run automatically when `REDIS_URL` (or
`REDIS_TEST_URL`) points at a reachable server, and skip otherwise.

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
