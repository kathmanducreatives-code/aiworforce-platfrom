#!/usr/bin/env bash
# Mutation proofs for the database-contract lane. Each removes one fix and
# requires its contract tests to FAIL on the behaviour:
#   1. revert the D1 PostgREST fix: the fenced-write tests fail;
#   2. build without the held credit re-arm migration: the credit tests fail;
#   3. build without, or with one guard removed from, the held smoke admission
#      (migration, transport gate, poll loop, Codex review R1–R7 fixes): a
#      named admission test fails.
#
#   PG_ADMIN_URL=… POSTGREST_BIN=… tests/db-contract/mutation.sh
#
# SHARDING (release verification runs the proofs in parallel jobs, each with
# its OWN Postgres): MUTATION_SHARDS=N MUTATION_SHARD=i runs proof k when
# (k-1) % N == i. Unset, it runs every proof, as before. Every shard walks the
# whole list, so each prints the same `total`; the workflow's gate requires the
# shards' `ran` counts to add up to it (docs/launch/ci.md, "Test levels").
#
# The real module is restored on exit whatever happens. Run it only in a
# disposable checkout (CI) or a clean working tree.
set -euo pipefail
root="$(cd "$(dirname "$0")/../.." && pwd)"
shards="${MUTATION_SHARDS:-1}"; shard="${MUTATION_SHARD:-0}"
case "$shards$shard" in *[!0-9]*) echo "MUTATION_SHARDS/MUTATION_SHARD must be integers" >&2; exit 2 ;; esac
[ "$shard" -lt "$shards" ] || { echo "MUTATION_SHARD must be below MUTATION_SHARDS" >&2; exit 2; }
proof_n=0; ran=0
# take: count this proof; true when it belongs to this shard.
take() { proof_n=$((proof_n + 1)); [ $(( (proof_n - 1) % shards )) -eq "$shard" ]; }
real="$root/supabase/functions/_shared/fencedTaskWrite.ts"
backup="$(mktemp)"; out="$(mktemp)"
cp "$real" "$backup"
trap 'cp "$backup" "$real"; rm -f "$backup" "$out"' EXIT
if take; then
cp "$root/tests/db-contract/mutants/fencedTaskWrite.pre-d1-fix.ts" "$real"
set +e
"$root/tests/db-contract/run.sh" "$root/tests/db-contract/fencedWrite.contract.test.ts" >"$out" 2>&1
status=$?
set -e
sed 's/\x1b\[[0-9;]*m//g' "$out" | grep -E '\.\.\. (ok|FAILED)|passed \|' || true
if [ $status -eq 0 ]; then
  echo "MUTANT SURVIVED: the contract tests pass with the D1 fix reverted" >&2; exit 1
fi
# It must fail on the behaviour, not on a build or type error. No `grep -q`
# here: under pipefail it exits on the first match, sed takes SIGPIPE on a
# large log, and the pipeline reports a miss for a line that is present.
if ! sed 's/\x1b\[[0-9;]*m//g' "$out" | grep 'own generation, open row: the write lands and is reported written \.\.\. FAILED' >/dev/null; then
  echo "the mutant run failed, but not on the fenced write itself:" >&2; tail -30 "$out" >&2; exit 1
fi
echo "mutant killed: reverting the D1 fix fails the fenced-write contract"
cp "$backup" "$real"; ran=$((ran + 1))
fi

# ── PROOF 2: the credit re-arm ──────────────────────────────────────────────
# Build the database WITHOUT the held billing fix and require the credit test
# to fail on its behaviour: the refunded key is replayed, not re-armed.
if take; then
set +e
DB_CONTRACT_OMIT_HELD=20261015130000_credits_rearm_settled_key.sql \
  "$root/tests/db-contract/run.sh" "$root/tests/db-contract/creditRearm.contract.test.ts" >"$out" 2>&1
status=$?
set -e
sed 's/\x1b\[[0-9;]*m//g' "$out" | grep -E '\.\.\. (ok|FAILED)|passed \||^omitted ' || true
if [ $status -eq 0 ]; then
  echo "MUTANT SURVIVED: the credit tests pass without the re-arm migration" >&2; exit 1
fi
if ! sed 's/\x1b\[[0-9;]*m//g' "$out" | grep 'a key refunded once (not_charged) and then really bought is charged \.\.\. FAILED' >/dev/null; then
  echo "the credit mutant failed, but not on the re-arm itself:" >&2; tail -30 "$out" >&2; exit 1
fi
echo "mutant killed: without the re-arm migration a refunded key's purchase goes uncharged"
ran=$((ran + 1))
fi

# ── PROOFS 3+: durable smoke admission ─────────────────────────────────────
# Each mutant removes ONE guard (in the held migration, the gate or the poll
# loop) and requires a named contract test to FAIL on that behaviour. The file
# is edited in place and restored on exit; a mutant whose text no longer
# matches stops the script rather than passing vacuously.
adm_sql="$root/supabase/migrations-held/20261015140000_discovery_smoke_admission.sql"
gate_ts="$root/supabase/functions/_shared/smokeAdmission.ts"
tools_ts="$root/supabase/functions/_shared/toolRegistry.ts"
credit_ts="$root/supabase/functions/_shared/creditAuthorization.ts"
runner_ts="$root/worker/leadMissionRunner.ts"
clock_ts="$root/supabase/functions/_shared/missionWallClock.ts"
plan_ts="$root/supabase/functions/_shared/smokeAdmissionRefusal.ts"
planner_ts="$root/supabase/functions/_shared/gptExecutionPlanner.ts"
brain_writer_sql="$root/supabase/migrations/20261024120000_company_brain_authorized_writer.sql"
client_sql="$root/supabase/migrations-held/20261024160000_client_company_brain.sql"
autosave_ts="$root/src/lib/onboardingAutosave.ts"
brain_draft_ts="$root/supabase/functions/generate-company-brain-draft/index.ts"
client_save_ts="$root/supabase/functions/_shared/clientBrainSave.ts"
brain_scope_ts="$root/src/lib/brainScope.ts"
client_api_ts="$root/src/lib/clientBrainApi.ts"
restore_list=()
for f in "$adm_sql" "$gate_ts" "$tools_ts" "$credit_ts" "$runner_ts" "$clock_ts" "$plan_ts" "$planner_ts" "$brain_writer_sql" "$client_sql" "$autosave_ts" "$brain_draft_ts" "$client_save_ts" "$brain_scope_ts" "$client_api_ts"; do
  cp "$f" "$f.mutation-backup"; restore_list+=("$f")
