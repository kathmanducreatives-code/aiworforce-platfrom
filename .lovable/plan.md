## Goal
Resolve the frontend/backend version mismatch by verifying the production `run-agent` edge function and redeploying it if stale. No providers, migrations, RLS, secrets, or outreach touched.

## Steps

1. **Inspect deployed `run-agent`** on project `wqnigjhcwjxtmordrwno`:
   - Use `supabase--edge_function_logs` and/or `supabase--curl_edge_functions` with a harmless introspection call (e.g., `{ "ping": true }` or an intentionally invalid body) to observe the deployed version's response shape / error surface.
   - Compare current `supabase/functions/run-agent/index.ts` in this repo (which reflects commit `ac87eb5` or later) against the deployed behavior signals — specifically the additive `tool_input.lead_action` branch used by `src/lib/leadActions.ts` (Research company / Find decision-makers / Generate outreach).
   - If the deployed function rejects or ignores `tool_input.lead_action`, it is stale.

2. **If stale → redeploy** using `supabase--deploy_edge_functions` with `function_names: ["run-agent"]`. This deploys the current repo source to production. No code changes are made.

3. **Verify post-deploy**:
   - Re-run the same harmless introspection call to confirm the new version is live.
   - Check `supabase--edge_function_logs` for a clean cold-start (no import/parse errors).

4. **If already up-to-date → no action.** Report findings back.

## Explicit non-actions
- No migrations, RLS, secret, or config changes.
- No provider calls (Firecrawl, Apify, Resend, LLMs) triggered by us.
- No outreach sends.
- No frontend changes.
- No republish of the frontend.

## Deliverable
A short status: "run-agent was stale → redeployed" or "run-agent already current → no action needed", plus the log/response evidence used to decide.
