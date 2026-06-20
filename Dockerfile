# syntax=docker/dockerfile:1.7

FROM node:22-alpine AS package-base
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10.12.1 --activate
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

FROM package-base AS dependencies
RUN pnpm install --frozen-lockfile

FROM dependencies AS build
COPY . .
RUN pnpm build

FROM dependencies AS tools
COPY scripts ./scripts
ENTRYPOINT ["pnpm", "hash-password", "--"]

FROM package-base AS production-dependencies
RUN pnpm install --prod --frozen-lockfile

FROM node:22-alpine AS runtime
ARG APP_VERSION=development
ARG VCS_REF=unknown
ARG BUILD_DATE=unknown

LABEL org.opencontainers.image.title="Risky Investor Dashboard" \
      org.opencontainers.image.description="Private investment operating dashboard" \
      org.opencontainers.image.version="${APP_VERSION}" \
      org.opencontainers.image.revision="${VCS_REF}" \
      org.opencontainers.image.created="${BUILD_DATE}" \
      org.opencontainers.image.source="https://riskyinvestor.co.uk"

ENV NODE_ENV=production \
    PORT=4180 \
    PRIVATE_DATA_DIR=/app/data/private \
    APP_VERSION=${APP_VERSION}

RUN addgroup -S -g 10001 riskyinvestor \
    && adduser -S -D -H -u 10001 -G riskyinvestor riskyinvestor \
    && mkdir -p /app/data/private /app/scanner/config /app/scanner/output \
    && chown -R riskyinvestor:riskyinvestor /app/data /app/scanner

WORKDIR /app
COPY --from=production-dependencies --chown=riskyinvestor:riskyinvestor /app/node_modules ./node_modules
COPY --from=build --chown=riskyinvestor:riskyinvestor /app/dist ./dist
COPY --from=build --chown=riskyinvestor:riskyinvestor /app/dist-server ./dist-server
COPY --chown=riskyinvestor:riskyinvestor package.json ./

USER riskyinvestor
EXPOSE 4180

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:4180/healthz').then((response) => { if (!response.ok) process.exit(1); }).catch(() => process.exit(1));"]

CMD ["node", "dist-server/index.js"]
