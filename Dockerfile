# syntax=docker/dockerfile:1

FROM node:22-slim AS deps
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm fetch
COPY prisma ./prisma
RUN pnpm install --frozen-lockfile --offline

FROM node:22-slim AS build
WORKDIR /app
# Installed here (not just in `runner`) for two reasons: `prisma generate`
# below detects the OpenSSL version present RIGHT NOW to pick which query-
# engine binary to fetch, so it must see the same OpenSSL `runner` will
# actually run against; and this `build` image is ALSO what `docker-compose.yml`'s
# `migrate` service runs live (`prisma migrate deploy` needs a working engine
# too), so it needs OpenSSL at runtime here, not just at generate time.
RUN apt-get update && apt-get install -y --no-install-recommends openssl && \
    rm -rf /var/lib/apt/lists/*
RUN corepack enable
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN pnpm exec prisma generate
RUN pnpm build

FROM node:22-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
# Prisma's query engine dynamically links OpenSSL; node:22-slim's Debian base
# doesn't ship it, so Prisma silently guesses "openssl-1.1.x" at runtime
# without this — works today by luck, breaks on a base-image bump.
RUN apt-get update && apt-get install -y --no-install-recommends openssl && \
    rm -rf /var/lib/apt/lists/*
RUN corepack enable && \
    groupadd --system --gid 1001 nodejs && \
    useradd --system --uid 1001 --gid nodejs nextjs
COPY --from=build --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=build --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=build /app/prisma ./prisma
USER nextjs
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=3s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://localhost:3000/api/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.js"]
