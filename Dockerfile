FROM node:24-bookworm-slim AS deps
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json prisma.config.ts ./
COPY prisma ./prisma
RUN npm ci --fetch-retries=5 --fetch-retry-mintimeout=10000

FROM deps AS build
COPY . .
# The browser SDK needs its DSN at build time. Both default to empty, so an
# image built with no Sentry configuration still builds (and Sentry stays off).
ARG NEXT_PUBLIC_SENTRY_DSN=""
ARG SENTRY_RELEASE=""
ENV NEXT_PUBLIC_SENTRY_DSN=${NEXT_PUBLIC_SENTRY_DSN}
ENV SENTRY_RELEASE=${SENTRY_RELEASE}
RUN npm run build

FROM deps AS schema
CMD ["npx", "prisma", "db", "push"]

FROM node:24-bookworm-slim AS app
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/src/prompts ./src/prompts
USER node
EXPOSE 3000
CMD ["node", "server.js"]
