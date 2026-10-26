# Hosted providers-off rehearsal — attempts on TEST tlvnfrxzjhsjgdofwehb (2026-10-26)

| Run | Commit | Result |
|---|---|---|
| [40312341355](https://github.com/kathmanducreatives-code/aiworforce-platfrom/actions/runs/40312341355) | 6d448610 | Identity guard refused: `TEST_SUPABASE_URL does not name the confirmed project`. Checkout and worker skipped. Owner corrected the secret. No kickoff applied. |
| [40313271491](https://github.com/kathmanducreatives-code/aiworforce-platfrom/actions/runs/40313271491) | 6d448610 | Guard PASSED (URL secret now correct), checkout at the approved SHA, worker session 13:05:21–13:15:24 UTC (`providers=none`), drained on schedule, success. **Kickoff applied late, at 13:36:35** (operator session restart): no worker was running, the mission was never claimed. |

Kickoff: sha256 15a5839b…350f, queue 8010a9c0-d1bb-4222-a063-53860955c43b, plan 0d8799c2-…, authorization ced23645-d4d4-4b35-bf54-a8146a831421 (0 starts per actor), stopped 13:38 by `stop_discovery_smoke`.

Effects since the kickoff: 0 smoke operations, 0 tasks, 0 ledger rows, 0 credit transactions, 0 leads; credits 10 / 0; no live authorization; P11 0, P15 4. **P13 = 1**: the unclaimed queue row is still `queued` (stop_discovery_smoke does not cancel the queue row).

Verdict: **NOT EXECUTED** — the providers-off judge was not run (no mission ran). Not a product failure.
