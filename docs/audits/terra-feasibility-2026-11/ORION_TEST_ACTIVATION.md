# Activate ORION on TEST and test it in your browser (2026-11-11)

**Status: everything is prepared and verified; nothing is activated.** Each remote step below waits for your explicit approval. Production `ohsdatpvfdjdemstoiuj` is never contacted.

## What was verified this pass (read-only on TEST, local otherwise)

| Check | Result |
|---|---|
| Repository | `claude/agentory-audit-roadmap-64uq8n`, up to date with remote |
| TEST identity | `tlvnfrxzjhsjgdofwehb`. `npm run supabase:test --` always passes `--project-ref tlvnfrxzjhsjgdofwehb`. **`supabase/config.toml` names production, so never run a raw `supabase …` deploy.** |
| `pilot-chat` on TEST | **not deployed** (TEST runs `provider-connections`, `lead-pipeline`, `daily-brief`) |
| Deploy channel | The TEST GitHub workflow deploys only `lead-pipeline` and `provider-connections` from `launch/hardening`. This session has **no Supabase access token**, so the deploy is **one command in your shell** (§3). |
| AI keys on TEST | not listable from here. `orion-pilot-activate.sh` checks the names and refuses if one is missing. |
| Company Brain writes on TEST | blocked (guard trigger `A`, 0 rows), unchanged |
| Security on TEST today | 10 browser write policies live (signals and approvals). **NEW finding:** the `lead_model_calls` spend view bypasses RLS (owner-rights view granted to `anon`), so anyone with the public key can read and delete model-spend rows. A held fix exists; production likely has the same flaw (not checked). |
| App against TEST | Boots in headless Chromium with the TEST publishable key: shows the "NON-PRODUCTION — TLVNFRXZJHSJGDOFWEHB" banner and redirects to sign-in; no errors |
| ORION Evidence panel | New. Renders under ORION answers. Browser-checked: badges, dates and ages, safe links, malformed data ignored. |

## 1. Accounts (you, in the TEST Supabase dashboard)

Create **four** new users in Authentication → Users → *Add user* (auto-confirm). Use fresh accounts so each belongs **only** to its pilot workspace. The app opens the user's first membership and has no workspace switcher, so an existing account that already belongs to another TEST workspace could land in the wrong one.

| Account | Role | Workspace |
|---|---|---|
| `orion-owner@…` | owner | ORION Pilot (fictional) |
| `orion-editor@…` | editor | ORION Pilot (fictional) |
| `orion-viewer@…` | viewer | ORION Pilot (fictional) |
| `orion-outsider@…` | owner | ORION Isolation (fictional) |

Send me the four **emails** (not passwords). I'll look up their user ids on TEST read-only for the seed.

**Do not open the app with these accounts before step 2.** With no membership, the app would auto-create a separate workspace for them.

## 2. Database (I run these after your approval, through the TEST-pinned Supabase connection)

**a. Security fixes**, both held migrations in one transaction each:
- `20261113120000_workforce_v2_security.sql`: browsers can't write signals or approvals.
- `20261114120000_lead_model_calls_view_lockdown.sql`: the spend view stops bypassing RLS and leaves browser roles.

Then I re-run the catalog checks: 0 browser write policies, view `security_invoker=true`, 0 browser grants.

You can run the same thing yourself instead:
```bash
TEST_PROJECT_REF=tlvnfrxzjhsjgdofwehb TEST_DB_URL=… scripts/test-project/install-workforce-v2-security.sh --confirm tlvnfrxzjhsjgdofwehb
```

**b. Seed:** `orion-pilot-seed.sql` with the four user ids. It creates 2 fictional workspaces plus their leads, signals and accounts. No missions, scraping or outreach, and nothing existing is touched (validated locally with `validate-orion-pilot-seed.sh`).

## 3. Flags and deploy (you, in your shell with the Supabase CLI logged in)

**Step A, read-only and free.** It lists secret **names** only and changes nothing:
```bash
scripts/test-project/orion-pilot-activate.sh --check --confirm tlvnfrxzjhsjgdofwehb
```

