# syntax=docker/dockerfile:1
#
# Web image.
#
# Uses Next.js standalone output, which traces exactly the files the server needs and
# leaves the rest behind — the runtime layer is a fraction of a full node_modules tree.

FROM node:22-alpine AS deps
WORKDIR /repo

COPY package.json package-lock.json ./
COPY packages/contracts/package.json packages/contracts/
COPY packages/analytics/package.json packages/analytics/
COPY apps/web/package.json apps/web/

# Only the web app's dependency tree, not the API's or the mobile app's.
RUN npm ci --workspace @badminton/web --include-workspace-root

FROM node:22-alpine AS build
WORKDIR /repo

ARG NEXT_PUBLIC_API_URL=http://localhost:4000
# Baked into the client bundle at build time, so it must be supplied as a build
# argument rather than a runtime variable.
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
ENV NEXT_TELEMETRY_DISABLED=1

# The whole installed tree, rather than a list of node_modules folders a clean install
# may not create. `.dockerignore` keeps the host's node_modules and .env out of the next copy.
COPY --from=deps /repo ./
COPY . .

RUN npm run build -w @badminton/contracts \
 && npm run build -w @badminton/web

FROM node:22-alpine AS runtime
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

RUN apk add --no-cache dumb-init \
 && addgroup -S app && adduser -S app -G app

# The standalone bundle, plus the static assets it serves. Next does not copy `static`
# into the standalone output itself; missing this step yields a page that renders but
# cannot load its own JavaScript.
COPY --from=build --chown=app:app /repo/apps/web/.next/standalone ./
COPY --from=build --chown=app:app /repo/apps/web/.next/static ./apps/web/.next/static

USER app
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/login').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "apps/web/server.js"]
