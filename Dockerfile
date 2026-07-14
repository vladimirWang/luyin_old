FROM node:22-bookworm

WORKDIR /app

# RUN sed -i \
#     -e 's|http://deb.debian.org/debian|https://mirrors.aliyun.com/debian|g' \
#     -e 's|http://deb.debian.org/debian-security|https://mirrors.aliyun.com/debian-security|g' \
#     -e 's|http://security.debian.org/debian-security|https://mirrors.aliyun.com/debian-security|g' \
#     /etc/apt/sources.list.d/debian.sources \
#   && apt-get update \
#   && apt-get install -y --no-install-recommends ffmpeg \
#   && rm -rf /var/lib/apt/lists/*

COPY package.json pnpm-lock.yaml .npmrc ./
COPY server/package.json server/pnpm-lock.yaml ./server/
RUN corepack enable && corepack prepare pnpm@9.15.9 --activate \
  && pnpm install --prod \
  && pnpm --dir server install --prod

COPY . .

RUN DATABASE_URL="mysql://prisma:prisma@localhost:3306/prisma" pnpm --dir server exec prisma generate \
  && chmod +x ./docker-entrypoint.sh \
  && mkdir -p /app/logs /app/server/storage \
  && chown -R node:node /app/logs /app/server/storage


EXPOSE 8787

ENTRYPOINT ["./docker-entrypoint.sh"]

CMD ["npm", "run", "start:prod"]
