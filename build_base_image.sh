#!/bin/bash

docker buildx build \
  --platform linux/amd64 \
  -f server/Dockerfile.base \
  -t luyin-old-app-base:node22-bookworm-ffmpeg-v1 \
  --load \
  server
