## Goal
Redeploy production edge function `run-agent` from the current repo source. No other changes.

## Steps

1. Call `supabase--deploy_edge_functions` with `function_names: ["run-agent"]`. This deploys the current repo's `supabase/functions/run-agent/index.ts` to project `wqnigjhcwjxtmordrwno`.

2. Verify via `supabase--edge_function_logs` for `run-agent` that the cold start is clean (no import/parse errors).

3. Report back:
   - Deploy success yes/no
   - Project ref used (`wqnigjhcwjxtmordrwno`)
   - Source = current repo working tree (Lovable deploys from the current workspace source, not from a git commit SHA — I cannot independently verify the SHA is `ef772cd`; will state this explicitly)
   - Confirm: no migrations, no RLS changes, no secret changes, no providers invoked, no outreach sent

## Explicit non-actions
- No migrations, RLS, config, or secret changes
- No provider calls (Apify, Firecrawl, LLMs, Resend)
- No frontend publish
- No other edge functions deployed

## Note on commit SHA
Lovable's deploy tool ships the current workspace source to the target project ref. It does not accept a git SHA parameter and I cannot query git state. If the workspace is not at `ef772cd`, the deploy will still use whatever is currently in `supabase/functions/run-agent/index.ts`. I will flag this in the post-deploy report.
