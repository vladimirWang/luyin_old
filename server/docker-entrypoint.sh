#!/bin/sh
set -e

db_host="${MYSQL_HOST:-}"
db_port="${MYSQL_PORT:-3306}"

if [ -z "$db_host" ] && [ -n "${DATABASE_URL:-}" ]; then
  db_host="$(node -e 'console.log(new URL(process.argv[1]).hostname)' "$DATABASE_URL")"
  db_port="$(node -e 'console.log(new URL(process.argv[1]).port || "3306")' "$DATABASE_URL")"
fi

if [ -n "$db_host" ]; then
  echo "Waiting for database at ${db_host}:${db_port}..."
  attempt=1
  until node -e '
    const net = require("node:net");
    const socket = net.createConnection({ host: process.argv[1], port: Number(process.argv[2]) });
    const fail = () => { socket.destroy(); process.exit(1); };
    socket.setTimeout(1000);
    socket.once("connect", () => { socket.destroy(); process.exit(0); });
    socket.once("error", fail);
    socket.once("timeout", fail);
  ' "$db_host" "$db_port"; do
    if [ "$attempt" -ge 60 ]; then
      echo "Database at ${db_host}:${db_port} did not become reachable within 120 seconds."
      exit 1
    fi
    attempt=$((attempt + 1))
    sleep 2
  done
  echo "Database is reachable."
fi

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
