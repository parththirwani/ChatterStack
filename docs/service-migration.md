# Three-service migration

## Current checkpoint

The npm workspace has three application directories. Docker Compose runs all
three as separate servers. The web app forwards `/api/auth/*` to Auth and
`/api/chat` to Chat. Without service URLs, web retains local handlers for its
current single-app deployment. Auth and Chat still import web package code
and share its database, so data ownership has not moved yet.

The existing Vercel project must use `apps/web` as its Root Directory before
this layout is released. The moved `vercel.json` applies from that directory.

## Ownership

| Application | Owns | Data access |
| --- | --- | --- |
| Auth | OAuth, sessions, identity | Shared PostgreSQL for now; auth tables later |
| Chat | Prompt assembly, OpenRouter, AI Council, streaming | Shared PostgreSQL, Redis, Qdrant for now; backend APIs later |
| Web and backend | UI, conversations, messages, documents, skills, profile, scheduling, retrieval | Application tables, Blob, Redis, Qdrant |

The browser keeps the current same-origin API routes. The web app proxies chat
streams and auth callbacks in Compose. The backend checks
the user ID on every conversation, document, and skill request; a valid
identity token alone does not authorize access to a resource.

## Next implementation steps

1. Define versioned internal request and SSE event contracts. Cover model
   output, AI Council progress, cancellation, errors, and retry semantics.
   Contract tests must run against both the existing route and the new chat
   handler.
2. Put conversation reads and writes, document and skill resolution, and
   retrieval behind backend interfaces. Move the per-conversation turn claim
   from process memory to a distributed mechanism before running more than
   one chat instance.
3. Replace direct Prisma, Redis, and Qdrant access in Chat with backend APIs.
   The web route already forwards the request and stream in Compose. Keep the
   local handler until the separate service is deployed in every environment.
4. Run scheduled tasks in a backend worker. It claims runs and calls chat
   execution; it records results through the backend conversation path.
   Queue indexing after message commits with saved message IDs as idempotency
   keys. Process chat deletion in Qdrant as well.
5. Extract Auth.js and its tables. Use signed, short-lived identity tokens
   between services. Replace cross-service foreign keys with stable user IDs
   after migrating accounts and sessions. Cut over OAuth callbacks last.

Each extraction requires integration coverage for authorization, partial
streams, retries, and failure recovery before its routing switch is enabled.
