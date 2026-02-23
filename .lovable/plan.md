

## Landing Page Premium Overhaul: Full-Screen Glass Aesthetic with Moving Animations

Transform the current flat, plain-white landing page into an immersive, full-screen experience with glassmorphism cards, animated floating elements, gradient mesh backgrounds, and smooth motion throughout -- all using the existing Verdant design system.

---

### Current Problems

- Hero section is plain white with no visual interest or depth
- Cards are flat with minimal styling
- No background animations or floating elements
- Sections don't fill the viewport properly
- No glassmorphism despite the platform using it everywhere else
- The page feels static and lifeless compared to modern SaaS landing pages

---

### What Changes

**Every section** gets:
- Full viewport height (`min-h-screen`) with centered content
- Animated gradient mesh background (subtle green radial gradients that pulse slowly)
- Floating glass orbs/particles in the background for depth
- Glassmorphism treatment on all cards and containers

---

### File-by-File Changes

#### 1. `src/pages/Landing.tsx`
- Add an animated background layer with floating gradient orbs (3-4 circles with `bg-primary/10` that drift with CSS keyframes)
- Add a subtle grid pattern overlay for texture
- Ensure `overflow-hidden` on the root container

#### 2. `src/components/landing/HeroHook.tsx`
- Make truly full-screen with `h-screen` instead of `min-h-screen`
- Add animated gradient mesh background: radial gradient from `primary/5` at center fading out, with a slow pulsing animation (10s cycle)
- Wrap counter in a glassmorphism container: `backdrop-blur-xl bg-card/40 border border-primary/20 rounded-2xl shadow-lg p-8`
- Add floating decorative elements: 2-3 small glass circles that float up/down with staggered CSS animations
- Typewriter headline gets a subtle gradient text effect on the word "STEALING" using `bg-gradient-to-r from-destructive to-destructive/70 bg-clip-text text-transparent`
- Scroll arrow gets a glass pill container around it
- GSAP: add parallax effect -- headline moves slightly slower than body content on scroll

#### 3. `src/components/landing/OldVsNewComparison.tsx`
- Old Way panel: wrap in a glass card with `backdrop-blur-md bg-destructive/5 border border-destructive/20 rounded-2xl p-6`
- New Way panel: wrap in a glass card with `backdrop-blur-md bg-primary/5 border border-primary/20 rounded-2xl p-6`
- Progress ring: add a glowing glass backdrop behind it (`backdrop-blur-xl bg-card/30 rounded-full p-6 border border-border/30`)
- Each step animates in individually with staggered GSAP reveals as scroll progresses (not just the panels fading)
- Add subtle connecting lines between the ring and the panels (decorative borders)
- Background: add a very subtle radial gradient from `primary/3` at center

#### 4. `src/components/landing/BehavioralEngine.tsx`
- Section becomes `min-h-screen flex flex-col justify-center`
- Feature cards get full glassmorphism: `backdrop-blur-md bg-card/60 border border-border/30 shadow-xl hover:shadow-2xl hover:border-primary/30 hover:-translate-y-2 transition-all duration-500`
- Card icons get animated glass circles behind them: `w-14 h-14 rounded-xl bg-primary/10 backdrop-blur-sm border border-primary/20 flex items-center justify-center`
- On hover, cards get a subtle shine sweep animation (the `premium-shine` keyframe already exists in CSS)
- Stat bar numbers get glass pill containers
- Add floating decorative dots in the background (3-4 small `bg-primary/20 rounded-full` elements with `animate-float`)
- GSAP: cards slide up with rotation (slight 3D tilt that corrects on arrival)

#### 5. `src/components/landing/SocialProofMetrics.tsx`
- Full `min-h-screen` with centered content
- Background: animated radial gradient mesh -- two overlapping radial gradients from `primary/5` that slowly shift position with CSS animation
- Metric cards get glassmorphism: `backdrop-blur-md bg-card/50 border border-border/30 rounded-2xl shadow-lg hover:shadow-xl hover:border-primary/20 transition-all duration-400`
- Each metric number gets a subtle glow effect: `text-shadow: 0 0 30px hsl(var(--primary) / 0.3)`
- Ticker tape gets a glass track: `bg-card/30 backdrop-blur-sm border-y border-border/30`
- GSAP: metric cards stagger in with scale (0.9 to 1) plus fade

#### 6. `src/components/landing/ClosingCTA.tsx`
- Full `min-h-screen` with centered content
- Add animated background pattern: subtle diagonal lines or dots pattern overlay at 3% opacity
- CTA button gets a glass effect with animated border glow on hover
- The comparison lines get glass pill containers
- Add a large decorative glass circle in the background (50% opacity, blurred, slowly rotating)
- Button hover: add the glow shadow `shadow-[0_0_40px_hsl(var(--primary)/0.3)]`

#### 7. `src/components/landing/CustomCursor.tsx`
- Outer ring gets `backdrop-blur-sm` for a glass feel
- Add a subtle trail effect: third element that follows with even more delay and lower opacity

#### 8. `src/index.css` -- Add new keyframes
- `@keyframes float-slow`: translateY 0 to -20px to 0 over 8s
- `@keyframes float-gentle`: translateY 0 to -15px to 0 over 12s, with slight X movement
- `@keyframes mesh-shift`: background-position shift for gradient mesh movement over 10s
- `@keyframes glass-shine`: a sweep effect for card hover states
- Utility classes: `.glass-panel`, `.glass-card-landing`, `.floating-orb`

#### 9. `src/components/landing/NoiseOverlay.tsx`
- Increase opacity slightly to `0.04` for more visible texture on the light background
- Add a subtle gradient overlay on top (transparent to `background/10`) for depth

---

### Animation Summary

| Element | Animation | Duration | Trigger |
|---|---|---|---|
| Background orbs | Float up/down + drift | 8-12s loop | Always |
| Hero headline chars | Typewriter reveal | 50ms stagger | On load |
| Hero body text | Fade up | 800ms | On load, 1.5s delay |
| Counter value | Count up | 2s | On load, 2s delay |
| Feature cards | Slide up + fade | 600ms | Scroll into view, 150ms stagger |
| Card hover | Lift + shine sweep | 500ms | Mouse hover |
| Metric numbers | Count up + scale | 1.8s | Scroll into view |
| Metric cards | Scale in + fade | 600ms | Scroll, 100ms stagger |
| Progress ring | Stroke fill | Scrubbed | Scroll position |
| Comparison panels | Slide + fade | Scrubbed | Scroll position |
| Strikethrough lines | Line-through + replace | 600ms | Scroll into view, 300ms stagger |
| Ticker tape | Infinite scroll left | 30s loop | Always |
| CTA button glow | Border glow pulse | 300ms | Hover |

---

### Technical Details

- All glassmorphism uses `backdrop-blur-md` (12px) or `backdrop-blur-xl` (24px) with semi-transparent backgrounds
- Floating orbs use CSS animations only (no GSAP overhead for decorative elements)
- GSAP remains for scroll-bound animations (pinning, scrub, countUp)
- New CSS keyframes added to `index.css` for float/mesh/shine effects
- All hover transitions use `transition-all duration-300` or `duration-500` for smoothness
- Glass borders use `border-primary/20` or `border-border/30` for subtlety
- No new dependencies required

