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
# Every mutating stage needs its exact approval phrase (`CANARY_APPROVAL`).
# Any failed check stops the stage before its operation. Secrets are never
# printed: the database URL is only ever passed to psql, the tokens only to
# the scripts that send them to their own vendor.
set -euo pipefail

STAGE="${1:?usage: canary-stage.sh verify|migrate|prepare|launch|reconcile}"
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
  # verify reports every check; every other stage stops at the first failure.
  [ "$STAGE" = "verify" ] || { note "STOPPED: $STAGE did not run its operation"; exit 1; }
}
stop() { note "STOPPED: $1"; exit 1; }

q() { psql "$TEST_DB_URL" -X -v ON_ERROR_STOP=1 -At "$@"; }

# ── checks ────────────────────────────────────────────────────────────────────
check_inputs() {
  [[ "$EXPECTED_SHA" =~ ^[0-9a-f]{40}$ ]] || stop "EXPECTED_SHA is not a commit sha"
}
has_db() {
  [ -n "${TEST_DB_URL:-}" ] && return 0
  fail "TEST_DB_URL is not set in the discovery-test Environment (the isolated project's administrator connection)"
  return 1
}

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

check_apify() {
  local args=(--json "$AUDIT/apify.json" --mask-identity)
  [ -n "${APIFY_USERNAME:-}" ] && args+=(--expect-username "$APIFY_USERNAME")
  [ -n "${APIFY_API_TOKEN:-}" ] || { fail "apify: TEST_APIFY_API_TOKEN is not set in the discovery-test Environment"; return; }
  if "$DENO" run --no-prompt --allow-net="$APIFY_NET" --allow-env=APIFY_API_TOKEN,APIFY_API_BASE \
      --allow-read=docs/launch/proposals --allow-write="$AUDIT" scripts/test-project/apify-account-check.ts "${args[@]}" \
      > "$AUDIT/apify.txt" 2>&1; then
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
    --expected-sha "$EXPECTED_SHA" --out "$out" "${src[@]}" > "$out/console.txt" 2>&1 \
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
    if ! has_db; then note "INFO  database checks skipped: no TEST_DB_URL"; [ "$failures" -eq 0 ] || stop "$failures check(s) failed"; fi
    check_identity
    check_migration_files
    cap="$(read_cap)"; note "INFO  read cap now: $cap (the canary needs 7; migrate applies it)"
    [ "$cap" = "5" ] || [ "$cap" = "7" ] || fail "read cap is in an unexpected state"
    check_conflicts
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
    check_preflight
    note "COMPILING the kickoff mission (paid: <= 2 Luna calls)"
    generate_kickoff paid "$AUDIT/kickoff" "$CANARY_APPROVER" || stop "kickoff not generated"
    validate_kickoff "$AUDIT/kickoff"
    sha="$(sha256sum "$AUDIT/kickoff/kickoff.sql" | cut -d' ' -f1)"
    echo "$sha" > "$AUDIT/kickoff.sha256"
    note "KICKOFF READY (not executed). kickoff.sql sha256: $sha"
    note "Launch approval phrase: launch canary $sha on $REF"
    ;;

  launch)
    sha="${KICKOFF_SHA256:?KICKOFF_SHA256 is required}"
    require_approval "launch canary $sha on $REF"
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

  *) stop "unknown stage $STAGE" ;;
esac

[ "$failures" -eq 0 ] || stop "$failures check(s) failed"
note "DONE: $STAGE"
