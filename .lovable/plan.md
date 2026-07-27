## Controlled Production Rollout — Qualified-Lead + Claude-First Lead Planning

Scope: Phase A–N. No frontend redesign. No Phase 3. No TEST changes. Never touch `supabase/functions/mcp/index.ts`.

### Capability gate (honest disclosure, up front)

This Lovable environment can only do a subset of what the task lists. Before starting I will confirm each capability against reality; where a step needs a tool I don't have, I will stop and hand the exact command to the repo owner rather than pretend the step ran.

| Capability | Available here | Notes |
|---|---|---|
| Read repo files at Lovable-synced `main` | Yes | Read-only via project files. |
| `git fetch remix` / verify SHA of `remix/main`, ancestor checks for PR #100/#101 | No | Stateful git is blocked. Owner must run `git fetch remix && git log remix/main` and confirm the two PR merge commits are ancestors. I will verify the PR #100 code (continuation lease, planner bridge, feature-OFF no-op) and PR #101 code (Anthropic-preferred planner) are present in the working tree by reading files. |
| Supabase read/write on prod `wqnigjhcwjxtmordrwno` | Yes | Managed Supabase tools + psql are bound to this project (verified via project_info). Used as the two independent identity signals. |
| Apply migration to prod | Yes | Via `supabase--migration` (requires user approval each call). |
| Deploy Edge Functions to prod | Yes | Via `supabase--deploy_edge_functions`. Cannot pin `--project-ref` manually; the tool targets the bound prod project — I will re-verify identity before each deploy. |
| Inspect function versions / source hashes | Partial | Can list deployed functions and re-deploy; per-version source hash is not exposed. I will record deploy timestamps and the local file SHAs I deployed from. |
| Read secret NAMES without values | Yes | `secrets--fetch_secrets`. Values never printed. |
| Add / set secrets in prod | Yes | Via `add_secret` / `set_secret`. For `ANTHROPIC_API_KEY`, if missing I will stop and ask the owner to add it in the Supabase secrets UI, per the hard rule. |
| Real two-connection concurrency test for continuation claim | No | psql sessions in the sandbox are sequential. I will state this limitation and instead prove the RPC's atomicity by asserting the winner/loser contract via back-to-back calls plus row inspection — not describe it as literal concurrency. |
| Drive the production UI at agentory.space as a real signed-in user | No | I cannot log into agentory.space as the owner. Preview verification (Phase H) will be done by calling `pilot-chat` directly with the production workspace UUID and inspecting the returned contract, and by asking the owner to confirm what the UI renders. |
| Trigger the single paid workflow (Phase M) | Gated | I will only start `run-agent` after the owner explicitly confirms in chat: (a) the workspace UUID to use, (b) that estimated spend ≤ $5 is acceptable, (c) that Claude-first is enabled for exactly that workspace. |

### Phase A — Source verification (read-only)

