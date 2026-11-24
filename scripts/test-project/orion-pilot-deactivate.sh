#!/usr/bin/env bash
# DEACTIVATE THE ORION PILOT ON TEST (rollback of orion-pilot-activate.sh). Your shell.
#
#   scripts/test-project/orion-pilot-deactivate.sh --confirm tlvnfrxzjhsjgdofwehb [--keep-function]
#
# Unsets the two evidence flags. Unsets MODEL_SPEND_* ONLY if the activation set
# them (state file ceiling_set=1); a pre-existing spending limit is left alone.
# Deletes pilot-chat (it was not deployed on TEST before the pilot) unless --keep-function.
# Data: scripts/test-project/orion-pilot-cleanup.sql removes the two fictional workspaces.
set -euo pipefail
REF=tlvnfrxzjhsjgdofwehb
[ "${1:-}" = "--confirm" ] && [ "${2:-}" = "$REF" ] || { echo "usage: $0 --confirm $REF [--keep-function]" >&2; exit 2; }
cd "$(dirname "$0")/../.."
STATE=.orion-pilot-activation.state
t() { npm run --silent supabase:test -- "$@"; }
t secrets unset AGENTORY_ORION_EVIDENCE_CONTEXT AGENTORY_ORION_EVIDENCE_WORKSPACES
if [ -f "$STATE" ] && grep -qx 'ceiling_set=1' "$STATE"; then
  t secrets unset MODEL_SPEND_ENFORCEMENT MODEL_SPEND_CEILING_USD MODEL_SPEND_PERIOD_DAYS
  echo "pilot spending limit removed (it was set by the activation)."
else
  echo "spending limit left unchanged (pre-existing, or no activation state found)."
fi
[ "${3:-}" = "--keep-function" ] || t functions delete pilot-chat
rm -f "$STATE"
echo "ORION pilot deactivated on $REF."
