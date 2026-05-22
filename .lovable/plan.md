# Pass 1 — Foundation: Design Tokens + Sidebar Restructure

Two jobs. Additive only. No visual changes to components, dashboard, chat, or landing.

---

## Pre-flight findings (read before write)

### `tailwind.config.ts` current state
- **Backgrounds**: `background: #080B0F`, `card/popover: #0D1117`, `muted: #131920`, `surface-elevated: #131920`, `surface-hover: #1A2332`
- **Borders**: `border: rgba(255,255,255,0.10)`, `border-subtle: rgba(255,255,255,0.06)`, `border-accent: rgba(16,185,129,0.30)` — note: the names the user asked for (`border-hairline`, `border-soft`, `border-active`) overlap semantically with these.
- **Fonts**: `sans: DM Sans`, `serif: Instrument Serif`, `mono: JetBrains Mono`
- **Shadows**: `xs/sm/md/lg/xl/2xl: none`, `primary/primary-lg/emerald-glow` for green glow, `glow` for white
- **No backdrop-blur custom utilities** — uses Tailwind defaults

### `src/index.css` current state
- **Existing glass utilities** (already proliferating — this is the problem the user wants to prevent):
  - `.glass` — rgba(255,255,255,0.04) + blur(24px) + border 0.06 + heavy shadow
  - `.glass-strong` — rgba 0.06 + blur(32px) + border 0.08
  - `.glass-panel` — landing-only, uses hsl tokens + blur(24px)
  - `.glass-card-landing` — landing-only, blur(12px)
- **Typography utilities**: `.font-display` (Inter Tight, -0.02em), `.font-jetbrains`, `.font-label` (11px uppercase mono-feel, but uses Inter not JetBrains)
- **Body**: no explicit body class; Tailwind default + `--font-sans` which is **Work Sans** in `:root` and **Inter Tight** in `.dark`. Confirmed.
- **Spacing**: `--spacing: 0.25rem` (4px base), standard Tailwind scale (no custom extensions in config)
- **Inconsistency to flag**: memory says HSL-only, but `tailwind.config.ts` uses hex literals for `background`, `card`, `primary`, etc. Also `--background` in `[data-theme="dark"]` is `0 0% 1% / 0` (transparent alpha) which is unusual. Not fixing this pass.

### `src/components/Sidebar.tsx` current state
- 5 groups (Hire, Departments, Find, Engage, Insights), 22 visible items + 3 bottom utilities
- Row height: `h-8` (32px) — below user's 36-40px target
- Section labels: use `.font-label` already
- Group spacing: `mt-5` (20px) between groups — below user's 24px target

---

## JOB 1 — Design tokens (additive)

### Edit `tailwind.config.ts` (extend, don't replace)

Add under `theme.extend.colors`:
```ts
'layer-0': '#000000',
'layer-1': '#0A0A0A',
'layer-2': '#131313',
'layer-3': 'rgba(255,255,255,0.04)',
'border-hairline': 'rgba(255,255,255,0.06)',
'border-soft': 'rgba(255,255,255,0.10)',
'border-active': 'rgba(16,185,129,0.40)',
```

**Collision note**: existing `border-subtle` (0.06) ≈ new `border-hairline`; existing `border` (0.10) ≈ new `border-soft`; existing `border-accent` (0.30) ≈ new `border-active` (0.40). I'll add the new names **alongside** the old ones (not overwrite). Flag for user to consolidate in a later pass.

### Edit `src/index.css` — append to the "Premium SaaS visual layer" section

