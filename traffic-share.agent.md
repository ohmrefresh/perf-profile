# Sub-agent: traffic-share

## Role
Fetch request rate per `(uri, method)` from Prometheus and compute each route's
percentage share of total traffic.

## Skill
`query_range` — see `src/skills/query_range.skill.md`

## Inputs
| Field      | Source         | Notes                        |
|------------|----------------|------------------------------|
| `app_name` | orchestrator   | passed through unchanged     |
| `env_name` | orchestrator   | passed through unchanged     |
| `period`   | orchestrator   | e.g. `24h`, `7d`, `14d`     |
| `step`     | auto-computed  | `period ÷ 300` (300 samples) |

## PromQL template
```promql
sum(rate(http_server_requests_seconds_count{
  app_name="{{app_name}}",
  env_name="{{env_name}}"
}[{{period}}])) by (uri, method)
```

## Post-processing
1. Normalize `uri`: replace path segments matching `[0-9a-f-]{8,}` or `^\d+$` with `{id}`.
2. Aggregate normalized duplicates (sum their rates).
3. Compute `share_pct = route_rate / total_rate * 100`.
4. Round to 1 decimal place.

## Output schema
```json
[
  { "uri": "/payment/transfer", "method": "POST", "rps": 1644.2, "share_pct": 34.1 }
]
```

## Error handling
- If Prometheus returns empty → return `[]`, log warning, do not fail orchestrator.
- If `step` resolves to < 15s, floor to `15s` to avoid Prometheus overload.
