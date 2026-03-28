# Sub-agent: error-rate

## Role
Compute HTTP 5xx (and optionally 4xx) error ratio per `(uri, method)`.
Tag each route with a severity label based on thresholds.

## Skill
`instant_query` — see `src/skills/instant_query.skill.md`

## Inputs
| Field            | Source       | Notes                               |
|------------------|--------------|-------------------------------------|
| `app_name`       | orchestrator | passed through unchanged            |
| `env_name`       | orchestrator | passed through unchanged            |
| `period`         | orchestrator | e.g. `24h`, `7d`, `14d`            |
| `status_pattern` | hardcoded    | `"5.."` for 5xx errors              |

## PromQL template
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

## Severity thresholds
| Severity | Condition         |
|----------|-------------------|
| `ok`     | error_pct < 1.0   |
| `warn`   | 1.0 ≤ error_pct < 5.0 |
| `err`    | error_pct ≥ 5.0   |

Thresholds configurable in `src/mcp/prometheus.mcp.json` under `thresholds.error_pct`.

## Post-processing
1. Multiply ratio by 100 → `error_pct`.
2. Round to 1 decimal.
3. Assign `severity` label per table above.
4. If denominator = 0 (no traffic) → set `error_pct: null`, `severity: "ok"`.

## Output schema
```json
[
  { "uri": "/rtp/inward/confirm", "method": "POST", "error_pct": 4.7, "severity": "warn" }
]
```
