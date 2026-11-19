# syntax=docker/dockerfile:1

# Stages: base -> deps -> dev (compose tooling) | source -> test | build -> dist | runtime; e2e.

FROM node:26-slim@sha256:e6bedef217677b276c591795e169840edd9096dbf13f29df8ef8d1856b8820bc AS base
LABEL com.black-hole.project=black-hole
ENV NPM_CONFIG_UPDATE_NOTIFIER=false \
    NPM_CONFIG_FUND=false \
    NPM_CONFIG_AUDIT=false
WORKDIR /app
RUN chown node:node /app
COPY --chmod=0755 docker/entrypoint.sh /usr/local/bin/bh-entrypoint
USER node
ENTRYPOINT ["bh-entrypoint"]

FROM base AS deps
LABEL com.black-hole.project=black-hole
COPY --chown=node:node package.json package-lock.json ./
RUN --mount=type=cache,target=/home/node/.npm,uid=1000,gid=1000,sharing=locked \
    npm ci \
    && sha256sum package-lock.json | cut -d ' ' -f 1 > node_modules/.package-lock.sha256

FROM deps AS dev
LABEL com.black-hole.project=black-hole
EXPOSE 5173
CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0"]

FROM deps AS source
LABEL com.black-hole.project=black-hole
COPY --chown=node:node . .

FROM source AS test
LABEL com.black-hole.project=black-hole
RUN npm run lint && npm run typecheck && npm test

FROM source AS build
LABEL com.black-hole.project=black-hole
RUN npm run build \
    && node scripts/render-nginx-headers.js > nginx-security-headers.conf

FROM scratch AS dist
LABEL com.black-hole.project=black-hole
COPY --from=build /app/dist/ /

FROM nginxinc/nginx-unprivileged:1.31.7-alpine@sha256:b5047b9b76845eac124358373c6852377c52e4b05834a47647e955dd91cb8f1e AS runtime
LABEL com.black-hole.project=black-hole
COPY docker/nginx/default.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/nginx-security-headers.conf /etc/nginx/snippets/security-headers.conf
COPY --from=build /app/dist/ /usr/share/nginx/html/
RUN nginx -t
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD wget -q -O /dev/null http://127.0.0.1:8080/healthz || exit 1

# The Playwright image tag must match the @playwright/test version in package.json. uid 1000
# ("ubuntu" in this image) matches the node user so both share the bind-mounted npm cache.
FROM mcr.microsoft.com/playwright:v1.65.1-noble@sha256:1507cbfc550a63a6b7396791ca4f00df17beb56342d2447b3f106c306f525579 AS e2e
LABEL com.black-hole.project=black-hole
ENV NPM_CONFIG_UPDATE_NOTIFIER=false \
    NPM_CONFIG_FUND=false \
    NPM_CONFIG_AUDIT=false
WORKDIR /app
RUN chown 1000:1000 /app
COPY --chmod=0755 docker/entrypoint.sh /usr/local/bin/bh-entrypoint
USER 1000:1000
COPY --chown=1000:1000 package.json package-lock.json ./
RUN --mount=type=cache,target=/home/ubuntu/.npm,uid=1000,gid=1000,sharing=locked \
    npm ci \
    && sha256sum package-lock.json | cut -d ' ' -f 1 > node_modules/.package-lock.sha256
COPY --chown=1000:1000 . .
ENTRYPOINT ["bh-entrypoint"]
CMD ["npx", "playwright", "test"]
