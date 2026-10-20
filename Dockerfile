# syntax=docker/dockerfile:1

#   docker build -t metro .
#   docker run -p 8789:8789 --env-file apps/node/.env -v metro-state:/data metro

ARG NODE_VERSION=22.22

FROM node:${NODE_VERSION}-alpine AS api
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/core/package.json ./packages/core/
COPY packages/upstream/package.json ./packages/upstream/
COPY packages/fleet/package.json ./packages/fleet/
COPY packages/publisher/package.json ./packages/publisher/
COPY packages/api/package.json ./packages/api/
COPY apps/node/package.json ./apps/node/
RUN npm ci
COPY packages ./packages
COPY apps/node ./apps/node
RUN npm run build:packages && npm --workspace @metro/node run build && npm prune --omit=dev

FROM node:${NODE_VERSION}-alpine AS web
WORKDIR /web
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/ ./
# Optional: a GA4 measurement id (G-…) baked into the UI; empty keeps it off.
ARG VITE_GA_MEASUREMENT_ID=
RUN npm run build

FROM node:${NODE_VERSION}-alpine
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8789 \
    WEB_DIST=/app/web/dist \
    FLEET_STATE_PATH=/data/fleet-state.json \
    DATA_DIR=/data/fleet-data
RUN mkdir /data && chown node:node /data
VOLUME /data
WORKDIR /app
COPY --from=api /app/package.json ./
COPY --from=api /app/node_modules ./node_modules
COPY --from=api /app/packages ./packages
COPY --from=api /app/apps/node/package.json ./apps/node/
COPY --from=api /app/apps/node/dist ./apps/node/dist
COPY --from=web /web/dist ./web/dist
USER node
EXPOSE 8789
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD wget -qO- "http://127.0.0.1:${PORT}/api/health" >/dev/null || exit 1
# The server handles SIGTERM itself (Effect's runMain), so no init is needed.
CMD ["node", "apps/node/dist/main.js"]
