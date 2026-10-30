# Chat execution service

This Next.js server handles `/api/chat` in Docker Compose. The web app
forwards the browser request and response stream to it. `/api/health` checks
database readiness. Run it locally with `npm run dev --workspace @chatterstack/chat`.

It currently reuses web package code and directly reads and writes the shared
database. Moving data access behind backend APIs and replacing the
process-local turn queue are later migration steps.
