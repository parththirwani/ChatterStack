# Web and main backend

This is the existing Next.js application, including the frontend and API
routes. It remains the only running app during the first layout checkpoint.
The application still hosts Auth.js and chat execution until those flows are
extracted behind tested internal contracts.

Run its scripts from the repository root with `npm run dev`, `npm run build`,
and `npm test`. Put the local development environment in `apps/web/.env.local`.
