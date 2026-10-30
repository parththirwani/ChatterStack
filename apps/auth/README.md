# Auth service

This Next.js server handles `/api/auth/*` in Docker Compose. The web app
forwards browser requests through its same-origin route. `/api/health` checks
database readiness. Run it locally with `npm run dev --workspace @chatterstack/auth`.

It currently shares the web package's Auth.js configuration and database.
Moving auth table ownership and replacing direct session reads in web and
chat are later migration steps.
