FROM node:24-bookworm-slim AS docs-build

RUN npm install --global pnpm@12.6.0

WORKDIR /app
COPY . .
RUN --mount=type=cache,target=/pnpm/store pnpm install --frozen-lockfile --ignore-scripts --store-dir=/pnpm/store
RUN pnpm --dir apps/docs run postinstall
RUN pnpm --dir apps/docs run build

FROM node:24-bookworm-slim

WORKDIR /app
ENV NODE_ENV=production
ENV HOSTNAME=0.0.0.0
ENV PORT=3000
RUN groupadd --system --gid 1001 nodejs && useradd --system --uid 1001 --gid nodejs nextjs
COPY --from=docs-build --chown=nextjs:nodejs /app/apps/docs/.next/standalone ./
COPY --from=docs-build --chown=nextjs:nodejs /app/apps/docs/public ./apps/docs/public
COPY --from=docs-build --chown=nextjs:nodejs /app/apps/docs/index.md ./apps/docs/index.md
COPY --from=docs-build --chown=nextjs:nodejs /app/apps/docs/content ./apps/docs/content
COPY --from=docs-build --chown=nextjs:nodejs /app/apps/docs/.source ./apps/docs/.source
COPY --from=docs-build --chown=nextjs:nodejs /app/apps/docs/source.config.ts ./apps/docs/source.config.ts
COPY --from=docs-build --chown=nextjs:nodejs /app/CHANGELOG.md ./CHANGELOG.md
COPY --from=docs-build --chown=nextjs:nodejs /app/apps/docs/.next/static ./apps/docs/.next/static
USER nextjs
EXPOSE 3000
CMD ["node", "apps/docs/server.js"]
