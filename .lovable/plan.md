

# Plan: Redesign Ecosystem + Workforce Team Sections

## Scope
Rewrite 2 existing files + update 1 file. No other sections touched.

## Files Changed

| File | Change |
|------|--------|
| `src/components/landing/ToolLogos.tsx` | Full rewrite — 16 SVG logos with proper brand colors and recognizable geometric icons |
| `src/components/landing/EcosystemSection.tsx` | Full rewrite — orbital system with 3 rings, CSS rotation, energy pulses, breathing center, hover dimming, department filter tabs |
| `src/components/landing/MeetTheTeamSection.tsx` | Full rewrite — war room interface with fake chrome bar, sidebar, auto-cycling message feed, 9 agent profile cards, redesigned truth blocks |

No changes to `Landing.tsx` — both sections stay in the same render positions (slots 4 and 6).

---

## Section 1: Ecosystem — "The Neural Network"

### ToolLogos.tsx Rewrite
Each logo gets proper brand colors baked into the SVG (not just letter avatars):
- Claude: terracotta circle (#CC785C) with flowing C curves
- Gemini: blue-red gradient diamond/star shape
- GPT-4: OpenAI green (#10A37F) with lotus/flower mark
- Perplexity: teal (#20808D) with P mark
- Firecrawl: flame orange-red (#FF4500) flame shape (keep existing, it's good)
- Apify: bright green (#97D700) A mark
- Hunter: orange (#F5A623) crosshair/target
- Instantly: indigo (#6366F1) lightning bolt
- ElevenLabs: dark (#1A1A2E) with sound bars (keep existing)
- Replicate: dark (#393939) play triangle
- Notion: white with dark N (keep existing)
- Linear: purple (#5E6AD2) angular mark (keep existing)
- GitHub: dark with octocat path (keep existing)
- Cal.com: dark with calendar grid (keep existing)
- Canva: teal (#00C4CC) C mark
- Gamma: purple (#6C47FF) G mark

### EcosystemSection.tsx — Orbital Layout

**Structure:**
- Center: 100px Pilot Brain node with green glow (`box-shadow: 0 0 60px rgba(0,255,148,0.3)`), breathing animation (CSS `alternate infinite`)
- Ring 1 (r=180px): Claude, Gemini, GPT-4, Perplexity — 72px nodes
- Ring 2 (r=280px): Firecrawl, Apify, Hunter, Instantly — 60px nodes  
- Ring 3 (r=380px): 8 remaining tools — 48-52px nodes
- Container: 800px diameter on desktop

**CSS Orbital Rotation:**
- 3 wrapper divs, each with CSS `animation: spin Xs linear infinite`
- Ring 1: 120s CW, Ring 2: 90s CCW (`reverse`), Ring 3: 150s CW
- Each node inside has counter-rotation: `animation: counter-spin Xs linear infinite` to stay upright
- Use CSS custom properties for duration per ring

**Energy Pulses (JS):**
- `useEffect` with `setInterval` every 500ms, randomly selects a tool
- Creates a small colored dot (div) that CSS-animates from tool position to center over 1.2s
- Max 6 concurrent pulses, uses a ref array to track active ones
- Pulse color matches tool's brand color

**Node Entrance Animation:**
- IntersectionObserver triggers `inView`
- Ring 1 nodes: Framer Motion `scale: 0→1, opacity: 0→1` delay 0.3s
- Ring 2: delay 0.6s
- Ring 3: delay 0.9s
- Each node within a ring staggered by 0.08s

**Hover Interaction:**
- `hoveredTool` state
- Hovered node: `scale-110`, stronger glow via inline `boxShadow` in brand color
- All other nodes: `opacity: 0.4` via CSS transition
- Tooltip: dark card above node showing name, description, department pill (colored by dept)
- Connection line from hovered tool to center brightens (rendered as an absolutely-positioned div or SVG line)

**Department Filter Tabs:**
- Same tab row as before, same mapping
- When filtered: non-matching tools get `opacity: 0.15, scale: 0.85` via Framer Motion `animate`
- Transition 400ms

**Mobile (<768px):**
- Replace orbital with 4-column grid of tool cards
- Each card: tool logo (40px) + name + sublabel
- Brand colors preserved
- No rotation animations
- Pilot Brain card at top, larger

**Stats + Closing:** Keep existing content, same layout.

---

## Section 2: Workforce Team — "The War Room"

### MeetTheTeamSection.tsx — Complete Rewrite

**Headline:**
- Eyebrow: "YOUR AI WORKFORCE"
- Headline: "Meet the team running your company right now."
- Subheadline: agent roles + €149/month line

**War Room Interface (Desktop):**
Dark card container, max-w-[1100px], rounded-xl border.

- **Top Chrome Bar:** 3 colored dots (red/yellow/green) + "ScreeningPilot Internal · 5 agents online" + green dot "All systems active" — monospace 12px
- **Left Sidebar (~200px):** Department list with colored dots + agent count. Below: "AGENTS ONLINE" with small name list. Hidden on tablet/mobile.
- **Main Feed Area:** Shows messages auto-cycling.

**Message Feed System:**
- 8 messages defined in a data array (Signal, Radar, Penn, Scout, Hawk, Quill, Relay, Brief)
- Each message: agent avatar (36px circle, dept color), agent name, dept tag, time, tool pills (20px brand-colored circles from ToolLogos), message text, "Passed to" indicator
- `useState` tracks `visibleMessages` array (max 4 visible)
- `useEffect` with `setInterval(2200ms)` adds next message, removes oldest when >4
- Framer Motion `AnimatePresence` for enter (slide up 20px, fade in) and exit (fade out at top)
- Top of feed has a gradient overlay (`bg-gradient-to-b from-[#0a0e14] to-transparent`) to fade out old messages
- Loop restarts at message 8 → back to 1 after 18s total
- Agent dot in sidebar pulses when that agent sends a message (track via `activeAgent` state)

**Responsive War Room:**
- Tablet (768-1024): hide sidebar, show dept names as horizontal tabs above feed
- Mobile (<768): full-width feed only, 3 messages visible, reduced padding

**Agent Profile Cards (Below War Room):**
- 9 cards in 3-col grid (desktop), 2-col (tablet), 1-col (mobile)
- Each card: avatar (44px, lucide icon, dept-colored bg), name, title, department, job description, tool logos row (24px brand-colored circles), "Talks to" line
- ACTIVE badge: green dot + text
- Framer Motion `whileInView` stagger 0.08s per card, `viewport={{ once: true, margin: "-50px" }}`

**Agent Data (9 agents):**
- Talent: Scout (Search), Aria (MessageSquare), Lens (Eye)
- Growth: Radar (Radio), Penn (PenLine), Relay (Send)
- Intelligence: Hawk (Target), Signal (TrendingUp), Brief (FileText)
- Each with: tools used (reference ToolLogos), "talks to" connections

**Department Colors:**
- Talent: `emerald-400`
- Growth: `blue-400`
- Intelligence: `amber-400`
- Content: `purple-400`

**Three Truth Blocks:** Brain, GitBranch, Crown icons — same pattern as before but with updated copy per spec.

**Closing:** New quote text + CTA button, same `conic-border` style.

**Collaboration Feed Ticker:** Removed (replaced by war room feed). Or kept below as secondary — will remove to avoid redundancy with the war room.

---

## Technical Notes
- All Framer Motion `whileInView` uses `viewport={{ once: true, margin: "-50px" }}`
- CSS orbital rotation: pure `@keyframes` in inline `<style>` tag within the component (or Tailwind arbitrary `animate-[spin_120s_linear_infinite]`)
- Energy pulses: absolutely positioned divs with CSS transition, managed via refs for cleanup
- No new dependencies
- Tool brand colors are constants in ToolLogos.tsx, exported for reuse in both sections
- Total estimated: ~400 lines EcosystemSection, ~500 lines MeetTheTeamSection, ~200 lines ToolLogos

