ARG APP_BASE_IMAGE=luyin-old-app-base:node22-bookworm-ffmpeg-v1
FROM ${APP_BASE_IMAGE}

WORKDIR /app

COPY package.json pnpm-lock.yaml .npmrc ./server/
ARG INSTALL_DEV=false
RUN if [ "$INSTALL_DEV" = "true" ]; then \
       pnpm --dir server install --frozen-lockfile; \
     else \
       pnpm --dir server install --prod --frozen-lockfile; \
     fi

COPY . ./server

RUN DATABASE_URL="mysql://prisma:prisma@localhost:3306/prisma" pnpm --dir server exec prisma generate \
  && chmod +x ./server/docker-entrypoint.sh \
  && mkdir -p /app/logs /app/server/storage \
  && chown -R node:node /app/logs /app/server/storage

EXPOSE 8787

ENTRYPOINT ["./server/docker-entrypoint.sh"]

CMD ["node", "server/index.mjs"]
