#!/usr/bin/env bash
# DEACTIVATE THE ORION PILOT ON TEST (rollback of orion-pilot-activate.sh). Your shell.
#
#   scripts/test-project/orion-pilot-deactivate.sh --confirm tlvnfrxzjhsjgdofwehb [--keep-function]
#
# Unsets the pilot flags and the pilot spend ceiling, then deletes pilot-chat
# (it was not deployed on TEST before the pilot) unless --keep-function.
# If MODEL_SPEND_* existed before the pilot, re-set their recorded values afterwards.
# Data: run scripts/test-project/orion-pilot-cleanup.sql (approval) to remove the fictional workspaces.
# Security migration: scripts/test-project/install-workforce-v2-security.sh --rollback (only if needed).
set -euo pipefail
REF=tlvnfrxzjhsjgdofwehb
[ "${1:-}" = "--confirm" ] && [ "${2:-}" = "$REF" ] || { echo "usage: $0 --confirm $REF [--keep-function]" >&2; exit 2; }
cd "$(dirname "$0")/../.."
t() { npm run --silent supabase:test -- "$@"; }
t secrets unset AGENTORY_ORION_EVIDENCE_CONTEXT AGENTORY_ORION_EVIDENCE_WORKSPACES \
  MODEL_SPEND_CEILING_USD MODEL_SPEND_PERIOD_DAYS MODEL_SPEND_ENFORCEMENT
[ "${3:-}" = "--keep-function" ] || t functions delete pilot-chat
echo "ORION pilot deactivated on $REF."
