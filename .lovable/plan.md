# Read-Only Deployment Audit

No code, deploys, migrations, secrets, or providers were changed. Inspection only.

## 1. Git / Lovable branch status

- **Repo**: Lovable-managed remote (`git.private.lovable-gcp.code.storage/a1a1da21-…`). Git-sync to a customer GitHub repo is not enabled on this project from what's visible in the sandbox — Claude Code pushes land on `main` of this Lovable-hosted remote.
- **Branch Lovable is on**: `edit/edt-0453b203-44df-406a-afdb-34055a224f2f` (working branch, auto-created for chat edits).
- **Latest SHA on this branch (what preview is building)**: `794563f` — "Saved security audit"
- **You referenced main SHA**: `d3ec2143` — "Merge Commit 4A"
- **Commits ahead of `d3ec2143` on the preview branch**:
  - `e2410ca` "Changes"
  - `794563f` "Saved security audit"
- **Working tree**: clean. No uncommitted Lovable workspace changes.
- **Lovable → GitHub**: nothing unpushed on the working branch.
- **GitHub → Lovable**: nothing missing — Lovable is ahead of `d3ec2143`, not behind.
- **Published/live SHA**: not directly exposed in the sandbox. Publish is a separate manual click; assume live = whatever was in the last "Update" in the Publish dialog (see §3).

## 2. Recent commits from Claude Code

| SHA | Title | Area | In Lovable repo | In preview branch | Extra deploy needed |
|---|---|---|---|---|---|
| `d3ec2143` | Merge Commit 4A: Apify LinkedIn Jobs hiring source | backend edge fn | yes | yes | `run-radar-scan` deploy — **done this session** |
| `8884f5a9` | Brain backend — Commit 4A: Apify LinkedIn Jobs hiring source | backend edge fn | yes | yes | rolled up into `d3ec2143` |
| `bc9a7726` | Merge Company-Brain backend v1 (Signals scoring) | backend edge fn | yes | yes | `run-radar-scan` deploy — **done this session** |
| `e2410ca` | Changes | mixed (Lovable auto-commit) | yes | yes | none identified |
| `794563f` | Saved security audit | metadata only | yes | yes (HEAD) | none |

Frontend impact of the Commit 4A chain: none — pure edge-function changes under `supabase/functions/run-radar-scan/` and `supabase/functions/_shared/radarSources/`.

## 3. Frontend implementation status

- No frontend files in the Commit 4A chain.
- Two commits since `d3ec2143` (`e2410ca`, `794563f`) may contain minor edits/metadata. Preview reflects HEAD.
- **Publish gap**: any frontend edit since the last "Update" click is preview-only until you open the Publish dialog and click Update. This audit can't read the live-site SHA from the sandbox; to confirm, open the published URL in an incognito window and compare with preview.

## 4. Backend Edge Function status

Repo contains 28 edge functions under `supabase/functions/`. Highlights:

| Function | Repo has latest | Deployed to `wqnigjhcwjxtmordrwno` | Notes |
|---|---|---|---|
| `run-radar-scan` | yes (Commit 4A: imports `apifyJobsHiringSource`, reads `RADAR_ENABLE_APIFY_JOBS`) | **yes — deployed this session** | Includes Apify Jobs adapter |
| `run-agent` | yes | yes (proven deployed earlier) | Not redeployed this session |
| `send-scheduled-emails` | yes | unknown from repo — no recent deploy trigger | Deployable via Lovable |
| `setup-company-brain` | yes | unknown | Deployable via Lovable |
| `integration-readiness` | yes | yes (recent boot logs observed) | Healthy |

`run-radar-scan` specifics:
- Commit 4A code in repo: **yes** (`apifyJobsHiringSource.ts` present; `run-radar-scan/index.ts` L10/L171–175 imports adapter + checks flag).
- Deployed version uses Commit 4A: **yes** (deployed this session from current HEAD, which includes it).
- Apify Jobs adapter included in deployed function: **yes**.
- `RADAR_ENABLE_APIFY_JOBS=true`: **yes** (set this session).
- `APIFY_API_TOKEN` present: **yes**.
- `FIRECRAWL_API_KEY` present: **yes**.

Lovable can deploy any of these; Supabase CLI is not required.

## 5. Supabase secrets / environment status (project `wqnigjhcwjxtmordrwno`)

