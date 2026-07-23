# Lead Library Decision-System & UX Overhaul (v1)

Frontend + canonical read-model only. No backend, migrations, deploys, or model calls. One PR into `main` on branch `lead-library-decision-system-v1`. Not merged, not deployed.

## Base & scope
- Base SHA: latest `remix/main` (expected `1a53c041…`), verified before branching.
- Preserves PR #84/#85/#86 wiring: `selectedLeadCandidateId`, paired `selectedPlanId`, `createLeadActionController` single-flight, shared `runLeadAction`, and React Query `canonical-v1` invalidation. `mcp/index.ts` untouched.

## 1. Canonical decision model (single source of truth)
New pure module `src/lib/leadLibrary/leadDecisionState.ts` exporting `deriveLeadDecisionState(row)` returning:

```
decision:      contact | watch | skip | needs_review
lifecycle:     discovered | research_needed | buyer_needed | qualified
               | draft_ready | awaiting_approval | contacted | replied | meeting
fitBand:       strong | good | soft | poor | unknown  (reuses existing thresholds)
buyerState:    verified | needs_review | missing
researchState: ready | stale | failed_with_previous_success | needed
outreachState: none | draft_ready | awaiting_approval | sent
nextAction:    research_company | find_decision_makers | review_evidence
               | review_opener | approve_draft | mark_contacted | monitor | none
priorityScore, priorityReason, whyNowSummary
```

Rules (deterministic, read-only):
- Poor fit + no reviewed progression → `watch`/`skip`; never counts as qualified/buyer-ready/draft-ready. Historical draft stays visible in drawer, not primary action.
- Qualified requires canonical qualification evidence (buyer alone / draft alone insufficient).
- Buyer-ready ⇒ qualified. Draft-ready ⇒ buyer-ready. Awaiting-approval ⇒ draft-ready.
- Contacted/replied/meeting override earlier prep stages (meeting > replied > contacted).
- Incomplete/contradictory evidence → `needs_review`, never implicit `contact`.

All table, drawer, counter, filter, sort code consumes this one object. Existing duplicated interpreters in `labels.ts`, `canonicalLeadView.ts` consumers, `LeadTable`, drawer, metric strip are refactored to read from it.

## 2. Top counters
`MetricStrip` shows: All · Qualified · Buyer ready · Draft ready · Awaiting approval · Contacted · Replied · Meetings. Tooltip definitions. Invariants enforced by construction (single derivation pass). Poor-fit watch/skip never inflate readiness metrics.

## 3. Table redesign
Columns: **Account · Why now · Fit · Buyer · Decision · Next action · Updated**. Opener excerpt removed (moved to drawer). Compact opener chip only if space allows. Decision chip is the visual anchor (CONTACT / WATCH / SKIP / NEEDS REVIEW). One context-aware next action button per row using canonical `nextAction`. Consistent terminology — always "Find decision-makers". Why-now is a human sentence built from evidence; "Limited timing evidence" fallback when weak. Names/titles get tooltips; checkboxes de-emphasized.

## 4. Sorting & priority
Default sort **Recommended** using `priorityScore` with tie-break on latest meaningful signal. Order: Contact+strong+buyer → Contact+buyer-needed → Needs review w/ timing → Watch → Skip. Visible sort control: Recommended · Strongest fit · Latest signal · Recently updated.

## 5. Filters
Rebuilt on the canonical model: Decision · Stage (lifecycle) · Fit · Buyer · Industry · Source. Removes overlapping "status" controls. Search covers company, domain, buyer, title, why-now text, source label. Reset → Recommended sort + no filters + page 1.

## 6. Drawer as decision cockpit
Keeps 38vw glassmorphic shell + responsive min/max, full width on mobile. Reordered sections:
1. Header (name, domain, refresh, close) with clear decision/fit/buyer/engagement badges — no contradictory combos.
2. **Decision summary card**: Decision, Fit, Timing, Buyer, Next action + one-sentence rationale from real evidence.
3. **Primary action** — exactly one visually primary button driven by `nextAction`. Secondary safe actions (refresh research, find more DMs) de-emphasized. Wiring unchanged: same `LeadDetailActions` controller, `runLeadAction`, single-flight, canonical-v1 invalidation, `selectedPlanId` paired to `selectedLeadCandidateId`.
4. **Why now** — readable reason, source type (humanized, not raw enums), title, observed date, confidence, URL if valid. "Limited timing evidence" when weak; progressive disclosure for multiple items.
5. **Recommended buyer** — name, title, employer verification, contactability, verification state. Standardized copy. No silent recipient replacement.
6. **Personalized opener** — full message + recipient + specificity + evidence count + approval state + timestamp + copy. On watch/skip: labelled historical, not primary.
7. **Contact tracking** — grouped Engagement / LinkedIn / Email with a single selected state per group. Integration-gated states disabled with explanatory tooltip.
8. **Activity timeline** — human event names, agent/user, timestamp, concise result.
9. Technical/source details collapsed.

