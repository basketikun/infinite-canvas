FROM oven/bun:1.3.14 AS build

WORKDIR /app/legacy-admin
COPY legacy-admin/package.json legacy-admin/bun.lock ./
RUN bun install --frozen-lockfile
COPY VERSION CHANGELOG.md /app/
COPY legacy-admin ./
RUN bun run build

FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
ENV HOSTNAME=0.0.0.0
ENV PORT=3000
COPY --from=build /app/legacy-admin/public ./public
COPY --from=build /app/legacy-admin/.next/standalone ./
COPY --from=build /app/legacy-admin/.next/static ./.next/static
EXPOSE 3000
CMD ["node", "server.js"]
