# Skill: instant_query

## MCP tool
`prometheus_mcp.instant_query`

## Purpose
Execute a Prometheus instant query (single point in time, averaged over a range window).
Used by: `error-rate` agent.

## Tool call schema
```json
{
  "tool": "prometheus_mcp.instant_query",
  "params": {
    "query": "<promql string>",
    "time":  "now"
  }
}
```

## Why instant_query for error rate?
Error rate is a ratio — we want the current ratio computed over the full period window,
not a time series. Using `instant_query` with `rate(...[period])` inside gives a single
scalar per `(uri, method)` without the overhead of a matrix response.

## PromQL pattern
```promql
sum(rate(http_server_requests_seconds_count{
  app_name="{{app_name}}",
  env_name="{{env_name}}",
  status=~"{{status_pattern}}"
}[{{period}}])) by (uri, method)
/
sum(rate(http_server_requests_seconds_count{
  app_name="{{app_name}}",
  env_name="{{env_name}}"
}[{{period}}])) by (uri, method)
```

## Response shape
```json
{
  "status": "success",
  "data": {
    "resultType": "vector",
    "result": [
      {
        "metric": { "uri": "/rtp/inward/confirm", "method": "POST" },
        "value":  [1711584000, "0.047"]
      }
    ]
  }
}
```

## Response handling
- Multiply value by 100 for percentage.
- `NaN` or missing route → `error_pct: 0`, `severity: "ok"`.

## Concurrency
Counts as **1 slot** in the semaphore pool (max 4 concurrent).
