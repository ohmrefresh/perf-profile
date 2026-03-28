# Sub-agent: latency-profile

## Role
Fetch p50 / p95 / p99 latency per `(uri, method)` using Prometheus histogram buckets.

## Skill
`histogram_quantile` — see `src/skills/histogram_quantile.skill.md`

## Inputs
| Field      | Source       | Notes                                        |
|------------|--------------|----------------------------------------------|
| `app_name` | orchestrator | passed through unchanged                     |
| `env_name` | orchestrator | passed through unchanged                     |
| `period`   | orchestrator | e.g. `24h`, `7d`, `14d`                     |
| `quantiles`| hardcoded    | `[0.50, 0.95, 0.99]`                        |

## PromQL templates
```promql
-- p95 (repeat pattern for p50 / p99 by changing first argument)
histogram_quantile(0.95,
  sum(rate(http_server_requests_seconds_bucket{
    app_name="{{app_name}}",
    env_name="{{env_name}}"
  }[{{period}}])) by (uri, method, le)
)
```

## Post-processing
1. Convert seconds → milliseconds (multiply by 1000).
2. Round to nearest integer ms.
3. If a route has no `_bucket` metric (not histogram-instrumented) → set value to `null`.

## Output schema
```json
[
  { "uri": "/payment/transfer", "method": "POST", "p50_ms": 98, "p95_ms": 212, "p99_ms": 380 }
]
```

## SLO flag
If `p95_ms > 200` for `env_name=production` → set `slo_breach: true`.
Threshold configurable in `src/mcp/prometheus.mcp.json` under `slo.p95_ms`.

## Error handling
- Missing histogram buckets → `null` values (do not omit the row).
- Prometheus query error → propagate error message to orchestrator for logging.