## 7. Terminology
Standardize user copy: Account · Why now · Fit · Recommended buyer · Verified buyer · Find decision-makers · Decision · Next action · Draft ready · Awaiting approval · Contacted · Replied · Meeting. Backend names untouched.

## 8. Density, states, layout
Improve secondary text contrast, unify spacing/row height, shrink checkbox emphasis, add safe bottom padding so `WorkforceDock` never overlaps table/pagination, tighten filter bar, keyboard focus preserved. Empty / loading / blocked / error / no-session / workspace-mismatch / integration-missing states each explain themselves; no dead instructional text.

## 9. Fixtures & tests
Add deterministic fixtures (BigID poor-fit + draft; Brain Co. medium+buyer+draft; Harmonic poor-fit historical recipient; Voice AI Space buyer-needed; strong qualified; contacted/replied/meeting) and tests covering:
- Decision-model invariants (poor+draft ≠ qualified; buyer alone ≠ qualified; readiness implications; progression overrides; needs_review fallback)
- Counter invariants (BuyerReady ≤ Qualified ≤ All; Draft ≤ Buyer; Approval ≤ Draft; poor-fit excluded)
- Sorting order + deterministic tie-break
- Table: no opener excerpt; single next action; humanized why-now; consistent terminology
- Drawer: one primary action; PR #86 payload unchanged; `selectedPlanId` matches `selectedLeadCandidateId`; double-click → 1 invocation; success invalidates canonical-v1; drawer stays open; recipient/outreach untouched
- Filters + search + reset
- Multi-tenant reject; workspace/account mismatch blocks action

Tests colocated under `src/lib/leadLibrary/__tests__/`. If repo lacks a runnable Vitest config, tests are still committed and this is reported honestly; no new framework installed.

## Technical section

**Files (new)**
- `src/lib/leadLibrary/leadDecisionState.ts` (model + `derive…` + `priorityScore`)
- `src/lib/leadLibrary/leadDecisionCopy.ts` (label maps, humanized enums, tooltips)
- `src/lib/leadLibrary/__tests__/leadDecisionState.test.ts`
- `src/lib/leadLibrary/__tests__/fixtures.ts`
- `src/components/leads/library/DecisionChip.tsx`
- `src/components/leads/library/NextActionButton.tsx`
- `src/components/leads/library/drawer/DecisionSummaryCard.tsx`
- `src/components/leads/library/drawer/WhyNowSection.tsx` (rename/refactor)
- `src/components/leads/library/drawer/ContactTrackingGroups.tsx`
- `src/components/leads/library/drawer/ActivityTimeline.tsx`

**Files (edited)**
- `src/pages/LeadLibrary.tsx` — sort control, filter wiring, bottom padding for dock
- `src/components/leads/library/LeadTable.tsx` — new columns, opener removed
- `src/components/leads/library/LeadDetailDrawer.tsx` — cockpit reorder, one primary action
- `src/components/leads/library/LeadDetailActions.tsx` — primary/secondary hierarchy; wiring unchanged
- `src/components/leads/library/MetricStrip.tsx` — 8 canonical metrics
- `src/components/leads/library/FilterBar.tsx` / `Toolbar.tsx` — canonical filters + reset
- `src/lib/leadLibrary/labels.ts` — delegates to `leadDecisionCopy`
- `src/hooks/leadLibrary/useLeadLibrary.ts` — attaches derived decision to each row (post-map, no query shape change)

**Untouched:** `supabase/functions/**` (incl. `mcp/index.ts`), migrations, `run-agent`, contact persistence, opener generation, recipient reconciliation, `canonicalLeadView` core derivation (only consumers change), Company Brain code.

**Commits (proposed)**
1. `feat(lead-library): add canonical decision state`
2. `feat(lead-library): redesign table around account decisions`
3. `feat(lead-library): turn detail drawer into decision cockpit`
4. `fix(lead-library): align counters, filters, and terminology`
5. `test(lead-library): verify decision and readiness invariants`

**Validation:** `npx tsc --noEmit`, `npm run build`, decision-model tests, existing `leadDetailActions` / `canonicalLeadView` / `canonicalIntegration` / `contactAssociationReadModel` / recipient-preservation / multi-tenant tests. Honest report if the harness cannot run committed suites.

**PR:** `lead-library-decision-system-v1` → `main`, title `feat(lead-library): unify decisions, readiness, and account review UX`. Not merged, not deployed.
