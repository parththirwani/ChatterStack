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

`npm run build` checks the production build. The app uses NextAuth with Google and GitHub sign-in. The optional retrieval flow is controlled by `RAG_ENABLED`.