done
trap 'cp "$backup" "$real"; for f in "${restore_list[@]}"; do mv -f "$f.mutation-backup" "$f"; done; rm -f "$backup" "$out"' EXIT
adm_tests="$root/tests/db-contract/smokeAdmission.contract.test.ts"
gate_tests="$root/tests/db-contract/smokeAdmissionRuntime.contract.test.ts"
unit_tests="$root/tests/edge-functions/_shared/smokeAdmission.test.ts"
clock_tests="$root/tests/edge-functions/_shared/missionWallClock.test.ts"
planner_tests="$root/tests/edge-functions/_shared/smokePlannerRequestSize.test.ts"

# prove_killed <label> <file> <literal to find> <replacement> <test file> <test name that must FAIL>
prove_killed() {
  local label="$1" file="$2" find="$3" repl="$4" tests="$5" name="$6"
  take || return 0
  cp "$file.mutation-backup" "$file"
  FIND="$find" REPL="$repl" perl -0pi -e 's/\Q$ENV{FIND}\E/$ENV{REPL}/' "$file"
  if cmp -s "$file" "$file.mutation-backup"; then
    echo "MUTANT DID NOT APPLY ($label): the guarded text changed; update this proof" >&2; exit 1
  fi
  set +e
  "$root/tests/db-contract/run.sh" "$tests" >"$out" 2>&1
  local status=$?
  set -e
  cp "$file.mutation-backup" "$file"
  if [ $status -eq 0 ]; then echo "MUTANT SURVIVED ($label)" >&2; exit 1; fi
  if ! sed 's/\x1b\[[0-9;]*m//g' "$out" | grep -F "$name ... FAILED" >/dev/null; then
    echo "the mutant ($label) failed, but not on '$name':" >&2; tail -30 "$out" >&2; exit 1
  fi
  echo "mutant killed: $label"
  ran=$((ran + 1))
}

if take; then
set +e
DB_CONTRACT_OMIT_HELD=20261015140000_discovery_smoke_admission.sql "$root/tests/db-contract/run.sh" "$adm_tests" >"$out" 2>&1
status=$?
set -e
if [ $status -eq 0 ] || ! sed 's/\x1b\[[0-9;]*m//g' "$out" | grep -F "admission: the template's maximum is charged, durably, before anything is sent ... FAILED" >/dev/null; then
  echo "MUTANT SURVIVED or failed elsewhere: admission tests without the held migration" >&2; tail -30 "$out" >&2; exit 1
fi
echo "mutant killed: without the held admission migration nothing is admitted"
ran=$((ran + 1))
fi

# ── PROOFS: OWN-01, lead-graph parents stay in their workspace ─────────────
# Without the held migration a member stores a contact under another
# workspace's account; each part of the fix is required by a named test.
own01_sql="$root/supabase/migrations-held/20261025120000_lead_graph_same_workspace_parents.sql"
own01_tests="$root/tests/db-contract/leadGraphSameWorkspaceParents.contract.test.ts"
cp "$own01_sql" "$own01_sql.mutation-backup"; restore_list+=("$own01_sql")
if take; then
set +e
DB_CONTRACT_OMIT_HELD=20261025120000_lead_graph_same_workspace_parents.sql "$root/tests/db-contract/run.sh" "$own01_tests" >"$out" 2>&1
status=$?
set -e
if [ $status -eq 0 ] || ! sed 's/\x1b\[[0-9;]*m//g' "$out" | grep -F "OWN-01: a member cannot store a contact under another workspace's account (raw INSERT) ... FAILED" >/dev/null; then
  echo "MUTANT SURVIVED or failed elsewhere: OWN-01 tests without the held migration" >&2; tail -30 "$out" >&2; exit 1
fi
echo "mutant killed: without the OWN-01 migration a contact stores another workspace's account"
ran=$((ran + 1))
fi
prove_killed "OWN-01: SET NULL nulls the whole key (workspace_id too)" "$own01_sql" \
  "when 'set null' then format('set null (%I)', r.col)" "when 'set null' then 'set null'" \
  "$own01_tests" "positive controls: own parent, no parent, embed, delete behaviour"
prove_killed "OWN-01: contacts left out of the reference list" "$own01_sql" \
  '    ["contacts",              "account_id",         "accounts",         "set null"],
' "" \
  "$own01_tests" "OWN-01: a member cannot store a contact under another workspace's account (raw INSERT)"
prove_killed "OWN-01: preflight does not abort on an existing mismatch" "$own01_sql" \
  "  if v_report <> '' then" "  if false then" \
  "$own01_tests" "preflight: an existing mismatch aborts the migration and changes nothing"

prove_killed "no serialization lock" "$adm_sql" \
  "where queue_id = p_queue for update;
  if not found then return jsonb_build_object('decision', 'not_authorized'); end if;" \
  "where queue_id = p_queue;
  if not found then return jsonb_build_object('decision', 'not_authorized'); end if;" \
  "$adm_tests" "deadline: an admission that waited on the lock past the deadline is refused"
# (Paid admissions also serialize on the liability lock since PR #96, so the
# last-slot race no longer depends on this row lock alone; the lock-wait test,
# which holds this row from a second session, still does.)
prove_killed "no deadline" "$adm_sql" "or a.deadline_at <= v_now" "" \
  "$adm_tests" "deadline: absolute, from the queue row, read after the lock, never renewed"

# ── PROOFS: the legacy pre-effect guard ────────────────────────────────────
# Each mutant removes one part of the guard or one entry's call to it; a named
# test, judged by effects (rows, vendor requests, writes), must then fail.
guard_ts="$root/supabase/functions/_shared/legacyExecutionGuard.ts"
ra_ts="$root/supabase/functions/run-agent/index.ts"
orch_ts="$root/supabase/functions/orchestrate/index.ts"
enq_ts="$root/supabase/functions/enqueue-lead-mission/index.ts"
guard_tests="$root/tests/db-contract/legacyPreEffectGuard.contract.test.ts"
for f in "$guard_ts" "$ra_ts" "$orch_ts" "$enq_ts"; do cp "$f" "$f.mutation-backup"; restore_list+=("$f"); done
prove_killed "guard: run-agent ignores the refusal" "$ra_ts" \
  "      return json({ success: false, error: guard.code, detail: guard.detail }, guard.status);" \
  "      void json({ success: false, error: guard.code, detail: guard.detail }, guard.status);" \
  "$guard_tests" "run-agent: a request carrying the pilot marker is refused before any effect"
prove_killed "guard: the stored task's pilot markers are not read" "$guard_ts" \
  "      if (stored.pilot.length) return" "      if (stored.pilot.length && false) return" \
  "$guard_tests" "run-agent: a resume of a STORED pilot task is refused before any effect, with the request's markers stripped"
prove_killed "guard: membership not re-checked for a service caller" "$guard_ts" \
  "    if (!data) return refuse(403, \"principal_not_member\"" "    if (!data && false) return refuse(403, \"principal_not_member\"" \
  "$guard_tests" "run-agent: a service call for a user who is no longer a member is refused before any effect"
