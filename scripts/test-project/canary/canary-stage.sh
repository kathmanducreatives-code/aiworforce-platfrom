#!/usr/bin/env bash
# THE FIRST REAL-APIFY CANARY, ONE STAGE AT A TIME.
#
# Run only by .github/workflows/discovery-test-worker.yml (input `canary_stage`),
# inside the `discovery-test` Environment and its required reviewer, after the
# workflow's own refusal step. Each stage is one approved operation:
#
#   verify     read-only, free: Apify account, plan, usage, actor availability
#              and current prices; project identity; migration state and
#              checksums; rollback; conflicting work; preflight; an OFFLINE
#              kickoff (reviewed proposal, no model call) validated end to end.
#   migrate    verify, then apply ONLY 20261029120000_smoke_read_cap_seven.sql
#              (read cap 5 -> 7) to the isolated project.               WRITE
#   prepare    verify, then the real kickoff compile (<= 2 Luna calls, ≈ $0.006)
#              and the PAID kickoff SQL, validated; saved, NOT executed.  PAID
#   launch     re-verify, then execute the prepared kickoff SQL (its sha256 is
#              the approval), verify the queue row and authorization; the
#              workflow's existing worker step runs next, in the same job,
#              inside the authorization's 300 s window.            WRITE + PAID
#   reconcile  read-only: the post-run checks, the reconciliation list, Apify's
#              own figures, and the reconciliation SQL to review (not run).
#
# FAST CANARY MODE — one approval for one bounded session (the stages above
# stay as the fallback):
#   session        verify (Apify account checked CONCURRENTLY with the database
#                  checks), the paid compile, validation K01–K20, then the
#                  approved contract (docs/launch/proposals/canary-session-
#                  contract.json, session-contract.ts S01–S17). Only a plan
#                  that satisfies the contract exactly — and only when the
#                  contract says auto_execute — reaches the kickoff, written
#                  under the contract's single-use queue id; the worker step
#                  runs next, inside the 300 s window.          PAID + WRITE
#   session-close  after the worker: the post-run checks, stop_discovery_smoke,
#                  reconciliation of every provider purchase against Apify's
#                  own terminal figure, and one report.                WRITE
#
# Every mutating stage needs its exact approval phrase (`CANARY_APPROVAL`).
# Any failed check stops the stage before its operation. Secrets are never
# printed: the database URL is only ever passed to psql, the tokens only to
# the scripts that send them to their own vendor.
set -euo pipefail

STAGE="${1:?usage: canary-stage.sh verify|migrate|prepare|launch|reconcile|session|session-close}"
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
cd "$ROOT"

# ── the one target ────────────────────────────────────────────────────────────
REF=tlvnfrxzjhsjgdofwehb
WS=40e2512f-09b6-433e-97fe-f9999a1f1897
WS_NAME=discovery-test
PRODUCTION_REFS=(ohsdatpvfdjdemstoiuj wqnigjhcwjxtmordrwno)
MIGRATION=supabase/migrations-held/20261029120000_smoke_read_cap_seven.sql
MIGRATION_SHA256=c3ba7d8bcc1056ce686007d2aaffc08c2f44e7d526c05500cc4da8bf919ea5b9
ROLLBACK=supabase/migrations-held/rollback/20261029120000_smoke_read_cap_seven.down.sql
ROLLBACK_SHA256=f0c88c2d61d8e4c09e4ea1bb685b7ef7246c8c79b8ac576f3e90159a3e57f508

AUDIT="${CANARY_AUDIT_DIR:?CANARY_AUDIT_DIR is required}"
mkdir -p "$AUDIT"
SUMMARY="$AUDIT/summary.txt"
: > "$SUMMARY"
EXPECTED_SHA="${EXPECTED_SHA:?EXPECTED_SHA is required}"
# Deno's network permission for each vendor. The workflow never overrides it;
# local tests point it at a stand-in server.
APIFY_NET="${CANARY_APIFY_NET:-api.apify.com}"
DENO="${DENO:-deno}"

failures=0
note() { printf '%s\n' "$*" | tee -a "$SUMMARY"; }
pass() { note "PASS  $1"; }
fail() {
  note "FAIL  $1"
  failures=$((failures + 1))
  # verify and session-close report every check (a closing session always
  # writes its report); every other stage stops at the first failure.
  [ "$STAGE" = "verify" ] || [ "$STAGE" = "session-close" ] || { note "STOPPED: $STAGE did not run its operation"; exit 1; }
}
stop() { note "STOPPED: $1"; exit 1; }

