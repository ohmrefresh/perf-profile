# Sub-agent: baseline-diff

## Role
Compare current-period traffic share against the equivalent prior period using
Prometheus `offset` modifier. Skipped automatically when `env_name=qa`.

## Skill
`offset_query` — see `src/skills/offset_query.skill.md`

## Inputs
| Field      | Source       | Notes                                       |
|------------|--------------|---------------------------------------------|
| `app_name` | orchestrator | passed through unchanged                    |
| `env_name` | orchestrator | must NOT be `qa` — orchestrator guards this |
| `period`   | orchestrator | offset is set to same value as period       |

## PromQL template
```promql
-- previous-period rate (offset = same as current period)
sum(rate(http_server_requests_seconds_count{
  app_name="{{app_name}}",
  env_name="{{env_name}}"
}[{{period}}] offset {{period}})) by (uri, method)
```

## Post-processing
1. Fetch both current rate (from traffic-share agent result) and prev-period rate.
2. Compute `delta_pct = (current - prev) / prev * 100`.
3. Round to 1 decimal. Prefix with `+` for positive, `-` for negative.
4. If `prev = 0` and `current > 0` → set `delta_pct = "+new"`.
5. If both `prev = 0` and `current = 0` → set `delta_pct = "—"`.

## Period → offset mapping
| period | offset used |
|--------|-------------|
| `1h`   | `1h`        |
| `24h`  | `24h`       |
| `3d`   | `3d`        |
| `7d`   | `7d`        |
| `14d`  | `14d`       |

## Output schema
```json
[
  { "uri": "/rtp/inward/confirm", "method": "POST", "delta_pct": "+12.1" },
  { "uri": "/payment/transfer",   "method": "POST", "delta_pct": "+3.4"  }
]
```

## Skip condition
Orchestrator sets `skip: true` for this agent when `env_name=qa`.
When skipped, all `delta_pct` values in the final profile are set to `"—"`.