| Secret | Present | Consumed by | Impact if missing |
|---|---|---|---|
| `SUPABASE_URL` | yes | all fns | fatal |
| `SUPABASE_ANON_KEY` | yes | client-scoped fns | auth failures |
| `SUPABASE_SERVICE_ROLE_KEY` | yes | admin ops | inserts fail |
| `APIFY_API_TOKEN` | yes | `run-radar-scan`, people-search paths | hiring source not ready |
| `FIRECRAWL_API_KEY` | yes | `run-radar-scan`, intelligence | scans skip Firecrawl branch |
| `RADAR_ENABLE_APIFY_JOBS` | **yes (set this session)** | `run-radar-scan` | hiring source disabled |
| `APIFY_ENABLE_PEOPLE_SEARCH` | yes | people search flow | people search disabled |
| `RESEND_API_KEY` | yes | email fns | no emails |
| `OPENAI_API_KEY` | yes | optional | fallback paths only |
| `ANTHROPIC_API_KEY` | yes | optional | fallback paths only |
| `GOOGLE_AI_API_KEY` | yes | Gemini standard | AI features degrade |

No action required.

## 6. Database / migration status

- Migration files in repo: ~83 files under `supabase/migrations/`.
- Commit 4A requires migrations: **no** (uses existing `signals`, `company_brain`, `workspace_members`).
- Pending unapplied migrations: **cannot be determined read-only from the sandbox** — Lovable Cloud auto-applies migrations on merge, so under normal flow all repo migrations are applied. There is no schema change tied to Commit 4A.
- RLS changes pending for Commit 4A: **no**.

## 7. Deployment gap summary

| Change / Commit | Area | In main? | In Lovable? | In preview? | Published? | Fn deployed? | Secrets ready? | Action needed |
|---|---|---|---|---|---|---|---|---|
| `bc9a7726` Brain v1 scan wiring | edge fn | yes | yes | yes | n/a (backend) | yes | yes | none |
| `8884f5a9`/`d3ec2143` Commit 4A Apify Jobs | edge fn | yes | yes | yes | n/a | **yes (this session)** | yes (`RADAR_ENABLE_APIFY_JOBS=true`) | none |
| `e2410ca`, `794563f` post-4A | mixed/meta | yes | yes | yes | unknown | n/a | n/a | click Publish → Update if frontend changed |

## 8. Exact next actions

**A. Actions Lovable can do (no CLI needed)**
- None required for Commit 4A — deploy + flag were completed this session.
- Optional: redeploy `send-scheduled-emails` or `setup-company-brain` from Lovable if you want to guarantee they match repo HEAD (ask and I'll queue in build mode).
- Optional: click Publish → Update in the top right if you want the newest frontend on the live URL.

**B. Actions that require Supabase CLI**
- None. Everything needed for Commit 4A is achievable through Lovable's deploy tool and secret manager.
- If you ever prefer CLI parity, the equivalents are:
  ```
  supabase secrets set RADAR_ENABLE_APIFY_JOBS=true --project-ref wqnigjhcwjxtmordrwno
  supabase functions deploy run-radar-scan --project-ref wqnigjhcwjxtmordrwno
  ```

**C. Actions you must do manually in the app**
- Open Signals → Scout Radar and click "Run radar scan" once to validate hiring source returns `per_category.hiring.status == "ready"` and non-zero `inserted`.

**D. Actions Claude Code should do**
- Nothing required. Commit 4A is live on the connected production project.

## 9. Risk check (for the single validation scan)

- Touch production data: **yes** — inserts into `public.signals` for the current workspace.
- Apify spend: **yes, small** — hiring actor capped ~10 rows per scan.
- Firecrawl spend: **yes, small** — ~3 queries per category.
- Send emails: **no** — `run-radar-scan` never emails.
- LinkedIn posts/comments/DMs: **no**.
- RLS / schema changes: **no**.
- Rollback: delete inserted `signals` rows by `created_at` window, or set `RADAR_ENABLE_APIFY_JOBS=false` to disable the hiring source.

## 10. Final verdict

- GitHub main latest SHA (referenced): `d3ec2143`
- Lovable preview SHA (HEAD of working branch): `794563f` (2 commits ahead of `d3ec2143`)
- Lovable published/live SHA: **not readable from sandbox** — compare via published URL if needed
- Pending Lovable publish: **only if you have unpublished frontend edits since last Update** (nothing in the Commit 4A chain is frontend)
- Pending Edge Function deploy: **no** (`run-radar-scan` deployed this session)
- Pending Supabase secret setup: **no** (`RADAR_ENABLE_APIFY_JOBS=true` set this session; all others present)
- Pending migration: **no** (Commit 4A needs none)
- Commit 4A fully live: **yes**
- Safe to run one manual Scout Radar scan: **yes**
- Exact thing still blocking it: **nothing** — one manual click in Signals → Scout Radar is the only remaining step