prove_killed "guard: a resume may change its principal" "$guard_ts" \
  "if (i.taskIds.resume.includes(row.id) && row.user_id && row.user_id !== i.principalUserId) {" \
  "if (i.taskIds.resume.includes(row.id) && row.user_id && row.user_id !== i.principalUserId && false) {" \
  "$guard_tests" "run-agent: a resume keeps its original principal — another member cannot resume it"
prove_killed "guard: enqueue-lead-mission ignores the refusal" "$enq_ts" \
  "    return json({ error: guard.code, detail: guard.detail }, guard.status);" \
  "    void json({ error: guard.code, detail: guard.detail }, guard.status);" \
  "$guard_tests" "enqueue-lead-mission: no pilot, client-scoped or non-member mission is queued"
prove_killed "guard: orchestrate ignores the refusal" "$orch_ts" \
  "        return json({ error: guard.code, details: guard.detail }, guard.status);" \
  "        void json({ error: guard.code, details: guard.detail }, guard.status);" \
  "$guard_tests" "orchestrate: a pilot or client-scoped request is refused before any plan, Brain read, model call or dispatch"
prove_killed "guard: the plan is not checked (EXEC-PLAN)" "$guard_ts" \
  "    if (!plan || plan.workspace_id !== i.workspaceId) {" "    if ((!plan || plan.workspace_id !== i.workspaceId) && false) {" \
  "$guard_tests" "run-agent: a task filed under another workspace's plan is refused before any effect (Codex EXEC-PLAN)"
# The task commit boundary (held 20261025130000): the database's own check.
cb_sql="$root/supabase/migrations-held/20261025130000_tasks_commit_boundary.sql"
cb_tests="$root/tests/db-contract/taskCommitBoundary.contract.test.ts"
cp "$cb_sql" "$cb_sql.mutation-backup"; restore_list+=("$cb_sql")
if take; then
set +e
DB_CONTRACT_OMIT_HELD=20261025130000_tasks_commit_boundary.sql "$root/tests/db-contract/run.sh" "$cb_tests" >"$out" 2>&1
status=$?
set -e
if [ $status -eq 0 ] || ! sed 's/\x1b\[[0-9;]*m//g' "$out" | grep -F "commit boundary: a new task's principal must be a current member ... FAILED" >/dev/null; then
  echo "MUTANT SURVIVED or failed elsewhere: commit boundary tests without the held migration" >&2; tail -30 "$out" >&2; exit 1
fi
echo "mutant killed: without the commit boundary a non-member's task commits"
ran=$((ran + 1))
fi
prove_killed "commit boundary: membership read without its lock (EXEC-REVOKE race)" "$cb_sql" \
  "      where m.workspace_id = new.workspace_id and m.user_id = new.user_id
      for key share;" "      where m.workspace_id = new.workspace_id and m.user_id = new.user_id;" \
  "$cb_tests" "commit boundary: a membership DELETE racing the INSERT — the INSERT waits, then is refused"
prove_killed "commit boundary: the plan's workspace is not compared" "$cb_sql" \
  "    if not found or v_plan_ws is distinct from new.workspace_id then" "    if not found then" \
  "$cb_tests" "commit boundary: a task filed under another workspace's plan is refused (plan_id and task_plan_id)"
prove_killed "clock read before the lock wait" "$adm_sql" "v_now := clock_timestamp();  -- after the lock wait" "v_now := now();  --" \
  "$adm_tests" "deadline: an admission that waited on the lock past the deadline is refused"
prove_killed "a run bought with one read (no dataset read)" "$plan_ts" "export const SMOKE_MIN_RUN_READS = 2;" "export const SMOKE_MIN_RUN_READS = 1;" \
  "$gate_tests" "read lifecycle: the FINAL run is bought with two reads; its receipt is deferred, held at the maximum, and blocks the next smoke"
prove_killed "no generation fence" "$adm_sql" "or t.checkpoint_version is distinct from p_generation" "" \
  "$adm_tests" "ownership: queue claim, queue lease, lineage lease, task binding and generation all fence"
prove_killed "any task status admitted" "$adm_sql" "or t.status not in ('running', 'ready')" "" \
  "$adm_tests" "ownership: queue claim, queue lease, lineage lease, task binding and generation all fence"
prove_killed "no new smoke over unreconciled liability: gate removed" "$adm_sql" "  if v_open > 0 then" "  if false then" \
  "$adm_tests" "reconciliation: an unsettled purchase blocks the next authorization until a person reconciles it"
prove_killed "an earlier authorization spends over open liability: admission recheck removed" "$adm_sql" \
  "  if p_kind in ('provider', 'model') and exists (select 1 from public.discovery_smoke_operations x" \
  "  if false and exists (select 1 from public.discovery_smoke_operations x" \
  "$adm_tests" "reconciliation: an earlier authorization cannot spend over another's open liability (Codex review, PR #96)"
prove_killed "two smokes race past the recheck: admission lock removed" "$adm_sql" \
  "  if p_kind in ('provider', 'model') then
    perform pg_advisory_xact_lock(hashtext('agentory.discovery_smoke.liability'));" \
  "  if p_kind in ('provider', 'model') then
    null;" \
  "$adm_tests" "reconciliation: two smokes racing to buy first — exactly one purchase is admitted"
# Codex P1 (final review): the clock read, and so every ownership check, before
# the liability lock's wait. A lease expiring during the wait would be missed.
prove_killed "ownership judged before the liability lock's wait" "$adm_sql" \
  "  if p_kind in ('provider', 'model') then
    perform pg_advisory_xact_lock(hashtext('agentory.discovery_smoke.liability'));
  end if;
  v_now := clock_timestamp();  -- after the lock wait; now() is transaction start" \
  "  v_now := clock_timestamp();  -- after the lock wait; now() is transaction start
  if p_kind in ('provider', 'model') then
    perform pg_advisory_xact_lock(hashtext('agentory.discovery_smoke.liability'));
  end if;" \
  "$adm_tests" "leases: a paid admission that waited on the liability lock past a lease is refused (Codex P1, final review)"
prove_killed "one actor's slow run spends another's reads: allocation ignored by the read plan" "$gate_ts" \
  "    const share = actor ? readAllocation(auth, actor) : null;" "    const share = null as number | null;" \
  "$gate_tests" "read lifecycle: with a 3 + 2 allocation, a slow job search keeps company details' two reads (independent review, PR #96)"
prove_killed "one actor's reads exceed its share: database allocation removed" "$adm_sql" \
  "    return jsonb_build_object('decision', 'read_allocation');" "    null;" \
  "$adm_tests" "polls: a reads template's per-actor allocation holds each actor to its share of the five (independent review, PR #96)"
