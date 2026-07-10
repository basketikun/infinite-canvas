# 构建 Next.js 前端产物。依赖仍由 Bun 安装，但 Next 构建必须运行在 Node，
# 因为服务端会加载 Node 22 提供的 node:sqlite。
FROM oven/bun:1.3.13 AS bun-runtime

FROM node:22-bookworm-slim AS web-build
COPY --from=bun-runtime /usr/local/bin/bun /usr/local/bin/bun

WORKDIR /app/web
COPY web/package.json web/bun.lock ./
RUN --mount=type=cache,target=/root/.bun/install/cache bun install --frozen-lockfile --cache-dir=/root/.bun/install/cache
COPY VERSION /app/VERSION
COPY CHANGELOG.md /app/CHANGELOG.md
COPY web ./
RUN node node_modules/next/dist/bin/next build

# 运行镜像：Next.js 提供页面、加密会话与固定到 Token/New API 的同源 AI 代理。
FROM node:22-bookworm-slim

WORKDIR /app
COPY VERSION /app/VERSION
COPY CHANGELOG.md /app/CHANGELOG.md
COPY --from=web-build /app/web/public /app/web/public
COPY --from=web-build /app/web/.next/standalone /app/web
COPY --from=web-build /app/web/.next/static /app/web/.next/static
ENV NODE_ENV=production
ENV HOSTNAME=0.0.0.0
ENV PORT=3000
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates && rm -rf /var/lib/apt/lists/* \
    && mkdir -p /app/data
VOLUME ["/app/data"]

EXPOSE 3000
CMD ["sh", "-c", "cd /app/web && PORT=3000 node server.js"]
