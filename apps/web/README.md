# Web and main backend

This Next.js app includes the frontend and main backend APIs. In Docker
Compose it forwards `/api/auth/*` to `apps/auth` and `/api/chat` to `apps/chat`.
Without `AUTH_SERVICE_URL` and `CHAT_SERVICE_URL`, those routes use local
handlers so the existing single-app deployment still works.

Run its scripts from the repository root with `npm run dev`, `npm run build`,
and `npm test`. Put the local development environment in `apps/web/.env.local`.
