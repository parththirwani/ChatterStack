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
  chats) and count toward the daily token limit.
- **Skill page:** Overview and Contents (rendered SKILL.md and files), and
  Try in chat, Edit with AI, Edit, Replace, Duplicate, Download (`.zip`) and
  Remove.

Only the SKILL.md body is sent to the model: ChatterStack models can't open
bundled files or run scripts, and skills run only when tagged (Claude can also
pick skills automatically). Each user can keep 50 skills. Apply the Prisma
schema (`npx prisma db push`) before deploying this version.
