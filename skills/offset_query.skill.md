# Skill: offset_query

## MCP tool
`prometheus_mcp.query_range`

## Purpose
Fetch the equivalent prior-period metric using Prometheus `offset` modifier.
Used by: `baseline-diff` agent.

## Tool call schema
Same as `query_range` — uses `query_range` endpoint with `offset` in PromQL.

## PromQL pattern
```promql
sum(rate(http_server_requests_seconds_count{
  app_name="{{app_name}}",
  env_name="{{env_name}}"
}[{{period}}] offset {{period}})) by (uri, method)
```

## Offset = period rule
The offset is always set equal to the current period so that the comparison
window is the identical-length slice immediately before the current window.

| Current window  | Offset applied |
|-----------------|----------------|
| now-1h → now    | 1h ago         |
| now-24h → now   | 24h ago        |
| now-7d → now    | 7d ago         |
| now-14d → now   | 14d ago        |

## Step
Use the same step as the corresponding `query_range` call for the current period.
Take the mean of all values in the returned series.

## Skip condition
This skill is **not called** when `env_name=qa`.
The orchestrator enforces this before dispatching — do not implement skip logic here.

## Response handling
- Take the mean of the time-series values (same as `query_range` skill).
- Missing route in prev period (new route) → `prev_rate: 0`.

## Concurrency
Counts as **1 slot** in the semaphore pool (max 4 concurrent).
