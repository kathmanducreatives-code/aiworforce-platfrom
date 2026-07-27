## Frontend-Only Production Deploy

Publish current Lovable-synced main to `agentory.space` on production project `wqnigjhcwjxtmordrwno`. No backend/migration/secret changes.

### Steps

1. **Verify source SHA** — read latest synced main SHA from the Lovable worktree, confirm PR #100 + PR #101 (provider-routing fix) are present. If either is missing, stop and report.

2. **Verify env safety** — confirm `.env` resolves to `wqnigjhcwjxtmordrwno` only. Grep the repo + build output for `zbwsbnqqpkvdhqwavjke`, `11111111-1111-1111-1111-555555555555`, `CLAUDE_FIRST_LEAD_PLANNING_WORKSPACES`, and TEST hosts. Confirm no `.env.local` is tracked and no service-role key is under a `VITE_` prefix.

3. **Verify dev-only gating** — grep diagnostic components (`PreviewDiagnostics`, routing-mismatch banner in `WorkflowConfirmationCard`) for `import.meta.env.DEV` guards.

4. **Build check** — run `tsgo --noEmit` and `npm run build`. Grep the produced `dist/` for the TEST refs above. Ensure `supabase/functions/mcp/index.ts` regeneration is left unstaged.

5. **Security scan gate** — call `security--get_scan_results`; only proceed if no unresolved critical findings.

6. **Publish** — call `preview_ui--publish` (no slug change) to deploy to `agentory.space`.

7. **Smoke report** — record deployed SHA, published URL, TS/build results, TEST-ref grep result, MCP file status, and confirm no edge functions/migrations/secrets/flags were touched.

### Hard constraints (from request)
- No edge function deploys, no migrations, no secret changes, no Claude-first flag enable, no paid workflow runs.
- Never stage `supabase/functions/mcp/index.ts`.
- Rollback via Lovable's previous stable deployment if production connects to TEST, diagnostics render publicly, or auth/Workbench breaks.
