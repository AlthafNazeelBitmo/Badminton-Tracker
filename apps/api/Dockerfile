# syntax=docker/dockerfile:1
#
# API image.
#
# Multi-stage so the runtime layer carries no compiler, no source and no dev
# dependencies. The final image runs as an unprivileged user — a container that runs
# everything as root turns a application-level bug into a host-level one.

# --- Stage 1: install dependencies ------------------------------------------
FROM node:22-alpine AS deps
WORKDIR /repo

# Only the manifests, so this layer is cached until a dependency actually changes.
COPY package.json package-lock.json ./
COPY packages/contracts/package.json packages/contracts/
COPY packages/analytics/package.json packages/analytics/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/

RUN npm ci --workspaces --include-workspace-root

# --- Stage 2: build ---------------------------------------------------------
FROM node:22-alpine AS build
WORKDIR /repo

COPY --from=deps /repo/node_modules ./node_modules
COPY --from=deps /repo/packages/contracts/node_modules ./packages/contracts/node_modules
COPY --from=deps /repo/packages/analytics/node_modules ./packages/analytics/node_modules
COPY . .

RUN npm run build -w @badminton/contracts \
 && npm run build -w @badminton/analytics \
 && npx prisma generate --schema apps/api/prisma/schema.prisma \
 && npm run build -w @badminton/api

# Drop dev dependencies before they are copied into the runtime image.
RUN npm prune --omit=dev --workspaces --include-workspace-root

# --- Stage 3: runtime -------------------------------------------------------
FROM node:22-alpine AS runtime
WORKDIR /repo

ENV NODE_ENV=production

# `dumb-init` reaps zombies and forwards signals, so SIGTERM reaches Node and the
# graceful shutdown hooks actually run.
RUN apk add --no-cache dumb-init \
 && addgroup -S app && adduser -S app -G app

COPY --from=build --chown=app:app /repo/node_modules ./node_modules
COPY --from=build --chown=app:app /repo/package.json ./package.json
COPY --from=build --chown=app:app /repo/packages/contracts/dist ./packages/contracts/dist
COPY --from=build --chown=app:app /repo/packages/contracts/package.json ./packages/contracts/package.json
COPY --from=build --chown=app:app /repo/packages/analytics/dist ./packages/analytics/dist
COPY --from=build --chown=app:app /repo/packages/analytics/package.json ./packages/analytics/package.json
COPY --from=build --chown=app:app /repo/apps/api/dist ./apps/api/dist
COPY --from=build --chown=app:app /repo/apps/api/package.json ./apps/api/package.json
# Migrations ship with the image so a deployment can apply exactly the schema it expects.
COPY --from=build --chown=app:app /repo/apps/api/prisma ./apps/api/prisma

USER app
EXPOSE 4000

# Hits the readiness probe, which checks the database rather than only the process.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:4000/health/ready').then(r=>r.json()).then(b=>process.exit(b.status==='ok'?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "apps/api/dist/main.js"]
