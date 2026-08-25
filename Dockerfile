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
ENV NODE_ENV=production DATA_DIR=/app/data PORT=3000
COPY --from=build /app/build build
COPY --from=build /app/node_modules node_modules
COPY package.json .
# node:22-slim ships a built-in "node" user (uid 1000, gid 1000). Run as that
# fixed identity instead of root; the mounted data volume must be owned by the
# same uid/gid on the host (see deploy/README.md).
RUN mkdir -p "$DATA_DIR" && chown -R node:node /app
USER node
EXPOSE 3000
CMD ["node", "build"]