**Step B, after approval:**
```bash
scripts/test-project/orion-pilot-activate.sh --deploy --confirm tlvnfrxzjhsjgdofwehb
```
- Sets `AGENTORY_ORION_EVIDENCE_CONTEXT=true` and `AGENTORY_ORION_EVIDENCE_WORKSPACES=a71a0000-0000-4000-8000-0000000011a1`. Only `pilot-chat` reads them, and only for that workspace.
- Deploys `pilot-chat` with `--use-api` (no Docker), then smoke-checks for a 401.
- **Refuses** if:
  - `OPENAI_API_KEY` or `ANTHROPIC_API_KEY` is missing;
  - any `AGENTORY_TERRA_*`, `AGENTORY_HYBRID_*` or `AGENTORY_ROUTE_*` secret exists;
  - the spending limit is only partly configured.

**Spending limit (`MODEL_SPEND_*`, project-wide):**
- **All three already set:** preserved and never overwritten. `pilot-chat` uses them.
- **None set:** `pilot-chat` would refuse every turn (it fails closed). `--deploy` refuses unless you append `--set-pilot-ceiling`, which sets enforce / $0.49 per workspace / 7 days.
- **Effect on other TEST functions:** only `daily-brief` reads these settings. It would go from refusing model calls to allowed up to the same $0.49 per workspace per 7 days. `lead-pipeline` (ATLAS discovery) and `provider-connections` do not read them and are unaffected. *(An earlier version of this doc wrongly said `lead-pipeline`.)*

**Rollback:** `orion-pilot-deactivate.sh` unsets the evidence flags and deletes `pilot-chat`. It removes `MODEL_SPEND_*` **only if** activation set them; that is recorded in `.orion-pilot-activation.state`.

## 4. Open ORION in your browser

1. On your machine, in the repository root, create `.env.local`. The values are public; never a secret key:
   ```bash
   VITE_SUPABASE_URL=https://tlvnfrxzjhsjgdofwehb.supabase.co
   VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_xJyW_B57hr6_SMFQbf2KPg_7-Fdyrjp
   VITE_TEST_DASHBOARD_WITHOUT_BRAIN=true
   ```
   The last line is the existing TEST-only bypass. It is ref-locked to TEST, does nothing on production, and creates no Brain.
2. Start the app (no Docker):
   ```bash
   npm install && npm run dev
   ```
