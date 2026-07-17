#!/bin/sh
set -e

(
  cd /app/server

  case "${PRISMA_SCHEMA_MODE:-migrate}" in
    push)
      echo "Prisma schema mode: push"
      npx prisma db push
      ;;
    migrate)
      echo "Prisma schema mode: migrate"
      npx prisma migrate deploy
      ;;
    *)
      echo "Unknown PRISMA_SCHEMA_MODE='${PRISMA_SCHEMA_MODE}'. Falling back to prisma migrate deploy."
      npx prisma migrate deploy
      ;;
  esac
)

exec "$@"
