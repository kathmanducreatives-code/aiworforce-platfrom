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
restore_list=()
for f in "$adm_sql" "$gate_ts" "$tools_ts" "$credit_ts" "$runner_ts" "$clock_ts" "$plan_ts" "$planner_ts"; do
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
# The plan parent side (held 20261025150000, Codex PLAN-PARENT).
pp_sql="$root/supabase/migrations-held/20261025150000_task_plans_parent_identity.sql"
pp_tests="$root/tests/db-contract/taskPlanParentIdentity.contract.test.ts"
cp "$pp_sql" "$pp_sql.mutation-backup"; restore_list+=("$pp_sql")
if take; then
set +e
DB_CONTRACT_OMIT_HELD=20261025150000_task_plans_parent_identity.sql "$root/tests/db-contract/run.sh" "$pp_tests" >"$out" 2>&1
status=$?
set -e
if [ $status -eq 0 ] || ! sed 's/\x1b\[[0-9;]*m//g' "$out" | grep -F "parent: no application writer moves a plan to another workspace or changes its id ... FAILED" >/dev/null; then
  echo "MUTANT SURVIVED or failed elsewhere: plan parent tests without the held migration" >&2; tail -30 "$out" >&2; exit 1
fi
echo "mutant killed: without the parent guard a referenced plan moves to another workspace"
ran=$((ran + 1))
fi
prove_killed "plan parent: the workspace may change" "$pp_sql" \
  "    if new.id is distinct from old.id or new.workspace_id is distinct from old.workspace_id then" \
  "    if new.id is distinct from old.id then" \
  "$pp_tests" "parent: no application writer moves a plan to another workspace or changes its id"
prove_killed "plan parent: a deleted plan's id may be re-created elsewhere" "$pp_sql" \
  "              where t.plan_id = new.id and t.workspace_id is distinct from new.workspace_id) then" \
  "              where false) then" \
  "$pp_tests" "parent: a deleted plan's id cannot be re-created in another workspace while tasks still point at it"
# The live-principal effect fence (effectFence.ts, Codex EXEC-EFFECT).
fence_ts="$root/supabase/functions/_shared/effectFence.ts"
ra_ts="$root/supabase/functions/run-agent/index.ts"
for f in "$fence_ts" "$ra_ts"; do cp "$f" "$f.mutation-backup"; restore_list+=("$f"); done
ef_tests="$root/tests/db-contract/effectFence.contract.test.ts"
efm_tests="$root/tests/db-contract/effectFenceMission.contract.test.ts"
ef_name="fence: membership removed after the task INSERT — no model call starts, and the task still ends terminal"
efm_name="fence mission: removed once the job search is bought — it settles, nothing new starts"
prove_killed "effect fence: the live membership check is skipped" "$fence_ts" \
  "    const verdict = await liveEffectAuthorization(principal);" "    const verdict: EffectVerdict = \"ok\";" "$ef_tests" "$ef_name"
prove_killed "effect fence: run-agent never binds its principal" "$ra_ts" \
  "    bindEffectPrincipal({" "    void ({" "$ef_tests" "$ef_name"
prove_killed "effect fence: settlement reads of an admitted run are refused too" "$fence_ts" \
  "    if (c.kind === \"free\" || c.kind === \"poll\" || stopsAdmitted(method, url)) return base(input, init);" \
  "    if (c.kind === \"free\") return base(input, init);" "$efm_tests" "$efm_name"
prove_killed "effect fence: a refused provider start reads as a definite non-start (early refund)" "$fence_ts" \
  "    return refusal(verdict, { host: url.hostname, path: url.pathname }, c.kind === \"provider\");" \
  "    return refusal(verdict, { host: url.hostname, path: url.pathname }, false);" "$efm_tests" "$efm_name"
prove_killed "effect fence: the transport's marks are hidden by the wrapper" "$fence_ts" \
  "    if (d) Object.defineProperty(fenced, k, d);" "    void d;" \
  "$efm_tests" "fence mission control: the same mission with the fence and no removal qualifies the lead"
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

# THE TALLY the workflow's gate adds up. A proof that did not run is not killed.
echo "MUTATION_TALLY shard=$shard shards=$shards total=$proof_n ran=$ran"
if [ -n "${MUTATION_TALLY_FILE:-}" ]; then
  printf '{"shard":%d,"shards":%d,"total":%d,"ran":%d}\n' "$shard" "$shards" "$proof_n" "$ran" > "$MUTATION_TALLY_FILE"
fi
