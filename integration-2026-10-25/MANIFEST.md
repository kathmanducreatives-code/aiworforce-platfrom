# Evidence C (2026-10-25): reproductions, Company Brain compatibility, C5

## Exact failing reproductions (`repro/`)

| Log | Code under test | Result |
|---|---|---|
| `guard-on-launch-8b0e2b6.log` | #179's contract test, run unchanged against **unmodified launch/hardening 8b0e2b6** | **8 / 9 fail**; only the positive control passes. A stored pilot task's resume is not refused (it stops incidentally at `no_checkpoint`). A removed member's service call starts execution |
| `own01-without-migration.log` | #177's contract test with `DB_CONTRACT_OMIT_HELD=20261025120000_lead_graph_same_workspace_parents.sql` | **6 / 8 fail**. The foreign-account contact INSERT answers **201 Created**; the PATCH answers **200 OK** |

With the fixes (#179 `d3d68201`, #177 `05e288e1`): 9 / 9 and 8 / 8 pass.

## Compatibility with the latest Company Brain branches

| Tree | Commit | Contents | Results |
|---|---|---|---|
| 176-chain | `fa36393b` | launch + #176 `1756b217` (→ #169 `833affce` → #160 → #147) + #181 + #175 + #177 + #179 `d3d68201` + #180 | contract **271 / 0**; mutation **91 / 91** (total = ran); edge **8910 / 0**; infra 187 / 0; deno check pass. (Contract and mutation ran on #179 `c0199569`; the later head changes only the client-marker list and a comment; the guard contract was re-run, 9 / 9) |
| 168-chain | `947e5194` | #168 `b8b0419f` (→ #167 → #160 → #147) + #184 `cd3a7a00` + #180 + #181 | 1.4-1…1.4-6 + C5: **12 / 12**; edge **8906 / 0** |

**Incompatibility found and fixed (Backend side):** #176's source scan (`clientBrain.test.ts`) failed on #179's quoted marker key `"client_account_id"`. #179 now uses the #174 contract's pins (`client_id`, `client_grant_id`, `client_grant_generation`) → `d3d68201`.

**Open, Company Brain-internal:** #168 ↔ #169/#176 conflict in `generate-company-brain-draft` (AUTH-06 authorized writer versus versioned autosave). Reported on #168. Not resolved by Backend.

## Also
- #181 full release CI (workflow_dispatch level=full, run 40172330252): **16 / 16 jobs green**, including all 8 mutation shards.
- `operator-checklist.md`: deployment settings, merge order, migrations, secrets, rollback, approvals.
