

# Plan: Complete Landing Page Overhaul — AI Workforce Platform

## Scope

This is a content and narrative overhaul of every existing landing page section, plus 2 new sections. All animation rigs, SVG structures, and scroll effects are preserved. Only text, data arrays, and layout structures change.

## Files Modified (15 files)

### Content-Only Updates (text/data replacements, keep all animation code)

**1. `src/components/Header.tsx`**
- Update nav links: `How It Works | Departments | Pricing | Enterprise`
- Change CTA button text: "Meet your workforce →"
- Remove "Get a Demo" and "Ecosystem" and "Global" nav items
- Keep language selector as-is

**2. `src/components/landing/HeroHook.tsx`**
- Replace aggressive ALL CAPS agency headline with mixed-case workforce narrative
- New headline: "You are doing the work / of ten people. / Now you don't have to." (line 3 in emerald)
- New subheadline about 5 departments, 15 agents, one brain
- Replace agency cost stats with animated agent presence row (5 avatar circles: Users, TrendingUp, Pen, Eye, BarChart2 with labels + pulsing rings + connection dots)
- CTAs: "Build your AI workforce →" (primary), "See how it works" (secondary)
- Trust line: "Trusted by founders from 50+ countries · Set up in 10 minutes · Cancel anytime"
- Keep all GSAP entry animations exactly

**3. `src/components/landing/GlobalTrustBar.tsx`**
- Update counter text: "Founders from N countries building with ScreeningPilot"
- Keep everything else

**4. `src/components/landing/EcosystemSection.tsx`**
- Update tab labels: Growth → Talent, rename rooms for new departments
- Update closing line to reference "ScreeningPilot" instead of "Pilot"
- Keep entire power grid, SVG, animations, hover tooltips

**5. `src/components/landing/TransformationSection.tsx`**
- This becomes Section 5 "The Problem" — repurpose the pinned scroll transformation
- Replace oldWayItems/newWayItems with problem-focused content about 15 tools, 10 jobs, hiring costs
- Keep the scroll-triggered progress ring and GSAP timeline

**6. `src/components/landing/ProductDashboard.tsx`**
- Remove — or repurpose as command center visual. Simplest: remove from Landing.tsx render order

**7. `src/components/landing/ProductLookalike.tsx`**
- Becomes Section 7 "Talent Department" — keep candidate card grid animation
- Replace surrounding text with Talent Department narrative (Scout, Aria, Lens agents)
- Update mock candidate data header text
- Add 3 agent pills below body text
- Add stat row (500+, 95%, 48hrs)

**8. `src/components/landing/ProductScreening.tsx`**
- Becomes Section 8 "Growth Department" — keep the scroll-triggered step sequence
- Replace step text with Growth narrative (Radar, Penn, Relay agents)
- Update mock card content for lead pipeline
- Add 3 agent pills + stat row

**9. `src/components/landing/ExpertJourney.tsx`**
- Becomes Section 9 "Intelligence Department" — keep the 4-step scroll stack animation
- Replace card content with Intelligence narrative (Hawk, Signal, Brief agents)
- Update stage titles and descriptions

**10. `src/components/landing/MeetTheTeamSection.tsx`**
- Update headline, subheadline, three truths text, and closing CTA
- Keep entire office diagram, connection lines, collaboration feed, mobile cards
- Update agent names/bubbles to match new department framing

**11. `src/components/landing/TeamsAtWorkSection.tsx`**
- Update eyebrow, headline, subheadline
- Rename department cards: Talent, Growth, Content, Intelligence, Engineering
- Update activity feed items per the spec
- Keep all animation code

**12. `src/components/landing/TimeMath.tsx`**
- Replace comparison rows with workforce vs human team data
- Update from agency comparison to full workforce comparison
- Add savings counter: "€192,212"

**13. `src/components/landing/SocialProof.tsx`**
- Replace testimonials with anonymized workforce testimonials
- Replace company logos with stage/industry descriptors
- Add disclaimer line about anonymization

**14. `src/components/landing/PricingCard.tsx`**
- Expand from single card to 3-tier pricing (Founder €79, Startup €149, Business €349)
- Add billing toggle (Monthly/Annual)
- Update feature lists per spec
- Keep GSAP entrance animation

**15. `src/components/landing/FAQSection.tsx`**
- Replace 7 agency FAQs with 6 workforce FAQs
- Keep custom accordion (already working)

**16. `src/components/landing/GlobalSection.tsx`**
- Update text to reference "AI workforce" instead of "AI team"
- Keep world map, hubs, pulsing dots, columns

**17. `src/components/landing/FinalCTA.tsx`**
- Replace green-bg with dark bg + green accent
- Update all text to workforce narrative
- Add secondary CTA for booking call

**18. `src/components/landing/Footer.tsx`**
- Replace Product links: remove Expert Marketplace, add department names
- Update tagline

**19. `src/components/landing/MarqueeBanner.tsx`**
- Update ticker text to workforce messaging
- Remove agency-specific language

**20. `src/components/landing/FeatureSet.tsx`**
- Remove from Landing.tsx render — content absorbed into department sections

### New Files (2)

**21. `src/components/landing/DayTimelineSection.tsx`** (~300 lines)
- Section 10: "A Day With Your AI Workforce"
- Vertical timeline, alternating left/right on desktop, single column mobile
- 15 timeline items from 7am to 5pm showing agent activities
- Each item: time (monospace), agent avatar (colored by dept), action text, output card
- Color-coded dots: green (done), amber (awaiting review), blue (founder decision), pulsing (in-progress)
- Bottom summary card: 4 stats (47min, 1 meeting, 127 candidates, €0 fees)
- Framer Motion `whileInView` with `viewport={{ once: true, margin: "-50px" }}` for each item
- CTA: "Start your first Monday →"

**22. `src/components/landing/AgentBuilderSection.tsx`** (~200 lines)
- Section 14: "Custom Agent Builder Preview"
- Dark mock UI card showing builder form (agent name, department, tools, prompt)
- Horizontal scrolling template pills below
- Framer Motion entrance animation
- No interactivity needed — static visual mock

### Updated Render Order in `src/pages/Landing.tsx`

```
Header
HeroHook
GlobalTrustBar
EcosystemSection
TransformationSection (repurposed as Problem)
MeetTheTeamSection
ProductLookalike (Talent Department)
ProductScreening (Growth Department)  
ExpertJourney (Intelligence Department)
DayTimelineSection (NEW)
TeamsAtWorkSection
TimeMath
SocialProof
AgentBuilderSection (NEW)
PricingCard
FAQSection
GlobalSection
MarqueeBanner
FinalCTA
Footer
```

Removed from render: `ProductDashboard`, `FeatureSet`

## Key Technical Notes

- All existing GSAP ScrollTrigger timelines preserved — only data arrays and text strings change
- All Framer Motion `whileInView` gets `viewport={{ once: true, margin: "-50px" }}` to fix black-section rendering bug
- All multi-line headlines changed from ALL CAPS to Title Case
- Green used as accent only — no full-section green backgrounds
- PricingCard becomes 3-column grid with billing toggle (useState for monthly/annual)
- No new dependencies added
- Expert Marketplace references removed from all sections

