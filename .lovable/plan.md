

## Landing Page Theme Alignment: Match the Software's White-and-Green Identity

The current landing page uses a hardcoded dark aesthetic (#080808 black, #00e5a0 teal, Bebas Neue/Syne/JetBrains Mono fonts) that clashes with the main software's clean white-and-green Verdant theme using Work Sans, Lora, and Inconsolata. This update brings the entire landing page into visual harmony with the authenticated experience.

---

### What Changes

**Fonts**: Replace all `font-bebas`, `font-syne`, `font-jetbrains` classes with the software's standard font stack:
- Headlines: `font-sans font-bold` (Work Sans Bold)
- Body text: `font-sans` (Work Sans)
- Metrics/labels: `font-mono` (Inconsolata)

**Colors**: Replace all hardcoded hex values with semantic design tokens:
- `#080808` backgrounds become `bg-background`
- `#00e5a0` accents become `text-primary`
- `#0f0f0f` card backgrounds become `bg-card`
- `#1e1e1e` borders become `border-border`
- `text-white` becomes `text-foreground`
- `text-white/70` becomes `text-muted-foreground`

**Overall feel**: Clean, professional SaaS page that uses the same visual language as the dashboard — not a separate aesthetic island.

---

### Files to Modify

| File | Changes |
|---|---|
| `src/pages/Landing.tsx` | Replace hardcoded `backgroundColor: '#080808'` with `bg-background` |
| `src/components/landing/HeroHook.tsx` | Swap all fonts to Work Sans/Inconsolata, replace hex colors with tokens, update `NoiseOverlay` opacity for light backgrounds |
| `src/components/landing/OldVsNewComparison.tsx` | Replace #080808 bg, #00e5a0 accents, Bebas/Syne/JetBrains fonts with tokens |
| `src/components/landing/BehavioralEngine.tsx` | Replace card hardcoded styles with `bg-card border-border border-t-primary`, swap fonts |
| `src/components/landing/SocialProofMetrics.tsx` | Replace radial gradient hex with primary token-based gradient, swap fonts |
| `src/components/landing/ClosingCTA.tsx` | Change `#00e5a0` background to `bg-primary`, update text/button contrast using `text-primary-foreground`, swap fonts |
| `src/components/landing/CustomCursor.tsx` | Replace hardcoded teal with `hsl(var(--primary))` |
| `src/components/landing/NoiseOverlay.tsx` | Adjust opacity for light theme readability |

---

### Section-by-Section Detail

**Section 1 -- Hero Hook**
- Background: `bg-background` (white in light mode)
- Headline: `font-sans font-bold text-foreground` at same responsive sizes
- Body text: `font-sans text-muted-foreground`
- Counter: `font-mono text-primary` with `shadow-glow` instead of hardcoded teal glow
- Scroll arrow: `text-primary`

**Section 2 -- Old vs New Comparison**
- Background: `bg-background`
- "OLD WAY" label: `text-destructive` (uses the theme's red token)
- "SCREENING PILOT WAY" label: `text-primary`
- Steps text: `font-sans text-muted-foreground`
- SVG ring stroke: `hsl(var(--primary))` and `hsl(var(--border))` for track
- Dependency counter: `font-mono`

**Section 3 -- Behavioral Engine**
- Background: `bg-background`
- Section label: `font-mono text-primary uppercase`
- Cards: `bg-card border border-border border-t-2 border-t-primary rounded-xl`
- Card titles: `font-sans font-bold text-foreground`
- Card body: `font-sans text-muted-foreground`
- Stat numbers: `font-mono text-primary` at large sizes
- Stat labels: `font-sans text-muted-foreground`

**Section 4 -- Social Proof Metrics**
- Background: subtle radial gradient using `hsl(var(--primary) / 0.06)` fading to `bg-background`
- Metric numbers: `font-mono text-primary`
- Labels: `font-sans text-foreground/80`
- Ticker: `text-primary` on `border-border` track

**Section 5 -- Closing CTA**
- Background: `bg-primary` (the theme's green)
- All text: `text-primary-foreground`
- CTA button: `bg-background text-primary` with hover invert
- Comparison strikethroughs: `text-destructive` for old, `text-primary-foreground font-bold` for new

**Custom Cursor**
- Dot and ring colors: use CSS custom property `hsl(var(--primary))` instead of hardcoded teal

---

### Technical Notes

- The Bebas Neue / Syne / JetBrains Mono Google Fonts import line in `index.html` can be removed (or left for now since it causes no harm)
- The `.font-bebas`, `.font-syne`, `.font-jetbrains` utility classes in `index.css` will no longer be used but can be cleaned up
- All GSAP ScrollTrigger logic, pinning, scrub, and animation timelines remain exactly the same -- only visual styling changes
- Inline `style={{ color: '#00e5a0' }}` and `style={{ backgroundColor: '#080808' }}` replaced with Tailwind classes using design tokens
- Counter glow effects use `var(--shadow-glow)` or `shadow-[0_0_40px_hsl(var(--primary)/0.3)]`

