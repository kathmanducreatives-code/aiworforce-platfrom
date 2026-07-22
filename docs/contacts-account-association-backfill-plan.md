# Contact → account association: guarded production backfill plan

**Status:** PLAN ONLY — not executed. No production writes in this PR.

## What this PR ships (code)

- `contactAccountAssociation.ts` — pure resolver. Attaches a contact to an
  account only on a STRONG current-employer signal (provider company id /
  employer domain / employer company LinkedIn / company-scoped search + verified
  employer / lead-candidate account match + verified employer). Name-only,
  title, array membership, model opinion, and stale employers are insufficient.
  Conflicts (wrong current employer, cross-workspace, different account) reject;
  a strong new employer vs an existing association returns
  `reassignment_required` (never a silent move).
- `contactAccountBackfillPlanner.ts` — read-only classifier
  (`safe_to_backfill` / `needs_review` / `rejected` / `already_associated`).
- `attachContactAccount.ts` — persistence glue. Wired into
  `leadActionExecutor` (decision-maker discovery) and `run-agent`
  (contact discovery): both now write `account_id` **only when verified**, and
  omit it otherwise so an existing verified link is never clobbered.

## Read-only planner run against production (Agentory workspace `e510c1a6…`)

9 contacts, all `account_id = null`, all `via = decision_maker_discovery`:

| classification | count | reason |
|---|---|---|
| `needs_review` | 3 | account-linked (Harmonic Security, Brain Co., BigID) but the discovery-time employer verification was never persisted to `contact.raw` → no strong current-employer signal |
| `needs_review` | 6 | no `lead_candidate` references the contact (`contact_id`), so no candidate account |
| `safe_to_backfill` | **0** | — |

**Conclusion:** an automatic backfill today would change nothing — correct and
safe. The forward wiring fixes new writes; the 3 account-linked contacts are good
**manual-review** candidates (durably attached to a known account via a
company-scoped search), but the resolver will not auto-attach without stored
employer evidence.

## Guarded backfill procedure (when approved, run separately)

1. **Deploy** this contact-association code first (so new writes stop producing nulls).
2. **Re-run the planner** read-only against the target workspace after some new
   discovery has repopulated `contact.raw` with verification provenance.
3. **Review** `safe_to_backfill` vs `needs_review`; manually confirm the 3
   account-linked legacy contacts if desired.
4. **Back up** the `contacts` rows to be touched (export id, account_id, raw).
5. **Update only `safe_to_backfill`** rows, one guarded statement each:
   ```sql
   update contacts
      set account_id = :expected_account_id,
          raw = jsonb_set(coalesce(raw,'{}'::jsonb), '{account_association}', :assoc_json)
    where id = :contact_id
      and workspace_id = :workspace_id      -- tenant guard
      and account_id is null;               -- expectedCurrentAccountId guard → abort on concurrent change
   ```
   Verify `:expected_account_id`'s workspace equals `:workspace_id` before running.
6. **Leave `needs_review`/`rejected` rows null** for manual handling.
7. **Preserve** selected-recipient / outreach history — this backfill touches
   only `contacts.account_id`, never outreach or `lead_candidates.contact_id`.
8. **Write an audit** activity_feed row per updated contact.
9. **Verify** the canonical Lead Library shows the newly-associated contacts on
   the right account; roll back any row whose post-update account ≠ expected.

No migration is required — `contacts.account_id` already exists.
