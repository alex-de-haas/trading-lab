# syntax=docker/dockerfile:1@sha256:4edf897a3ffa55b89f906fc8cc78afdb3f1834cc9c7083565e611a8a7d5fe99e
FROM node:24.18.0-bookworm-slim@sha256:6f7b03f7c2c8e2e784dcf9295400527b9b1270fd37b7e9a7285cf83b6951452d AS base
WORKDIR /app

FROM base AS builder
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts --no-audit --no-fund
COPY . .
RUN --network=none npm run build \
    && npm prune --omit=dev --ignore-scripts --offline --no-audit --no-fund

FROM base AS runner
ENV NODE_ENV=production PORT=3000 HOSTY_APP_DATA_DIR=/app/data
RUN apt-get update \
    && apt-get install -y --no-install-recommends gosu \
    && rm -rf /var/lib/apt/lists/*
COPY --from=builder /app/package.json /app/package-lock.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY docker-entrypoint.sh /usr/local/bin/trading-lab-entrypoint
RUN chmod 755 /usr/local/bin/trading-lab-entrypoint \
    && install -d -o node -g node -m 700 /app/data
EXPOSE 3000
ENTRYPOINT ["/usr/local/bin/trading-lab-entrypoint"]
CMD ["node", "dist/server.mjs"]
