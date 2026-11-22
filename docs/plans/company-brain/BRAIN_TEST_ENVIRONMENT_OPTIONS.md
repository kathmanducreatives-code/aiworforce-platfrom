# Hosted validation for Company Brain V2: options

**Decision needed from the owner.** Nothing here has been created or changed. The existing ATLAS TEST guard stays as it is.

## Constraints (verified 2026-11-22, `ENVIRONMENT_INVENTORY.md`)
- **The TEST project is ATLAS's discovery environment.** Trigger `discovery_test_no_company_brain` is enabled ALWAYS and refuses every `company_brain` write. TEST holds 0 Brain rows, by design.
- **ATLAS's own checks assume no Brain exists on TEST.** Examples: the V1 preflight check P1 and the discovery smoke tests. ATLAS deploys `lead-pipeline` and `pilot-chat` there.
- **TEST lacks the Brain write-hardening and memory migrations.** It still has the browser insert/update policies on `company_brain`.
- **Production already runs V1 memory.** The V2 release delta is two additive migrations plus function code.

## Options

| | A. Fictional workspace on the existing TEST | B. Separate Supabase project for Brain | C. Supabase branching off production | D. Local disposable stack + production smoke on an internal workspace |
|---|---|---|---|---|
| What it takes | Change the guard into a per-workspace allowlist; apply the hardening, V1, B2.2 and B2.3 migrations; deploy 4 Brain functions | Create (or restore) a project; apply the repo baseline and migrations; deploy Brain functions; seed fictional data | A preview branch of `ohsdatpvfdjdemstoiuj` | What we do today, plus a short post-deploy smoke in production |
| Isolation from ATLAS | **Poor.** It weakens the guard, puts Brain rows in ATLAS's environment, and changes shared `pilot-chat` and migrations under ATLAS | **Full** | Separate database, but tied to the production project | Full for testing; the production smoke is on a fictional internal workspace |
| Changes the TEST policy | **Yes**, which is not allowed without approval and contradicts "do not weaken" | No | No | No |
| Cost | No new project | One more project's compute (plan-dependent; confirm in Billing). The org has an INACTIVE project, `luvostyizefajbltukkc`, that could be restored instead of creating one, but its contents are unknown and repurposing it is the owner's call | Billed per branch-hour; needs a complete `supabase/migrations/` (the baseline is held, so branch creation would fail today) | None |
| Fixture management | Must clean up after every run, beside ATLAS's fixtures | Free: seed or reset at will. Two fictional workspaces (owner, editor, viewer), all created through real sign-up | Data does not copy; seed per branch | Already scripted (the contract and browser lanes) |
| Deployment complexity | High: coordinated with ATLAS deploys | Medium: a one-time setup, then deploys with `--project-ref` and `verify-deploy-target --expect brain-test` | High until migrations are consolidated | Low |
| Proves | Hosted Brain behaviour, at ATLAS's expense | Hosted auth, RLS, `pg_net`/pooler behaviour, real deploys, the real frontend against a real project | Same as B | Real code on a real stack, but not hosted networking or deploys |

## Recommendation
**B, a separate Brain TEST project**, with D kept as the per-commit gate. It is the only option that gives hosted evidence without touching the ATLAS environment or its guard.

Setup steps, once approved:
1. **Choose:** create a new project, or restore and wipe `luvostyizefajbltukkc`. Both need owner approval; wiping it is destructive.
2. Apply the baseline, then `supabase/migrations/*`, then the held Brain chain (hardening → V1 → B2.2 → B2.3), using `tests/db-contract/bootstrap.sh`'s order against that project's URL.
3. Deploy `generate-company-brain-draft`, `setup-company-brain`, `company-brain-memory`, `daily-brief` and `pilot-chat` with an explicit `--project-ref`. Add a `brain-test` target to `scripts/verify-deploy-target.mjs` so a deploy can never default to production.
4. **Seed and reset:** a script creates two fictional workspaces (owner, editor, viewer each) through the project's Auth API, plus fictional research runs. Nothing is copied from production.
5. **Secrets:** none are needed for Brain V2 itself, which makes no model calls. `pilot-chat` needs `OPENAI_API_KEY` only to answer chat. The memory offer is deterministic and runs without it.

**If B is declined:** use D, and run the acceptance guides once in production on a fictional internal workspace straight after the release, with the documented rollback ready.
