# 构建 Vite 前端产物。
FROM oven/bun:1.3.13 AS web-build

WORKDIR /app/web
COPY web/package.json web/bun.lock ./
RUN --mount=type=cache,target=/root/.bun/install/cache bun install --cache-dir=/root/.bun/install/cache
COPY VERSION /app/VERSION
COPY CHANGELOG.md /app/CHANGELOG.md
COPY web ./
RUN bun run build

# 运行镜像：托管静态前端，并提供同源 AI 代理以兼容不支持浏览器 CORS 的渠道。
FROM node:20-alpine

WORKDIR /app/web
ENV NODE_ENV=production
ENV PORT=3000

COPY --from=web-build /app/web/dist ./dist
COPY web/server ./server

EXPOSE 3000
CMD ["node", "server/proxy-server.mjs"]
