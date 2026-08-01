# Hiring Actor Benchmark — 2026-08-01

Isolated research. **Nothing here is imported by Agentory production code, and
no Actor here has been added to the capability catalog.**

## Result in one line

The stack works, but **enrichment must move before qualification** — the two ICP
filters Route B depends on (industry, size) proved unreliable, and the only
company that survived the funnel was a job-board aggregator.

Read `final_recommendation.md` first.

## Spend

**$0.4289 of a $5.00 ceiling**, 23 live runs. Measured from account-level
`monthlyUsageUsd` (7.099254 → 7.528139), *not* from per-run `usageTotalUsd`,
which under-reported by ~13x. `scripts/runner.py` blocks any run whose estimated
maximum would breach the ceiling.

No email, phone or contact enrichment was run. No production task was created.

## Layout

| Path | Contents |
|---|---|
| `actor_inventory.json` | Live metadata, build ids, BRONZE-tier pricing, field lists |
| `schemas/` | Raw live input schemas + `_schema_summary.json` |
| `sample_inputs/` | Exact input sent for every run |
| `raw_outputs/` | Unmodified Actor output + run metadata |
| `normalized_outputs/` | Mapped to Agentory canonical company/job/person shapes |
| `benchmark_results.csv` | Per-run status, rows, latency, cost |
| `field_mapping_matrix.md` | Output → canonical mapping, incl. unavailable fields |
| `capability_card_candidates.json` | Proposed cards — **NOT registered** |
| `final_recommendation.md` | Full findings, scorecard, Prompt-2 architecture |
| `BUDGET_PLAN.md` | Pre-flight cost estimates |
| `spend_ledger.json` | Append-only run ledger |
| `scripts/` | curl-based Apify helpers (no token ever persisted) |

## Reproducing

Requires `APIFY_TOKEN` in the environment. Prices resolve at the account's
pricing tier — this account is **BRONZE**; other tiers pay different amounts for
the same run.

```bash
python3 scripts/fetch_actor.py raw_outputs/_actor_meta_raw.json
python3 scripts/build_inventory.py raw_outputs/_actor_meta_raw.json actor_inventory.json
```

## Credentials

No token, header, cookie or credential is stored in any file here. `scripts/apify.py`
reads `APIFY_TOKEN` from the environment at call time and exposes a `redact()`
helper. The ledger records run ids and costs only.
