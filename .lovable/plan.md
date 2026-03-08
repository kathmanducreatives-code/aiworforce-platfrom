

## Apple-Style 3D Stack Animation — ExpertJourney Upgrade

### What Changes

The ExpertJourney card stack section gets upgraded from a basic sticky-recede animation to a cinematic 3D perspective stack with six enhancements:

### 1. 3D Perspective Container
- Change `.journey-cards` to add `perspective: 1200px` and `perspective-origin: 50% 40%`
- Remove per-slot perspective (currently on `.slot`) to use the shared parent perspective instead — this creates a unified 3D space

### 2. Outgoing Card 3D Recede (The "Falling Back" Effect)
- Update the scrub `onUpdate` callback: outgoing cards scale to `0.85`, fade to `opacity: 0.4`, and rotate `rotateX(-15deg)` (currently `-13deg`, `0.90` scale, `0.15` opacity)
- Add `translateZ(-100px)` to push the card visually "into" the screen
- Use `power2.inOut` easing curve via GSAP's interpolation

### 3. Reactive Background Grid
- Replace the static dot-grid background (`.journey-section` background-image) with CSS custom-property-driven vertical grid lines
- Add a `data-active-card` attribute to the section that updates via ScrollTrigger
- CSS grid lines behind the active card glow brighter (`rgba(34,197,94,0.25)`) and scale slightly via a CSS transition tied to a `.grid-glow` class
- Implement as 5-6 vertical `div` lines positioned absolutely, with a CSS transition on opacity/scaleY when the parent has the active class

### 4. Floating Sub-Elements (translateZ parallax)
- Add `transform-style: preserve-3d` to `.journey-card` and `.ui-panel`
- Add `translateZ(50px)` to inner interactive elements: `.bar-fill`, `.fit-badge`, `.profile-card`, `.available-pill`, `.recording-pill`, `.pill-paid`, `.mini-stat-val`, and `.btn-green-full`
- These elements will appear to float in front of the card surface due to the 3D perspective

### 5. Smoothing & Easing
- Set `scrub: 1` (already at 1, confirmed)
- Use `power2.inOut` for the entrance animation easing instead of the current cubic-bezier
- Add `ease: 'power2.inOut'` to the outgoing recede interpolation

### 6. Edge Rim Lighting
- Already exists (`.rim-active::after` with `rim-sweep` keyframe) — enhance it:
  - Increase highlight opacity from `0.12` to `0.18`
  - Add a second gradient layer with green tint (`rgba(34,197,94,0.08)`) for the Verdant palette
  - Slow the sweep from `1.6s` to `2.2s` for a more premium feel
  - Trigger it when the card enters center viewport (already at `top 55%`, keep)

### Files Modified
1. **`src/components/landing/ExpertJourney.tsx`** — All changes in STYLES constant and the useEffect GSAP logic

### Technical Details
- All changes are in a single file (~50 lines of CSS updates + ~20 lines of JS updates)
- No new dependencies
- `transform-style: preserve-3d` on cards enables the `translateZ` floating effect within the shared perspective container
- The reactive grid is pure CSS with a class toggle from ScrollTrigger — no per-frame DOM manipulation

