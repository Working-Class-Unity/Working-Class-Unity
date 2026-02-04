# Dockerfile for Nuxt 4 SSR Deployment
# Uses Node 22.12 to meet Nuxt 4.2.1 requirements (^20.19.0 || >=22.12.0)

FROM node:22.12-alpine AS builder

WORKDIR /app

# Copy package files first for better caching
COPY package.json package-lock.json ./

RUN npm ci

# Copy the rest of the application
COPY . .

# Build the Nuxt application
RUN npm run build

# Production stage
FROM node:22.12-alpine AS runner

# Create a non-root user for security
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nuxt -u 1001

WORKDIR /app

# Copy only the built output from builder stage
COPY --from=builder /app/.output .output

# Change ownership to non-root user
RUN chown -R nuxt:nodejs /app

# Switch to non-root user
USER nuxt

# Set production environment
ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3000

EXPOSE 3000

# Start the Nuxt server
CMD ["node", ".output/server/index.mjs"]
