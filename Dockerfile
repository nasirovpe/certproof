# syntax=docker/dockerfile:1

# ==============================================================================
# CertProof Multi-Stage Application Dockerfile
# Base Image: Node.js 22 LTS on Alpine Linux
# ==============================================================================

# Stage 1: Install dependencies
FROM node:22-alpine AS deps
RUN apk add --no-cache libc6-compat
WORKDIR /app

# Copy dependency manifests
COPY frontend/package.json frontend/package-lock.json ./

# Clean reproducible installation based on existing lockfile
RUN npm ci

# ------------------------------------------------------------------------------
# Stage 2: Build the Next.js application
# ------------------------------------------------------------------------------
FROM node:22-alpine AS builder
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY frontend ./

ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production

# Public configuration variables embedded into client bundles at build time
ARG NEXT_PUBLIC_APP_URL=http://localhost:3000
ARG NEXT_PUBLIC_CHAIN_ID=31337
ARG NEXT_PUBLIC_REGISTRY_ADDRESS=0x5fbdb2315678afecb367f032d93f642f64180aa3
ARG NEXT_PUBLIC_ANVIL_RPC_URL=http://127.0.0.1:8545
ARG NEXT_PUBLIC_SEPOLIA_RPC_URL=https://rpc.sepolia.org

ENV NEXT_PUBLIC_APP_URL=$NEXT_PUBLIC_APP_URL \
    NEXT_PUBLIC_CHAIN_ID=$NEXT_PUBLIC_CHAIN_ID \
    NEXT_PUBLIC_REGISTRY_ADDRESS=$NEXT_PUBLIC_REGISTRY_ADDRESS \
    NEXT_PUBLIC_ANVIL_RPC_URL=$NEXT_PUBLIC_ANVIL_RPC_URL \
    NEXT_PUBLIC_SEPOLIA_RPC_URL=$NEXT_PUBLIC_SEPOLIA_RPC_URL

# Build application with standalone output (Web Worker chunks compiled into .next/static)
RUN npm run build

# ------------------------------------------------------------------------------
# Stage 3: Minimal production runner
# ------------------------------------------------------------------------------
FROM node:22-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME="0.0.0.0"

# Non-root user execution
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

# Static public assets
COPY --from=builder /app/public ./public

# Set up runtime cache permissions
RUN mkdir -p .next && chown -R nextjs:nodejs .next

# Copy standalone server and static assets (including Web Worker chunks)
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

# In case tracing nested standalone under frontend/, link static assets there as well
RUN if [ -d "./frontend" ]; then \
      mkdir -p ./frontend/.next && \
      cp -r ./.next/static ./frontend/.next/static && \
      cp -r ./public ./frontend/public && \
      chown -R nextjs:nodejs ./frontend; \
    fi

# Switch to non-root user
USER nextjs

EXPOSE 3000

# Health check endpoint (verifies server process is up and responding)
HEALTHCHECK --interval=5s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://127.0.0.1:3000/api/auth/session || exit 1

# Start script detects root server.js or frontend/server.js
CMD ["sh", "-c", "if [ -f ./server.js ]; then node server.js; elif [ -f ./frontend/server.js ]; then node frontend/server.js; else echo 'server.js not found' && exit 1; fi"]
