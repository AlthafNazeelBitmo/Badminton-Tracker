#!/usr/bin/env bash
# Build step for the API's Vercel project (see vercel.json).
#
# Runs from apps/api, after the install step has installed the workspace from the
# repository root.
set -euo pipefail

# The shared packages are consumed from their compiled output.
(cd ../.. && npm run build:packages)

npx prisma generate

# Migrations need a direct connection: Neon's pooled endpoint runs PgBouncer in
# transaction mode, which cannot hold the advisory lock `migrate deploy` takes. The Neon
# integration provides both URLs; the application itself uses the pooled one.
DATABASE_URL="${DATABASE_URL_UNPOOLED:-$DATABASE_URL}" npx prisma migrate deploy

npm run build

# Vercel requires a non-empty static output directory even when a project is only
# functions. An API has no pages to index, so the one file says so.
mkdir -p public
printf 'User-agent: *\nDisallow: /\n' > public/robots.txt