# Final offline hardening: the template catalog and reconciliation.
prove_killed "a template missing a required key is authorized" "$adm_sql" \
  "or jsonb_typeof(v_t -> 'allowed_kinds') is distinct from 'array' or" \
  "or jsonb_typeof(v_t -> 'allowed_kinds') <> 'array' or" \
  "$adm_tests" "authorize: refuses stale, future, unbounded or evidence-free prices"
prove_killed "a template missing allowed_kinds admits" "$adm_sql" \
  "not coalesce((v_tpl -> 'allowed_kinds') ? p_kind, false)" "not ((v_tpl -> 'allowed_kinds') ? p_kind)" \
  "$adm_tests" "admission: a template missing a key admits nothing, even one written outside authorize (final hardening)"
prove_killed "an incomplete or oversized read allocation is authorized" "$adm_sql" \
  "    if (v_t -> 'request_limits') ? 'max_reads_per_actor' and (" "    if false and (" \
  "$adm_tests" "authorize: a read allocation covers exactly the reads template's actors and fits the five (final hardening)"
prove_killed "a priced read template is authorized" "$adm_sql" \
  "and (v_t ->> 'maximum_microusd')::bigint <> 0 then" "and false then" \
  "$adm_tests" "authorize: reads are free, and one template per kind and actor (final hardening)"
prove_killed "two templates for one kind and actor are authorized" "$adm_sql" \
  "group by k, x having count(distinct t.key) > 1) then" "group by k, x having false) then" \
  "$adm_tests" "authorize: reads are free, and one template per kind and actor (final hardening)"
prove_killed "an above-quote reconciliation closes liability for authorization" "$adm_sql" \
  "                        and r.vendor_microusd <= o.committed_microusd);" "                        );" \
  "$adm_tests" "reconciliation: a figure above the quote is recorded, HELD open, and blocks every later smoke (final hardening)"
prove_killed "an above-quote reconciliation lets another authorization spend" "$adm_sql" \
  "                                     and r.vendor_microusd <= x.committed_microusd)) then" "                                     )) then" \
  "$adm_tests" "reconciliation: a figure above the quote is recorded, HELD open, and blocks every later smoke (final hardening)"
prove_killed "a live authorization's purchase is reconciled" "$adm_sql" \
  "    if a.status = 'active' and a.deadline_at > clock_timestamp() then" "    if false then" \
  "$adm_tests" "reconciliation: never while the authorization is live, and only for a terminal vendor status (final hardening)"
prove_killed "a nonterminal vendor status is accepted" "$adm_sql" \
  "  if v_status is null or v_status not in ('SUCCEEDED', 'FAILED', 'ABORTED', 'TIMED-OUT', 'NO_RUN') then" "  if false then" \
  "$adm_tests" "reconciliation: never while the authorization is live, and only for a terminal vendor status (final hardening)"
prove_killed "NO_RUN closes a purchase that ran" "$adm_sql" \
  "    if v_status = 'NO_RUN' and (o.provider_run_id is not null or p_vendor_microusd <> 0) then" "    if false then" \
  "$adm_tests" "reconciliation: never while the authorization is live, and only for a terminal vendor status (final hardening)"
prove_killed "a padded reference is a different record" "$adm_sql" \
  "or r.vendor_ref is distinct from v_ref" "or r.vendor_ref is distinct from p_vendor_ref" \
  "$adm_tests" "reconciliation: immutable, provider purchases only, terminal, and a padded reference is the same record"
prove_killed "no lineage lease check" "$adm_sql" "or l.lease_holder is distinct from p_task " "" \
  "$adm_tests" "ownership: queue claim, queue lease, lineage lease, task binding and generation all fence"
prove_killed "re-keyed payload buys again" "$adm_sql" \
  "or (p_kind = 'provider' and kind = 'provider' and actor = p_actor and payload_hash = p_payload_hash)" "" \
  "$adm_tests" "replay: the same key, or the same payload under a new key, is never a second purchase"
prove_killed "no model attempt count" "$adm_sql" "if p_kind = 'model' and n_model >= a.model_attempts then" "if false then" \
  "$adm_tests" "model: four attempts, then refused; failed attempts keep their slot"
prove_killed "no combined USD cap" "$adm_sql" "if v_total + v_cost > a.total_microusd" "if false" \
  "$adm_tests" "money: provider \$0.20 and combined \$0.25 are shared by every kind"
prove_killed "no provider USD cap" "$adm_sql" "or (p_kind <> 'model' and v_provider + v_cost > a.provider_microusd)" "" \
  "$adm_tests" "race: two purchases racing for the last provider dollars cannot both win"
prove_killed "no model USD cap" "$adm_sql" "or (p_kind = 'model' and v_model + v_cost > a.model_microusd)" "" \
  "$adm_tests" "model: the \$0.05 model ceiling binds before the attempt count"
prove_killed "no poll limit" "$adm_sql" "if p_kind = 'poll' and n_poll >= a.provider_polls then" "if false then" \
  "$adm_tests" "polls: five across the whole mission, each tied to a purchase this mission made"

# ── PROOF: a malformed vendor dataset is recorded as malformed (A7 S18a) ───
prove_killed "S18a: a malformed dataset recorded as an empty one" "$tools_ts" \
  "  const datasetMalformed = !Array.isArray(itemsRes.data);" "  const datasetMalformed = false;" \
  "$root/tests/db-contract/a7Reliability.contract.test.ts" "S18a: the job-search dataset is malformed JSON — no lead, no further purchase, recorded as malformed"
prove_killed "worker may authorize" "$adm_sql" \
  "revoke all on function public.authorize_discovery_smoke(uuid, text, jsonb, jsonb, integer) from public, anon, authenticated, service_role;" \
  "grant execute on function public.authorize_discovery_smoke(uuid, text, jsonb, jsonb, integer) to service_role;" \
  "$adm_tests" "privileges: service_role reads and admits; it cannot authorize, insert, update or delete"
prove_killed "gate passes requests with no mission" "$gate_ts" 'if (!ctx) return refuse("no_mission_context");' 'if (!ctx) return d.baseFetch(input, init);' \
  "$gate_tests" "gate: outside a mission, before binding, after revocation, or to an unknown host, nothing is sent"
prove_killed "replayed purchase reported as a definite refusal" "$gate_ts" \
  "const purchaseMayExist = PURCHASE_MAY_EXIST.has(decision) || earlierPurchase;" \
  "const purchaseMayExist = false;" \
  "$gate_tests" "apify: an uncertain start keeps its credit HELD and is never bought again"
prove_killed "vendor caps not pinned" "$gate_ts" "url.searchParams.set(k, String(v));" "void [k, v];" \
  "$gate_tests" "apify: admitted with the template's vendor caps, run id durable, polls admitted, one credit charged"
