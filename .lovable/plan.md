

## Premium Animated Backgrounds and Glassmorphism Enhancement

### Overview
Upgrade the VerdantBackground component and apply premium glassmorphism + animation effects to the ICP Results page and Candidate Detail page. The current implementation has basic gradient orbs; this plan adds gradient mesh morphing, noise textures, scroll-triggered card animations, hover micro-interactions, and refined glass styling.

### Changes

#### 1. Upgrade `VerdantBackground` component (`src/components/ui/VerdantBackground.tsx`)

**Mesh mode** (used on Results page):
- Replace the current single radial-gradient animation with a multi-point gradient mesh that morphs between 4 positions over 10 seconds
- Add a second subtle layer with `#14b8a5` at 10% and `#e8fcf3` at 5%
- Keep the existing floating orbs but refine their opacity range (5-15%)
- Increase noise grain opacity from 0.03 to a visible 0.025 for depth texture

**Spotlight mode** (used on Candidate Detail page):
- Center the primary `#059467` radial gradient behind where the profile photo sits (top-center bias)
- Slow the pulsing animation from 12s to match spec (already at 12s, keep as-is)
- Add a mid-ring of `#14b8a5` at 12% opacity with offset timing
- Add subtle edge-to-center radial gradient with `#edfdf9` at 5%

#### 2. Enhance `ProfileResultCard` glassmorphism (`src/components/icp/ProfileResultCard.tsx`)

Current: `bg-white/5 backdrop-blur-[10px] border border-[#059467]/20 shadow-[0_8px_32px_rgba(5,148,103,0.12)]`

Updated:
- Keep `backdrop-blur-[10px]` and `bg-white/6` (rgba(255,255,255,0.06))
- Border: `border-[#059467]/20` (already matches spec)
- Shadow: keep `shadow-[0_8px_32px_rgba(5,148,103,0.12)]`
- Hover: already has `whileHover={{ y: -4 }}` via framer-motion and `hover:border-[#059467]/60` -- update to `hover:border-[#059467]/40` and deepen shadow to `hover:shadow-[0_12px_40px_rgba(5,148,103,0.2)]` (already present)
- Add match score badge pulse on hover: wrap the badge in a `group-hover:animate-pulse` or use framer-motion `whileHover={{ scale: [1, 1.05, 1] }}` with 600ms duration
- Add staggered fade-in animation: wrap the grid mapping with framer-motion `staggerChildren: 0.08` (80ms)

#### 3. Add staggered scroll animations to Results page grid (`src/pages/ICPResultsPage.tsx`)

- Wrap the grid `div` in a framer-motion container with `staggerChildren: 0.08`
- Each `ProfileResultCard` already has `variants` for `hidden`/`visible` -- connect them to the parent's `whileInView` trigger
- Apply `viewport={{ once: true }}` so cards animate only on first scroll into view

#### 4. Enhance Candidate Detail page sections (`src/pages/ICPCandidateDetail.tsx`)

**Profile card (left sidebar):**
- Already has `bg-white/5 backdrop-blur-md border border-[#059467]/20 shadow-[0_8px_32px_rgba(5,148,103,0.1)]`
- Increase `backdrop-blur` to `backdrop-blur-[12px]`
- Increase background to `bg-white/[0.08]` (rgba 255,255,255,0.08)
- Border to `border-[#059467]/25`
- Profile picture already has `shadow-[0_0_40px_rgba(5,148,103,0.3)]` -- add a subtle radial gradient overlay div behind it with `#059467` at 8% opacity and 60px blur

**Right-column section cards (About, Match, Career, Education, Skills, Contact):**
- Update from `bg-white/5` to `bg-white/[0.06]`
- Add `backdrop-blur-[10px]`
- Add hover state: `hover:border-[#059467]/30 hover:shadow-[0_12px_40px_rgba(5,148,103,0.15)] hover:scale-[1.02]` with `transition-all duration-250`
- Wrap each section in `motion.div` with `whileInView` fade-in + slide-up, staggered at 100ms

**Action buttons:**
- Primary buttons (Reveal Email): already `bg-primary` -- add hover gradient overlay effect using `hover:bg-gradient-to-r hover:from-[#059467] hover:to-[#14b8a5]` with 200ms transition
- Secondary/outline buttons: add `hover:bg-[#059467]/10` fill on hover

#### 5. Parallax scroll effect on Candidate Detail (`src/pages/ICPCandidateDetail.tsx`)

- Add a subtle parallax effect to the VerdantBackground by wrapping it in a container that translates Y at 25% of scroll position using a `useScroll` + `useTransform` from framer-motion
- This creates the depth effect where the background moves slower than content

### Technical Details

**Files modified (4):**

| File | Changes |
|------|---------|
| `src/components/ui/VerdantBackground.tsx` | Enhanced mesh and spotlight animations, refined opacity values, added mid-ring gradient |
| `src/components/icp/ProfileResultCard.tsx` | Added staggered animation variants, match badge hover pulse, refined glass values |
| `src/pages/ICPResultsPage.tsx` | Wrapped grid in motion container with staggerChildren, added viewport-triggered animations |
| `src/pages/ICPCandidateDetail.tsx` | Enhanced glass values on all cards, added parallax scroll, staggered section animations, button hover gradients, profile photo glow overlay |

**No new dependencies needed** -- framer-motion is already installed and provides `useScroll`, `useTransform`, `motion`, and `staggerChildren`.

**Color palette strictly maintained:**
- Primary: `#059467` (5-20% opacity for backgrounds)
- Accent teal: `#14b8a5` (for links, highlights, gradient endpoints)
- Light mint: `#e8fcf3` / `#edfdf9` (edge glows only)
- No blues, purples, or off-brand colors introduced

**Animation timing:**
- Background morph: 10s (mesh), 12s (spotlight)
- Card hover: 250ms ease-out
- Scroll-triggered fades: 400-600ms with 80-100ms stagger
- Badge pulse: 600ms scale 1.0 to 1.05 to 1.0

