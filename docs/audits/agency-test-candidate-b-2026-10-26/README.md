# Agency-only TEST — Candidate B preparation evidence (2026-10-26)

Local, offline, no paid call, no hosted write. Synthetic workspace, scripted
model, Apify denied. Every database was built by the candidate's own
`build-test-schema.sh`.

| | SHA |
|---|---|
| **Recommended dispatch/tooling commit** | `6d448610acd2e43b6610fba2f87e56c6f4ca3dba` (`test/agency-candidate-b-operator`) |
| Candidate B (Codex) | `0cbe2f31b4e581a7d1e4d0a0a7fa58b817bca13e`; runtime identical to `336e7107` (CI 40284128653) |
| Runtime diff 0cbe2f31 → 6d448610 (`supabase/`, `worker/`, `src/`) | none |
| Full CI on 6d448610 | [40297837043](https://github.com/kathmanducreatives-code/aiworforce-platfrom/actions/runs/40297837043): 17/17, mutation 134/134, edge 8957/0, UI 709/0, real workers 4/0 |

## Contents

| File | What |
|---|---|
| `reproduction-0cbe2f31/` | Codex's claims reproduced on unmodified Candidate B: providers-off (failed / unhandled_exception, 0 ops, 0 ledger, credits 10/0, 0 vendor requests) and scripted-GPT (23/23 automatic PASS, 0 Apify) |
| `sequence-6d448610.txt` + dir | **The checklist's hosted sequence on one database, recommended SHA:** build 56 → seed → preflight 0 FAIL → providers-off judge PASS → P12 FAIL until stopped → stop → preflight 0 FAIL → scripted-GPT judge 23/23 PASS (R4, M6 manual) → final preflight 0 FAIL |
| `sequence-ef373ca0.txt` + dir | the same on the tooling commit before the docs/lint commits (identical results) |
| `tooling-local.txt` | builder `--with-held-security`; installer apply / rerun / partial refusal / production and mismatch refusals; seed refusals (missing user, reserved credits, Company Brain kept); preflight P01–P17 and schema-verify S01–S08 in read-only sessions; a read-only session refuses a write; rollback round trip (down ×3 restores service_role U/D/T, reinstall restores triggers and grants) |
| `hand-mutations.txt` | 10/10 mutants of the new safeguards killed (providers=none key and deny, expected_sha, Apify secret gating, compile-gate allowlist and n, providers-off judge, P09, P15) |
| `suites-ef373ca0-*` | local full suites: contract 346/0 (34 files), edge 8957/0, infra 198/0, real workers 4/4 |
| `harness/` | the local rehearsal scripts (local Postgres/PostgREST only) |

`sha256sum -c MANIFEST.sha256` verifies every file.