# The smoke's Apify read lifecycle (its loop replaced the 3 s poll loop in smoke mode).
prove_killed "smoke status read ignores the read reserve" "$plan_ts" \
  '  if (s.readsLeft < SMOKE_MIN_RUN_READS) return { ok: false, reason: "reads_reserved" };' "" \
  "$gate_tests" "read lifecycle: a run still RUNNING at the reserve stays pending, its receipt explicitly unsettled and listed"
prove_killed "smoke start ignores the lifecycle's reads" "$plan_ts" \
  '  if (s.readsLeft !== null && s.readsLeft < SMOKE_MIN_RUN_READS) return { ok: false, reason: "reads_exhausted" };' "" \
  "$gate_tests" "read lifecycle: a slow run takes four reads; a second run that could not be settled is never bought"
prove_killed "read plan refusal reads as a refund for a replay" "$gate_ts" \
  '      if (!plan.ok) return refuse("read_plan", plan.reason);' '      if (!plan.ok) return refusal("read_plan", plan.reason);' \
  "$gate_tests" "read lifecycle: a replay of an uncertain start refused by the read plan keeps its credit HELD"
prove_killed "smoke start ignores the time left" "$plan_ts" \
  "    s.remainingMs < APIFY_START_TIMEOUT_MS + SMOKE_MIN_WAIT_S * 1000 + SMOKE_READ_SLACK_MS + SMOKE_TAIL_MS) {" "    false) {" \
  "$gate_tests" "read lifecycle: the long poll is clamped to the time left; too little time buys nothing"
prove_killed "long poll not clamped to the time left" "$plan_ts" \
  "Math.min(APIFY_MAX_WAIT_S, Math.floor((s.remainingMs - SMOKE_TAIL_MS - SMOKE_READ_SLACK_MS) / 1000))" "APIFY_MAX_WAIT_S" \
  "$gate_tests" "read lifecycle: the long poll is clamped to the time left; too little time buys nothing"
prove_killed "receipt read skipped" "$tools_ts" \
  $'      receipt = "unsettled";\n      if (plan.ok) {' $'      receipt = "unsettled";\n      if (plan.ok && plan.waitMs < 0) {' \
  "$gate_tests" "read lifecycle: a run finishing in its first long poll uses exactly three reads, and its receipt is settled"
prove_killed "settled receipt not labelled" "$gate_ts" \
  'source: apifyRunSettled(j?.data ?? null, sentAt) ? APIFY_SETTLED_SOURCE : "apify_run(status).receipt",' 'source: "apify_run(status).receipt",' \
  "$gate_tests" "read lifecycle: a run finishing in its first long poll uses exactly three reads, and its receipt is settled"
prove_killed "vendor cap above the quote kept" "$gate_ts" \
  "asked >= 0 && asked < quote ? asked : quote" "asked >= 0 ? asked : quote" \
  "$gate_tests" "jobs: more titles, locations or rows than one search of three is refused before purchase; the vendor cap never exceeds the quote"
prove_killed "billed-per-entry arrays unbounded" "$gate_ts" \
  '      if (!Array.isArray(pinned[k]) || (pinned[k] as unknown[]).length > max) return { ok: false, reason: `array_unbounded:${k}` };' "" \
  "$gate_tests" "jobs: more titles, locations or rows than one search of three is refused before purchase; the vendor cap never exceeds the quote"
prove_killed "legacy jobs actor keeps its customer shape in the smoke" "$tools_ts" \
  $'      if (smokeAdmissionActive()) {\n        return buildCuriousCoderSmokeJobsInput({' $'      if (false) {\n        return buildCuriousCoderSmokeJobsInput({' \
  "$gate_tests" "jobs: the legacy LinkedIn jobs actor gets one URL, three per source, no \`count\`, in the smoke"

# Codex review R1–R7: each fix removed in turn must fail its own regression.
prove_killed "R1 later refusal refunds an earlier hold" "$gate_ts" \
  'const earlier = c.kind === "provider" && (authUnavailable || (prior !== null && prior !== "no"));' \
  'const earlier = false;' \
  "$gate_tests" "R1: a later refusal (the authorization is stopped) never refunds an earlier uncertain Apify hold"
prove_killed "R2 uncertain Firecrawl refunded" "$credit_ts" " || error.startsWith(FIRECRAWL_UNCERTAIN)" "" \
  "$gate_tests" "R2: in the smoke, an uncertain Firecrawl purchase keeps its credit HELD"
prove_killed "R3 remote media accepted" "$gate_ts" "const textOnly = textOnlyModelRequest(c.vendor, pinned);" "const textOnly = null;" \
  "$unit_tests" "R3: model requests are the audited text-only shape; media, files, tools and unknown fields are refused"
prove_killed "R4 redirects followed" "$gate_ts" '{ ...(init ?? {}), redirect: "manual" }' "init" \
  "$unit_tests" "R4: a redirect is never followed, from the project's own API or from an admitted request"
prove_killed "R5 malformed admission trusted" "$gate_ts" \
  'if (bad) return { decision: "admission_unavailable", detail: `malformed_admission:${bad}` };' "void bad;" \
  "$unit_tests" "R5: an admitted answer missing or corrupting any field the send relies on sends nothing"
prove_killed "R6 closure not rechecked" "$gate_ts" \
  'if (ctx.closedReason) return refuse("closed_after_admission", ctx.closedReason);' "" \
  "$unit_tests" "R6: a mission call that ends while its admission is in flight sends nothing"
prove_killed "R7 start charge dropped" "$gate_ts" \
  'const charge = c.captures === "apify_run" ? apifyCharge(run ?? null) : null;' "const charge = null as number | null;" \
  "$gate_tests" "R7: a charge reported in the START response is recorded, and an over-quote stops the mission"
# R8: each ownership row is fenced through commit.
prove_killed "R8 queue row not fenced" "$adm_sql" "where id = p_queue for share;" "where id = p_queue;" \
  "$adm_tests" "R8: cancellation cannot commit while an admission is in flight, and refuses every admission after it"
prove_killed "R8 task row not fenced" "$adm_sql" "where id = p_task for share;" "where id = p_task;" \
  "$adm_tests" "R8: a newer generation cannot commit while an admission is in flight, and refuses every admission after it"
prove_killed "R8 lineage row not fenced" "$adm_sql" "where lineage_id = q.lineage_id for share;" "where lineage_id = q.lineage_id;" \
  "$adm_tests" "R8: a moved lineage lease cannot commit while an admission is in flight, and refuses every admission after it"
prove_killed "R2 uncertain crawl start refunded (Codex P2)" "$tools_ts" \
  '  if (!startRes.ok && smokeAdmissionActive() && (startRes.status === 0 || startRes.status >= 500)) {' \
  '  if (false) {' \
  "$gate_tests" "R2 (Codex P2): in the smoke, an uncertain Firecrawl CRAWL start keeps its credit HELD"