3. Open **http://localhost:8080** and sign in as **orion-owner@…**. You land on the Dashboard of "ORION Pilot (fictional)", the only workspace this account belongs to.
4. Open ORION by typing in **"Ask your workforce anything…"** at the bottom, or by pressing **Ctrl/⌘ + K** for the full chat. **Ctrl/⌘ + \\** expands the conversation.
5. Ask the questions in `ORION_MANUAL_TEST_GUIDE.md`. Under each business answer, click **Evidence · N records** to see the leads and signals behind every [E#], with dates and verified / single-source / stale / contradicted badges.

**Limitations without a Company Brain** (TEST blocks it by design):
- ORION does not know your ICP, voice or goals, and should say so.
- "Source / research / draft" requests return the onboarding prompt.
- Only stored records are used; there is no live web search.
- LISA is not collecting new signals.

## 5. Automated acceptance run (after approval; needs the owner and outsider sign-in tokens)

Run `scripts/orion-pilot/run-pilot.ts` (see `ORION_PILOT_READINESS.md` §6). It:
- calls the real TEST endpoint for the 15 questions, plus role repeats and isolation probes;
- **stops at the first server-side spend refusal** and records the rest as not run.

To get the evidence-off comparison:
1. Unset the evidence flag.
2. Run again with `--label baseline`.
3. Re-set the flag.

Then score:
```bash
deno run --allow-read scripts/orion-pilot/score.ts transcript-evidence-on.json transcript-baseline.json
```

I read the actual spend afterwards with a read-only query of the pilot workspaces' `lead_model_calls` rows.

## 6. Rollback

| What | How |
|---|---|
| Flags, ceiling, function | `scripts/test-project/orion-pilot-deactivate.sh --confirm tlvnfrxzjhsjgdofwehb`. If `MODEL_SPEND_*` existed before the pilot, re-set the recorded values. |
| Pilot data | `scripts/test-project/orion-pilot-cleanup.sql`: only the two fixed workspaces and their conversations and messages |
| Security fixes | `install-workforce-v2-security.sh --confirm tlvnfrxzjhsjgdofwehb --rollback` (reopens the findings; only if needed) |

## 7. Approvals needed (exact)

| # | Environment | Operation | Impact | Rollback |
|---|---|---|---|---|
| G1 | TEST DB | apply `20261113120000` + `20261114120000` | closes browser writes to signals and approvals, and the spend-view leak; no data change | installer `--rollback` |
| G2 | TEST DB | run the seed with your 4 TEST users' ids | 2 new fictional workspaces and rows | cleanup SQL |
| G3 | TEST secrets + functions | you run `orion-pilot-activate.sh` | `pilot-chat` live on TEST; evidence on for the pilot workspace; ceiling $0.49 per workspace for 7 days | `orion-pilot-deactivate.sh` |
| G4 | TEST endpoint | automated run (evidence on + baseline) | ≤ $0.60 total, enforced server-side | — |
| G5 | your shell | `--check-model gpt-6.1-terra` (free) | none | — |
| G6 | your shell | Stage 1 benchmark (≤ $1.43, cap $2) | paid | — |
| G7 | production (separate decision) | the `lead_model_calls` view flaw likely exists there too | — | — |

## Applied on TEST (2026-11-12)

The security fixes are applied on TEST: `20261112072003_workforce_v2_security` and `20261112072104_lead_model_calls_view_lockdown`. Preflight matched the reviewed scope.

**How it was verified:**
- one DO block ending in `RAISE EXCEPTION`, so everything rolled back;
- every write attempt used `WHERE false`;
- roles tested: `anon`, `authenticated` and a real workspace member (via JWT claims);
- the server role was tested separately.

| Check | anon | authenticated | member | service_role |
|---|---|---|---|---|
| insert / update / delete `signal_events`, `signal_event_evidence`, `monitoring_subjects` | denied | denied | denied | allowed |
| insert / update / delete `approvals` | denied | denied | denied | allowed |
| read / delete through `lead_model_calls` | denied | denied | denied | read OK (19 rows) |
| see another workspace's signals or approvals | — | — | 0 rows | — |

**Database unchanged afterwards:**
- 0 write policies and 4 SELECT policies on the four tables;
- the view has `security_invoker=true`;
- row counts equal the baseline: approvals 1, signal_events 4, signal_event_evidence 0, monitoring_subjects 0, lead_execution_calls 41, workspaces 4, members 5.

**Residual note (not exploitable):** `authenticated` still holds INSERT/UPDATE/DELETE grants on the base table `lead_execution_calls`. Row-level security is on and that table has only a SELECT policy, so such statements affect 0 rows. Revoking those grants would be extra defence in depth, but it is outside the reviewed scope and was not done.

## Seeded on TEST (2026-11-12)

- **Seed:** `orion-pilot-seed.sql` (sha256 `20eddbe8…`, unchanged since review). The only edit was substituting the four user ids; it ran in one transaction.
- **Accounts:** all four confirmed, never signed in, with no prior memberships:
  - `orion-owner`, `orion-editor` and `orion-viewer` → ORION Pilot (fictional), as owner / editor / viewer;
  - `orion-outsider` → ORION Isolation (fictional), as owner.
- **Added:** 2 workspaces, 4 memberships, 5 accounts, 5 leads and 5 signals.
- **Outside the pilot, unchanged:** 4 workspaces, 5 members, 4 accounts, 4 leads, 4 signals.
- **Created by the seed (none):** tasks 10 → 10, approvals 1 → 1, model calls 41 → 41, conversations 1 → 1, Company Brain rows 0. The no-Brain guard is still enabled.
