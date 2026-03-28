# ── Stage 1: builder ──────────────────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

# Install deps first (layer cache — only invalidated when package files change)
COPY package.json package-lock.json* ./
RUN npm ci --ignore-scripts

# Copy source and compile TypeScript
COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run build

# Prune dev dependencies
RUN npm prune --omit=dev

# ── Stage 2: runtime ──────────────────────────────────────────────────────────
FROM node:20-alpine AS runtime

LABEL org.opencontainers.image.title="prometheus-mcp"
LABEL org.opencontainers.image.description="Prometheus MCP server for @perf-profile GitHub Copilot agent"
LABEL org.opencontainers.image.version="1.0.0"

# Non-root user for security
RUN addgroup -S mcp && adduser -S mcp -G mcp

WORKDIR /app

# Copy compiled output + production node_modules only
COPY --from=builder /app/dist       ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./

# Copy MCP config (read at startup for SLO + thresholds)
COPY src/mcp/prometheus.mcp.json ./config/prometheus.mcp.json

USER mcp

# ── Environment variables ──────────────────────────────────────────────────────
# Required
ENV PROMETHEUS_URL=http://prometheus:9090

# Optional — override at runtime
ENV PROMETHEUS_TIMEOUT_MS=10000
ENV MCP_TRANSPORT=sse
ENV MCP_PORT=3000
ENV MCP_HOST=0.0.0.0
ENV MAX_CONCURRENT=4
ENV LOG_LEVEL=info
ENV NODE_ENV=production

EXPOSE 3000

# Health check — hits the /health endpoint added to the SSE server
HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:3000/health || exit 1

CMD ["node", "dist/mcp/prometheus-mcp-server.js"]