1. Read `supabase/functions/_shared/providerRouting.ts`, `_shared/aiProvider.ts`, `_shared/qualifiedLeadRouting.ts`, `_shared/sourcingContinuation.ts`, `_shared/companyFirstSourcingState.ts`, `run-agent/index.ts`, `orchestrate/index.ts`, `pilot-chat/index.ts` and confirm:
   - Anthropic preference exists for writing agents AND planner override via `SOURCE_PLANNER_PROVIDER` / Phase 2 planner is preferred to Anthropic (PR #101).
   - Feature-OFF path is a true no-op (`CLAUDE_FIRST_LEAD_PLANNING=false` returns without planner/mission/capability calls, no `claude_first_planning` result key, no strategy hash).
   - Continuation RPC calls (`claim_sourcing_continuation`, `release_sourcing_continuation`) exist in `run-agent`.
   - Migration file `supabase/migrations/20260727090000_continuation_claim_lease.sql` exists and defines the four `tasks` fields, both RPCs, `SECURITY DEFINER`, fixed `search_path`, revoked public execute, granted role.
   - `supabase/functions/mcp/index.ts` is NOT in the intended deploy diff (leave untouched even if regenerated).
2. Report the Lovable-synced main SHA I can observe. Ask owner to confirm it matches `remix/main` and that PR #100 + #101 are merged ancestors (I cannot run `git`).

Stop if any of the above are missing.

### Phase B — Production identity (two signals)

1. `supabase--project_info` → expect ref `wqnigjhcwjxtmordrwno`.
2. `psql -c "select current_database(), inet_server_addr()"` and check env var `PGHOST` resolves to `*.wqnigjhcwjxtmordrwno.supabase.co` (or the pooler equivalent for that ref).

Stop if the ref differs or is ambiguous. Record identity before any write.

### Phase C — Read-only prod audit

Via `psql` (SELECTs only):

- `select 1 from supabase_migrations.schema_migrations where version = '20260727090000'` — presence of continuation migration.
- `select proname, pronargs from pg_proc where proname in ('claim_sourcing_continuation','release_sourcing_continuation')`.
- `select column_name from information_schema.columns where table_schema='public' and table_name='tasks' and column_name in (<four lease columns as defined in the migration file>)`.
- `select relrowsecurity from pg_class where oid='public.tasks'::regclass` — RLS still on.
- `select distinct status from public.tasks` — record current status vocabulary.
- List deployed functions (via Supabase tool) — record current versions for `run-agent`, `orchestrate`, `pilot-chat`, `daily-brief`, `setup-company-brain` (only those that actually exist in prod).

Detect partial installation (some columns/RPCs present, others not). Stop on partial state — do not attempt repair mid-plan.

Schema snapshot: capture DDL of `public.tasks` and of the two RPCs to `/mnt/documents/prod-schema-pre-<ts>.sql` before Phase D.

### Phase D — Apply continuation migration (only if absent and audit clean)

- Call `supabase--migration` with the exact SQL from `supabase/migrations/20260727090000_continuation_claim_lease.sql` (unchanged).
- Do NOT reapply if already present.
- Post-apply verification (psql SELECTs): migration row present; four columns exist; both RPCs exist with expected signatures; RLS still on `tasks`; no unrelated tables/columns changed (diff against pre-snapshot).
- Behavioural checks against the RPC contract (sequential, not concurrent):
  - Normal claim on a fresh `ready` task with matching workspace succeeds.
  - Second claim with a different claim id on the same task returns conflict.
  - Release with matching claim id succeeds; release with wrong id is refused.
  - Terminal task cannot be claimed.
  - Checkpoint version increments; `result` JSON is merged (assert an unrelated key survives).
  - Search path is fixed; `EXECUTE` revoked from `public`, granted to the runtime role the migration designates.

Stop on any failure. No frontend deploy.

### Phase E — Deploy affected Edge Functions

Deploy from the synced main via `supabase--deploy_edge_functions`, one call, only functions that (a) exist in prod today and (b) import changed shared modules:

- `run-agent`
- `orchestrate`
- `pilot-chat`
- `daily-brief` (only if it imports changed shared code)
- `setup-company-brain` (only if it exists in prod and imports changed shared code)

Record: pre-version, post-version, deploy timestamp, and local file mtimes/hashes for each function's `index.ts` and its imported shared files. Preserve existing `verify_jwt` posture (do not edit `supabase/config.toml`). Do NOT enable Claude-first during deploy.

### Phase F — Synthetic continuation validation (no provider calls)

Using psql on production against a scoped synthetic fixture:

1. Create one synthetic workspace (`sp_phase_f_<ts>`) and one `tasks` row with `status='ready'`, `result.task_status='partial'`, `result.terminal_status='continuation_required'`, checkpoint under `SOURCING_STATE_KEY` at current version.
2. Call `claim_sourcing_continuation` twice sequentially with different claim ids → assert exactly one success, one conflict; task id unchanged; no new task inserted; quota state unchanged; provider idempotency keys unchanged.
3. Release winner → immediately reclaim → succeeds.
4. Simulate expired lease (UPDATE the expiry column to past); two stale reclaim attempts → exactly one wins.
5. Mark terminal → claim refused.
6. Delete all synthetic rows in a single transaction; verify zero residue by workspace prefix.

Honest limitation statement: sandbox psql runs sequentially; I will report this as a contract test, not a literal race.

Stop on failure.

### Phase G — Verify Claude-first is OFF

- `fetch_secrets` — confirm `CLAUDE_FIRST_LEAD_PLANNING` is absent or `false`; allow-list absent or empty.
- Call `pilot-chat` (see Phase H) with feature OFF and inspect the returned task's `result` JSON via psql: no `claude_first_planning` key, no strategy hash, no Phase 2 mission, no planner diagnostics.

### Phase H — Production preview with feature OFF

Invoke `pilot-chat` (or the appropriate preview endpoint used by agentory.space) against production with the exact instruction and the production workspace UUID (from Phase J), do NOT start the workflow. Assert the returned workflow contract:

- `workflow_kind = qualified_lead_sourcing`
- `execution_mode = company_first`
- `requested_lead_count = 5`, `count_entity = contact_ready_lead`, `quota_policy = contact_only`
- Hiring titles include Sales Operations / Revenue Operations / GTM Operations
- Decision-makers Founder / Co-Founder / CEO
- `current_employer_required = true`
- Does NOT contain: SDR / BDR / Account Executive / GTM hiring-signal accounts / `fast` mode / decision-makers as later optional step.

Also ask the owner to open agentory.space, paste the instruction into Pilot, and paste back the previewed workflow card so I can cross-check what the UI renders vs the endpoint contract (I cannot drive their signed-in browser).

Stop and report if the preview is still account-shaped; identify which endpoint returned the legacy contract.

### Phase I — Verify Anthropic secret

- `fetch_secrets` — confirm `ANTHROPIC_API_KEY` exists (name only) and `LOVABLE_API_KEY` exists.
- If `ANTHROPIC_API_KEY` is missing: stop and ask the owner to add it via Supabase's project secrets UI. Do not accept the value pasted in chat; do not proceed under Gemini/Lovable while calling the feature Claude-first.

### Phase J — Identify one production workspace

Via psql on production:

- Look up the owner's `auth.users` row (owner to confirm the email in chat).
- `select w.id, w.name from workspaces w join workspace_members m on m.workspace_id=w.id where m.user_id=<owner>` — confirm exactly one active workspace to use (expected display name may be `ScreeningPilot`), that it belongs to production, and that the id is NOT `11111111-1111-1111-1111-555555555555`.
- Owner confirms in chat that this is the workspace visible in the UI.

Store the UUID; in the final report display only the first 8 chars + last 4.

### Phase K — Enable Claude-first for exactly one workspace

Only after A–J pass:

- `set_secret CLAUDE_FIRST_LEAD_PLANNING=true`
- `set_secret CLAUDE_FIRST_LEAD_PLANNING_WORKSPACES=<exact production workspace UUID>` (single UUID, no wildcard, no commas, no TEST id)
- Verify via `fetch_secrets` that both are set; re-run Phase H preview for the selected workspace and confirm feature-ON contract; run Phase H against a second production workspace UUID (from Phase J listing) and confirm it still resolves as feature-OFF.
- No frontend / `VITE_` variables changed. No service-role key exposed.

### Phase L — Planner-only validation before paid sourcing

Use the narrowest available planner dry-run route (in the deployed code — read to confirm which endpoint or flag surfaces it; if none exists, capture the diagnostics on the live workflow *before* first provider execution and state the limitation).

Assert the accepted strategy matches the exact hiring role / decision-maker / output shape in the task spec, and:

- planner provider = anthropic
- planner source = claude, status = success, no deterministic fallback
- no Actor ID / credentials in model output
- no geography expansion, no seniority contamination, requested count and quota unchanged
- existing adapters compile provider input

Stop on any deviation.

### Phase M — One controlled quota-5 workflow

Preconditions (must be re-confirmed by owner in chat, in one message):
- workspace UUID to use
- Claude-first enabled for exactly that workspace
- estimated spend cap $5.00 acknowledged
- authorisation to spend real credits on this one run

Capture pre-run diagnostics (planner source/provider/model/status, strategy hash, approved/rejected/approval-required titles, capability keys, compiled input summary, estimated provider calls, estimated cost, requested quota). Abort if estimate > $5 or above any existing configured budget.

Kick off one workflow with the exact instruction. Do not re-run.

Verify: Claude planned strategy; Anthropic produced it; adapters (not Claude) produced provider-native JSON; existing company-first executor ran; only CONTACT-ready leads count toward 5; WATCH leads excluded; current-employer verification enforced; qualification precedence unchanged; no prompts/secrets/hidden reasoning in diagnostics; provider idempotency active; actual cost ≤ cap.

### Phase N — Continuation (only if run returns continuation_required)

Continue exactly once: same task id via `resume_task_id` path; assert claim RPC used, previous lease released, round 1 not restarted, completed provider calls not repeated, prior leads retained, quota/cost cumulative, status transitions ready → running → (ready | complete). Do not continue if genuinely terminal.

### Immediate rollback

Set `CLAUDE_FIRST_LEAD_PLANNING=false` immediately on any of the listed trip-wires (account-shaped preview, non-Anthropic planner, silent fallback, geography/count/quota drift, role contamination, unapproved adjacent titles, incomplete plan executed, raw Actor IDs/credentials in output, repeated provider calls, second task created on continue, WATCH counted, spend > $5, workspace isolation failure). Preserve logs and task ids. No speculative in-place fixes.

### Final report

I will end with the 40-item report the task requests, plus:
- an explicit list of steps I performed vs steps I handed back to the owner because the capability was missing,
- the production workspace UUID redacted as `<first8>…<last4>`,
- confirmation that TEST (`zbwsbnqqpkvdhqwavjke`) was not touched at any point,
- confirmation that `supabase/functions/mcp/index.ts` was not staged or deployed,
- confirmation that no Phase 3 work was started.

### Explicit stops built into the plan

I will pause and hand back to you before doing any of the following, even if earlier phases pass:
1. Applying the migration (Phase D) — requires migration-tool approval.
2. Deploying Edge Functions (Phase E) — I will list what I'm about to deploy first.
3. Setting `ANTHROPIC_API_KEY` if missing (you must set it in Supabase UI).
4. Enabling Claude-first (Phase K) — I will show the exact secret names/values first (workspace UUID only).
5. Launching the paid workflow (Phase M) — I will show pre-run estimate and wait for explicit go.
