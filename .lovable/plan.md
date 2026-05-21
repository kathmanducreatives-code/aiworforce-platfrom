# Day 1 Closeout Plan

Five sequential tasks, no scope creep.

## 1. Append v2 pill to `src/components/landing/MeetYourAITeamSection.tsx`
After the existing 5-agent grid (`AGENT_PROFILES.map(...)`), append one extra grid item styled as a "coming soon" placeholder:
- Same outer wrapper dimensions as an agent card so the grid stays aligned
- Dashed border (`border-2 border-dashed border-white/15`), reduced opacity (`opacity-60`)
- Circular slot matching `w-32 h-32 md:w-40 md:h-40` but empty (no image, no pulse dot)
- Copy: "More agents joining the team in v2"
- Uses existing tokens only (no new colors)

## 2. Verify `src/components/landing/FeatureSet.tsx`
Read full file. Grep for: Lens, Radar, Relay, Quill, Canvas, Pulse, Signal, Brief, Oracle. From the file already in context, none appear — slides are Clock3/Briefcase/Users/Target with agency-killer copy. Will re-confirm with ripgrep and report clean or strip any hits.

## 3. Typecheck
Run `npx tsc --noEmit` from project root. Paste full output. Fix only errors introduced today (landing edits, secret renames, tasks migration types). Flag pre-existing unrelated errors without fixing.

## 4. run-agent ↔ tasks column report
Read `supabase/functions/run-agent/index.ts` end-to-end. From the file in context, the `tasks` columns referenced are:
- select: `id, plan_id, agent_id, step_index, description, status`
- update: `status, started_at, finished_at, output`
- select on next: `id, agent_id, step_index, description`
- filter: `plan_id, status`

Compare each against migrated schema (id, plan_id, agent_slug, parent_task_id, depends_on, status, payload, result, error_message, user_id, created_at, updated_at, completed_at). Mark ✅ / ⚠️ / ❌. No fixes.

Also note (out of scope but flagged): references to nonexistent tables `approvals`, `handoffs`, `activity_feed`, `agents`, and missing `task_plans.workspace_id`.

## 5. Final summary block
Single message with the six exact sections requested: Migrations run today, Files modified, Secrets to set, run-agent↔tasks status, Anything unexpected, Ready to verify.

## Rules honored
No git push, no new deps, no edits outside the five items.

Approve to execute.