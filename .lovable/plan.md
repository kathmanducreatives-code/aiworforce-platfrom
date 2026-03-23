

## Ecosystem Section — Graphics, Interactivity & Real Logos Optimization

### Problem
1. **Logo URLs are unreliable** — many use `worldvectorlogo.com` and GitHub avatars that may fail to load or look blurry
2. **Limited interactivity** — hover shows a tooltip but there's no click interaction, no detail panel, no visual feedback beyond glow
3. **Orbital graphics are flat** — no depth cues, energy pulses are subtle, ring lines are barely visible

---

### Plan

#### 1. Replace all logo URLs with reliable, high-quality sources
Update `ToolLogos.tsx` `TOOL_BRANDS` registry with verified logo URLs:
- **Claude**: `https://mintlify.s3.us-west-1.amazonaws.com/anthropic/logo/light.svg` or use the official Anthropic mark
- **GPT-4/OpenAI**: `https://cdn.openai.com/API/logo-OpenAI.svg`
- **Gemini**: Google's official Gemini sparkle SVG (current URL is valid)
- **Perplexity**: Use `https://pplx-res.cloudinary.com/image/upload/v1679430919/pplx-icon.png`
- **Notion, Linear, GitHub, Canva**: Use `https://logo.clearbit.com/{domain}` (e.g. `notion.so`, `linear.app`, `github.com`, `canva.com`) — 128px crisp PNGs
- **Firecrawl, Apify, ElevenLabs, Replicate, Cal.com, Gamma, Instantly, Hunter.io**: Use Clearbit where available, fallback to GitHub avatar URLs at `?s=200`
- Increase default `ToolLogoImage` render size to ensure crisp display (logos currently render at `size * 0.55` which can be as small as 26px — bump logo sizes in orbital tools to ensure minimum 36px rendered)

#### 2. Add click-to-select interactivity with detail panel
- **Click a tool node** → it becomes "selected" (new `selectedTool` state)
- Selected tool gets a bright ring + scale(1.2) + all other tools dim
- A **detail card** slides in below the orbital (or overlaid on mobile):
  - Tool logo (large, ~48px), name, sublabel
  - Description text
  - Department badges
  - A "Used by" row showing which Pilot agents use this tool (e.g. "Scout, Aria, Radar")
  - A subtle animated connection line highlights from center Pilot to the selected tool
- Click again or click elsewhere to deselect
- On mobile grid: tap a tool card to expand an inline detail row beneath it

#### 3. Improve orbital ring graphics
- **Ring circles**: increase stroke opacity from `0.04` to `0.08`, add a subtle `strokeDasharray="2 8"` for a dotted-ring look
- **Radial lines to center**: add animated dash flow using CSS `stroke-dashoffset` animation (data flowing toward center)
- **Energy pulses**: make them larger (w-3 h-3), add a trail effect with a second delayed pulse element
- **Glow rings**: add a faint outer glow ring per orbital (a second circle with `filter: blur(4px)` and green tint)

#### 4. Add scroll-triggered entrance choreography
- When section enters viewport:
  - Center "Pilot Brain" scales in first (0s)
  - Ring 1 tools fade in with stagger (0.3s)
  - Ring 2 tools fade in (0.6s) — already partially implemented
  - Ring 3 tools fade in (0.9s)
  - Connection lines draw in via `stroke-dashoffset` after all nodes visible (1.2s)
  - Stats count up last (1.5s)

#### 5. Department tab enhancements
- When switching tabs, non-matching tools smoothly scale down to 0.6 and fade to 0.1 opacity (currently 0.15 — too visible)
- Active department tools get a colored ring matching department color (not just the brand color)
- Cross-connection lines for the active department pulse with a traveling dot animation

#### 6. Mobile grid improvements
- On tap, expand the tapped tool into a wider card spanning 2 columns showing description + departments
- Add a subtle shimmer/gradient animation on the grid cards on load

---

### Files Modified
| File | Changes |
|------|---------|
| `src/components/landing/ToolLogos.tsx` | Update all logo URLs to reliable sources (Clearbit + verified CDNs) |
| `src/components/landing/EcosystemSection.tsx` | Add `selectedTool` state, detail panel, improved ring graphics, animated connection lines, mobile tap-to-expand, entrance choreography refinements |

### Technical Notes
- All Clearbit logos use `https://logo.clearbit.com/{domain}?size=128` — fast, reliable, crisp
- The existing `onError` fallback to letter-initial remains as safety net
- Click interactions use `onClick` on the same elements that already have `onMouseEnter/Leave`
- No new dependencies needed — uses existing Framer Motion + CSS animations

