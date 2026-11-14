# R1.1 TEST run, then production deploy and live check

## TEST (`tlvnfrxzjhsjgdofwehb`): in your shell, before approving production

**One command does every step below,** including the "nothing created" check, the spend total and the cleanup:

```bash
TEST_DB_URL='<TEST database URL>' ORION_PILOT_OWNER_EMAIL='<owner>' ORION_PILOT_OWNER_PASSWORD='<pw>' ORION_PILOT_OUTSIDER_EMAIL='<outsider>' ORION_PILOT_OUTSIDER_PASSWORD='<pw>' scripts/test-project/r11-test-run.sh --confirm tlvnfrxzjhsjgdofwehb
```

The individual steps, for reference:

1. **Seed the fictional production-shaped records** into "ORION Pilot (fictional)". This adds 11 accounts that are not leads (including Laminar, Epsilon3 and Civilgrid), 6 old hiring signals with no event date, and 1 disabled monitoring subject.
   ```bash
   psql "$TEST_DB_URL" -v ON_ERROR_STOP=1 --single-transaction -f scripts/test-project/orion-r11-seed.sql
   ```
2. **Match production's release flag on TEST.** If `AGENTORY_DELEGATION_ENABLED` is absent, delegation counts as enabled, the drafting prompts take the LYRA route, and R1.1's draft path is not tested. Check the names, and set the flag if it is missing (a TEST-only secret, a value of `false`):
   ```bash
   npm run --silent supabase:test -- secrets list
   ```
   ```bash
   npm run --silent supabase:test -- secrets set AGENTORY_DELEGATION_ENABLED=false
   ```
   `AGENTORY_ORION_EVIDENCE_CONTEXT` must also be present on TEST; `orion-pilot-activate.sh` sets it.
3. **Deploy pilot-chat to TEST.** This builds from your checkout and changes no secrets.
   ```bash
   scripts/test-project/orion-pilot-deploy.sh --confirm tlvnfrxzjhsjgdofwehb
   ```
4. **Run the 20 prompts.** This costs about $0.10–0.30 under the TEST ceiling. It needs the owner and outsider sign-in tokens, set as environment variables in your shell.
   ```bash
   deno run --allow-env --allow-net --allow-read --allow-write=. scripts/orion-pilot/run-r11.ts --dry-run
   ```
   ```bash
   ORION_R11_APPROVED="I approve the ORION R1.1 TEST run on tlvnfrxzjhsjgdofwehb" ORION_PILOT_SUPABASE_URL=https://tlvnfrxzjhsjgdofwehb.supabase.co ORION_PILOT_ANON_KEY="$TEST_ANON" ORION_PILOT_OWNER_JWT="$OWNER_JWT" ORION_PILOT_OUTSIDER_JWT="$OUTSIDER_JWT" deno run --allow-env --allow-net --allow-read --allow-write=. scripts/orion-pilot/run-r11.ts
   ```
   **Pass:**
   - all 20 turns pass the automatic checks;
   - drafts route to `orion_draft`; on TEST they end at the onboarding gate, which is expected;
   - the isolation probe returns HTTP 403.
5. **Confirm nothing was created** by the drafts (expect 0 and 0):
   ```bash
   psql "$TEST_DB_URL" -c "select (select count(*) from content_item where workspace_id='a71a0000-0000-4000-8000-0000000011a1' and created_at > now() - interval '1 hour') content_rows, (select count(*) from tasks where workspace_id='a71a0000-0000-4000-8000-0000000011a1' and created_at > now() - interval '1 hour') tasks"
   ```
6. **Optional cleanup:**
   ```bash
   psql "$TEST_DB_URL" -v ON_ERROR_STOP=1 --single-transaction -f scripts/test-project/orion-r11-cleanup.sql
   ```

## Production (`ohsdatpvfdjdemstoiuj`): only after your approval

From a clean checkout of the R1.1 commit (`<SHA>` = the SHA in the approval request):

```bash
scripts/release/deploy-r11-pilot-chat.sh --check --confirm ohsdatpvfdjdemstoiuj --sha <SHA> --tool-sha <SHA>
```
```bash
scripts/release/deploy-r11-pilot-chat.sh --deploy --confirm ohsdatpvfdjdemstoiuj --sha <SHA> --tool-sha <SHA>
```

**Live check:** re-ask the 20 prompts in the production chat. Expected:

| Tests | Expected |
|---|---|
| 4 | Five labelled answers. Leads 61, qualified 0, monitored 1 subject with 0 enabled, signals 37, then opportunities. The answer separates "0" from "not recorded". |
| 6, 10, 20 | 145 accounts versus 61 lead candidates (84 accounts are not leads), all `new`, 0 scored. Never "eight leads". |
| 7 | Ten leads with fit status, decision status, buyer and next action. Unknown fields are stated as not stored. |
| 8 | Laminar, Epsilon3 and Civilgrid are indexed accounts but not leads; only Hyperbound is a lead. |
| 9 | Hyperbound has 0 saved contacts, and the answer lists which fields are unknown. It runs no enrichment. |
| 11 | Ten signals with type, source, observed date and confidence. Never "date not stated". |
| 12 | 21 hiring signals, the historical ones flagged, with the reasoning. |
| 1 | The answer flags the "2–2 employees" value and the "5" label as suspect. |
| 14–16 | A draft in the chat, with the "Draft only" chip and the notice. No `content_item` row is created; check with the query below. |
| 17 | Three companies, with ATLAS, LISA, ORION and LYRA attribution. Nothing is executed. |

Check that no draft row was created:

```sql
select count(*) from content_item where created_at > '<deploy time>';
```

The result must not increase from drafting.
