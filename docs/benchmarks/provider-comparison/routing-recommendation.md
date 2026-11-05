# Discovery routing: recommendation (not implemented)

**Status:** a recommendation only.
- **No routing code changes.** The planner keeps choosing as today; `apify_leadocean_concurrent` is never auto-selected.
- The basis is provider capabilities (`docs/PROVIDER_CAPABILITIES.md`) and the **offline** comparison (`comparison.json`: synthetic `.example` companies, recorded responses).
- **No live provider comparison has run yet** (TEST ledger: 0 rows, 2026-11-05). Revisit every row after the live comparison.

| Mission type | Recommended strategy | Why | Evidence so far |
|---|---|---|---|
| **Hiring-focused** ("actively hiring AEs") | `apify_only`: job-search discovery, then the company record | Discovery *by* the dated signal: every candidate already carries the posting, and the record proves identity, HQ and size. LeadOcean has no hiring data. | Offline: 2 qualified, 0 false, $0.023 |
| **Hiring + maximum coverage** | `apify_leadocean_concurrent`, plus the opt-in company-scoped job check (#237, unmerged) | LeadOcean adds candidates Apify missed. They stay **pending** until a scoped job search proves hiring. | Offline: 6 unique, 2→3 qualified with the check; +$0.003 |
| **Decision-maker discovery** | Apify identifies the companies, then LeadOcean people search scoped to them (`apify_plus_leadocean`) | Company eligibility comes from evidence; people come from the people database; role and employment stay "provider claim" until verified. | Not yet measured |
| **Company-profile** (industry, size, HQ; no signal) | `leadocean_plus_apify`: LeadOcean proposes, the Apify company record corroborates | LeadOcean filters natively on firmographics. Its claims are corroborated, never trusted alone; conflicts are kept. | Not yet measured |

## Before any automatic routing

1. The live three-mode comparison runs on TEST within the approved cap (`scripts/test-project/provider-live-comparison.ts`). Then repeat it on at least one company-profile mission and one decision-maker mission.
2. A routing rule, if adopted, is part of the planner and **inside the plan hash**:
   - it is explainable (it lands in `rationale`);
   - it is budget-aware (the worst case is shown before approval);
   - changing it changes the hash, so no existing approval silently changes meaning.
3. It must keep the discovery benchmark baseline unchanged for existing scenarios, or each difference is approved.
