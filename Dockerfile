FROM node:22-bookworm

WORKDIR /app

RUN sed -i \
    -e 's|http://deb.debian.org/debian|https://mirrors.aliyun.com/debian|g' \
    -e 's|http://deb.debian.org/debian-security|https://mirrors.aliyun.com/debian-security|g' \
    -e 's|http://security.debian.org/debian-security|https://mirrors.aliyun.com/debian-security|g' \
    /etc/apt/sources.list.d/debian.sources \
  && apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg \
  && rm -rf /var/lib/apt/lists/*

COPY package.json pnpm-lock.yaml .npmrc ./
RUN corepack enable && corepack prepare pnpm@9.15.9 --activate && pnpm install --prod --frozen-lockfile

COPY . .

RUN pnpm run build

RUN mkdir -p /app/logs /app/server/storage && chown -R node:node /app/logs /app/server/storage

USER node

EXPOSE 7000

CMD ["pnpm", "run", "start:prod"]