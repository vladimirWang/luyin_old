#!/bin/bash
set -e

echo "Running prisma migrate deploy..."
pnpm --dir /app/server exec prisma migrate deploy --schema=/app/server/prisma/schema.prisma || true

echo "Running prisma generate..."
pnpm --dir /app/server exec prisma generate --schema=/app/server/prisma/schema.prisma || true

echo "Running prisma db seed..."
pnpm --dir /app/server exec prisma db seed --schema=/app/server/prisma/schema.prisma || true

exec "$@"
