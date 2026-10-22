# syntax=docker/dockerfile:1.7
# Multi-stage build for the NestSelf API. Build context is the repository root:
#   docker build -f apps/api/Dockerfile -t nestself-api .

FROM node:24-alpine AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable && corepack prepare pnpm@10.10.0 --activate
WORKDIR /repo

# Fetch every package in the lockfile into the store (cached across builds), then install only the API subtree offline.
# The `build` stage doubles as the migration image: `pnpm --filter @nestself/api db:migrate` runs the Drizzle migrator.
FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc ./
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store pnpm fetch
COPY . .
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store pnpm install --frozen-lockfile --offline --filter "@nestself/api..."

FROM deps AS build
RUN pnpm --filter @nestself/api build
# Production node_modules for the API only (workspace packages are copied in as real directories).
RUN pnpm --filter @nestself/api --prod deploy --legacy /out

FROM node:24-alpine AS runtime
ENV NODE_ENV=production PORT=4000
RUN apk add --no-cache tini && addgroup -S nestself && adduser -S nestself -G nestself
WORKDIR /app
COPY --from=build --chown=nestself:nestself /out /app
COPY --from=build --chown=nestself:nestself /repo/apps/api/dist /app/dist
USER nestself
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 CMD wget -qO- http://127.0.0.1:4000/api/health || exit 1
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/main.js"]
