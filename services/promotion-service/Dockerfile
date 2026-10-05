# syntax=docker/dockerfile:1.7
# Build context is services/ so the shared library is available:
#   docker build -f promotion-service/Dockerfile -t shopverse/promotion-service:<sha> services/
ARG NODE_IMAGE=node:22-alpine

FROM ${NODE_IMAGE} AS build
WORKDIR /app
COPY . .
RUN --mount=type=cache,target=/root/.npm \
    npm ci --workspace promotion-service --include-workspace-root --ignore-scripts --no-audit --no-fund
RUN npx tsc -b promotion-service
# Re-install production dependencies only (workspace symlink to libs/common is preserved).
RUN --mount=type=cache,target=/root/.npm \
    rm -rf node_modules && npm ci --omit=dev --workspace promotion-service --ignore-scripts --no-audit --no-fund
# Amazon RDS CA bundle for verify-full TLS to RDS (DB_SSL_CA_PATH default).
ADD --chmod=644 https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem /tmp/rds-global-bundle.pem

FROM ${NODE_IMAGE}
ENV NODE_ENV=production \
    PORT=8080 \
    SERVICE_NAME=promotion-service \
    NODE_OPTIONS="--enable-source-maps"
# npm/yarn are not needed at runtime; removing them shrinks the image and its CVE surface.
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx /opt/yarn* /usr/local/bin/yarn*
WORKDIR /app
COPY --from=build /tmp/rds-global-bundle.pem /etc/ssl/certs/rds-global-bundle.pem
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/libs/common/package.json ./libs/common/package.json
COPY --from=build /app/libs/common/dist ./libs/common/dist
COPY --from=build /app/libs/common/migrations ./libs/common/migrations
WORKDIR /app/promotion-service
COPY --from=build /app/promotion-service/package.json ./package.json
COPY --from=build /app/promotion-service/dist ./dist
COPY --from=build /app/promotion-service/migrations ./migrations
USER 10001:10001
EXPOSE 8080
# Read-only root filesystem friendly: nothing is written outside /tmp (mount an emptyDir there).
CMD ["node", "--import", "@shopverse/common/tracing", "dist/index.js"]
