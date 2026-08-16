# Migrating Agentory onto `luvostyizefajbltukkc`

One project replaces both the old TEST (`zbwsbnqqpkvdhqwavjke`) and PRODUCTION
(`wqnigjhcwjxtmordrwno`) projects, in a different Supabase account.

**Decisions this runbook assumes** — schema only, no application data, no auth
users; storage files carried across; both old projects retired.

**What is already done in the repo** (committed): every project ref repointed,
the environment model documented as single-project, the deploy guards rewritten
to refuse the retired refs, and one migration defused — see step 0.

**What only you can do**: everything that touches the new project. The MCP
tooling is hard-scoped to the old project and cannot write a single row to the
new one.

---

## 0. Read this before you run anything

**A migration was recreating the outage.**
`20251206101250_…sql` scheduled a cron job every minute that posted to a
hardcoded `zbwsbnqqpkvdhqwavjke` URL, carrying a hardcoded anon JWT. Replayed
into the new project it would have created a job on the new database calling the
**old project's** function, forever, with a stale credential — and it is the same
job that wrote 455 MB into `cron.job_run_details`, filled the 500 MB quota and
made the app unusable on 2026-08-15.

That block is now a comment. The extensions are still created. If you want
scheduled email, schedule it deliberately **and pair it with the retention job**
— the commented template in that file has both.

**You are starting empty.** 28 auth users, 255 conversations, 683 messages and
all lead data stay behind. Every user re-registers.

---

## 1. Collect these from the new project's dashboard

| value | where |
|---|---|
| database password | Settings → Database |
| anon / publishable key | Settings → API |
| service-role key | Settings → API |
| access token | Account → Access Tokens |

---

## 2. Point the CLI at the new account

```bash
supabase login
```

```bash
supabase link --project-ref luvostyizefajbltukkc
```

Then confirm you are where you think you are — this refuses the retired refs:

```bash
npm run verify:deploy-target -- --expect production
```

---

## 3. Push the schema

99 migration files reconstruct the schema: 109 tables, 269 RLS policies,
21 functions, 39 triggers, 18 enums.

```bash
supabase db push
```

The remote previously tracked 73 migrations against 99 local files, so expect
some to be new to this database. Since it starts empty, they replay in order.

If a migration fails, fix it and re-run — do not `--include-all` past a failure,
because a partially applied schema with RLS missing is worse than none.

---

## 4. Deploy the 29 edge functions

```bash
supabase functions deploy --project-ref luvostyizefajbltukkc
```

---

## 5. Set the 13 secrets

`SUPABASE_URL`, `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` are injected
by the platform. The rest you must set — **none of them are in this repo**, and
they do not travel with the project:

```bash
supabase secrets set --project-ref luvostyizefajbltukkc ANTHROPIC_API_KEY=... APIFY_API_TOKEN=... FIRECRAWL_API_KEY=... LOVABLE_API_KEY=... PERPLEXITY_API_KEY=... RESEND_API_KEY=...
```

Also carried by name, if you used them: `APIFY_ACTOR_PEOPLE_SEARCH`,
`APIFY_ENABLE_PEOPLE_SEARCH`, `SOURCE_PLANNER_PROVIDER`, `PUBLISHED_URL`.

---

## 6. Recreate the three storage buckets

All three are **private**. Create them before uploading, or the uploads 404.

| bucket | files | bytes |
|---|---|---|
| `screening-resumes` | 8 | 814 kB |
| `cleintlogos` | 3 | 136 kB |
| `candidatespfp` | 1 | 1.25 MB |

Paths matter — `screening-resumes` keys are `<uuid>/<timestamp>_<name>.pdf`, and
the UUID is a candidate id. Upload with the **same key**, or the rows that
reference them will not resolve:

```
screening-resumes/35f2b966-af4b-4786-a5ec-d3b1553b3e43/1771838372099_Resume.pdf
screening-resumes/35f2b966-af4b-4786-a5ec-d3b1553b3e43/1771839261587_LinkedIn_Outreach_Launch_Kit.md.pdf
screening-resumes/7ce6717c-3c74-4312-962e-d7e6a27ad8cf/1772383988639_Python-Developer-Resume.pdf
screening-resumes/80f4d315-3814-4661-969d-ab4095667057/1772384319275_Python-Developer-Resume.pdf
screening-resumes/80f4d315-3814-4661-969d-ab4095667057/1772435868980_Python-Developer-Resume.pdf
screening-resumes/80f4d315-3814-4661-969d-ab4095667057/1772436062546_Python-Developer-Resume.pdf
screening-resumes/80f4d315-3814-4661-969d-ab4095667057/1772436311369_Python-Developer-2.pdf
screening-resumes/ec7fcc5f-f867-4e32-88ad-cbb12d4bdc35/Resume.pdf
cleintlogos/download (1).png
cleintlogos/powered by screening pilot (2).png
cleintlogos/Untitled design (40).png
candidatespfp/Layer 2 copy.png
```

Since no application data is being migrated, those candidate rows will not
exist. **Consider skipping the resumes entirely** — 8 files keyed to candidates
that no longer exist are 814 kB of orphans and eight people's CVs in a database
that has no record of them. The logos are the only ones with an obvious use.

---

## 7. Rebuild and verify

```bash
npm run build
```

```bash
npm run test:deploy-safety && npm run test:edge && npm run test:ui
```

---

## 8. After it works

Two abandoned projects still exist and **their credentials still work**. Nothing
in this repo can reach them any more — every retired ref now fails closed — but
a stale `.env` on another machine, or a teammate's shell, still can.

Pause or delete both once you are satisfied:
`zbwsbnqqpkvdhqwavjke`, `wqnigjhcwjxtmordrwno`.

---

## One thing this repo cannot fix for you

`supabase/functions/mcp/index.ts` is **generated** — its banner says
"AUTO-GENERATED … do not edit", and the Vite plugin rewrites it on every build.
Your local edit of `projectRef` there will be overwritten. The value must be
changed in `src/lib/mcp/index.ts`, which is the source the bundle is built from.
