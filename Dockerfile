FROM node:22-slim AS build
WORKDIR /app
# better-sqlite3 compiles from source via node-gyp (no prebuilt binaries) —
# requires Python and a C++ toolchain, absent from node:22-slim by default.
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
	&& rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production DATA_DIR=/app/data PORT=3000
COPY --from=build /app/build build
COPY --from=build /app/node_modules node_modules
COPY package.json .
EXPOSE 3000
CMD ["node", "build"]
