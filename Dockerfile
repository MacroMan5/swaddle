FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
# --ignore-scripts: better-sqlite3 ships N-API prebuilds (glibc + musl, x64 +
# arm64); skipping its default `node-gyp rebuild` avoids pulling a C++
# toolchain into the build stage and keeps arm64 builds fast under emulation.
RUN npm ci --ignore-scripts
COPY . .
RUN npm run build && npm prune --omit=dev

FROM node:22-slim
WORKDIR /app
# BODY_SIZE_LIMIT: adapter-node caps request bodies at 512 KiB by default,
# which is smaller than the JSON export of a household with a couple of years
# of events — restoring one would fail (issue #45). 10 MiB is the bound the
# application itself enforces (src/lib/limits.ts); keep the two equal.
ENV NODE_ENV=production DATA_DIR=/app/data PORT=3000 BODY_SIZE_LIMIT=10M
COPY --from=build /app/build build
COPY --from=build /app/node_modules node_modules
COPY package.json server.js ./
# node:22-slim ships a built-in "node" user (uid 1000, gid 1000). Run as that
# fixed identity instead of root; the mounted data volume must be owned by the
# same uid/gid on the host (see deploy/README.md).
RUN mkdir -p "$DATA_DIR" && chown -R node:node /app
USER node
EXPOSE 3000
# Custom entrypoint (not `node build`): it adds the security headers to the
# static assets adapter-node serves ahead of SvelteKit (issue #55).
CMD ["node", "server.js"]
