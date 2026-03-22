

# Plan: "Meet The Team" Landing Page Section

## Placement

There is no "Company Brain" or "How It Works" section currently rendered in `Landing.tsx`. The logical placement is **after ExpertJourney and before TimeMath** — this transitions from product features into the emotional team narrative before the comparison/pricing flow.

## Files Changed

| File | Change |
|------|--------|
| `src/components/landing/MeetTheTeamSection.tsx` | **NEW** — Full section component (~600 lines) |
| `src/pages/Landing.tsx` | Add import + render between ExpertJourney and TimeMath (2 lines changed) |

## Component Architecture

**MeetTheTeamSection.tsx** — Single self-contained component with 5 parts:

### Part 1: Headline Block
- Eyebrow "MEET THE TEAM" in `font-mono text-xs uppercase tracking-[0.15em] text-emerald-400` (matches SocialProof pattern)
- Display headline + muted subheadline, max-w-[600px] centered

### Part 2: Office Floor Plan (Desktop) / Agent Cards (Mobile)
- **Desktop (md+):** A relative-positioned container (700×450px) with dark bg, subtle grid overlay, 5 absolutely-positioned desks in pentagon formation
- Each desk: rounded rect with SVG monitor icon, agent name label, 40px avatar circle with lucide icon (TrendingUp, Users, Pen, BarChart2, User) and pulsing green ring
- Center desk (You/Founder) slightly larger with accent border
- **Mobile (<md):** Vertical stack of 5 simple agent cards with dotted connecting line

### Part 3: Animation Sequence (Framer Motion + CSS)
- IntersectionObserver triggers once on viewport entry
- Phase 1 (0-1s): Office fades in, empty desks visible, Founder desk already lit
- Phase 2 (1-5s): 4 agents slide in from edges to desks (staggered 0.8s), speech bubbles appear/fade (1.2s each)
- Phase 3 (5-7s): "Welcome to Pilot HQ" notification center-fades
- Phase 4 (7-10s): 8 SVG connection lines draw via strokeDashoffset (0.3s stagger), small dots pulse along lines via CSS animation
- Phase 5 (10s+): Final state persists — all connections visible, green rings pulsing, closing label fades in

### Part 4: Collaboration Feed
- Horizontal auto-scrolling ticker (CSS `@keyframes`, same pattern as MarqueeBanner's `ticker-track`)
- 10 pill cards showing agent→agent actions, duplicated in DOM for seamless loop
- Each pill: dark bg, border, agent icons with ArrowRight between, muted action text

### Part 5: Three Truths
- 3-column grid (md+), single column mobile
- Each: lucide icon (Brain, ArrowLeftRight, UserCheck) + title + body text
- No card borders — clean minimal layout

### Part 6: Closing CTA
- Italic quote text centered, muted body below
- Primary emerald button "Meet your AI team →" linking to `/auth` (same button style as FinalCTA)

## Design Tokens Used (all existing)
- Colors: `text-emerald-400`, `bg-emerald-600`, `text-white`, `text-white/40`, `border-white/[0.04]`
- Fonts: `font-display font-black`, `font-mono text-xs uppercase tracking-[0.15em]`
- Backgrounds: `#02060a` / `#04060d` range (matches FeatureSet/ExpertJourney)
- Button: `conic-border` class + emerald hover glow (from FinalCTA)

## No New Dependencies
- Framer Motion (already installed) for entrance animations
- Lucide React for icons
- CSS @keyframes for feed scroll + line pulses + dot animations
- Vanilla IntersectionObserver for trigger

