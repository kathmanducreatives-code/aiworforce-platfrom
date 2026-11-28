# Brain TEST runbook: deploy, manual Batches A and B, then ATLAS V5

Target: **Brain TEST `jekgwafobrzamoupehnn` only** (Tokyo, Free, a separate account). The ref is fixed inside
`scripts/test-env/brain-test`. Production (`ohsdatpvfdjdemstoiuj`), ATLAS TEST (`tlvnfrxzjhsjgdofwehb`) and
AgriDrone are refused by every script. No secret is ever typed into chat or a file. Each is prompted into the macOS Keychain.

Release candidate: branch `claude/brain-v2-integration`. It combines Company Brain V2 B2.0–B2.4, R1.2.1, and
ATLAS V5 G1–G4 (PR #282 at `1e6df6db`, with G1 adopting `excluded_industries_memory` and G4's `workspaceRulesFingerprint`).

## 0. Dashboard settings (Brain TEST, once)

1. **Authentication → URL Configuration.** Set Site URL to `http://localhost:8080`, and add the redirect URL `http://localhost:8080/**`.
2. **Authentication → Providers → Email.** Turn *Confirm email* off. This is Brain TEST only: the Free plan's mailer
   allows only a few emails an hour, and the confirmation link would not reach the local app anyway.
3. **Edge Functions → Secrets.** Add `OPENAI_API_KEY`. Drafting and ORION need it. Spending is capped by the deploy
   step: $0.25 per workspace per 30 days, at most $0.05 per call, and delegation is off.
4. Do **not** add `APIFY_API_TOKEN`, any `PROVIDER_LEADOCEAN_*`, Apollo, phone, signal or evidence-cache settings.
   The ATLAS installer refuses to run if any of them is present.

## 1. Terminal: get the release candidate, store the credentials, build, deploy and run the UI

You need macOS, the Supabase CLI, Docker running, psql, Node and Deno.

```bash
git clone https://github.com/kathmanducreatives-code/aiworforce-platfrom.git agentory-brain-test
```

```bash
cd agentory-brain-test && git fetch origin claude/brain-v2-integration && git checkout --detach 807698a0c5b775e44c6232a09a29dfe18a6d757c && npm ci
```

Use the host shown under Brain TEST → Connect → *Session pooler* (for example `aws-0-ap-northeast-1.pooler.supabase.com`):

```bash
scripts/test-env/brain-test init <session-pooler-host>
```

```bash
scripts/test-env/brain-test store-password
```

```bash
scripts/test-env/brain-test store-keys
```

```bash
scripts/test-env/brain-test check
```

```bash
scripts/test-env/brain-test build
```

```bash
scripts/test-env/brain-test deploy
```

```bash
scripts/test-env/brain-test ui
```

Open `http://localhost:8080`. The app must show the banner **"Non-production Supabase target: jekgwafobrzamoupehnn.supabase.co"**.
If the banner is missing, or names any other host, stop.

What each step does, and what it refuses:
- `check` is a read-only DB check. It must report the Brain TEST ref.
- `build` runs the baseline, then the migrations, then the Brain V2 chain, in one confirmed run against `jekgwafobrzamoupehnn` only.
- `deploy` deploys 7 functions (`generate-company-brain-draft`, `setup-company-brain`, `company-brain-memory`, `pilot-chat`,
  `daily-brief`, `run-radar-scan`, `run-monitoring-scan`). It sets the spend ceiling and turns delegation off. It does not deploy `run-agent`.
  Before changing anything, it requires that the CLI token can see the project.
- `ui` passes the Brain TEST URL, key and project id explicitly. A URL and key from different projects are refused at
  start-up. No `.env.local` value can override them.

## 2. Batch A: Company Brain setup and ICP (about 20 minutes, a few cents)

Use a new account (`brain-a+1@…`, any address). Each row is a pass or a fail. Note the time of any failure.

| # | Do | Expect |
|---|---|---|
| A1 | Sign up, then sign in | You land in a new workspace. The banner shows Brain TEST. |
| A2 | Open Company Brain before doing any setup | The page says what is missing, truthfully: no invented score and no "complete" badge. |
| A3 | Run onboarding with a fictional company (a name, a website or description, what it sells) | A draft appears. Every field is marked as a draft or AI-suggested, not as confirmed. |
| A4 | Accept some fields and edit one by hand | Edited fields show *you* as the source. Accepted fields keep their draft origin. |
| A5 | ICP: set industries "Manufacturing, Distribution", geography "United States", size 10–200 | The ICP hero shows exactly these values. Nothing is duplicated between the ICP and the target-customer sections. |
| A6 | Enter a conflicting size elsewhere (for example 500–1000 in the target customer) | A conflict is shown and must be resolved. It is never silently merged. |
| A7 | Add a disqualifier industry "Consumer retail" | It appears under exclusions. |
| A8 | Completion panel | It lists the remaining gaps with direct links. The status changes as you fill them. |
| A9 | Reload the page and sign out, then back in | Everything persists. Change history shows who changed each field and when. |
| A10 | A second account in a different workspace | It sees none of the first workspace's Brain. |

## 3. Batch B: memory approvals and ORION recall (about 15 minutes, within $0.25)

Use the Batch A workspace.

| # | Do | Expect |
|---|---|---|
| B1 | Company Brain → Company memory → *Teach Agentory*: "We never sell to crypto companies" | It is saved as your own fact (approval not required) and is visible under exclusions or facts. |
| B2 | Teach a statement that contradicts the ICP (for example "We only target retail") | A conflict confirmation appears, and nothing changes until you choose. |
| B3 | In chat, ask ORION: "Remember that our sales cycle is about 45 days" | ORION *offers* to remember it. A pending proposal appears in the memory review queue, and the dashboard shows "Review in Company Brain". |
| B4 | Reject one proposal | You see "Rejected — it will not be suggested again". Asking again does not re-propose it. |
| B5 | Approve the 45-day proposal | You see "Remembered — every agent uses it from its next run". It is listed with you as approver. |
| B6 | Start a **new** conversation and ask: "What is our typical sales cycle and whom do we avoid selling to?" | 45 days and crypto, both from memory. Nothing pending or rejected is recalled. |
| B7 | Correct the memory (45 → 60 days), then ask again in a new conversation | It answers 60. Change history keeps the old value. |
| B8 | Retract the memory, then ask again | It is no longer stated as fact. |
| B9 | Second-workspace account asks the same question | Nothing from workspace 1 appears. |
| B10 | Dashboard → spend (or ask the owner to check the ledger) | Total is ≤ $0.25 and every call is priced. |

Report Batch A and B results as one table with pass or fail and a note per row. A failure stops the step that follows.

## 4. After A and B pass, with separate approval: ATLAS V5 on Brain TEST (no paid discovery)

Use the workspace UUID shown in the app's URL or Settings. A dry run prints the plan and changes nothing:

```bash
scripts/test-env/brain-test atlas-v5 --workspace <workspace-uuid>
```

```bash
scripts/test-env/brain-test atlas-v5 --workspace <workspace-uuid> --execute --confirm jekgwafobrzamoupehnn
```

What `--execute` does:
1. Runs a preflight: the Brain V2 schema and the workspace exist, and no forbidden secret is set.
2. Applies three migrations, then verifies them: provider connections, pipeline checkpoints, and one lead per company.
3. Deploys `lead-pipeline` and `provider-connections`.
4. Enables the pipeline for **this one workspace**.

There is still no `APIFY_API_TOKEN`, so planning works and no run can buy anything.

To see it in the app, restart the UI with Strategy Discovery shown (still Brain TEST only):

```bash
scripts/test-env/brain-test ui --discovery
```

Batch C (planning only, $0 in providers):

| # | Do | Expect |
|---|---|---|
| C1 | Ask for "manufacturing companies in the US" | The plan shows the Brain's ICP fill-ins and the size rule, and requirements cite their origin (G2). |
| C2 | Ask for "crypto exchanges" | The plan becomes a question: it conflicts with the approved workspace exclusion. |
| C3 | Approve a plan, then approve a new exclusion memory (via an ORION proposal) and run the approved plan | Refused: **409 `brain_changed`**, with nothing bought. Re-planning shows the new rule (G4). |
| C4 | Run an approved plan with no Brain change | It reaches the provider stage and stops, because no provider credential is set. Nothing is bought. |

**Known gap (owned by PR #282's author):** an exclusion **you typed yourself** (`approval_status: not_required`, B1) is
refused by ATLAS's screening. It is shown as a refused memory and does not exclude. Exclusions that **ORION proposed
and you approved** do apply. For C2, use an approved ORION proposal. A fix is requested from the #282 owner: accept
`not_required` when `created_by_kind` is not `agent`.

The Apify pilot (a paid run) is a separate approval after Batch C, with its own budget.

## Rollback (Brain TEST only)

- Functions: `supabase functions delete <name> --project-ref jekgwafobrzamoupehnn`.
- ATLAS migrations: run `supabase/migrations-held/rollback/*.down.sql` for the three, in reverse order, then unset the four flags.
- The whole project can be reset from the dashboard. It holds no production data.
