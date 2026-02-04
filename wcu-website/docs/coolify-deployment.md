# Coolify Deployment Guide

This guide explains how to deploy the WCU Website (Nuxt 4) application using [Coolify](https://coolify.io/).

**Repository**: [https://github.com/harpreetchima/Working-Class-Unity](https://github.com/harpreetchima/Working-Class-Unity)

## Overview

This application uses **Server-Side Rendering (SSR)** for optimal SEO and internationalization support. SSR is the recommended deployment method because:

- **SEO Benefits**: Search engines receive fully rendered HTML content
- **i18n Support**: Language detection and routing work correctly on first page load
- **Dynamic Content**: Cal.com embeds and Formbricks surveys function properly
- **Performance**: Initial page loads are faster with server-rendered content

Coolify is a self-hosted Platform-as-a-Service (PaaS) that deploys applications as Docker containers. For this repo, the most predictable path is to use Coolify's **Dockerfile** build pack with the Dockerfile in `wcu-website/`.

> ⚠️ **Important**: Do **NOT** enable "Is it a static site?" for this application. That option is only for static site generation (SSG), which is not recommended for this project.

## Prerequisites

Before deploying, ensure you have:

- A Coolify instance with a connected server
- GitHub repository connected via GitHub App integration
- Domain configured in Coolify (optional but recommended)
- Access to the Coolify dashboard with permissions to create applications

## Application Specifications

| Component | Version | Notes |
|-----------|---------|-------|
| Nuxt | 4.2.1 | SSR enabled by default |
| Node.js | ^20.19.0 \|\| >=22.12.0 | Required for Nuxt 4.2.1 |
| Vue | 3.5.25 | |
| Tailwind CSS | 4.1.17 | With Vite plugin |
| DaisyUI | 5.5.5 | Component library |
| i18n | 10.2.1 | English, Spanish, Punjabi |

## Deployment Configuration

### Option 1: Dockerfile SSR Deployment (Recommended)

Server-Side Rendering provides better SEO and initial load performance.

This repo includes a production Dockerfile at `wcu-website/Dockerfile`.

#### Coolify Settings (Dockerfile build pack)

| Setting | Value |
|---------|-------|
| **Build Pack** | `dockerfile` |
| **Base Directory** | `wcu-website` |
| **Port Exposes** | `3000` |
| **Health Check Path** | `/` |

#### How It Works

1. Coolify builds the image using `wcu-website/Dockerfile`
2. The container starts via the Dockerfile `CMD` (Nuxt Nitro server)
3. Coolify routes traffic to the container on port 3000

### Option 2: Static Site Generation (SSG)

Generate static HTML files for hosting without a Node.js server.

#### Coolify Settings

| Setting | Value |
|---------|-------|
| **Build Pack** | `nixpacks` |
| **Base Directory** | `wcu-website` |
| **Is it a static site?** | `true` (enabled) |
| **Output Directory** | `dist` |
| **Build Command** | `npm run generate` |

#### How It Works

1. Runs `nuxt generate` to create static files
2. Outputs to `dist` directory
3. Coolify serves files via Nginx

> **Note**: SSG may have limitations with dynamic content and is **not recommended** for this application due to i18n support requirements. Use SSR (Option 1) instead for best SEO and internationalization support.

### Option 3: Nixpacks SSR (Alternative)

If you prefer, you can deploy SSR with Coolify's Nixpacks build pack instead of using a Dockerfile.

#### Coolify Settings (Nixpacks)

| Setting | Value |
|---------|-------|
| **Build Pack** | `nixpacks` |
| **Base Directory** | `wcu-website` |
| **Port Exposes** | `3000` |
| **Build Command** | `npm run build` |
| **Start Command** | `node .output/server/index.mjs` |

## Environment Variables

Configure these in Coolify's **Environment Variables** section if needed:

| Variable | Description | Example |
|----------|-------------|---------|
| `NUXT_PUBLIC_FORMBRICKS_ENVIRONMENT_ID` | Formbricks environment ID (public, used client-side) | `cminsehli0009o8015hjuzkuz` |
| `NUXT_PUBLIC_FORMBRICKS_APP_URL` | Formbricks app URL (public, used client-side) | `https://form.workingclassunity.com` |
| `NODE_ENV` | Environment mode | `production` |

### Build-time vs Runtime Variables

- `NUXT_PUBLIC_*` - Available in both server and client code
- `NUXT_*` - Server-only variables
- Add to **Build Variables** if needed during build process

## i18n Routes

The application uses the `prefix_except_default` strategy:

| Language | URL Path | Example |
|----------|----------|---------|
| English (default) | `/` | `/about`, `/join` |
| Spanish | `/es/` | `/es/about`, `/es/join` |
| Punjabi | `/pa/` | `/pa/about`, `/pa/join` |

All routes work automatically with Coolify's Traefik proxy.

## Health Checks

Coolify performs container health checks by default. The Nuxt server responds on port 3000.

**Recommended Health Check Settings:**

| Setting | Value |
|---------|-------|
| **Health Check Path** | `/` |
| **Health Check Interval** | `30s` |
| **Health Check Timeout** | `10s` |
| **Health Check Start Period** | `60s` |

If you encounter health check issues:
1. Ensure the start command is correct: `node .output/server/index.mjs`
2. Verify port 3000 is exposed
3. Check container logs in Coolify dashboard
4. Temporarily disable health checks to debug

## Nixpacks Configuration (Optional)

If you deploy with Nixpacks (Option 3), you may want to pin the Node.js version to match Nuxt 4.2.1 requirements.

To customize the build, add a `nixpacks.toml` file in the `wcu-website` directory:

```toml
[phases.build]
cmds = ["npm run build"]

[phases.setup]
nixPkgs = ["nodejs_22"]

[start]
cmd = "node .output/server/index.mjs"
```

**When to use `nixpacks.toml`:**
- Need a specific Node.js version
- Custom build steps required
- Environment-specific build configurations

## Domain Configuration

1. In Coolify, navigate to your application
2. Add your domain(s) in the **Domains** section
3. Enable **Force HTTPS** for security (enabled by default)
4. Coolify automatically provisions SSL certificates via Let's Encrypt

### Multiple Domains

You can configure multiple domains:
- `wcu.example.com` - Primary domain
- `www.wcu.example.com` - WWW subdomain

## Auto Deploy

Enable automatic deployments when pushing to your repository:

1. Connect your GitHub repository via GitHub App integration
2. Enable **Auto Deploy** in application settings
3. Configure the target branch (e.g., `master` or a dedicated `production` branch)

### Preview Deployments

For pull request previews:
1. Enable **Preview Deployments**
2. Set URL template: `{{pr_id}}.{{domain}}`
3. PRs will deploy to URLs like `123.wcu.example.com`

## Troubleshooting

### Build Fails

**Check Base Directory**: Ensure `wcu-website` is set correctly since the Nuxt app is in a subdirectory.

**Node Version Mismatch**: If you see errors related to Node.js version:
1. Ensure Node.js meets Nuxt 4.2.1 requirements: `^20.19.0 || >=22.12.0`
2. If using Nixpacks, pin Node via `nixpacks.toml` (for example: `nodejs_22`)

**Lock File Issues**: Dockerfile builds use `npm ci` + the committed `package-lock.json`. If you need to update dependencies, regenerate the lockfile locally and commit it:

```bash
cd wcu-website
rm -rf node_modules
npm install
git add package-lock.json
git commit -m "Update package-lock.json"
```

### Container Won't Start

**Verify Start Command**: Must be `node .output/server/index.mjs`

**Check Logs**: In Coolify dashboard, view container logs for errors.

**Memory Issues**: Increase container memory limits if OOM errors occur:
- Set memory limit to at least 512MB
- Set memory reservation to 256MB

### Port Configuration Issues

If the application doesn't respond:
1. Verify **Port Exposes** is set to `3000`
2. Ensure no other setting overrides the port
3. Check that `HOST=0.0.0.0` is set in environment variables (usually automatic)

### 502 Bad Gateway

1. Container may still be starting - wait 30 seconds
2. Check if container is healthy in Coolify dashboard
3. Verify port 3000 is correctly exposed
4. Review Traefik proxy logs

### Static Assets Not Loading

For SSR deployments, static assets are served from `.output/public`. If assets fail to load:
1. Clear Coolify's build cache
2. Rebuild the application
3. Check browser console for 404 errors

### Environment Variable Issues

If environment variables aren't working:
1. Verify `NUXT_PUBLIC_*` prefix for client-exposed variables
2. Check if variables need to be in **Build Variables** vs **Environment Variables**
3. Rebuild the application after adding new build-time variables
4. Use `useRuntimeConfig()` in Nuxt to access variables

## Verification Steps

After deployment, verify everything is working correctly:

### 1. Check Application Status

In Coolify dashboard:
- [ ] Container status shows "Running"
- [ ] Health check shows "Healthy" (green)
- [ ] No error messages in logs

### 2. Test the Application

Visit your deployed URL and verify:
- [ ] Homepage loads correctly
- [ ] Navigation works between pages
- [ ] Styling (Tailwind CSS/DaisyUI) is applied
- [ ] Images and static assets load

### 3. Test i18n Routes

Test language switching:
- [ ] English: `https://yourdomain.com/`
- [ ] Spanish: `https://yourdomain.com/es/`
- [ ] Punjabi: `https://yourdomain.com/pa/`

### 4. Test Third-Party Integrations

- [ ] Cal.com calendar embeds load on relevant pages
- [ ] Formbricks surveys trigger correctly

### 5. Test SSL/HTTPS

- [ ] Site redirects HTTP to HTTPS
- [ ] SSL certificate is valid (no browser warnings)
- [ ] Mixed content warnings don't appear

## Resource Recommendations

| Environment | CPU | Memory |
|-------------|-----|--------|
| Development/Testing | 0.5 cores | 512MB |
| Production (low traffic) | 1 core | 1GB |
| Production (high traffic) | 2+ cores | 2GB+ |

## Related Documentation

- [Coolify Documentation](https://coolify.io/docs)
- [Nuxt Deployment Guide](https://nuxt.com/docs/getting-started/deployment)
- [Nixpacks Documentation](https://nixpacks.com/docs)

---

*Last updated: December 2024*
