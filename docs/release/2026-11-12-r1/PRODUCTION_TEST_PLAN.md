# Production test plan (after R1 is live)

**Setup:** sign in at `agentory.space` once the frontend is republished. **Before any test**, I confirm the live bundle points at `ohsdatpvfdjdemstoiuj`.

**Your account:** production has **1 user**, the one last signed in on 2026-10-21. Use that email and password; the old site used a different backend with its own accounts.

**Rules:**
- Use **your own company's real details** for the Company Brain. No fictional TEST data in production.
- Nothing here sends outreach, scrapes, enriches or calls anyone.
- ORION's "start work" path is switched off in R1 (it says so).

**Cost:** each ORION message is about **$0.005–$0.01**, worst case about $0.05. The server-side ceiling applies per workspace per 7 days.

| # | Area | Steps | Expected | Failure | Cost |
|---|---|---|---|---|---|
| P1 | Sign-in and workspace | Sign in → Dashboard | Your workspace name is shown; no "NON-PRODUCTION" badge (it's production) | A blank page, an unexpected workspace, or a "NON-PRODUCTION" badge | free |
| P2 | Company Brain: view | Open **Company Brain** | Your existing profile from 2026-10-22 is shown and editable (owner) | Missing data, a TEST banner, or read-only for the owner | free |
| P3 | Company Brain: edit and persist | Edit one field (e.g. the one-liner) → Save → reload the page | Saved; the value survives the reload | "Save failed", "changed elsewhere" on a single tab, or reverted after reload | free |
| P4 | Company Brain: concurrent edit | Open the Brain in two tabs; save in tab A, then save a different change in tab B | Tab B: "Company Brain was changed elsewhere… make your change again"; tab A's change is preserved | Silent overwrite | free |
| P5 | ICP, buyers, exclusions | Edit target customer, buyer roles, and one "do not target" item → reload | All persist | Any lost | free |
| P6 | Memory panel | In the memory panel, add a preference or decision | Listed with its source and status; survives a reload | Error toast, or it disappears | free |
| P7 | ORION knows the company | Ask: *What do you know about our company and who we sell to?* | Uses your Brain's real details (ICP, offer); says what is missing; no invented facts | Generic answer, or "Brain isn't set up" | ≈$0.01 |
| P8 | Leads | Ask: *Which of our saved leads should I prioritize, and why?* | Ranks your real saved leads with fit and evidence and [E#] citations; Evidence panel | Invented companies; no citations | ≈$0.01 |
| P9 | Signals and evidence | Ask: *What companies and signals do we have? Summarize them with evidence.* | Covers leads **and** signals with verification and dates; Evidence panel | Only a list of names (the old bug) | ≈$0.01 |
| P10 | Follow-ups | Same chat: *Tell me more about the second one.* | Resolves to the second company it listed | The wrong company | ≈$0.01 |
| P11 | Executive brief | Dashboard brief, and ask *Brief me on this week* | An evidence-backed brief, or an honest "not enough data" | An error card | ≈$0.01 |
| P12 | Agent work is off | Ask: *Find 10 new leads like our best customer.* → press **Start** if a card appears | "Starting agent work isn't switched on in this release yet… nothing charged" | Any mission or task row; credits moved | free |
| P13 | Content | Content page: open existing drafts | Lists render; no auto-publish | A crash | free |
| P14 | Isolation | Sign in as a second user (only if you create one; not required) and open the Brain | No access to your workspace's Brain or chats | Any of your data shown | free |
| P15 | Spend | After P7–P11, ask me for the spend check | `lead_execution_calls` holds model rows for your workspace (understanding plus answers); total ≈ cents | 0 rows after model answers | free |
| P16 | Errors | Disconnect the network mid-question, then retry | A readable error; retry works | A blank chat or a stuck spinner | free |

## Scorecard

| # | PASS / FAIL | Notes |
|---|---|---|
| P1 | | |
| P2 | | |
| P3 | | |
| P4 | | |
| P5 | | |
| P6 | | |
| P7 | | |
| P8 | | |
| P9 | | |
| P10 | | |
| P11 | | |
| P12 | | |
| P13 | | |
| P14 | | |
| P15 | | |
| P16 | | |
