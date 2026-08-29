# ==========================================
# Multi-Stage Dockerfile for AgentLedger
# Optimized for Google Cloud Run
# ==========================================

# ------------------------------------------
# Stage 1: Build & Compile TypeScript
# ------------------------------------------
FROM node:20-alpine AS builder

WORKDIR /app

# Install build dependencies
COPY package.json tsconfig.json ./
RUN npm install

# Copy source code
COPY src/ ./src/

# Compile TypeScript
RUN npm run build

# Prune development dependencies to minimize container footprint
RUN npm prune --omit=dev

# ------------------------------------------
# Stage 2: Minimal Production Runtime
# ------------------------------------------
FROM node:20-alpine AS runner

WORKDIR /app

# Environment variables for Cloud Run
ENV NODE_ENV=production
ENV PORT=8080

# Create application directory and assign permissions to non-root 'node' user
RUN chown -R node:node /app

# Copy production artifacts from builder
COPY --from=builder --chown=node:node /app/node_modules ./node_modules
COPY --from=builder --chown=node:node /app/dist ./dist
COPY --from=builder --chown=node:node /app/package.json ./package.json
COPY --chown=node:node public/ ./public/

# Run as non-root user for security best practices
USER node

# Expose standard Cloud Run HTTP port
EXPOSE 8080

# Health check configuration
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:8080/api/health || exit 1

# Start the AgentLedger application server
CMD ["node", "dist/api/server.js"]
