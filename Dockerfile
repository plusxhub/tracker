# syntax=docker/dockerfile:1

FROM oven/bun:1.3 AS deps
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

FROM deps AS build
COPY . .
RUN bun run build

# The image carries code only: the server build bundles its dependencies, and the
# catalogue lives in Postgres, read at runtime through the read-only tracker_web role.
FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=4321
COPY --from=build /app/dist ./dist
COPY package.json ./
USER node
EXPOSE 4321
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:4321/healthz >/dev/null || exit 1
CMD ["node", "./dist/server/entry.mjs"]
