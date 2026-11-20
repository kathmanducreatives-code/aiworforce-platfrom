# ATLAS Actor-selection prototype (offline)

Architecture review, 2026-11-20. Nothing here is imported by live code, calls a network, a provider, a model or a database. The full findings are in [docs/audits/2026-11-20-atlas-apify-ai-review.md](../../docs/audits/2026-11-20-atlas-apify-ai-review.md).

```bash
deno run --allow-read --no-check prototypes/atlas-actor-selection/demo.ts            # prototype vs live, 7 missions
deno run --allow-read --no-check prototypes/atlas-actor-selection/review-scenarios/run.ts   # the live pipeline (ATLAS simulator) on the same readings
deno test --allow-read --no-check prototypes/atlas-actor-selection/                  # 10 tests
```

| File | What it is |
|---|---|
| `catalog.ts` | One capability catalogue, written as data. Each entry records what the Actor proves, which property carries each input slot, how it bills, whether `maxItems` counts per query, and whether it is `approved` (on the allowlist) or only `catalogued`. Also the reviewed LinkedIn industry, function and location vocabularies. |
| `planner.ts` | Five separate steps: needs from the Mission Contract, candidates, schema-driven input with disclosures, validation against the captured schema, then a cost and authorization gate. Also `proposeFromStore`, which turns Apify Store search results into review proposals that are never executable. |
| `snapshots/` | Input schemas and Store search results read from the Apify REST API on 2026-11-20. These are free, read-only calls. |
| `review-scenarios/` | Six request types, written as mocked model readings, plus a runner that sends them through the real ATLAS simulator. |
