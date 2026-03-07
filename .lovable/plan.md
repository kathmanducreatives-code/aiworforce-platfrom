

## Two Issues to Fix

### 1. Build Error: `mockData.ts` — Wrong items in `mockReviews` array
The `mockReviews: CompanyReview[]` array (line 290) has 3 valid review objects, then 7 `InterviewRequest` objects (lines 315-482) incorrectly placed inside it. These interview request items have `candidateName`, `techStack`, `scorecard` etc. which don't exist on `CompanyReview`.

**Fix**: Close the `mockReviews` array after line 314 (the 3rd valid review), then add the 7 interview request objects to the existing `mockInterviewRequests` array (currently at line 139, ending at line 241).

### 2. Landing Page Scroll Optimization

The landing page has multiple GSAP ScrollTrigger sections with these issues:

- **TransformationSection**: `scrub: 1.5` on a 1500px scroll space — the "New Way" panel only appears in the last 10% of scroll (`0.9`), meaning users scroll through a lot of dead space. The transition timing is unbalanced.
- **ProductDashboard & ProductLookalike**: Both use `scrub: 2.5` on 2000px scroll — very heavy scrub smoothing makes animations feel laggy/unresponsive. The scroll-to-animation ratio is too high.
- **ExpertJourney**: 4 sticky cards at `height: calc(4 * 100vh + 600px)` — the outgoing card recede animation uses `scrub: 1` which is fine, but the entrance trigger at `top 85%` can cause cards to appear before the previous one has fully receded.
- **Multiple ScrollTrigger instances**: Each section creates its own ScrollTrigger context without `refreshPriority`, causing potential calculation conflicts.
- **`will-change` overuse**: TransformationSection applies `will-change-transform` to panels that are already animated by GSAP, adding compositor overhead.
- **Performance**: Heavy `filter: blur()` animations on scrub (TransformationSection, ExpertJourney) force expensive repaints every frame.

**Fixes**:
1. **TransformationSection**: Reduce scroll space from 1500px to 1200px. Rebalance timeline: old way fades 30-60%, new way enters 55-85% (overlap creates a smoother handoff). Increase `scrub` from 1.5 to 0.8 for snappier response.
2. **ProductDashboard**: Reduce scroll space from 2000px to 1400px, reduce `scrub` from 2.5 to 1.2. Compress animation phases so content appears faster.
3. **ProductLookalike**: Same — reduce to 1400px scroll, `scrub: 1.2`.
4. **ExpertJourney**: Add `refreshPriority` and tighten the entrance trigger from `top 85%` to `top 80%`.
5. **Global**: Add `ScrollTrigger.config({ limitCallbacks: true })` and use `fastScrollEnd: true` on pinned sections.
6. Replace `filter: blur()` with opacity-only transitions where possible to reduce repaint cost.
7. Remove redundant `will-change-transform` classes since GSAP manages transforms directly.

### Files Modified
1. `src/components/expert-marketplace/mockData.ts` — Fix array boundary
2. `src/components/landing/TransformationSection.tsx` — Rebalance timing
3. `src/components/landing/ProductDashboard.tsx` — Reduce scroll/scrub
4. `src/components/landing/ProductLookalike.tsx` — Reduce scroll/scrub
5. `src/components/landing/ExpertJourney.tsx` — Tighten triggers
6. `src/pages/Landing.tsx` — Add global ScrollTrigger config

