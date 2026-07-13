#!/bin/sh
set -e

echo "Running prisma migrate deploy..."
(
    cd /app/server
    npx prisma migrate deploy
)
# (
#   cd /app/server
#   if [ -d prisma/migrations ] && [ -n "$(find prisma/migrations -name migration.sql -print -quit)" ]; then
#     npx prisma migrate deploy
#   else
#     echo "No Prisma migrations found; skipping prisma migrate deploy."
#   fi
# )

exec "$@"
