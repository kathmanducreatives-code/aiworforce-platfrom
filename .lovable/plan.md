# Redeploy Backend Edge Functions + Production QA

## Goal
Force a fresh deploy of the three Lead Intelligence edge functions so production runs the code already on `main`, then verify the assistant-hiring lead flow end-to-end in the live app.

## Steps

1. **Redeploy edge functions** (Lovable Cloud manages deploys; trigger a fresh push from current `main`):
   - `pilot-chat`
   - `run-agent`
   - `orchestrate`

2. **Confirm deployment** by tailing recent logs for each function (boot/shutdown events with current timestamps) to prove the new revision is live.

3. **Browser QA via Playwright** against the running preview:
   - Restore the managed Supabase session, navigate to the chat workspace.
   - Send: *"I want founders hiring for assistant roles in USA. Help me find them."*
   - Screenshot the confirmation card and verify:
     - Hiring role = Assistant / founder-support
     - Target buyer = Founder / CEO / Operator
     - No "Persona: Founder / Head of Growth"
     - No "Industry: B2B SaaS"
   - Click **Start**, wait for the run to finish, screenshot the workbench.
   - Verify rows contain `job_title`, `exact_hiring_signal`, real `source_url`, `fit_score`, `fit_tier`, `why_this_lead`.
   - Verify no `Co-Founder` / `Founder` / `CEO` / `CTO` / `Entrepreneur in Residence` / `proof_incomplete` rows survived.
   - Export CSV and confirm `source_url`, `job_title`, `exact_hiring_signal` columns are populated.

4. **Final report** back in chat:
   - Functions redeployed (names + project ref `wqnigjhcwjxtmordrwno`)
   - QA prompt result (card contents, accepted/rejected counts)
   - CSV source-proof check
   - Any remaining issue

## Non-goals / guardrails
- No frontend, schema, migration, or secret changes.
- No manual DB edits, no auto-send/DM/post/email enabled.
- No parser changes unless the freshly deployed functions still fail QA.
