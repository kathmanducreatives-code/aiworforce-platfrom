# R1 rollback and recovery

**General rules:**
- Never re-run a partially applied step blindly. Read its state first: catalog checks for migrations, `x-agentory-build` for functions.
- Each migration ran in a single transaction, so it either applied or it didn't.

| Step | How to tell where it stands | Rollback |
|---|---|---|
| D1 security (signals, approvals) | 0 non-SELECT policies on the 4 tables | `supabase/migrations-held/rollback/20261113120000_workforce_v2_security.down.sql` (rehearsed; restores all 10 policies and the grants). **Reopens the hole.** |
| D2 spend view | `lead_model_calls` reloptions include `security_invoker=true` | `rollback/20261114120000_lead_model_calls_view_lockdown.down.sql` (rehearsed). **Reopens the hole.** |
| D5 Brain memory | `to_regclass('public.company_brain_memory')` | The drop list in the file header (lines 48–62): trigger, functions, then tables. **Destroys memory rows written since**, so export them first. |
| D4 authorized writer | `to_regprocedure('public.company_brain_authorized_write(...)')` | The file header: drop both functions. **The new Brain functions need them**, so roll the functions back first. |
| D3 server writes only | No INSERT/UPDATE policies on `company_brain` | The file header recreates `company_brain_member_insert` and `_update` and the grants. **Reopens the viewer-write hole.** |
| Functions | `x-agentory-build` = RC SHA | Redeploy the backups in `release-backups/r1-<timestamp>/` (`functions deploy <fn> --use-api --workdir <backup>`). `pilot-chat` can also be rebuilt from `86ac1b92`. `company-brain-memory` was new: `functions delete company-brain-memory`. |
| Flags | `secrets list` names | `secrets unset AGENTORY_DELEGATION_ENABLED AGENTORY_ORION_EVIDENCE_CONTEXT`; unset `MODEL_SPEND_*` **only if** `STATE` says `spend_set_by_release=1` |
| Frontend | Live assets reference `ohsdat…` | Lovable: re-publish the previous version (Lovable keeps version history), which reconnects the site to `wqnig…` |

**Recovery order** (reverse of rollout): frontend → flags → functions → D5 → D4 → D3. **Keep D1 and D2** unless they are proven to block a legitimate path; none was found in the code or on the clone.

**Nothing in R1 deletes or rewrites existing rows.** On the clone, the existing Company Brain row stayed byte-identical through D3–D5.