prove_killed "SAF-008 bodyless purchase skips mandatory fields" "$gate_ts" \
  "  if (hasBody || limits.pin_body || mandatory || limits.max_array_items) {" "  if (hasBody || limits.pin_body || limits.max_array_items) {" \
  "$gate_tests" "SAF-008: an absent or empty body never bypasses the quote's mandatory fields"
# Verified adoption of a run a dead slice bought (smokeAdmission.ts
# `verifiedAdoption`): the gate wiring and each binding of the evidence.
adopt_tests="$root/tests/db-contract/killResumeAdoption.contract.test.ts"
adopt_unit="$root/tests/edge-functions/_shared/smokeAdoption.test.ts"
prove_killed "adoption: a verified adopt still answered 503" "$gate_ts" \
  '        return adoptedRunResponse(adopted.runId, adopted.datasetId);' '        return refusal("adopt", adopted.runId);' \
  "$adopt_tests" "adoption: killed before the run id reached the execution ledger — the next worker adopts the paid run, reads it and finishes; one purchase, one charge"
prove_killed "adoption: evidence not bound to the task" "$gate_ts" \
  '  if (row.task_id !== b.taskId) return { ok: false, reason: "task" };' '' \
  "$adopt_tests" "adoption fails closed: the recorded purchase belongs to another task"
prove_killed "adoption: dataset id format not checked" "$gate_ts" \
  '  if (typeof datasetId !== "string" || !RUN_REF_RE.test(datasetId)) return' '  if (typeof datasetId !== "string") return' \
  "$adopt_tests" "adoption fails closed: a malformed dataset id is never read or adopted"
prove_killed "adoption: a same- or later-generation purchase adopted" "$gate_ts" \
  ' || row.generation >= b.generation) return' ') return' \
  "$adopt_unit" "adoption: the operation row must be this start's purchase, of this task, bought by an earlier generation"
prove_killed "adoption: a conflicting run id adopted" "$gate_ts" \
  '  if (row.provider_run_id !== runId) return { ok: false, reason: "run_conflict" };' '' \
  "$adopt_unit" "adoption: the operation row must be this start's purchase, of this task, bought by an earlier generation"
prove_killed "adoption: another operation's answer adopted" "$gate_ts" \
  '  if (d.operation_key !== b.key) return { ok: false, reason: "operation_key" };' '' \
  "$adopt_unit" "adoption: the answer itself must be complete and well-formed"
# The opt-in mission wall clock (from codex/smoke-execution-guards).
prove_killed "wall clock: expired mission still reaches the handler" "$runner_ts" \
  "if (d.enforceMissionWallClock && (expiry === null || now() >= expiry)) {" "if (false) {" \
  "$clock_tests" "wall clock: a worker restart with a lost checkpoint never resets the persisted queue deadline"
prove_killed "wall clock: deadline extended past 300 s" "$clock_ts" \
  "  return at + SMOKE_MISSION_RUNTIME_MS;" "  return at + 10 * SMOKE_MISSION_RUNTIME_MS;" \
  "$clock_tests" "wall clock: a worker restart with a lost checkpoint never resets the persisted queue deadline"
prove_killed "wall clock: far-future queue timestamp accepted" "$clock_ts" \
  "at > now + QUEUE_CLOCK_SKEW_MS) return null;" "false) return null;" \
  "$clock_tests" "wall clock: unreadable or future queue timestamp 2026-10-14T00:00:30.001Z refuses before the handler"
prove_killed "settlement judged at arrival, not send time (Codex P2)" "$tools_ts" \
  "    } else if (apifyRunSettled(finalRun, finalRunSentAt)) {" "    } else if (apifyRunSettled(finalRun, Date.now())) {" \
  "$gate_tests" "read lifecycle (Codex P2): a preliminary snapshot answered late is not taken as settled"
prove_killed "smoke planner shown every authorised actor (Codex P1)" "$planner_ts" \
  "    const payload = approved ? smokePlannerPayload(i.payload, approved) : i.payload;" "    const payload = i.payload;" \
  "$planner_tests" "smoke planner: the execution-planner request for the smoke's mission fits the Luna template"

# ── PROOF: the browser never writes the Company Brain (roadmap Phase 3a) ───
# Build WITHOUT 20261023120000_company_brain_server_writes_only and require the
# server-writes test to fail on a member's browser write — the viewer PATCH
# that returned 204 and persisted before the migration.
if take; then
set +e
DB_CONTRACT_OMIT_HELD=20261023120000_company_brain_server_writes_only.sql \
  "$root/tests/db-contract/run.sh" "$root/tests/db-contract/companyBrainServerWrites.contract.test.ts" >"$out" 2>&1
status=$?
set -e
sed 's/\x1b\[[0-9;]*m//g' "$out" | grep -E '\.\.\. (ok|FAILED)|passed \||^omitted ' || true
if [ $status -eq 0 ] || ! sed 's/\x1b\[[0-9;]*m//g' "$out" | grep -F "no member — viewer, editor, admin or owner — writes the Brain from the browser ... FAILED" >/dev/null; then
  echo "MUTANT SURVIVED or failed elsewhere: Brain server-writes tests without the migration" >&2; tail -30 "$out" >&2; exit 1
fi
echo "mutant killed: without the migration a viewer rewrites the Company Brain from the browser"
ran=$((ran + 1))
fi

# ── PROOFS: the Company Brain writer re-authorizes under locks (AUTH-06) ────
# Each mutant weakens one part of public.company_brain_authorized_write; a
# named race or refusal test must then fail. The function is applied by the
# bootstrap as a normal migration, so the mutant is what the database runs.
brain_writer_tests="$root/tests/db-contract/companyBrainAuthorizedWrite.contract.test.ts"
prove_killed "Brain writer: no lock on the session (a logout overtakes the write)" "$brain_writer_sql" \
  "     and (s.not_after is null or s.not_after > v_now)
   for share;" "     and (s.not_after is null or s.not_after > v_now);" \
  "$brain_writer_tests" "race: logged out in flight → the write waits, then is refused"
prove_killed "Brain writer: no lock on the membership (a demotion overtakes the write)" "$brain_writer_sql" \
  "   where m.workspace_id = p_workspace_id and m.user_id = p_actor_id
   for share;" "   where m.workspace_id = p_workspace_id and m.user_id = p_actor_id;" \
  "$brain_writer_tests" "race: demoted to viewer in flight → the write waits, then is refused"
prove_killed "Brain writer: role not checked at the write" "$brain_writer_sql" \
  "            when 'edit' then v_role in ('owner', 'admin', 'editor')" "            when 'edit' then true" \
  "$brain_writer_tests" "owner, admin and editor write; viewer, legacy roles and non-members are refused and change nothing"

