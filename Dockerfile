FROM node:24-bookworm-slim AS deps
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
COPY apps/web/package.json ./apps/web/package.json
COPY apps/auth/package.json ./apps/auth/package.json
COPY apps/chat/package.json ./apps/chat/package.json
COPY apps/web/prisma.config.ts ./apps/web/prisma.config.ts
COPY apps/web/prisma ./apps/web/prisma
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
CMD ["npm", "exec", "--workspace", "@chatterstack/web", "--", "prisma", "db", "push"]

FROM deps AS service-build
COPY . .
RUN npm run build:auth && npm run build:chat

FROM node:24-bookworm-slim AS app
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0
COPY --from=build --chown=node:node /app/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /app/apps/web/src/prompts ./apps/web/src/prompts
USER node
EXPOSE 3000
CMD ["node", "apps/web/server.js"]

FROM node:24-bookworm-slim AS auth
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production PORT=3001 HOSTNAME=0.0.0.0
COPY --from=service-build --chown=node:node /app/apps/auth/.next/standalone ./
USER node
EXPOSE 3001
CMD ["node", "apps/auth/server.js"]

FROM node:24-bookworm-slim AS chat
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production PORT=3002 HOSTNAME=0.0.0.0 CHAT_PROMPTS_DIR=/app/apps/web/src/prompts
COPY --from=service-build --chown=node:node /app/apps/chat/.next/standalone ./
COPY --from=service-build --chown=node:node /app/apps/web/src/prompts ./apps/web/src/prompts
USER node
EXPOSE 3002
CMD ["node", "apps/chat/server.js"]
