#!/usr/bin/env bash
# BUILD THE DEDICATED COMPANY BRAIN TEST PROJECT (a NEW, EMPTY Supabase project).
#
# PROPOSAL TOOLING — needs the owner's explicit approval to run. Writes ONLY to
# the database named by BRAIN_TEST_DB_URL, after every check passes.
#
#   BRAIN_TEST_PROJECT_REF=<ref> BRAIN_TEST_DB_URL='postgresql://…<ref>…' \
#     scripts/test-project/brain-test/build-brain-test.sh --confirm <ref>
#
# Mirrors PRODUCTION's schema (docs/plans/company-brain/ENVIRONMENT_INVENTORY.md)
# plus the release's held migrations, in the order the contract lane proves:
#   1  scripts/test-project/build-test-schema.sh (held baseline, every shipped
#      migration incl. the Brain write-hardening, the held Lead V2 chain; cron
#      jobs that call a hosted URL are detached in the same transaction). WITHOUT
#      --with-test-no-brain-guard: this project exists to hold Brains.
#   2  held security already live in production: workforce_v2_security,
#      lead_model_calls_view_lockdown
#   3  held Company Brain chain: V1 memory → B2.2 provenance → B2.3 activation
#   4  held R1.2.1 conversation workspace guard
# Refuses production, the ATLAS TEST project and the paused AgriDrone project
# BEFORE any connection. The ATLAS TEST project and its no-Brain guard are never touched.
set -euo pipefail
REFUSED="ohsdatpvfdjdemstoiuj tlvnfrxzjhsjgdofwehb luvostyizefajbltukkc wqnigjhcwjxtmordrwno"
ref="${BRAIN_TEST_PROJECT_REF:-}"; url="${BRAIN_TEST_DB_URL:-}"; confirm=""
while [ $# -gt 0 ]; do case "$1" in --confirm) confirm="${2:-}"; shift 2 ;; *) echo "unknown argument: $1" >&2; exit 2 ;; esac; done
refuse() { echo "refusing: $*" >&2; exit 1; }
# THE ONE ALLOWED TARGET: the dedicated Brain TEST project (owner-created 2026-11-28,
# separate account, Tokyo). Anything else is refused, whatever the deny-list says.
# Local rehearsal only: BRAIN_TEST_REHEARSAL=1 with ref brainrehearsalzzzzzz and a 127.0.0.1 URL.
BRAIN_TEST_ALLOWED_REF=jekgwafobrzamoupehnn
[ -n "$ref" ] || refuse "BRAIN_TEST_PROJECT_REF is empty"
for r in $REFUSED; do
  [ "$ref" != "$r" ] || refuse "$ref is production, ATLAS TEST, AgriDrone or the abandoned project — never the Brain TEST target"
  case "$url" in *"$r"*) refuse "BRAIN_TEST_DB_URL names $r" ;; esac
done
[ "$confirm" = "$ref" ] || refuse "--confirm must repeat BRAIN_TEST_PROJECT_REF exactly"
if [ "${BRAIN_TEST_REHEARSAL:-0}" = 1 ]; then
  [ "$ref" = brainrehearsalzzzzzz ] || refuse "rehearsal mode only accepts ref brainrehearsalzzzzzz"
  case "${BRAIN_TEST_DB_URL:-}" in *@127.0.0.1:*) ;; *) refuse "rehearsal mode only accepts a 127.0.0.1 database URL" ;; esac
else
  [ "$ref" = "$BRAIN_TEST_ALLOWED_REF" ] || refuse "$ref is not the dedicated Brain TEST project ($BRAIN_TEST_ALLOWED_REF)"
fi
case "$url" in postgres://*"$ref"*|postgresql://*"$ref"*) ;; *) refuse "BRAIN_TEST_DB_URL must be a postgres URL that names $ref" ;; esac
root="$(cd "$(dirname "$0")/../../.." && pwd)"; held="$root/supabase/migrations-held"

TEST_PROJECT_REF="$ref" TEST_DB_URL="$url" "$root/scripts/test-project/build-test-schema.sh" --confirm "$ref"

apply() { echo "applying ${1#$root/}"; psql "$url" -X -q -v ON_ERROR_STOP=1 --single-transaction -f "$1"; }
for f in 20261113120000_workforce_v2_security.sql 20261114120000_lead_model_calls_view_lockdown.sql \
         20261110120000_company_brain_memory.sql 20261122120000_company_brain_provenance.sql \
         20261122130000_company_brain_memory_activation.sql 20261121120000_conversation_workspace_guard.sql; do
  apply "$held/$f"
done

echo "verifying…"
psql "$url" -X -At -v ON_ERROR_STOP=1 <<'SQL'
select case when count(*) = 4 then 'ok   brain writers + provenance present' else 'FAIL brain functions missing' end
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.proname in ('company_brain_authorized_write','company_brain_provenanced_write','company_brain_memory_write','company_brain_proposal_review');
select case when exists (select 1 from information_schema.columns where table_name = 'company_brain_revisions' and column_name = 'source_kind')
            then 'ok   B2.2 columns present' else 'FAIL B2.2 columns missing' end;
select case when not exists (select 1 from pg_trigger where tgname = 'discovery_test_no_company_brain')
            then 'ok   no no-Brain guard (this is the Brain TEST project)' else 'FAIL no-Brain guard present' end;
select case when not exists (select 1 from pg_policies where tablename = 'company_brain' and cmd in ('INSERT','UPDATE'))
            then 'ok   company_brain is server-write-only' else 'FAIL browser write policy present' end;
SQL
