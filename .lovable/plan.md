

## Premium Landing Page Redesign: Scroll-Bound Story Experience

Replace the current generic landing page with a 5-section scroll-driven narrative that tells the story of why recruiting agencies are dead and positions ScreeningPilot as the replacement. Uses GSAP ScrollTrigger for pinned scroll animations, custom fonts (Bebas Neue, Syne, JetBrains Mono), and a dark #080808 aesthetic with teal (#00e5a0) accents.

---

### Architecture Approach

Since this is a React/Vite project (not a standalone HTML file), the implementation will:
- Install `gsap` as an npm dependency (includes ScrollTrigger plugin)
- Add Google Fonts imports for Bebas Neue, Syne, and JetBrains Mono to `index.css`
- Build each section as a dedicated React component
- Replace the existing Landing page content entirely (keep Header + Footer wrapper)
- Use `useEffect` + `useRef` for GSAP initialization and cleanup

---

### Dependencies

- **Add**: `gsap` npm package (includes ScrollTrigger, no CDN needed in React)

---

### New Files to Create

| File | Purpose |
|---|---|
| `src/components/landing/HeroHook.tsx` | Section 1 — Full viewport pinned hero with typewriter headline, agency fee counter, pulsing scroll arrow |
| `src/components/landing/OldVsNewComparison.tsx` | Section 2 — Pinned 300vh scroll section with left/right comparison, center progress ring, agency dependency counter |
| `src/components/landing/BehavioralEngine.tsx` | Section 3 — Feature cards with scroll-reveal animations, stat bar with countUp |
| `src/components/landing/SocialProofMetrics.tsx` | Section 4 — 2x2 metric grid with countUp, horizontal ticker tape |
| `src/components/landing/ClosingCTA.tsx` | Section 5 — Teal background CTA with strikethrough animations |
| `src/components/landing/CustomCursor.tsx` | Custom teal dot cursor with trailing ring |
| `src/components/landing/NoiseOverlay.tsx` | SVG noise texture grain overlay component |

### Files to Modify

| File | Change |
|---|---|
| `index.html` | Add Google Fonts link for Bebas Neue, Syne, JetBrains Mono |
| `src/index.css` | Add font-face utility classes, noise texture CSS, ticker animation keyframes |
| `src/pages/Landing.tsx` | Replace all content between Header and Footer with the 5 new sections; add GSAP initialization |

---

### Section-by-Section Implementation

**Section 1 — HeroHook.tsx**
- Full viewport height, `bg-[#080808]` with SVG noise overlay
- Typewriter effect for "RECRUITING AGENCIES ARE STEALING FROM YOU" in Bebas Neue 120px (reuse existing `TypewriterText` component pattern but with GSAP for smoother control)
- Body copy in Syne 18px white
- CountUp counter from $0 to $247,000 in 2s using GSAP, displayed in Bebas Neue 80px teal
- Label in JetBrains Mono uppercase
- Pulsing down arrow with "Scroll to see a better way" text
- GSAP ScrollTrigger pin for a brief pause effect

**Section 2 — OldVsNewComparison.tsx**
- Container pinned for 300vh scroll distance via ScrollTrigger `pin: true, scrub: 1`
- Three-column layout: Old Way (left, red), Progress Ring (center), AI Way (right, teal)
- GSAP timeline with scrub: Old Way fades/slides left, AI Way fades/slides in from right
- SVG progress ring using `stroke-dasharray` / `stroke-dashoffset` animated by scroll progress
- Ring text updates at 0%, 25%, 50%, 75%, 100% thresholds
- Agency dependency counter: 100% down to 0%, then "ELIMINATED" with strikethrough
- 5 steps each side with X (red) and checkmark (teal) icons
- Mobile: stack vertically, simplify to sequential reveal

**Section 3 — BehavioralEngine.tsx**
- Normal scroll (not pinned), scroll-reveal via ScrollTrigger `start: "top 80%"`
- Section label in teal JetBrains Mono small caps
- Headline in Bebas Neue 100px
- 3 feature cards in horizontal row (stack on mobile):
  - Card 1: Brain icon — Behavioral DNA Mapping
  - Card 2: Crosshair icon — Blind Scoring Engine
  - Card 3: Zap icon — 8 Minute Shortlist
- Cards: `bg-[#0f0f0f]` border `#1e1e1e`, teal top border, 32px padding, 12px radius
- Full-width stat bar: "8 MIN", "94%", "$0" — countUp on scroll into view
- Numbers in Bebas Neue 72px teal, labels in Syne 14px grey

**Section 4 — SocialProofMetrics.tsx**
- Subtle teal radial gradient center fading to black
- 2x2 metric grid: 90% / $247K / 8 MIN / 3X — each with countUp
- Cards animate in staggered with GSAP ScrollTrigger
- Horizontal ticker tape: CSS `@keyframes ticker` infinite scroll left
- Ticker text in teal on dark background

**Section 5 — ClosingCTA.tsx**
- `bg-[#00e5a0]`, all text `#080808` — maximum contrast
- Headline in Bebas Neue 120px
- 3 comparison lines with GSAP-powered strikethrough animation on scroll into view:
  - Red text gets `line-through`, then teal replacement fades in
- CTA pill button: `bg-[#080808]` text `#00e5a0`, hover inverts
- Small mono text below button
- "screeningpilot.com" bottom right

**CustomCursor.tsx**
- Small teal dot (8px) follows mouse exactly
- Outer ring (32px) follows with slight GSAP delay (0.15s ease)
- Hidden on mobile (touch devices)
- Uses `pointer-events-none` and `fixed` positioning

---

### CSS Additions (index.css)

```text
- Font utility classes: .font-bebas, .font-syne, .font-jetbrains
- Noise texture: SVG filter-based grain overlay
- Ticker keyframes: @keyframes ticker-scroll for infinite horizontal scroll
- Custom scrollbar styling for dark sections
```

### Google Fonts (index.html)

```text
Bebas Neue (display headlines)
Syne (body/subheadlines)  
JetBrains Mono (mono labels/counters)
```

---

### Mobile Responsiveness (below 768px)

- All sections stack vertically
- Section 2 comparison: Old Way and AI Way stack vertically instead of side-by-side; progress ring scales down and sits between them
- Pin duration reduced on mobile for better UX
- Font sizes scale down: 120px to 48px, 100px to 36px, 80px to 32px, 72px to 28px
- Custom cursor hidden on touch devices
- Ticker tape remains functional

### Performance Considerations

- GSAP ScrollTrigger uses `will-change: transform` for pinned elements
- SVG progress ring uses GPU-accelerated properties only
- CountUp animations use `requestAnimationFrame` via GSAP
- Noise overlay uses CSS filter (no canvas) for minimal paint cost
- All animations respect `prefers-reduced-motion` media query

