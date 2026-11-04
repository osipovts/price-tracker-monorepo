# One Dockerfile for every app: docker compose passes APP_NAME and picks the target
# (see docker-compose.yml and docker-compose.dev.yml). Build context is the monorepo root.
# Keep the version in sync with .nvmrc.
ARG NODE_VERSION=26.12

################################
# Runtime
################################
FROM node:${NODE_VERSION}-slim AS runtime
WORKDIR /app
# The Prisma schema engine that applies the migrations needs OpenSSL.
RUN apt-get update && \
    apt-get install -y --no-install-recommends openssl && \
    rm -rf /var/lib/apt/lists/*

################################
# pnpm
################################
FROM runtime AS pnpm
# Install the pnpm version pinned in package.json "packageManager" (without the "+sha..." suffix)
RUN --mount=type=bind,source=package.json,target=/tmp/package.json \
    npm install -g --prefix /opt/pnpm \
      "$(node -p "require('/tmp/package.json').packageManager.split('+')[0]")"

################################
# Base
################################
FROM runtime AS base
ENV PATH="/opt/pnpm/bin:$PATH"
COPY --from=pnpm /opt/pnpm /opt/pnpm
RUN pnpm config set store-dir /pnpm-store

################################
# Dependencies
################################
FROM base AS fetch
# better-sqlite3 of camoufox-js has no binary for this Node.js and is compiled.
# The headers come with the Node.js image: they are put where node-gyp looks for them, so that it
# does not download them (the build machine may not reach nodejs.org).
RUN apt-get update && \
    apt-get install -y --no-install-recommends python3 make g++ && \
    rm -rf /var/lib/apt/lists/* && \
    headers="/root/.cache/node-gyp/$(node -p 'process.versions.node')" && \
    mkdir -p "$headers" && \
    cp -r /usr/local/include "$headers/include" && \
    echo 11 > "$headers/installVersion"
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY .npmrc* ./
# The fixes of dependencies the lockfile refers to (pnpm patch).
COPY patches ./patches
# Downloads the packages of the whole lockfile into the store: the layer depends on the lockfile
# only. pnpm has verified the lockfile when it wrote it; --trust-lockfile skips verifying it again,
# which would request the metadata of every package from the registry.
RUN --mount=type=cache,id=pnpm-store,target=/pnpm-store \
    --mount=type=cache,id=pnpm-metadata,target=/root/.cache/pnpm \
    pnpm --trust-lockfile fetch --frozen-lockfile

################################
# Installation
################################
FROM fetch AS install
ARG APP_NAME
# Only the workspace packages and the app itself: changes of the other apps keep the cache.
COPY packages ./packages
COPY apps/${APP_NAME} ./apps/${APP_NAME}
# Links the app and the workspace packages it depends on from the store. The store is a cache mount,
# which the layer cache of CI does not keep: when the fetch layer comes from that cache, the store
# is empty and the packages it lacks are downloaded.
RUN --mount=type=cache,id=pnpm-store,target=/pnpm-store \
    --mount=type=cache,id=pnpm-metadata,target=/root/.cache/pnpm \
    --mount=type=cache,id=prisma-engines,target=/root/.cache/prisma \
    pnpm --trust-lockfile install --prefer-offline --frozen-lockfile --filter ${APP_NAME}...

################################
# Build
################################
FROM install AS build
ARG APP_NAME
# The trailing "..." builds the workspace packages the app depends on first.
RUN pnpm --filter ${APP_NAME}... build
RUN --mount=type=cache,id=pnpm-store,target=/pnpm-store \
    --mount=type=cache,id=pnpm-metadata,target=/root/.cache/pnpm \
    --mount=type=cache,id=prisma-engines,target=/root/.cache/prisma \
    pnpm --trust-lockfile --prefer-offline --filter ${APP_NAME} deploy --prod /deploy

################################
# Development (the code is mounted, see docker-compose.dev.yml)
################################
FROM base AS dev
ENV NODE_ENV=development

################################
# Admin panel (static files the hub serves)
################################
FROM fetch AS admin-ui-build
COPY packages/frontend-shared ./packages/frontend-shared
COPY apps/frontend-admin ./apps/frontend-admin
RUN --mount=type=cache,id=pnpm-store,target=/pnpm-store \
    --mount=type=cache,id=pnpm-metadata,target=/root/.cache/pnpm \
    pnpm --trust-lockfile install --prefer-offline --frozen-lockfile --filter frontend-admin...
RUN pnpm --filter frontend-admin build

################################
# Client app (static files the hub serves)
################################
FROM fetch AS client-ui-build
COPY packages/frontend-shared ./packages/frontend-shared
COPY apps/frontend-client ./apps/frontend-client
RUN --mount=type=cache,id=pnpm-store,target=/pnpm-store \
    --mount=type=cache,id=pnpm-metadata,target=/root/.cache/pnpm \
    pnpm --trust-lockfile install --prefer-offline --frozen-lockfile --filter frontend-client...
RUN pnpm --filter frontend-client build

################################
# Hub
################################
FROM runtime AS hub-prod
ENV NODE_ENV=production \
    ADMIN_UI_DIR=/app/panel \
    CLIENT_UI_DIR=/app/client
COPY --from=admin-ui-build /app/apps/frontend-admin/dist ./panel
COPY --from=client-ui-build /app/apps/frontend-client/dist ./client
COPY --from=build /deploy/node_modules ./node_modules
COPY --from=build /deploy/dist ./dist
COPY --from=build /deploy/prisma ./prisma
COPY --from=build /deploy/prisma.config.js ./prisma.config.js
COPY --from=build /deploy/package.json ./package.json
# A failed download of the Prisma engine does not fail the install: without the engine `migrate` cannot run.
RUN find node_modules/.pnpm -path '*@prisma/engines/schema-engine-*' | grep -q .
USER node
EXPOSE 3000
CMD ["node", "dist/index.js"]

################################
# Proxy fetcher
################################
FROM runtime AS proxy-fetcher-prod
ENV NODE_ENV=production
COPY --from=build /deploy/node_modules ./node_modules
COPY --from=build /deploy/dist ./dist
COPY --from=build /deploy/package.json ./package.json
USER node
CMD ["node", "dist/index.js"]

################################
# Camoufox for the price fetcher
################################
FROM install AS camoufox-version
ARG APP_NAME
# The browser stage below is cached until the installed camoufox-js version changes.
RUN cd apps/${APP_NAME} && node -p "require('camoufox-js/package.json').version" > /camoufox-version

FROM runtime AS camoufox
# The browser is kept outside of the home of the user the app runs as.
ENV XDG_CACHE_HOME=/opt/camoufox-cache \
    DISPLAY=:99
# Libraries of Firefox, and the fonts a Russian site is drawn with.
RUN apt-get update && \
    apt-get install -y --no-install-recommends xvfb libgtk-3-0 libdbus-glib-1-2 libasound2 libx11-xcb1 libxt6 fonts-liberation && \
    rm -rf /var/lib/apt/lists/*
COPY --from=camoufox-version /camoufox-version /tmp/camoufox-version
RUN --mount=type=cache,id=npm,target=/root/.npm \
    npx -y "camoufox-js@$(cat /tmp/camoufox-version)" fetch && \
    chmod -R a+rX /opt/camoufox-cache
# Xvfb runs beside the app instead of xvfb-run wrapping it: the app gets SIGTERM itself
# and finishes the job in progress while the display is still there. A restarted container
# keeps the lock of the previous Xvfb.
ENTRYPOINT ["sh", "-c", "rm -f /tmp/.X99-lock /tmp/.X11-unix/X99; Xvfb :99 -screen 0 1280x1024x24 -nolisten tcp & until [ -e /tmp/.X11-unix/X99 ]; do kill -0 $! || exit 1; sleep 0.1; done; exec \"$@\"", "xvfb"]

################################
# Price fetcher
################################
FROM camoufox AS price-fetcher-dev
ENV NODE_ENV=development \
    PATH="/opt/pnpm/bin:$PATH"
COPY --from=pnpm /opt/pnpm /opt/pnpm

FROM camoufox AS price-fetcher-prod
ENV NODE_ENV=production
COPY --from=build /deploy/node_modules ./node_modules
COPY --from=build /deploy/dist ./dist
COPY --from=build /deploy/package.json ./package.json
USER node
CMD ["node", "dist/worker.js"]

################################
# Handbook fetcher: reads the sites in the browser, like the price fetcher
################################
FROM camoufox AS handbook-fetcher-dev
ENV NODE_ENV=development \
    PATH="/opt/pnpm/bin:$PATH"
COPY --from=pnpm /opt/pnpm /opt/pnpm

FROM camoufox AS handbook-fetcher-prod
ENV NODE_ENV=production
COPY --from=build /deploy/node_modules ./node_modules
COPY --from=build /deploy/dist ./dist
COPY --from=build /deploy/package.json ./package.json
USER node
CMD ["node", "dist/index.js"]
