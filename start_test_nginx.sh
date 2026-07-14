#!/bin/bash

docker compose --env-file .env.test \
  -f docker-compose.test.yml \
  up -d --build --no-deps nginx py_server
