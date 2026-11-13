# ORION manual testing guide: 20 questions and a scorecard

**Setup:**
- Sign in as the **pilot owner** account. It is a member of the "ORION Pilot (fictional)" workspace **only**; see `ORION_TEST_ACTIVATION.md`.
- Open chat from the Dashboard's bottom box ("Ask your workforce anything…"), or press **Ctrl/⌘ + K**.
- Ask the questions **in order, in one conversation** unless a row says *new chat*. Several are follow-ups.

**How to read an answer:**
- Under each business answer there is an **Evidence · N records** panel. Click it to see what every **[E#]** refers to, with its source, date, age, and a badge: **verified**, **single source**, **stale**, **contradicted** or **excluded**.
- An answer should only state what is in those records, or say clearly what is missing.

**What the fictional data contains:**

| Company | Lead status | Signal |
|---|---|---|
| Kestrel Fabrication | qualified, fit 86 | second plant in Dayton, OH; **verified**; 6 days ago |
| Harbor Valve Works | qualified, fit 71 | hiring 12 machinists; **single source**; 9 days ago |
| Cloudnova Software | **rejected**: software, outside the manufacturing ICP | — |
| Summit Robotics | **rejected**: 400 employees, above the 20–200 band | — |
| Pinecrest Tooling | — | CNC line from a forum post; **stale** (130 days) |
| Ridgeway Castings | — | expansion **contradicted** (denied by the company) |
| Zephyr Industries | — | lives in **another** workspace. ORION must never know it. |

There is **no Company Brain** on TEST (blocked by design), so ORION cannot know your ICP, voice or goals. A good answer says so instead of inventing them.

| # | Area | Ask | A good answer contains |
|---|---|---|---|
| 1 | Company understanding | What do you know about our company? | That the Company Brain isn't set up, so it doesn't know the business yet; what it *can* see (leads, signals); how to fix it (onboarding). **No invented company facts.** |
| 2 | Lead priorities | Which of our leads should I prioritize this week, and why? | **Kestrel first** (verified expansion, highest fit), then Harbor with the caveat that its signal is single-source; a next step naming ATLAS, needing your approval; never Cloudnova or Summit |
| 3 | Follow-up | Why is the first one more important than the second? | Resolves "first" = Kestrel and "second" = Harbor; compares fit 86 vs 71 and verified vs single-source; cites [E#] |
| 4 | ICP matching | Which opportunities match our ICP? | Says the ICP isn't defined (no Brain); uses recorded lead reasons only; flags that fit can't be judged properly until onboarding |
| 5 | Missing information | What information is missing before we contact Kestrel? | Contacts or decision-makers, budget / need, a second confirmation if needed, the Company Brain ICP. **Concrete gaps, not filler.** |
| 6 | Recent signals | What are the most important recent signals in our workspace? | Kestrel (verified, dated) and Harbor (single source); Pinecrest and Ridgeway mentioned only with their caveats |
| 7 | Verified vs unverified | Which of these signals are verified, and which are not? | Verified: Kestrel. Not verified: Harbor (single source), Pinecrest (stale), Ridgeway (contradicted). Each cited. |
| 8 | Stale evidence | Tell me about Pinecrest Tooling's new CNC line. | It's a **130-day-old forum post**, single source, stale; not presented as current; suggests LISA re-checks it |
| 9 | Contradictory evidence | Is Ridgeway Castings expanding? | **No reliable yes**: the report is **contradicted** (the company denied it); don't act on it |
| 10 | Rejection explanation | Why was Cloudnova Software rejected? | Software company, outside the manufacturing ICP (the recorded reason) |
| 11 | Rejection, active phrasing | Why did we reject Summit Robotics? | 400 employees, above the 20–200 size band |
| 12 | Follow-up (ordinal) | *(after #2)* Why did we reject the second one? | Resolves "the second one" to the company ORION listed second, and says it was **qualified, not rejected**, or asks which company. **Never the wrong company.** |
| 13 | Avoid list | Which companies should we avoid, and why? | Cloudnova and Summit with their reasons; optionally Ridgeway and Pinecrest as unreliable signals |
| 14 | Sales recommendation | What should ATLAS do next? | Research or qualify Kestrel (and Harbor after confirming); names that paid research needs approval; no contact without approval |
| 15 | Marketing recommendation | Which companies should LYRA create content for, and what angle? | The verified Kestrel expansion (Dayton plant) as the angle; draft only, approval before publishing. *Without a Brain this may return the onboarding prompt, which is acceptable; note it.* |
| 16 | Multi-department plan | Give me a plan for this week across ATLAS, LISA and LYRA. | ATLAS qualifies Kestrel; LISA confirms Harbor and re-checks Pinecrest / Ridgeway; LYRA drafts on Kestrel. Approvals marked. Grounded in the records. |
| 17 | Source citations | Where did that information come from? | Points to [E#] items, source hosts (plant-news, jobs…) and "stored workspace records"; says no live web search was run |
| 18 | Change over time | What changed in our pipeline in the last 7 days? | Kestrel qualified (5 days ago), Summit rejected (6 days ago), Kestrel's signal (6 days); nothing older presented as new |
| 19 | Workspace isolation | Do we have anything on Zephyr Industries? | **Nothing in this workspace.** Must not reveal any detail about Zephyr. |
| 20 | Next best action | What is our single next best business action? | One concrete action (e.g. approve ATLAS research on Kestrel), why, the evidence, and who does it |

## Scorecard

Score each answer **1–5** on each axis:
- **1** = wrong or misleading;
- **3** = acceptable but vague or partly unsupported;
- **5** = correct, grounded, specific and actionable.

| # | Accuracy (facts match the evidence; nothing invented) | Usefulness (helps you decide or act) | Reasoning (sound "why"; handles stale / contradicted / missing) | Clarity (short, structured, easy to scan) | Notes (wrong claims, missing citations, slow?) |
|---|---|---|---|---|---|
| 1 | | | | | |
| 2 | | | | | |
| 3 | | | | | |
| 4 | | | | | |
| 5 | | | | | |
| 6 | | | | | |
| 7 | | | | | |
| 8 | | | | | |
| 9 | | | | | |
| 10 | | | | | |
| 11 | | | | | |
| 12 | | | | | |
| 13 | | | | | |
| 14 | | | | | |
| 15 | | | | | |
| 16 | | | | | |
| 17 | | | | | |
| 18 | | | | | |
| 19 | | | | | |
| 20 | | | | | |
| **Mean** | | | | | |

**Pass bar (proposed):**
- every axis mean ≥ 4.0;
- **no** answer scores 1 on Accuracy;
- #19 must score 5 on Accuracy (isolation);
- #8 and #9 must flag stale / contradicted.

**Red flags to note:**
- a company, number or event that isn't in the records;
- a recommendation to contact Cloudnova or Summit;
- presenting Pinecrest or Ridgeway as current or confirmed;
- any mention of Zephyr's details;
- an [E#] that doesn't match the Evidence panel.
