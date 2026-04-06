# Implementation Task Tracker — COMPLETE ✅

## P0 — Critical Fixes
- [x] Fix social links in Footer.tsx — real URLs with target="_blank" + rel="noopener"
- [x] Add USD/EUR currency toggle in PricingCard.tsx — flags 🇺🇸/🇪🇺, 1.08 rate, annual savings label
- [x] Remove duplicate "Set up in 10 minutes" in HeroHook.tsx — replaced with "Cancel anytime"
- [x] Replace nanobanana with Midjourney in HeroHook.tsx — consistent with AgentBuilder

## P1 — Conversion Wins
- [x] Wire Constructor "Start Building" onClick in DepartmentRevealSection.tsx — routes to /auth
- [x] Add TimeMath cost breakdown rows — 3-stat grid (5 roles, €61K avg, €149/mo plan)
- [x] FinalCTA button safety net — 7.5s timeout guarantees button visibility

## P2 — Polish
- [x] Unhide 3rd Hero card on mobile (HeroHook.tsx) — removed hidden sm:block
- [x] Fix mobile DayTimeline clip — reduced to -50% yTranslation and 350vh on mobile

## P3 — Performance
- [x] Reduce ParticleBurst count 100 → 40 (TimeMath.tsx)
- [x] Lazy-load EcosystemSection + DepartmentRevealSection + AgentBuilder + DayTimeline + TeamsAtWork — code-split confirmed in build output!
- [ ] Throttle cursor RAF to sectionVisible only — left for future (low risk vs complexity tradeoff)

## Build Status
✅ `npm run build` — SUCCESS · 4035 modules transformed · no TypeScript errors