# Phase 3c (held client schema): every lock and rule the client tests rely on.
client_tests="$root/tests/db-contract/clientCompanyBrain.contract.test.ts"
prove_killed "client writer: no lock on the session (a logout overtakes the write)" "$client_sql" \
  "  perform 1 from auth.sessions s
   where s.id = p_session_id and s.user_id = p_actor_id for share;
  perform 1 from public.workspace_members m
   where m.workspace_id = p_workspace_id and m.user_id = p_actor_id for share;
  perform 1 from public.client_accounts c" \
  "  perform 1 from public.workspace_members m
   where m.workspace_id = p_workspace_id and m.user_id = p_actor_id for share;
  perform 1 from public.client_accounts c" \
  "$client_tests" "6c. race: logged out in flight → session_invalid; nothing written"
prove_killed "client writer: no lock on the membership (a demotion overtakes the write)" "$client_sql" \
  "  perform 1 from public.workspace_members m
   where m.workspace_id = p_workspace_id and m.user_id = p_actor_id for share;
  perform 1 from public.client_accounts c
   where c.workspace_id = p_workspace_id and c.id = p_client_id for share;" \
  "  perform 1 from public.client_accounts c
   where c.workspace_id = p_workspace_id and c.id = p_client_id for share;" \
  "$client_tests" "6. race: demoted to viewer in flight → waits, then forbidden_role; a pinned task is refused after demote→promote"
# Archive takes the client row and revokes every grant row, so either of these
# two locks alone already makes the writer wait; without both it does not.
prove_killed "client writer: no lock on the client or its grant (an archive overtakes the write)" "$client_sql" \
  "  perform 1 from public.client_accounts c
   where c.workspace_id = p_workspace_id and c.id = p_client_id for share;
  perform 1 from public.client_access_grants g
   where g.workspace_id = p_workspace_id and g.client_id = p_client_id
     and g.user_id = p_actor_id and g.revoked_at is null for share;" "" \
  "$client_tests" "7. race: client archived in flight → waits, then client_archived; every grant revoked; archive is terminal"
prove_killed "client rule: a revoked grant still authorizes" "$client_sql" \
  "  elsif v_grant is null then
    return 'no_grant';" "  elsif false then
    return 'no_grant';" \
  "$client_tests" "4. race: grant revoked in flight → the write waits on the lock, then is refused; nothing written"
prove_killed "client rule: a task's pinned generation is not compared (regrant revives the old task)" "$client_sql" \
  "if v_grant is null or v_grant <> p_pin_grant_id or v_gen <> p_pin_generation then return 'grant_changed'; end if;" \
  "if v_grant is null then return 'grant_changed'; end if;" \
  "$client_tests" "5. revoke → regrant: a new generation; a task pinned to the old one is refused, read and write"
prove_killed "client rule: a task's pinned permission revision is not compared" "$client_sql" \
  "if v_rev <> p_pin_revision then return 'permission_changed'; end if;" "" \
  "$client_tests" "6. race: demoted to viewer in flight → waits, then forbidden_role; a pinned task is refused after demote→promote"
prove_killed "permission revision not renewed on a role change" "$client_sql" \
  "  if new.role is distinct from old.role then
    new.permission_revision := nextval('public.workspace_member_permission_revision_seq');" \
  "  if new.role is distinct from old.role then
    new.permission_revision := old.permission_revision;" \
  "$client_tests" "6. race: demoted to viewer in flight → waits, then forbidden_role; a pinned task is refused after demote→promote"
prove_killed "membership removal leaves the user's grants active" "$client_sql" \
  "     set revoked_at = clock_timestamp(), revoke_reason = 'membership_removed', revoked_by = null
   where g.workspace_id = old.workspace_id and g.user_id = old.user_id and g.revoked_at is null;" \
  "     set revoked_at = clock_timestamp(), revoke_reason = 'membership_removed', revoked_by = null
   where false;" \
  "$client_tests" "6b. race: membership removed in flight → not_member and every grant revoked; remove → rejoin → regrant refuses the old task"
prove_killed "archive leaves the client's grants active" "$client_sql" \
  "     set revoked_at = v_now, revoked_by = p_actor_id, revoke_reason = 'client_archived'
   where g.workspace_id = p_workspace_id and g.client_id = p_client_id and g.revoked_at is null;" \
  "     set revoked_at = v_now, revoked_by = p_actor_id, revoke_reason = 'client_archived'
   where false;" \
  "$client_tests" "7. race: client archived in flight → waits, then client_archived; every grant revoked; archive is terminal"
prove_killed "client rule: a missing client falls through instead of client_context_required" "$client_sql" \
  "  if p_client_id is null then return 'client_context_required'; end if;" "" \
  "$client_tests" "8. a client request without a client is refused everywhere — never the agency Brain or a default client"
prove_killed "client rule: a viewer edits" "$client_sql" \
  "            when 'edit' then v_role in ('owner', 'admin', 'editor')" "            when 'edit' then true" \
  "$client_tests" "2. a user granted only client A reads and edits A, and can neither read, write nor list B"
prove_killed "client RLS: every member enumerates every client (O1)" "$client_sql" \
  "  using (status = 'active' and public.client_access_is_active(workspace_id, id));" "  using (true);" \
  "$client_tests" "2. a user granted only client A reads and edits A, and can neither read, write nor list B"

# End-to-end autosave (actual handler + page logic): the guards the E2E tests rely on.
e2e_tests="$root/tests/db-contract/brainAutosaveEndToEnd.contract.test.ts"
prove_killed "autosave: a stale answer without the server's copy is merged against nothing (typed text blanked)" "$autosave_ts" \
  "  if (r.kind === 'stale' && (r.serverProfile === null || r.serverProfile === undefined)) {" \
  "  if (false) {" \
  "$e2e_tests" "4. two users autosave the same agency Brain from one version: no edit is lost, both orderings"
prove_killed "handler: client Brains served while switched off" "$brain_draft_ts" \
  '    if (!clientBrainsEnabled((k) => Deno.env.get(k))) return json({ error: "client_brains_disabled" }, 409);' "" \
  "$e2e_tests" "switched off: a client request is refused before any Brain access — never served from the agency Brain"
prove_killed "handler: the request's client is ignored (a client save lands on the agency Brain)" "$brain_draft_ts" \
  "  const brainScope = resolveBrainScope(body);" "  const brainScope = resolveBrainScope({});" \
  "$e2e_tests" "2. a user edits and autosaves an AUTHORIZED CLIENT Brain: first insert, then CAS on its version; the agency Brain is untouched"
prove_killed "client save: the version the page built on is not checked (a stale save overwrites)" "$client_save_ts" \
  "  if (expected !== currentVersion) {" "  if (false) {" \
  "$e2e_tests" "6. a stale autosave is rejected without a write and without losing the user's unsaved text"
