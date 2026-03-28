# perf-profile · GitHub Copilot agent

Generate **traffic share by API** performance profiles from Prometheus,
directly inside GitHub Copilot Chat.

## File structure

```
perf-profile/
├── .github/
│   └── copilot-instructions.md
├── .vscode/
│   └── settings.json                   ← stdio + SSE MCP modes
├── docker/
│   ├── prometheus/prometheus.yml       ← local scrape config
│   └── grafana/provisioning/datasources/prometheus.yml
├── src/
│   ├── agents/
│   │   ├── traffic-share.agent.md
│   │   ├── latency-profile.agent.md
│   │   ├── error-rate.agent.md
│   │   └── baseline-diff.agent.md
│   ├── skills/
│   │   ├── query_range.skill.md
│   │   ├── histogram_quantile.skill.md
│   │   ├── instant_query.skill.md
│   │   └── offset_query.skill.md
│   └── mcp/
│       ├── prometheus.mcp.json
│       ├── prometheus-mcp-server.ts    ← stdio + SSE transports
│       └── semaphore.ts               ← max 4 concurrent calls
├── prompts/
│   └── profile-output.md
├── Dockerfile                         ← multi-stage production image
├── docker-compose.yml                 ← local dev stack
├── docker-compose.prod.yml            ← production override
├── .env.example
├── package.json
└── tsconfig.json
```

---

## Quickstart — Docker (recommended)

```bash
# 1. Environment
cp .env.example .env

# 2. Start MCP server + local Prometheus
docker compose up -d

# 3. Optional: add Grafana
docker compose --profile grafana up -d   # http://localhost:3001

# 4. Verify
curl http://localhost:3000/health

# 5. VS Code auto-connects via .vscode/settings.json (prometheus-mcp-docker entry)

# 6. Use Copilot Chat
# @perf-profile app_name=payment-api env_name=production period=24h
```

## Quickstart — local Node (no Docker)

```bash
export PROMETHEUS_URL=http://your-prometheus:9090
npm install && npm run build
# VS Code uses prometheus-mcp-stdio — Copilot spawns the process automatically
```

## Production

```bash
docker build -t prometheus-mcp:1.0.0 .
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d
```

---

## MCP server endpoints (SSE transport)

| Method | Path      | Description                        |
|--------|-----------|------------------------------------|
| GET    | `/health` | Health — pool state + uptime       |
| GET    | `/sse`    | SSE stream — Copilot connects here |
| POST   | `/rpc`    | JSON-RPC 2.0 tool calls            |

---

## Environment variables

| Variable                | Default                 | Notes                          |
|-------------------------|-------------------------|--------------------------------|
| `PROMETHEUS_URL`        | http://localhost:9090   | Required                       |
| `PROMETHEUS_TIMEOUT_MS` | 10000                   | Per-request ms                 |
| `MCP_TRANSPORT`         | stdio                   | `stdio` or `sse`               |
| `MCP_PORT`              | 3000                    | SSE bind port                  |
| `MAX_CONCURRENT`        | 4                       | Semaphore pool size            |
| `LOG_LEVEL`             | info                    | debug/info/warn/error          |

---

## Micrometer (Spring Boot) — required labels

```yaml
management:
  metrics:
    tags:
      app_name: ${APP_NAME}
      env_name: ${ENV_NAME}
    distribution:
      percentiles-histogram:
        http.server.requests: true
```

---

## SLO thresholds

Edit `src/mcp/prometheus.mcp.json`:

```json
{
  "slo": { "p95_ms": 200, "p99_ms": 500 },
  "thresholds": { "error_pct": { "ok": 1.0, "warn": 5.0 } }
}
```
