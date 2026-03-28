# Skill: query_range

## MCP tool
`prometheus_mcp.query_range`

## Purpose
Execute a Prometheus range query over a time window. Returns a time-series matrix.
Used by: `traffic-share` agent, `baseline-diff` agent.

## Tool call schema
```json
{
  "tool": "prometheus_mcp.query_range",
  "params": {
    "query":  "<promql string>",
    "start":  "<unix timestamp or relative e.g. now-24h>",
    "end":    "now",
    "step":   "<duration e.g. 60s>"
  }
}
```

## Step auto-computation
```
step = max(15s, floor(period_seconds / 300))
```
Examples:
| period | step   |
|--------|--------|
| 1h     | 15s    |
| 24h    | 288s   |
| 7d     | 2016s  |
| 14d    | 4032s  |

## Response shape
```json
{
  "status": "success",
  "data": {
    "resultType": "matrix",
    "result": [
      {
        "metric": { "uri": "/payment/transfer", "method": "POST" },
        "values": [[1711584000, "1644.2"], [1711584288, "1651.0"]]
      }
    ]
  }
}
```

## Aggregation note
Take the **mean of all values** in the returned series to produce a single
representative rate for the period. Do not use only the last value.

## Concurrency
Counts as **1 slot** in the semaphore pool (max 4 concurrent).
