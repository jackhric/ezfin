# ezfin: local-first finance dashboard in one container.
#
#   docker build -t ezfin .
#   docker run --rm -p 127.0.0.1:8787:8787 -v ezfin-data:/data ezfin
#
# Then open http://127.0.0.1:8787. Publish the port on 127.0.0.1 only (as above)
# so the dashboard is not reachable from other machines on your network.

FROM node:22-bookworm-slim AS build
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=1
RUN npm install -g pnpm@12.18.0
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.json vite.config.ts ./
COPY apps/web/package.json apps/web/
COPY apps/api/package.json apps/api/
COPY packages/core/package.json packages/core/
RUN pnpm install --frozen-lockfile
COPY apps apps
COPY packages packages
RUN pnpm --filter web run build

FROM node:22-bookworm-slim
ENV NODE_ENV=production \
    EZFIN_HOST=0.0.0.0 \
    EZFIN_PORT=8787 \
    EZFIN_DATA_DIR=/data \
    EZFIN_STATIC_DIR=/app/apps/web/dist \
    EZFIN_ALLOW_NONLOCAL_BIND=1
WORKDIR /app
# Runtime needs the API sources, the core package, the built UI and node_modules
# (vpx from vite-plus runs the TypeScript sources directly).
COPY --from=build /app/package.json /app/pnpm-workspace.yaml /app/tsconfig.json /app/vite.config.ts ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/apps/api ./apps/api
COPY --from=build /app/apps/web/dist ./apps/web/dist
COPY --from=build /app/apps/web/package.json ./apps/web/package.json
COPY --from=build /app/packages/core ./packages/core
RUN mkdir -p /data && chown -R node:node /data /app
USER node
VOLUME ["/data"]
EXPOSE 8787
CMD ["./node_modules/.bin/vpx", "apps/api/src/server.ts"]