```css
/* === Pass 1: v2 design system tokens === */

/* Single-source glass utility — use this going forward */
.glass-surface {
  background: rgba(255, 255, 255, 0.04);
  backdrop-filter: blur(24px);
  -webkit-backdrop-filter: blur(24px);
  border: 1px solid rgba(255, 255, 255, 0.08);
  box-shadow: inset 0 1px 0 0 rgba(255, 255, 255, 0.04);
}

/* Display type scale */
.text-display-lg {
  font-family: 'Inter Tight', 'Inter', system-ui, sans-serif;
  font-size: clamp(48px, 5vw, 56px);
  font-weight: 600;
  line-height: 1.05;
  letter-spacing: -0.02em;
}
.text-display-md {
  font-family: 'Inter Tight', 'Inter', system-ui, sans-serif;
  font-size: clamp(32px, 3vw, 36px);
  font-weight: 600;
  line-height: 1.1;
  letter-spacing: -0.015em;
}
.text-display-sm {
  font-family: 'Inter Tight', 'Inter', system-ui, sans-serif;
  font-size: clamp(22px, 2vw, 24px);
  font-weight: 600;
  line-height: 1.2;
  letter-spacing: -0.01em;
}

/* Mono labels (timestamps, IDs, system data) */
.text-mono-label {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 11px;
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: 0.08em;
}
```

**No collisions** — `.glass-surface`, `.text-display-*`, `.text-mono-label` are all new names. `.font-label` stays (similar but Inter-based; will deprecate later).

### Existing glass treatments to flag (not migrate)
- `.glass`, `.glass-strong`, `.glass-panel`, `.glass-card-landing` — all live in `index.css`
- Many components use ad-hoc `backdrop-blur-* + bg-white/X + border-white/X` — will inventory in Pass 2

---

## JOB 2 — Sidebar restructure

### Edit `src/components/Sidebar.tsx`

Replace `navGroups` array with 4 groups in this order:

**Workspace**
- Dashboard `/dashboard` (LayoutDashboard)
- Awaiting You `/awaiting-you` (Inbox, badge "4" amber)
- Conversations `/dashboard` (Mail icon) — with `// TODO: route to /conversations in later pass`

**Workforce**
- Talent `/rooms/talent` (Sparkles)
- Growth `/rooms/growth` (Megaphone)
- Intelligence `/rooms/intelligence` (Eye)
- Content `/rooms/content` (BookOpen)
- + New Agent button (existing modal trigger — preserve as-is)

**Intelligence**
- Lead Scraper `/lead-scraper` (Search)
- ICP Intelligence `/icp-intelligence` (Target)
- Deep Search `/deep-search` (Brain)
- Growth Signals `/growth-signals` (TrendingUp)
- Talent Intel `/talent-intel` (Users)
- Competitor Intel `/competitor-intel` (Eye)
- Analytics `/analytics` (BarChart3)

**Settings**
- Interviews `/interview-scheduler` (Calendar) — moved from Hire
- Email Sequences `/email-sequences` (Mail) — moved from Engage

**Decision on bottom utility row**: keep Help & Support / Sign Out / Collapse in the existing bottom utility row (under the border-t). Reason: Sign Out and Collapse are app-shell controls, not "Settings" links. Cleaner mental model.

### Items hidden from primary nav (routes preserved in codebase)
Job Screening, Candidates, Expert Interviews, Job Distribution, Post Interceptor, Lead CRM, Job Tracker.

### Minimal visual changes (this pass only)
- Section labels: swap `font-label` → `text-mono-label` (new utility)
- Row height: `h-8` → `h-9` (36px) — hits the 36-40px target
- Group spacing: `mt-5` (20px) → `mt-6` (24px)
- No color, icon, badge, or active-state changes

---

## Verification
- Run `npx tsc --noEmit`. Report results.
- No new npm dependencies.
- No git push.

---

## Final summary block (delivered after execution)
Will contain: Tokens added, Tokens NOT added (collisions), Sidebar items hidden, Sidebar items moved, Files modified, Anything unexpected, Ready to verify line.

---

## One question before I execute

**Conversations link target**: you said "for now, link to /dashboard with a TODO comment". Confirm — or would you prefer it disabled (visible but `disabled` styling, no nav) so users don't get confused by clicking it and landing on Dashboard? I'll default to your stated `/dashboard + TODO` if no preference.
