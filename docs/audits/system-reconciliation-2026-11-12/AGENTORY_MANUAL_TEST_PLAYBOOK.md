# Agentory manual test playbook: isolated TEST (2026-11-12)

## Before you start

1. **Use the TEST checkout** (`~/Projects/agentory-orion-test`) and update it:
   ```bash
   git pull origin claude/agentory-audit-roadmap-64uq8n && npm install
   ```
2. **Redeploy `pilot-chat`** so it carries this pass's fixes (D-1 compound reads, D-2 spend ledger). This is approval item **A3**; it changes no secrets:
   ```bash
   scripts/test-project/orion-pilot-deploy.sh --confirm tlvnfrxzjhsjgdofwehb
   ```
3. Start the app with `npm run dev` and open http://localhost:8080. `.env.local` must point at `https://tlvnfrxzjhsjgdofwehb.supabase.co`.
4. **Cost:**
   - Every ORION message is a real OpenAI call: typically under **$0.01**, worst case about **$0.05**.
   - The server refuses new turns once a workspace reaches **$0.49 in 7 days**.
   - Tests marked "free" make no model call.
   - Nothing here sends email, scrapes, enriches or calls a phone. Paid actions have no backend on TEST.

**Fictional data** in ORION Pilot:
- Leads: Kestrel (qualified, 86), Harbor (qualified, 71), Summit (rejected: too large), Cloudnova (rejected: software).
- Signals:
  - Kestrel's second plant (verified);
  - Harbor hiring (single source);
  - Pinecrest CNC line (stale, July);
  - Ridgeway expansion (contradicted).
- Zephyr exists **only** in ORION Isolation.

**Where to inspect evidence:**
- Under each ORION answer, click **Evidence · N records**.
- Database rows: ask me for a read-only check of `messages.metadata` (`chat_brain.route`, `orion_evidence`) and `lead_execution_calls` for the workspace.

## Tests

| # | Action | Expected | Failure looks like | Cost |
|---|---|---|---|---|
| T1 | Open the app (any page) | Badge reads **"TEST — tlvnfrxzjhsjgdofwehb"** | "NON-PRODUCTION — …", a production label, or no badge | free |
| T2 | Sign in as `orion-owner@agentory.space`, then open the Dashboard | Lands in **ORION Pilot (fictional)**, the only workspace for this account | Another workspace, or a new empty workspace is created | free |
| T3 | Ask: *Hello — what can you help me with?* | Short ORION reply. **No invented company facts**; may say the Company Brain isn't set up | Claims about "your company" that aren't in the data | ≈$0.005 |
| T4 | Ask: *What companies and signals are currently available in my workspace? Summarize them using stored evidence.* | Covers **leads and signals**: Kestrel, Harbor, Summit and Cloudnova (rejected), plus Pinecrest (stale) and Ridgeway (contradicted), with **[E#]** citations and an **Evidence** panel | Only four company names (the old bug); no Evidence panel; Zephyr mentioned | ≈$0.01 |
| T5 | Ask: *Which of our leads should I prioritize this week, and why?* | **Kestrel first** (verified, fit 86), then Harbor with a single-source caveat; never Summit or Cloudnova; cites [E#] | Recommends a rejected lead; no citations; "couldn't pull your workspace summary" | ≈$0.01 |
| T6 | Same chat: *Why is the first one more important than the second?* | Resolves first = Kestrel, second = Harbor; compares fit and verification | Wrong companies, or asks "which one?" despite the list | ≈$0.01 |
| T7 | Ask: *Why did we reject Cloudnova Software?* | "Software company — outside the manufacturing ICP" (the stored reason) | An invented reason | ≈$0.01 |
| T8 | Ask: *Is Ridgeway Castings expanding?* and *Tell me about Pinecrest Tooling's CNC line.* | Ridgeway: **contradicted**, don't act. Pinecrest: **stale** (about 130 days, forum post). | Either presented as current or confirmed | ≈$0.02 |
| T9 | Open the Evidence panel on T4 or T5 and click a source link | Badges (verified / single source / stale / contradicted); links open `https://…example` addresses (fictional and expected not to load) | [E#] in the text with no matching panel row; a non-https link | free |
| T10 | Sign in as editor and viewer; ask T5 as each | Both can read and chat; the viewer sees the Company Brain read-only | A viewer gets edit controls, or a 403 on reading | ≈$0.02 |
| T11 | Sign in as `orion-outsider@…`; ask *Do we have anything on Kestrel Fabrication?* | Nothing about Kestrel (different workspace); may mention Zephyr only | Any Kestrel or Harbor detail | ≈$0.01 |
| T12 | As the owner, open **Company Brain** | Blue banner **"Company Brain is turned off in this TEST environment"**; no edit, setup or restart controls | Editable fields, or "changed elsewhere / still loading" | free |
| T13 | After T3–T8, ask me for the spend check | `lead_execution_calls` rows exist for the workspace (understanding plus answers), with a total under $0.49 | 0 rows after model turns (the old bug) | free |
| T14 | Open **Lead Library** | **Qualified = 2** (Kestrel and Harbor); Summit and Cloudnova show SKIP; ATLAS strip shows "Blocked · Needs your Company Brain"; 0 credits (intended) | Qualified 0; "Blocked" with no reason | free |
| T15 | After all tests, ask me for the side-effect check | No new rows in `outreach_*`, `tasks`, `credit_transactions` or `lead_mission_queue`; no new edge-function calls besides `pilot-chat` | Any outreach, task or credit row | free |

Also browse **Dashboard, Workbench, Signals, Content, Agents, Integrations and Settings / Usage**, and note any blank page, dead button or error toast (not yet audited in a browser).

## Scorecard

| # | PASS / FAIL | Notes |
|---|---|---|
| T1 | | |
| T2 | | |
| T3 | | |
| T4 | | |
| T5 | | |
| T6 | | |
| T7 | | |
| T8 | | |
| T9 | | |
| T10 | | |
| T11 | | |
| T12 | | |
| T13 | | |
| T14 | | |
| T15 | | |

**Pass bar:** T1, T4, T11, T12 and T14 must pass. Any failure in T5–T8 goes back to me with the exact answer text.
