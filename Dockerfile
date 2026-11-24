# 构建 Vite 前端产物。
FROM node:24-bookworm-slim AS web-build

RUN npm install --global pnpm@12.6.0

WORKDIR /app
COPY . .
RUN --mount=type=cache,target=/pnpm/store pnpm install --frozen-lockfile --ignore-scripts --store-dir=/pnpm/store
RUN pnpm --filter @infinite-canvas/web build

# 运行镜像：只启动静态前端，AI 请求由浏览器前台直连用户自己的接口。
FROM nginx:1.27-alpine

COPY --from=web-build /app/apps/web/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY apps/web/docker-entrypoint.sh /docker-entrypoint.d/40-runtime-config.sh
RUN chmod +x /docker-entrypoint.d/40-runtime-config.sh

EXPOSE 3000
