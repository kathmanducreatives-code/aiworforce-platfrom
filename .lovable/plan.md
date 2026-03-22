

# Plan: AI Tools Ecosystem + Global Brand Sections

## Overview

Add 5 new files and modify 2 existing files (Landing.tsx for section placement, Header.tsx for nav updates). All additions only — no existing sections modified.

## New Files

### 1. `src/components/landing/ToolLogos.tsx`
- 16 exported SVG logo components (ClaudeLogo, GeminiLogo, etc.)
- Each: `viewBox="0 0 32 32"`, accepts `className` prop
- Simple geometric approximations (letterforms, shapes) — no complex paths
- Under 20 SVG elements each

### 2. `src/components/landing/GlobalTrustBar.tsx`
- Placed after HeroHook, before TransformationSection
- Left: animated counter "Founders from N countries" with Globe icon, N cycling 47-52
- Center: auto-scrolling emoji flag strip using `ticker-track` CSS class (already exists for MarqueeBanner)
- Right: 3 compliance badges (SOC2, GDPR, Encrypted)
- Mobile: hide counter, flags full-width, badges below

### 3. `src/components/landing/EcosystemSection.tsx`
- Placed after MeetTheTeamSection, before TimeMath
- Power grid visual: center "Pilot" node + 2 concentric rings of tool logos (inner 8 bright, outer 8 muted)
- SVG connection lines from each tool to center
- Animation via IntersectionObserver + Framer Motion: center appears → inner ring staggers in with line draws → outer ring follows → permanent pulsing dots on lines
- Hover tooltips per tool (name + description + Connected/Partner badge)
- Tab filter row: All / Growth / Recruiting / Creative / Strategy — dims non-matching tools
- 3 stat blocks below (16+, 1, 0) with counter animation
- Closing quote text
- Mobile: only inner ring shown, outer ring hidden

### 4. `src/components/landing/TeamsAtWorkSection.tsx`
- Placed after EcosystemSection, before TimeMath
- 5 department cards in 2-col grid (desktop), 1-col (mobile)
- Each card: dept icon + name, ACTIVE badge (pulsing green), tool logo row, auto-cycling activity feed (3 items, rotates every 3s via setInterval + Framer AnimatePresence)
- Card 5 (Engineering) has "Coming Soon" badge + muted styling
- "View Room" buttons link to `/auth?room=growth` etc.
- Card 5 has "Join waitlist" button

### 5. `src/components/landing/GlobalSection.tsx`
- Placed before FinalCTA (second to last content section)
- 3-column layout (Globe, Languages, Shield icons)
- Inline SVG world map outline (simplified continental shapes)
- 8-10 pulsing dots at startup hub coordinates
- Faint connecting lines between dots
- Mobile: 1-col, map simplified, 5 dots only

## Modified Files

### `src/pages/Landing.tsx`
Add imports and render in order:
```
HeroHook
GlobalTrustBar          ← NEW
TransformationSection
ProductDashboard / Lookalike / Screening
ExpertJourney
MeetTheTeamSection
EcosystemSection        ← NEW
TeamsAtWorkSection      ← NEW
TimeMath
FeatureSet
SocialProof
PricingCard
FAQSection
GlobalSection           ← NEW
MarqueeBanner
FinalCTA
```

### `src/components/Header.tsx`
- Add "Ecosystem" and "Global" nav items pointing to `#ecosystem` and `#global` anchors
- Add language selector dropdown (shadcn DropdownMenu) far right: EN active, Hindi/Deutsch/Português greyed "coming soon"

## Technical Notes
- All animations: IntersectionObserver, fire once
- Activity feed cycling: setInterval + Framer AnimatePresence for slide transitions
- Flag scroll: reuse existing `ticker-track` CSS keyframes
- Tool logo hover tooltips: absolute-positioned div, Framer opacity transition
- World map: hand-drawn simplified SVG paths for continents (~50 path commands total)
- Stats counters: requestAnimationFrame-based countUp on intersection
- Zero new dependencies, zero new design tokens
- Patterns match existing: `font-mono text-xs uppercase tracking-[0.15em] text-emerald-400` eyebrows, `font-display font-black` headlines, `conic-border` buttons