prove_killed "switcher: the client list is served while client Brains are switched off" "$brain_draft_ts" \
  '  if (action === "list_clients") {
    if (!clientBrainsEnabled((k) => Deno.env.get(k))) return json({ error: "client_brains_disabled" }, 409);' \
  '  if (action === "list_clients") {' \
  "$e2e_tests" "9. the switcher lists exactly the user's active granted clients — and drops one the moment access ends"
prove_killed "switcher: a selected client stays shown after it is no longer listed" "$brain_scope_ts" \
  "  return listed.some((c) => c.clientId === requested) ? (clientScope(requested) ?? AGENCY_SCOPE) : AGENCY_SCOPE;" \
  "  return clientScope(requested) ?? AGENCY_SCOPE;" \
  "$e2e_tests" "9. the switcher lists exactly the user's active granted clients — and drops one the moment access ends"
prove_killed "page: a Brain answer for another client is accepted" "$client_api_ts" \
  "  if (body?.ok === true && body.client_id === clientId) {" "  if (body?.ok === true) {" \
  "$e2e_tests" "11. switching agency → A → B → agency: each read shows only that Brain; nothing from one is shown or saved as another"
# The #168 ↔ #169/#176 merge: each way the resolution can lose a protection.
prove_killed "merge kept #168's side: writeBrain writes the table directly (no AUTH-06 re-check)" "$brain_draft_ts" \
  '      const writeBrain = (w: { permission: "edit" | "activate"; profile: AnyObj; activate?: boolean }) =>
        authorizedBrainWrite(admin, {' \
  '      const writeBrain = async (w: { permission: "edit" | "activate"; profile: AnyObj; activate?: boolean }) => {
        const { data } = await admin.from("company_brain").upsert({ workspace_id, profile: w.profile, updated_at: new Date().toISOString(), ...(w.activate ? { onboarding_completed: true } : {}) }, { onConflict: "workspace_id" }).select("updated_at");
        return { outcome: "ok" as "ok" | "stale" | "not_member" | "forbidden_role" | "session_invalid", updated_at: (data?.[0] as { updated_at?: string } | undefined)?.updated_at ?? null };
      };
      const _authorizedUnused = (w: { permission: "edit" | "activate"; profile: AnyObj; activate?: boolean }) =>
        authorizedBrainWrite(admin, {' \
  "$e2e_tests" "12. activation goes through the AUTH-06 writer: an admin demoted in flight is refused and nothing activates; an owner's activation lands and ends onboarding progress"
prove_killed "merge dropped the in-transaction version check (every save an upsert)" "$brain_draft_ts" \
  '          mode: !versioned ? "upsert" : currentUpdatedAt !== null ? "cas" : "insert",' '          mode: "upsert",' \
  "$e2e_tests" "14. a versioned activation that loses the race at the write is stale: nothing written, nothing activated"
prove_killed "a versioned first save upserts over a Brain another device created" "$brain_draft_ts" \
  '          mode: !versioned ? "upsert" : currentUpdatedAt !== null ? "cas" : "insert",' '          mode: !versioned ? "upsert" : currentUpdatedAt !== null ? "cas" : "upsert",' \
  "$e2e_tests" "15. a versioned first save never overwrites a Brain another device created in flight"
# ── Backend's membership writers (held 20261025140000; #174 O3 A, §9.4) ──────
mw_sql="$root/supabase/migrations-held/20261025140000_workspace_member_writers.sql"
cp "$mw_sql" "$mw_sql.mutation-backup"; restore_list+=("$mw_sql")
mw_tests="$root/tests/db-contract/workspaceMemberWriters.contract.test.ts"
mw_policy="policy: who may remove and demote whom; each refusal leaves memberships and grants unchanged"
if take; then
set +e
DB_CONTRACT_OMIT_HELD=20261025140000_workspace_member_writers.sql "$root/tests/db-contract/run.sh" "$mw_tests" >"$out" 2>&1
status=$?
set -e
if [ $status -eq 0 ] || ! sed 's/\x1b\[[0-9;]*m//g' "$out" | grep -F "remove: the member is gone and every grant of theirs is revoked 'membership_removed' in the same transaction ... FAILED" >/dev/null; then
  echo "MUTANT SURVIVED or failed elsewhere: membership writer tests without the held migration" >&2; tail -30 "$out" >&2; exit 1
fi
echo "mutant killed: without the held membership writers nothing removes or demotes"
ran=$((ran + 1))
fi
prove_killed "membership writers: only the actor and target rows are locked, not every owner" "$mw_sql" \
  "and (m.user_id in (p_actor_id, p_target_user_id) or lower(btrim(coalesce(m.role, ''))) = 'owner')" \
  "and m.user_id in (p_actor_id, p_target_user_id)" \
  "$mw_tests" "race: the only two owners leave at once — one succeeds, the other is refused 'last_owner', one owner remains"
prove_killed "membership writers: the last owner can be removed" "$mw_sql" \
  "    return 'last_owner';" "    null;" "$mw_tests" "$mw_policy"
prove_killed "membership writers: an admin may remove an owner" "$mw_sql" \
  "  if v_target = 'owner' and p_actor_id <> p_target_user_id and v_actor <> 'owner' then return 'owner_protected'; end if;" "" \
  "$mw_tests" "$mw_policy"
prove_killed "membership writers: any member may remove others" "$mw_sql" \
  "  if p_actor_id <> p_target_user_id and v_actor not in ('owner', 'admin') then return 'forbidden_role'; end if;" "" \
  "$mw_tests" "$mw_policy"
prove_killed "membership writers: promotion is allowed" "$mw_sql" \
  "then return 'promotion_unsupported'; end if;" "then null; end if;" "$mw_tests" "$mw_policy"
prove_killed "membership writers: an expired or foreign session is accepted" "$mw_sql" \
  "                    and (s.not_after is null or s.not_after > clock_timestamp())) then
    return 'session_invalid';" \
  "                    and (s.not_after is null or s.not_after > clock_timestamp())) and false then
    return 'session_invalid';" \
  "$mw_tests" "$mw_policy"
prove_killed "membership writers: browsers may call them" "$mw_sql" \
  "revoke all on function public.workspace_member_remove(uuid, uuid, uuid, uuid) from public, anon, authenticated;" \
  "grant execute on function public.workspace_member_remove(uuid, uuid, uuid, uuid) to authenticated;" \
  "$mw_tests" "surface: browsers cannot call the writers; the service role cannot call the internal check"

# THE TALLY the workflow's gate adds up. A proof that did not run is not killed.
echo "MUTATION_TALLY shard=$shard shards=$shards total=$proof_n ran=$ran"
if [ -n "${MUTATION_TALLY_FILE:-}" ]; then
  printf '{"shard":%d,"shards":%d,"total":%d,"ran":%d}\n' "$shard" "$shards" "$proof_n" "$ran" > "$MUTATION_TALLY_FILE"
fi
