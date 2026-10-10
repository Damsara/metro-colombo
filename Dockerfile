# syntax=docker/dockerfile:1

#   docker build -t metro .
#   docker run -p 8788:8788 metro

ARG NODE_VERSION=22.22

FROM node:${NODE_VERSION}-alpine AS api
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

FROM node:${NODE_VERSION}-alpine AS web
WORKDIR /web
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

FROM node:${NODE_VERSION}-alpine
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8788 \
    WEB_DIST=/app/web/dist \
    AUTH_STATE_PATH=/data/auth-state
RUN mkdir /data && chown node:node /data
VOLUME /data
WORKDIR /app
COPY --from=api /app/package.json ./
COPY --from=api /app/node_modules ./node_modules
COPY --from=api /app/dist ./dist
COPY --from=web /web/dist ./web/dist
USER node
EXPOSE 8788
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD wget -qO- "http://127.0.0.1:${PORT}/api/health" >/dev/null || exit 1
# The server handles SIGTERM itself (Effect's runMain), so no init is needed.
CMD ["node", "dist/server.js"]
