#!/bin/bash
set -euo pipefail

docker compose --env-file .env.test -f docker-compose.test.yml up --build -d