# READ-ONLY BY CONSTRUCTION: every stage but migrate and launch opens its
# database session with default_transaction_read_only, so no statement it runs
# can write, whatever the SQL says.
# A session's verification is read-only too: it becomes writable only at the
# one boundary where the validated, in-contract kickoff is executed.
case "$STAGE" in migrate|launch|session-close) DB_WRITES=1 ;; *) DB_WRITES=0 ;; esac
# Bounded waits: a connection or statement that hangs fails the stage.
export PGCONNECT_TIMEOUT=15
q() {
  # Never a psql call on an unchecked URL (and so never a local-socket fallback).
  [ "$DB_URL_OK" = "1" ] || stop "internal: database call before TEST_DB_URL was checked"
  if [ "$DB_WRITES" = "1" ]; then psql "$TEST_DB_URL" -X -v ON_ERROR_STOP=1 -Atq -c "set statement_timeout = '60s'" "$@"
  else psql "$TEST_DB_URL" -X -v ON_ERROR_STOP=1 -Atq -c "set statement_timeout = '60s'" -c "set default_transaction_read_only = on" "$@"; fi
}
CANARY_MISSION="Find one US company hiring Account Executives that raised funding within the last six months."

# ── checks ────────────────────────────────────────────────────────────────────
check_inputs() {
  [[ "$EXPECTED_SHA" =~ ^[0-9a-f]{40}$ ]] || stop "EXPECTED_SHA is not a commit sha"
}
has_db() {
  [ -n "${TEST_DB_URL:-}" ] || { fail "TEST_DB_URL is not set in the discovery-test Environment (the isolated project's administrator connection)"; return 1; }
  # The URI's structure and target, checked BEFORE psql sees it: psql takes any
  # value not starting with postgresql:// as a database name and silently falls
  # back to a local socket. Nothing here prints the URL or the password.
  if "$DENO" run --no-prompt --allow-env=TEST_DB_URL,CANARY_LOCAL_REHEARSAL scripts/test-project/canary/db-url-check.ts \
      > "$AUDIT/db-url.txt" 2>&1; then
    tee -a "$SUMMARY" < "$AUDIT/db-url.txt"
    pass "TEST_DB_URL: a postgresql:// URI for $REF (session pooler or direct), port 5432, database postgres"
    DB_URL_OK=1
    return 0
  fi
  tee -a "$SUMMARY" < "$AUDIT/db-url.txt"
  fail "TEST_DB_URL is malformed or not the isolated project: fix the FAIL lines above in GitHub → Settings → Environments → discovery-test"
  return 1
}
DB_URL_OK=0

check_identity() {
  # The URL is never printed; only whether it names the canary project.
  for p in "${PRODUCTION_REFS[@]}"; do
    [[ "$TEST_DB_URL" != *"$p"* ]] || stop "TEST_DB_URL names a production project"
  done
  [[ "$TEST_DB_URL" == *"$REF"* ]] || stop "TEST_DB_URL does not name the canary project $REF"
  local n
  n="$(q -c "select count(*) from public.workspaces where id = '$WS' and name = '$WS_NAME'")" || stop "cannot read the project"
  [ "$n" = "1" ] && pass "project: the connection names $REF and holds workspace $WS_NAME ($WS)" \
    || fail "project: workspace $WS_NAME ($WS) is not in this database"
}

check_permissions() {
  # What migrate and launch need: ownership of the admission table and function
  # (ALTER, CREATE OR REPLACE) and EXECUTE on authorize_discovery_smoke, which the
  # service role does not have. Read here; nothing is exercised.
  local r
  r="$(q -F '|' -c "select current_user,
      has_function_privilege(current_user, 'public.authorize_discovery_smoke(uuid,text,jsonb,jsonb,integer)', 'EXECUTE'),
      pg_has_role(current_user, (select relowner from pg_class where oid = 'public.discovery_smoke_authorizations'::regclass), 'USAGE'),
      pg_has_role(current_user, (select proowner from pg_proc where oid = 'public.authorize_discovery_smoke(uuid,text,jsonb,jsonb,integer)'::regprocedure), 'USAGE'),
      current_setting('transaction_read_only')")" || { fail "permissions: could not read"; return; }
  echo "$r" > "$AUDIT/permissions.txt"
  local user exec_ok tbl_owner fn_owner ro
  IFS='|' read -r user exec_ok tbl_owner fn_owner ro <<< "$r"
  [ "$exec_ok" = "t" ] && [ "$tbl_owner" = "t" ] && [ "$fn_owner" = "t" ] \
    && pass "permissions: role $user may execute authorize_discovery_smoke and owns the admission table and function (needed by migrate and launch)" \
    || fail "permissions: role $user lacks execute=$exec_ok table-owner=$tbl_owner function-owner=$fn_owner"
  [ "$DB_WRITES" = "1" ] || { [ "$ro" = "on" ] && pass "this $STAGE session is read-only (default_transaction_read_only)" || fail "this $STAGE session is not read-only"; }
}

# What the canary's OPERATIONS already spent, in µ$, across every attempt at
# this request in the canary workspace: each operation at the vendor's
# reconciled figure, or at its committed worst case until reconciled (model
# attempts stay at their committed reservation). Kickoff compiles are counted
# from the workflow's prepare runs instead (prior_prepares), so a compile that
# was never launched is still counted and a launched one is not counted twice.
spent_microusd() {
  q -c "with attempts as (
      select a.id as auth_id, q.id as queue_id from public.discovery_smoke_authorizations a
        join public.lead_mission_queue q on q.id = a.queue_id
       where q.workspace_id = '$WS' and q.request->>'instruction' = '$CANARY_MISSION')
    select (coalesce((select sum(coalesce(r.vendor_microusd, o.committed_microusd)) from public.discovery_smoke_operations o
               join attempts t on t.auth_id = o.authorization_id
               left join public.discovery_smoke_reconciliations r on r.authorization_id = o.authorization_id and r.operation_key = o.operation_key
              where o.kind in ('provider', 'model')), 0))::bigint"
}

