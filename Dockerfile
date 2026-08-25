# syntax=docker/dockerfile:1

FROM node:24-bookworm-slim AS deps
WORKDIR /app
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
  && rm -rf /var/lib/apt/lists/*
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY scripts/run-pnpm.mjs scripts/toolchain-contract.mjs scripts/
RUN npm run bootstrap

FROM node:24-bookworm-slim AS build
WORKDIR /app
ARG SENTRY_ORG
ARG SENTRY_PROJECT
ARG SENTRY_RELEASE
ARG SENTRY_URL
ARG SENTRY_UPLOAD_CACHE_BUST=disabled
COPY --from=deps /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/ca-certificates.crt
RUN test -s /etc/ssl/certs/ca-certificates.crt
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN test ! -e /app/.env.container-canary \
  && test ! -e /app/server/.env.container-canary \
  && test ! -e /app/.env \
  && test ! -e /app/.git \
  && test ! -e /app/data
RUN --mount=type=secret,id=SENTRY_AUTH_TOKEN,env=BUILD_SECRET_SENTRY_AUTH_TOKEN,required=false \
  --mount=type=secret,id=SENTRY_ORG,env=BUILD_SECRET_SENTRY_ORG,required=false \
  --mount=type=secret,id=SENTRY_PROJECT,env=BUILD_SECRET_SENTRY_PROJECT,required=false \
  --mount=type=secret,id=SENTRY_RELEASE,env=BUILD_SECRET_SENTRY_RELEASE,required=false \
  --mount=type=secret,id=SENTRY_URL,env=BUILD_SECRET_SENTRY_URL,required=false \
  --mount=type=secret,id=SENTRY_UPLOAD_CACHE_BUST,env=BUILD_SECRET_SENTRY_UPLOAD_CACHE_BUST,required=false \
  export SENTRY_AUTH_TOKEN="${BUILD_SECRET_SENTRY_AUTH_TOKEN:-}" \
  SENTRY_ORG="${BUILD_SECRET_SENTRY_ORG:-$SENTRY_ORG}" \
  SENTRY_PROJECT="${BUILD_SECRET_SENTRY_PROJECT:-$SENTRY_PROJECT}" \
  SENTRY_UPLOAD_CACHE_BUST="${BUILD_SECRET_SENTRY_UPLOAD_CACHE_BUST:-$SENTRY_UPLOAD_CACHE_BUST}" \
  && if [ -n "${BUILD_SECRET_SENTRY_RELEASE:-}" ]; then \
    export SENTRY_RELEASE="$BUILD_SECRET_SENTRY_RELEASE"; \
  elif [ -z "${SENTRY_RELEASE:-}" ]; then \
    unset SENTRY_RELEASE; \
  fi \
  && if [ -n "${BUILD_SECRET_SENTRY_URL:-}" ]; then \
    export SENTRY_URL="$BUILD_SECRET_SENTRY_URL"; \
  elif [ -z "${SENTRY_URL:-}" ]; then \
    unset SENTRY_URL; \
  fi \
  && npm run pnpm -- run build
RUN mkdir -p /app/.output/server/db \
  && cp /app/server/maintenance.mjs /app/.output/server/maintenance.mjs \
  && cp -R /app/server/db/migrations /app/.output/server/db/migrations \
  && cp /app/node_modules/drizzle-orm/better-sqlite3/migrator.js /app/.output/server/node_modules/drizzle-orm/better-sqlite3/migrator.js \
  && cp /app/node_modules/drizzle-orm/migrator.js /app/.output/server/node_modules/drizzle-orm/migrator.js

FROM node:24-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV NUXT_DATABASE_URL=file:/app/data/app.db
ENV NITRO_HOST=0.0.0.0
ENV NITRO_PORT=3000
COPY --from=build --chown=node:node /app/.output ./.output
RUN mkdir -p /app/data \
  && chown node:node /app/data
VOLUME ["/app/data"]
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 CMD ["node", "-e", "const fail=()=>process.exit(1);const token=process.env.NUXT_READINESS_TOKEN;if(!token)fail();fetch('http://127.0.0.1:3000/api/ready',{headers:{authorization:'Bearer '+token},signal:AbortSignal.timeout(3000)}).then(async(response)=>{if(response.status!==200)fail();const body=await response.json().catch(fail);const keys=body&&typeof body==='object'&&!Array.isArray(body)?Object.keys(body):[];process.exit(keys.length===1&&keys[0]==='status'&&body.status==='ready'?0:1)}).catch(fail)"]
USER node:node
CMD ["node", "--import", "./.output/server/sentry.server.config.mjs", ".output/server/index.mjs"]
