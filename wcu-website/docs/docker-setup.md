# Docker Setup Guide

This document explains how the Docker configuration works for the WCU Website project, a Nuxt 4 SSR application.

## Overview

The project uses a **multi-stage Docker build** to create an optimized production image. This approach:

- Separates build dependencies from runtime dependencies
- Produces a minimal final image (~150MB vs ~1GB for a single-stage build)
- Implements efficient layer caching to speed up rebuilds

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     Stage 1: Builder                            │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌────────┐  │
│  │ package.json│→ │   npm ci    │→ │  COPY . .   │→ │ build  │  │
│  │   (cached)  │  │  (cached)   │  │ (rebuilds)  │  │        │  │
│  └─────────────┘  └─────────────┘  └─────────────┘  └────────┘  │
│                                                          ↓      │
│                                              .output/ directory │
└─────────────────────────────────────────────────────────────────┘
                               ↓
                    Only .output/ is copied
                               ↓
┌─────────────────────────────────────────────────────────────────┐
│                     Stage 2: Runner                             │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │ node:22.12-alpine + .output/ only (~150MB total)        │    │
│  │ CMD: node .output/server/index.mjs                      │    │
│  └─────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────┘
```

## Files

| File | Purpose |
|------|---------|
| [`Dockerfile`](../Dockerfile) | Multi-stage build configuration |
| [`.dockerignore`](../.dockerignore) | Excludes files from build context |

## Dockerfile Explained

### Stage 1: Builder

```dockerfile
FROM node:22.12-alpine AS builder
```
Uses Node.js 22 on Alpine Linux as the base image. Named `builder` for reference in the second stage.

```dockerfile
WORKDIR /app
```
Sets `/app` as the working directory for all subsequent commands.

```dockerfile
COPY package.json package-lock.json ./
```
**Layer caching key:** Copies `package.json` and `package-lock.json` first. This layer is cached until either file changes.

```dockerfile
RUN npm ci
```
Installs dependencies. **This layer is cached as long as `package.json` and `package-lock.json` don't change**, even when source code changes.

> **Note:** The Dockerfile uses `npm ci` with the committed `package-lock.json` for reproducible installs.

```dockerfile
COPY . .
```
Copies all remaining source code. This layer changes on every code change, but **doesn't invalidate the cached `npm ci` layer above it**.

```dockerfile
RUN npm run build
```
Runs `nuxt build`, generating the `.output/` directory containing:
- `server/index.mjs` - The SSR server entry point
- `public/` - Static assets
- `nitro.json` - Server configuration

### Stage 2: Runner

```dockerfile
FROM node:22.12-alpine AS runner
```
Starts a **fresh image** - the builder stage is discarded. This is why the final image is so small.

```dockerfile
WORKDIR /app
```
Sets the working directory for runtime.

```dockerfile
COPY --from=builder /app/.output .output
```
Copies **only** the built output from the builder stage. The `node_modules/` and source code are NOT copied - they remain in the discarded builder image.

| Part | Meaning |
|------|---------|
| `--from=builder` | Copy from the "builder" stage |
| `/app/.output` | Source path in builder |
| `.output` | Destination path (becomes `/app/.output`) |

```dockerfile
ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3000
```
Sets runtime environment variables:
- `NODE_ENV=production` - Enables production optimizations
- `HOST=0.0.0.0` - Allows connections from outside the container
- `PORT=3000` - Server listens on port 3000

```dockerfile
EXPOSE 3000
```
Documents that the container listens on port 3000. This is metadata only - actual port publishing is done at `docker run`.

```dockerfile
CMD ["node", ".output/server/index.mjs"]
```
Default command to start the Nuxt SSR server. Uses exec form (JSON array) for proper signal handling.

## .dockerignore Explained

The [`.dockerignore`](../.dockerignore) file excludes files from the Docker build context:

| Pattern | Purpose |
|---------|---------|
| `node_modules` | **Critical:** Prevents local node_modules from being copied and invalidating cache |
| `.output`, `.nuxt`, `dist` | Excludes build artifacts |
| `.git`, `docs`, `*.md` | Excludes version control and documentation |
| `.vscode`, `.idea` | Excludes IDE configuration |

> **Note:** `package-lock.json` is intentionally included in the Docker build context so `npm ci` is deterministic.

## Layer Caching

Docker caches layers top-to-bottom. Each layer only invalidates layers **below** it in the Dockerfile.

### When Only Source Code Changes

```
package.json + package-lock.json → CACHED ✓ (unchanged)
npm ci          → CACHED ✓ (package files unchanged)
COPY . .        → REBUILDS (source changed)
npm run build   → REBUILDS (depends on source)
```

**Result:** Fast rebuild, dependencies don't reinstall.

### When Dependencies Change

```
package.json + package-lock.json → REBUILDS (changed)
npm ci          → REBUILDS (package files changed)
COPY . .        → REBUILDS (cache invalidated)
npm run build   → REBUILDS (cache invalidated)
```

**Result:** Full rebuild, dependencies reinstall.

## Usage

### Build the Image

```bash
cd wcu-website
docker build -t wcu-website .
```

### Run the Container

```bash
docker run -p 3000:3000 wcu-website
```

The application will be available at `http://localhost:3000`.

### Build with No Cache (Full Rebuild)

```bash
docker build --no-cache -t wcu-website .
```

### View Image Size

```bash
docker images wcu-website
```

## Troubleshooting

### Dependencies Reinstalling on Every Build

**Symptoms:** `npm ci` runs even when only source code changed.

**Causes:**
1. Local `node_modules/` folder exists and isn't in `.dockerignore`
2. `.dockerignore` file is missing or misconfigured
3. Building from wrong directory (should be `wcu-website/`)
4. Docker cache was pruned (`docker system prune`)

**Solution:** Verify `.dockerignore` contains `node_modules` and build from the correct directory.

### Platform-Specific Binary Errors

**Symptoms:** Errors about `oxc-parser` or other native modules not found.

**Common causes:**
- `package-lock.json` is missing/out of sync
- The build isn't using `npm ci`
- Node/npm version mismatch between local and container

**Solution:** Ensure Docker builds use `npm ci` and the committed `package-lock.json`. If the lockfile needs updating, regenerate it locally and commit the updated `package-lock.json`.

### Container Won't Start

**Symptoms:** Container exits immediately or can't connect.

**Checks:**
1. Verify the image built successfully: `docker images wcu-website`
2. Check container logs: `docker logs <container-id>`
3. Ensure port 3000 isn't already in use
4. Try running interactively: `docker run -it -p 3000:3000 wcu-website sh`

### Image Size Too Large

**Symptoms:** Final image is >500MB.

**Cause:** Single-stage build or copying unnecessary files.

**Solution:** Ensure you're using the multi-stage Dockerfile and `.dockerignore` is properly configured.

## Related Documentation

- [Coolify Deployment Guide](coolify-deployment.md) - Deploying with Coolify + Dockerfile
- [README.md](../../README.md) - Project overview and development setup