# Every earlier `prepare` run of this workflow, any outcome — each may have
# spent its compile before anything reached the database. Read from the
# GitHub API (the run's display title carries its stage); fails closed.
prior_prepares() {
  if [ "${GITHUB_ACTIONS:-}" = "true" ]; then
    [ -n "${GITHUB_TOKEN:-}" ] || return 1
    local page=1 count=0 total r n
    while :; do
      r="$(curl -fsS --max-time 20 -H "Authorization: Bearer $GITHUB_TOKEN" -H "Accept: application/vnd.github+json" \
        "${GITHUB_API_URL:-https://api.github.com}/repos/$GITHUB_REPOSITORY/actions/workflows/discovery-test-worker.yml/runs?per_page=100&page=$page")" || return 1
      # prepare and session runs both compile; every one counts, whatever its outcome.
      n="$(jq --arg self "${GITHUB_RUN_ID:-}" '[.workflow_runs[] | select(((.display_title | contains(" — prepare @ ")) or (.display_title | contains(" — session @ "))) and ((.id | tostring) != $self))] | length' <<< "$r")" || return 1
      total="$(jq '.total_count' <<< "$r")" || return 1
      count=$((count + n))
      [ $((page * 100)) -lt "$total" ] || break
      page=$((page + 1))
    done
    echo "$count"
  else
    # Local rehearsal only: the count is given.
    [[ "${CANARY_PRIOR_PREPARES:-}" =~ ^[0-9]+$ ]] || return 1
    echo "$CANARY_PRIOR_PREPARES"
  fi
}

check_budget() {
  local spent
  spent="$(spent_microusd)" || { fail "budget: could not read what the canary spent"; return; }
  [[ "$spent" =~ ^[0-9]+$ ]] || { fail "budget: unreadable spend '$spent'"; return; }
  local prior
  prior="$(prior_prepares)" || { fail "budget: could not count earlier prepare runs (their compiles count against the \$3)"; return; }
  [[ "$prior" =~ ^[0-9]+$ ]] || { fail "budget: unreadable prepare count '$prior'"; return; }
  [ -f "$AUDIT/apify.json" ] || { fail "budget: no Apify account record to check against"; return; }
  if "$DENO" run --no-prompt --allow-read --allow-write="$AUDIT" scripts/test-project/canary/canary-budget.ts \
      --stage "$STAGE" --apify "$AUDIT/apify.json" --spent-microusd "$spent" --prior-prepares "$prior" --json "$AUDIT/budget.json" > "$AUDIT/budget.txt" 2>&1; then
    cat "$AUDIT/budget.txt" | tee -a "$SUMMARY" > /dev/null; cat "$AUDIT/budget.txt"
    pass "budget: the \$3 canary ceiling and the \$0.25 per-attempt authorization hold for the next paid stage (software-enforced; see B6)"
  else
    cat "$AUDIT/budget.txt" | tee -a "$SUMMARY" > /dev/null; cat "$AUDIT/budget.txt"
    fail "budget: $(grep '^FAIL' "$AUDIT/budget.txt" | tr '\n' ';')"
  fi
}

check_preflight() {
  # P00 re-checks the identity from psql's own connection variables.
  q -F '|' -v workspace_id="$WS" -v project_ref="$REF" -f scripts/test-project/real-gpt/preflight.sql > "$AUDIT/preflight.txt" \
    || { fail "preflight: could not run"; return; }
  local bad
  bad="$(awk -F'|' '$5 == "FAIL" { print $1 " " $2 " (" $4 ")" }' "$AUDIT/preflight.txt")"
  [ -z "$bad" ] && pass "preflight: every check PASS (P00 identity included)" || fail "preflight: $(echo "$bad" | tr '\n' ';')"
}

# The read cap the project enforces now: 5, 7, or anything else (stop).
read_cap() {
  local def fn dflt
  def="$(q -c "select pg_get_constraintdef(oid) from pg_constraint where conname = 'discovery_smoke_authorizations_provider_polls_check'")"
  fn="$(q -c "select prosrc from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'authorize_discovery_smoke'")"
  dflt="$(q -c "select column_default from information_schema.columns where table_schema = 'public' and table_name = 'discovery_smoke_authorizations' and column_name = 'provider_polls'")"
  if [[ "$def" == *"<= 5)"* && "$fn" == *"sum to at most 5"* && "$dflt" == "5" ]]; then echo 5
  elif [[ "$def" == *"<= 7)"* && "$fn" == *"sum to at most 7"* && "$dflt" == "7" ]]; then echo 7
  else echo "unexpected"; fi
}

check_migration_files() {
  local m r
  m="$(sha256sum "$MIGRATION" | cut -d' ' -f1)"; r="$(sha256sum "$ROLLBACK" | cut -d' ' -f1)"
  [ "$m" = "$MIGRATION_SHA256" ] && pass "migration file is the reviewed one (sha256 $m)" || fail "migration checksum $m is not the reviewed $MIGRATION_SHA256"
  [ "$r" = "$ROLLBACK_SHA256" ] && pass "rollback file is the reviewed one (sha256 $r)" || fail "rollback checksum $r is not the reviewed $ROLLBACK_SHA256"
  grep -q "between 0 and 5" "$ROLLBACK" && grep -q "Refuses (the constraint fails) while any authorization holds more than 5 reads" "$ROLLBACK" \
    && pass "rollback restores cap 5 and refuses while an authorization holds more than 5 reads" || fail "rollback procedure is not the reviewed one"
  local held
  held="$(q -c "select (to_regclass('public.discovery_smoke_authorizations') is not null and to_regclass('public.discovery_smoke_operations') is not null
    and to_regclass('public.discovery_smoke_reconciliations') is not null)::int")"
  [ "$held" = "1" ] && pass "admission schema present (authorizations, operations, reconciliations)" || fail "admission schema missing"
}

check_conflicts() {
  local r
  r="$(q -F '|' -c "select
      (select count(*) from public.lead_mission_queue where status in ('queued', 'running', 'resumable')),
      (select count(*) from public.discovery_smoke_authorizations where status = 'active' and deadline_at > clock_timestamp()),
      (select count(*) from public.discovery_smoke_operations o where o.kind = 'provider' and not exists (
         select 1 from public.discovery_smoke_reconciliations x where x.authorization_id = o.authorization_id and x.operation_key = o.operation_key)),
      (select coalesce(sum(reserved_credits), 0) from public.workspace_credit_balances where workspace_id = '$WS')")"
  echo "$r" > "$AUDIT/conflicts.txt"
  [ "$r" = "0|0|0|0" ] && pass "no conflicting work: no claimable mission, live authorization, unreconciled purchase or reserved credit" \
    || fail "conflicting work (claimable|live authorizations|unreconciled purchases|reserved credits): $r"
}

check_apify() { start_apify && finish_apify; }
# The Apify account check is read-only and independent of the database: a
# session starts it first and collects it after the database checks.
APIFY_PID=""
start_apify() {
  local args=(--json "$AUDIT/apify.json" --mask-identity)
  [ -n "${APIFY_USERNAME:-}" ] && args+=(--expect-username "$APIFY_USERNAME")
  [ -n "${APIFY_API_TOKEN:-}" ] || { fail "apify: TEST_APIFY_API_TOKEN is not set in the discovery-test Environment"; return 1; }
  "$DENO" run --no-prompt --allow-net="$APIFY_NET" --allow-env=APIFY_API_TOKEN,APIFY_API_BASE \
    --allow-read=docs/launch/proposals --allow-write="$AUDIT" scripts/test-project/apify-account-check.ts "${args[@]}" \
    > "$AUDIT/apify.txt" 2>&1 &
  APIFY_PID=$!
}
finish_apify() {
  [ -n "$APIFY_PID" ] || return 0
  local pid="$APIFY_PID"; APIFY_PID=""
  if wait "$pid"; then
    cat "$AUDIT/apify.txt"
    pass "apify: account, limits, actor availability and current prices fit the approved budget"
  else
    # REVIEW (e.g. no expected username yet) is not PASS: it blocks every stage but verify.
    cat "$AUDIT/apify.txt"
    fail "apify: $(grep -E '^(FAIL|REVIEW)' "$AUDIT/apify.txt" | tr '\n' ';' || echo 'the check did not complete')"
  fi
}

owner_user() {
  local u
  u="$(q -c "select user_id from public.workspace_members where workspace_id = '$WS' and role = 'owner'")"
  [[ "$u" =~ ^[0-9a-f-]{36}$ ]] || stop "workspace $WS_NAME must have exactly one owner (the kickoff's user)"
  echo "$u"
}

# The kickoff, generated by the reviewed preparer: offline (reviewed proposal,
# no model call) for verify, the real compile for prepare.
generate_kickoff() {
  local mode="$1" out="$2" approver="$3" observed user
  user="$(owner_user)" || stop "workspace $WS_NAME must have exactly one owner (the kickoff's user)"
  observed="$(jq -r '.observed_at' "$AUDIT/apify.json" 2>/dev/null || true)"
  [[ "$observed" =~ ^20[0-9]{2}-.*Z$ ]] || observed="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  local src=(--proposal docs/launch/proposals/canary-funding-reviewed-mission-proposal.json)
  local net=()
  if [ -n "${CANARY_OFFLINE_PROPOSAL:-}" ]; then
    src=(--proposal "$CANARY_OFFLINE_PROPOSAL")   # local rehearsal only: no model call
  elif [ "$mode" = "paid" ]; then
    src=(); net=(--allow-net=api.openai.com)
    [ -n "${OPENAI_API_KEY:-}" ] || stop "TEST_OPENAI_API_KEY is not set for the kickoff compile"
  fi
  mkdir -p "$out"
  local env=(env)
  [ "$mode" = "paid" ] || env=(env -u OPENAI_API_KEY)
  "${env[@]}" "$DENO" run --no-prompt --allow-env --allow-read --allow-write="$out" "${net[@]}" \
    scripts/test-project/real-gpt/prepare-real-gpt-kickoff.ts --scenario canary_funding \
    --project-ref "$REF" --workspace "$WS" --user "$user" \
    --pricing-version "canary-$(date -u +%Y%m%d)" --jobs-max 4000 --details-max 4050 --atomus-max 10550 \
    --observed-at "$observed" --price-source "apify-account-check.ts on the discovery-test account at $observed" \
    --approved-by "$approver" --authorize-paid "$approver" --acknowledge-defaults \
    --expected-sha "$EXPECTED_SHA" --out "$out" "${src[@]}" ${SESSION_QUEUE_ID:+--queue "$SESSION_QUEUE_ID" --plan "$SESSION_PLAN_ID"} \
    > "$out/console.txt" 2>&1 \
    || { cat "$out/console.txt"; fail "kickoff: the preparer refused (interpretation, prices or checkout)"; return 1; }
  grep -E '^(PASS|FAIL|ASSUMED|compile)' "$out/console.txt" | tee -a "$SUMMARY"
}

validate_kickoff() {
  local dir="$1"
  if "$DENO" run --no-prompt --allow-read="$dir" --allow-write="$dir" scripts/test-project/canary/validate-kickoff.ts \
      --dir "$dir" --expected-sha "$EXPECTED_SHA" --json "$dir/validation.json" > "$dir/validation.txt" 2>&1; then
    pass "kickoff valid: K01–K19 (request, interpretation, assumed window, commit, one start each, no Pvalyou, budget, SQL shape)"
  else
    cat "$dir/validation.txt"; fail "kickoff invalid: $(grep '^FAIL' "$dir/validation.txt" | tr '\n' ';')"
  fi
}

require_approval() {
  [ "${CANARY_APPROVAL:-}" = "$1" ] || stop "approval phrase does not match; this stage needs exactly: $1"
  pass "approval phrase matches"
}

verify_queue() {
  local qid="$1" r
  r="$(q -F '|' -c "select q.status, q.workspace_id, a.status,
      (a.actor_limits = '{\"apify:harvestapi~linkedin-job-search\": 1, \"apify:harvestapi~linkedin-company\": 1, \"apify:atomus~linkedin-company-scraper\": 1}'::jsonb)::text,
      a.provider_polls,
      extract(epoch from (a.deadline_at - q.created_at))::int, (a.deadline_at > clock_timestamp())::text
    from public.lead_mission_queue q join public.discovery_smoke_authorizations a on a.queue_id = q.id where q.id = '$qid'")"
  echo "$r" > "$AUDIT/queue.txt"
  local expected="queued|$WS|active|true|7|300|true"
  [ "$r" = "$expected" ] && pass "queue: $qid queued in $WS_NAME; authorization active, one start each, 7 reads, 300 s window" \
    || stop "queue verification failed: $r"
}

# ── stages ────────────────────────────────────────────────────────────────────
note "canary stage: $STAGE at $EXPECTED_SHA on $REF ($(date -u +%Y-%m-%dT%H:%M:%SZ))"
check_inputs

case "$STAGE" in
  verify)
    check_apify
    if ! has_db; then note "INFO  database checks skipped: TEST_DB_URL missing or unusable"; [ "$failures" -eq 0 ] || stop "$failures check(s) failed"; fi
    check_identity
    check_migration_files
    cap="$(read_cap)"; note "INFO  read cap now: $cap (the canary needs 7; migrate applies it)"
    [ "$cap" = "5" ] || [ "$cap" = "7" ] || fail "read cap is in an unexpected state"
    check_conflicts
    check_permissions
    check_budget
    check_preflight
    if generate_kickoff offline "$AUDIT/kickoff-offline" "verify dry run (not executed)"; then
      validate_kickoff "$AUDIT/kickoff-offline"
    fi
    ;;

  migrate)
    require_approval "apply 20261029120000_smoke_read_cap_seven to $REF"
    has_db
    check_identity
    check_migration_files
    cap="$(read_cap)"
    [ "$cap" = "7" ] && stop "already applied: the read cap is 7; nothing to do"
    [ "$cap" = "5" ] || stop "the read cap is in an unexpected state; nothing applied"
    pass "read cap is 5: the migration has not been applied"
    check_conflicts
    check_permissions
    note "APPLYING $MIGRATION to $REF"
    q -f "$MIGRATION" > "$AUDIT/migration.txt"
    [ "$(read_cap)" = "7" ] && pass "applied: constraint, default and authorize_discovery_smoke all say 7" || stop "post-check failed after the migration"
    check_preflight
    ;;

  prepare)
    require_approval "compile canary kickoff at $EXPECTED_SHA"
    has_db
    [ -n "${CANARY_APPROVER:-}" ] || stop "CANARY_APPROVER (who approved the paid canary) is required"
    [ -n "${APIFY_USERNAME:-}" ] || stop "apify_username is required: the canary account is confirmed by name, never assumed"
    check_apify
    check_identity
    check_migration_files
    [ "$(read_cap)" = "7" ] || stop "the read cap is not 7: run migrate first"
    check_conflicts
    check_permissions
    check_budget
    check_preflight
    note "COMPILING the kickoff mission (paid: <= 2 Luna calls)"
    generate_kickoff paid "$AUDIT/kickoff" "$CANARY_APPROVER" || stop "kickoff not generated"
    validate_kickoff "$AUDIT/kickoff"
    sha="$(sha256sum "$AUDIT/kickoff/kickoff.sql" | cut -d' ' -f1)"
    echo "$sha" > "$AUDIT/kickoff.sha256"
    note "KICKOFF READY (not executed). kickoff.sql sha256: $sha"
    note "Launch approval phrase: launch canary $sha on $REF with a software-enforced \$3 budget"
    ;;

  launch)
    sha="${KICKOFF_SHA256:?KICKOFF_SHA256 is required}"
    # The approval names the limitation: the $3 is software-enforced, not Apify's account limit.
    require_approval "launch canary $sha on $REF with a software-enforced \$3 budget"
    dir="${KICKOFF_DIR:?KICKOFF_DIR is required}"
    [ "$(sha256sum "$dir/kickoff.sql" | cut -d' ' -f1)" = "$sha" ] && pass "kickoff.sql is the approved file (sha256 $sha)" \
      || stop "kickoff.sql is not the approved file"
    validate_kickoff "$dir"
    [ -n "${APIFY_USERNAME:-}" ] || stop "apify_username is required"
    has_db
    check_apify
    check_identity
    [ "$(read_cap)" = "7" ] || stop "the read cap is not 7"
    check_conflicts
    check_permissions
    check_budget
    check_preflight
    qid="$(jq -r '.queue_id' "$dir/validation.json")"
    note "EXECUTING the approved kickoff SQL: queue $qid"
    q -f "$dir/kickoff.sql" > "$AUDIT/kickoff-exec.txt"
    verify_queue "$qid"
    echo "$qid" > "$AUDIT/queue_id"
    note "READY FOR THE WORKER: the authorization's 300 s window is running"
    ;;

  reconcile)
    has_db
    qid="${CANARY_QUEUE_ID:-}"
    [ -n "$qid" ] || qid="$(q -c "select q.id from public.lead_mission_queue q join public.discovery_smoke_authorizations a on a.queue_id = q.id
      where q.workspace_id = '$WS' order by q.created_at desc limit 1")"
    [[ "$qid" =~ ^[0-9a-f-]{36}$ ]] || stop "no canary queue row found"
    check_identity
    note "INFO  reconciling queue $qid"
    # Only the C01–C10 table: company details stay in the database, off the public artifact.
    sed '/^-- The funding record each qualified company rests on/,$d' scripts/test-project/canary-funding-verify.sql > "$AUDIT/verify-checks.sql"
    q -F '|' -v workspace_id="$WS" -v queue_id="$qid" -f "$AUDIT/verify-checks.sql" | tee "$AUDIT/canary-verify.txt"
    if awk -F'|' '$5 == "FAIL"' "$AUDIT/canary-verify.txt" | grep -q .; then fail "post-run checks: a C-check FAILED"; else pass "post-run checks C01–C10"; fi
    q -F '|' -v queue_id="$qid" -f scripts/test-project/smoke-reconciliation.sql > "$AUDIT/reconciliation-list.txt"
    runs="$(q -c "select string_agg(o.provider_run_id, ',') from public.discovery_smoke_operations o
      join public.discovery_smoke_authorizations a on a.id = o.authorization_id where a.queue_id = '$qid' and o.kind = 'provider' and o.provider_run_id is not null")"
    if [ -n "$runs" ] && [ -n "${APIFY_API_TOKEN:-}" ]; then
      "$DENO" run --no-prompt --allow-net="$APIFY_NET" --allow-env=APIFY_API_TOKEN,APIFY_API_BASE --allow-read=docs/launch/proposals \
        scripts/test-project/apify-account-check.ts --runs "$runs" > "$AUDIT/apify-runs.txt" 2>&1 \
        && pass "apify: every run charged within its cap and the $0.20 total" || fail "apify runs: $(grep FAIL "$AUDIT/apify-runs.txt" | tr '\n' ';')"
      cat "$AUDIT/apify-runs.txt"
    else
      note "INFO  no provider run to look up"
    fi
    # The administrator's reconciliation, generated for review — NOT executed.
    q -c "select format('select public.reconcile_discovery_smoke_operation(%L, %L, <vendor micro-USD from apify-runs.txt for run %s>, %L, ''<status>'');',
        a.queue_id, o.operation_key, coalesce(o.provider_run_id, 'NO_RUN'), 'https://console.apify.com/actors/runs/' || coalesce(o.provider_run_id, ''))
      from public.discovery_smoke_operations o join public.discovery_smoke_authorizations a on a.id = o.authorization_id
      where a.queue_id = '$qid' and o.kind = 'provider' order by o.admitted_at" > "$AUDIT/reconcile-to-review.sql"
    { echo "-- REVIEW, fill the vendor figures, then run as administrator AFTER:"; echo "select public.stop_discovery_smoke('$qid', 'canary finished');"
      cat "$AUDIT/reconcile-to-review.sql"; } > "$AUDIT/reconcile-to-review.sql.tmp" && mv "$AUDIT/reconcile-to-review.sql.tmp" "$AUDIT/reconcile-to-review.sql"
    pass "reconciliation SQL generated for review (not executed)"
    ;;

  session)
    CONTRACT=docs/launch/proposals/canary-session-contract.json
    # Local rehearsal only (never set by the workflow): another contract file. Its
    # own hash is still what the approval phrase must name, and A01–A09 still apply.
    [ "${CANARY_LOCAL_REHEARSAL:-}" = "1" ] && [ -n "${CANARY_SESSION_CONTRACT:-}" ] && CONTRACT="$CANARY_SESSION_CONTRACT"
    csha="$(sha256sum "$CONTRACT" | cut -d' ' -f1)"
    # One approval: this exact contract, at this exact commit.
    require_approval "run canary session $csha at $EXPECTED_SHA"
    [ -n "${CANARY_APPROVER:-}" ] || stop "CANARY_APPROVER (who approved the session) is required"
    [ -n "${APIFY_USERNAME:-}" ] || stop "apify_username is required: the canary account is confirmed by name, never assumed"
    "$DENO" run --no-prompt --allow-read scripts/test-project/canary/session-contract.ts contract "$CONTRACT" > "$AUDIT/contract.txt" 2>&1 \
      && { tee -a "$SUMMARY" < "$AUDIT/contract.txt" > /dev/null; pass "contract $csha: well-formed, unexpired, never wider than the existing caps"; } \
      || { cat "$AUDIT/contract.txt"; stop "the contract is invalid or expired: $(grep '^FAIL' "$AUDIT/contract.txt" | tr '\n' ';')"; }
    read -r SESSION_QUEUE_ID SESSION_PLAN_ID < <("$DENO" run --no-prompt scripts/test-project/canary/session-contract.ts ids "$csha")
    [[ "${SESSION_QUEUE_ID:-}" =~ ^[0-9a-f-]{36}$ && "${SESSION_PLAN_ID:-}" =~ ^[0-9a-f-]{36}$ ]] || stop "could not derive the contract's single-use ids"
    export SESSION_QUEUE_ID SESSION_PLAN_ID
    note "INFO  single-use ids from the contract: queue $SESSION_QUEUE_ID, plan $SESSION_PLAN_ID"
    # Read-only checks, the Apify account concurrently with the database.
    start_apify || true
    has_db || { finish_apify; stop "TEST_DB_URL unusable"; }
    check_identity
    check_migration_files
    [ "$(read_cap)" = "7" ] || stop "the read cap is not 7"
    [ "$(q -c "select count(*) from public.lead_mission_queue where id = '$SESSION_QUEUE_ID'")" = "0" ] \
      && pass "the contract is unused: no queue row $SESSION_QUEUE_ID" \
      || stop "this contract has already been used (queue $SESSION_QUEUE_ID exists); another session needs a new, separately approved contract"
    check_conflicts
    check_permissions
    check_preflight
    finish_apify
    check_budget
    note "COMPILING the mission (paid: <= 2 Luna calls)"
    generate_kickoff paid "$AUDIT/kickoff" "$CANARY_APPROVER (session contract $csha)" || stop "kickoff not generated"
    validate_kickoff "$AUDIT/kickoff"
    if "$DENO" run --no-prompt --allow-read --allow-write="$AUDIT" scripts/test-project/canary/session-contract.ts kickoff \
        "$CONTRACT" "$AUDIT/kickoff" "$csha" --json "$AUDIT/kickoff/contract-check.json" > "$AUDIT/kickoff/contract-check.txt" 2>&1; then
      tee -a "$SUMMARY" < "$AUDIT/kickoff/contract-check.txt" > /dev/null
      pass "the generated plan satisfies the contract exactly: S01–S17"
    else
      cat "$AUDIT/kickoff/contract-check.txt"
      stop "the generated plan is OUTSIDE the contract ($(grep '^FAIL' "$AUDIT/kickoff/contract-check.txt" | tr '\n' ';')) — nothing executed; it needs a separate approval"
    fi
    sha="$(sha256sum "$AUDIT/kickoff/kickoff.sql" | cut -d' ' -f1)"
    echo "$sha" > "$AUDIT/kickoff.sha256"
    if [ "$(jq -r '.auto_execute' "$CONTRACT")" != "true" ]; then
      note "KICKOFF READY (not executed: the contract does not authorize automatic execution). sha256 $sha"
    else
      # The write boundary: re-check the one fact that can change in the last
      # seconds, then switch this session to writable for the kickoff alone.
      check_conflicts
      DB_WRITES=1
      note "EXECUTING the in-contract kickoff: queue $SESSION_QUEUE_ID (kickoff.sql sha256 $sha)"
      q -f "$AUDIT/kickoff/kickoff.sql" > "$AUDIT/kickoff-exec.txt" || stop "the kickoff failed; the transaction rolled back"
      DB_WRITES=0
      verify_queue "$SESSION_QUEUE_ID"
      echo "$SESSION_QUEUE_ID" > "$AUDIT/queue_id"
      [ -n "${GITHUB_OUTPUT:-}" ] && echo "kickoff=executed" >> "$GITHUB_OUTPUT"
      note "READY FOR THE WORKER: the authorization's 300 s window is running"
    fi
    ;;

  session-close)
    has_db || stop "TEST_DB_URL unusable"
    qid="${CANARY_QUEUE_ID:?CANARY_QUEUE_ID is required}"
    [[ "$qid" =~ ^[0-9a-f-]{36}$ ]] || stop "unreadable queue id"
    check_identity
    note "INFO  closing session queue $qid"
    sed '/^-- The funding record each qualified company rests on/,$d' scripts/test-project/canary-funding-verify.sql > "$AUDIT/verify-checks.sql"
    q -F '|' -v workspace_id="$WS" -v queue_id="$qid" -f "$AUDIT/verify-checks.sql" > "$AUDIT/canary-verify.txt"
    cat "$AUDIT/canary-verify.txt"
    if awk -F'|' '$1 != "C10" && $5 == "FAIL"' "$AUDIT/canary-verify.txt" | grep -q .; then fail "post-run checks: a C-check FAILED"; else pass "post-run checks C01–C09"; fi
    # The authorization ends here: nothing more can be admitted under it.
    q -c "select public.stop_discovery_smoke('$qid', 'canary session closed') where exists (
      select 1 from public.discovery_smoke_authorizations where queue_id = '$qid' and status = 'active')" > /dev/null
    pass "authorization stopped: nothing more can be bought under it"
    runs="$(q -c "select coalesce(string_agg(o.provider_run_id, ','), '') from public.discovery_smoke_operations o
      join public.discovery_smoke_authorizations a on a.id = o.authorization_id where a.queue_id = '$qid' and o.kind = 'provider' and o.provider_run_id is not null")"
    if [ -n "$runs" ]; then
      "$DENO" run --no-prompt --allow-net="$APIFY_NET" --allow-env=APIFY_API_TOKEN,APIFY_API_BASE --allow-read=docs/launch/proposals \
        --allow-write="$AUDIT" scripts/test-project/apify-account-check.ts --runs "$runs" --json "$AUDIT/receipts.json" > "$AUDIT/apify-runs.txt" 2>&1 || true
      cat "$AUDIT/apify-runs.txt"
      # Reconcile ONLY what Apify itself reports as terminal with a figure; an
      # uncertain purchase stays open and blocks every later paid operation.
      jq -r '.receipts[] | select(.status != null and (.status | IN("SUCCEEDED","FAILED","ABORTED","TIMED-OUT")) and .usage_total_usd != null)
        | "\(.run_id) \(.status) \(.usage_total_usd * 1000000 | ceil)"' "$AUDIT/receipts.json" > "$AUDIT/reconcile.txt" 2>/dev/null || : > "$AUDIT/reconcile.txt"
      while read -r run status micro; do
        q -c "select public.reconcile_discovery_smoke_operation('$qid', o.operation_key, $micro, 'https://console.apify.com/actors/runs/$run', '$status')
          from public.discovery_smoke_operations o join public.discovery_smoke_authorizations a on a.id = o.authorization_id
          where a.queue_id = '$qid' and o.kind = 'provider' and o.provider_run_id = '$run'" > /dev/null < /dev/null \
          && note "RECONCILED run $run: $status, \$$(awk "BEGIN{printf \"%.6f\", $micro/1e6}") (Apify's own figure)"
      done < "$AUDIT/reconcile.txt"
    fi
    open="$(q -c "select count(*) from public.discovery_smoke_operations o join public.discovery_smoke_authorizations a on a.id = o.authorization_id
      where a.queue_id = '$qid' and o.kind = 'provider' and not exists (select 1 from public.discovery_smoke_reconciliations r
        where r.authorization_id = o.authorization_id and r.operation_key = o.operation_key)")"
    [ "$open" = "0" ] && pass "every provider purchase reconciled against Apify's receipt" \
      || fail "$open provider purchase(s) UNCERTAIN: not reconciled automatically; every later paid operation is blocked until an administrator reconciles them"
    q -F '|' -v queue_id="$qid" -f scripts/test-project/canary/session-summary.sql > "$AUDIT/session-summary.txt"
    cat "$AUDIT/session-summary.txt"
    ;;

  *) stop "unknown stage $STAGE" ;;
esac

[ "$failures" -eq 0 ] || stop "$failures check(s) failed"
note "DONE: $STAGE"
