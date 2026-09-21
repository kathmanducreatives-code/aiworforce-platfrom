# Recovery archive

Historical material recovered from the ScreeningPilot hub's worktrees during
the Agentory consolidation (2026-09-14), preserved here so it survives the
eventual deletion of `~/screeningpilot`. This is reference material, not
application code — nothing here is imported by `src/`, and none of it needs
to ship.

## agentory-backend-safety-b/

Recovered from the `agentory-backend-safety-b` worktree (linked worktree of
the ScreeningPilot hub, branch `lead-quality-person-sourcing-intent-fix-v1`),
which was never committed or pushed anywhere.

- `AGENTORY_AUDIT_AND_STATE.md` — a July 2026 audit documenting that its real
  work (the lead-quality benchmark harness, PR #90/#92) was already merged to
  `main` (confirmed: SHA `5719e3ac` is an ancestor of canonical's current
  history). This file itself is historical record only.
- `evals/` — 16 dated benchmark/audit run records (find-leads dual-Apify
  pipeline, signals-storage-v2 dual-write validation), July 2026. Reference
  material from past QA runs, not test code.

Not carried over: the worktree's one modified tracked file
(`supabase/functions/mcp/index.ts`) was a stale rebuild of a source file
confirmed byte-identical to canonical's current `src/lib/mcp/index.ts` —
nothing to preserve there. `.claude/settings.local.json` (local Claude Code
tool permissions) was also left behind — no non-secret content worth keeping.

Every file above was verified byte-for-byte identical to its source via
md5sum before this note was written.
