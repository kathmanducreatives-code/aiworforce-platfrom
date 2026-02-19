
## Premium UI Redesign: Job Screening Feature

The current screening UI uses basic Card/Badge/Button components with no visual hierarchy or premium feel. The goal is to elevate it to match the platform's established premium SaaS aesthetic — glassmorphism, glowing accents, staggered animations, and information-dense but visually clear layouts — consistent with ICP Manager and Lead Scraper pages.

---

### Visual Audit of Current Issues

| Component | Current Problem | Fix |
|---|---|---|
| `ScreeningJobs.tsx` | Plain page header, basic "Loading..." text, flat card list | Add gradient header with stats bar, animated skeleton states, better empty state |
| `JobCard.tsx` | Flat white card, icon-only buttons with no context, no visual weight | Glassmorphism card with gradient accent bar, labeled action buttons, animated hover |
| `CreateJobForm.tsx` | Bare form inside a generic card | Collapsible/expandable panel with step-feeling, premium inputs, better spacing |
| `ApplicantCard.tsx` | Plain card with small text, no avatar/initials | Initials avatar, score ring, rich strengths/flags display, premium hover |
| `JobApplicants.tsx` | Flat stat cards, basic tabs | Glowing stat cards with icons, gradient header, animated filter tabs |
| `ApplicantDetailModal.tsx` | Unstyled dialog with generic gray background | Full-width dark modal, colored tab bar, structured info blocks, premium action CTA |
| `InterviewQuestionsPanel.tsx` | Plain border list items | Numbered cards with gradient left bar, category indicators |

---

### Implementation Plan by File

**1. `src/pages/ScreeningJobs.tsx`**
- Add a premium gradient page header with an icon glyph background, subtitle, and stats summary row (total jobs, total applicants, active/paused counts)
- Replace `<p>Loading...</p>` with animated skeleton cards (3 placeholder cards)
- Replace `<p>No screening jobs yet</p>` with a visual empty state illustration using icons, heading, and a CTA arrow pointing to the form above
- Give the "Your Screening Jobs" section header a count badge and a subtle separator line

**2. `src/components/screening/JobCard.tsx`**
- Redesign as a premium glassmorphism card: `bg-card/60 backdrop-blur-sm border-border/50`
- Add a colored left accent bar (green=active, gray=paused) using `absolute` positioning
- Add candidate initials-style visual on the left (briefcase icon in a colored rounded square)
- Show application counts as mini stat pills in a row: green chip for Strong, amber for Good, etc.
- Replace icon-only ghost buttons with a proper action row: "View Applicants" as a primary outlined button (full label visible), and a `MoreHorizontal` dropdown for Copy Link / Pause / Delete
- Add `hover:-translate-y-0.5 hover:shadow-lg hover:shadow-primary/5` to the card
- Show a subtle "Active" / "Paused" badge with a glowing dot indicator

**3. `src/components/screening/CreateJobForm.tsx`**
- Wrap in a premium card with `bg-card/60 backdrop-blur-sm`
- Add a section stepper feel: number the logical groups (1. Basics, 2. Requirements, 3. Questions)
- Skills input: style the skill badges with `bg-primary/10 text-primary border-primary/20`
- Success state: upgrade to a full-width celebration block with animated checkmark ring, the URL in a code-styled input, and a "Share on LinkedIn" hint text
- Add smooth `animate-in slide-in-from-bottom-2` to the form card

**4. `src/components/screening/ApplicantCard.tsx`**
- Add an initials avatar (gradient circle with candidate's initials, same pattern as `CandidateCard.tsx`)
- Replace flat card with glassmorphism: `rounded-xl border bg-card/60 backdrop-blur-sm hover:-translate-y-0.5 hover:shadow-lg`
- Add a colored top accent bar that changes color based on match category (emerald/amber/red/gray)
- Show match score as a bold number badge in the top-right corner styled like a score ring
- Style strengths as green pills with check icons, red flags as red warning items
- Footer: clean time/tab-switch row with icon chips, "View Details" as a full-labeled button

**5. `src/pages/JobApplicants.tsx`**
- Add a premium header with back button, job title, company name, and a status badge (Active/Paused)
- Stat cards: upgrade with glassmorphism, colored backgrounds per category, larger numbers, subtle glow border
- Filter tabs: style the active tab with primary color background and glow, add transition animations
- Empty/loading states: use skeleton cards instead of plain text

**6. `src/components/screening/ApplicantDetailModal.tsx`**
- Upgrade DialogContent: add subtle gradient background overlay, wider on large screens
- Header: add a gradient avatar circle with initials, score as a styled badge, and a colored fit pill
- Tab bar: style each tab with icons and labels, active tab with primary underline glow
- Overview tab: strengths and flags in structured labeled sections with colored left borders
- Q&A tab: each Q&A block as an elevated card with score badge, question in bold, answer in muted bg block
- Interview tab: already delegated to `InterviewQuestionsPanel`
- Actions tab: "Next Steps" block with gradient border and clearer CTA styling

**7. `src/components/screening/InterviewQuestionsPanel.tsx`**
- Number each question card with a bold circular counter badge (emerald)
- Add a left gradient border accent to each question card
- "Why" context text in a styled italic muted section
- Copy/Print buttons: upgrade to icon + label with premium outline style

---

### Design Tokens Used (Consistent with Platform)

```text
Cards:          bg-card/60 backdrop-blur-sm border-border/50 rounded-xl
Hover:          hover:-translate-y-0.5 hover:shadow-lg hover:shadow-primary/5 hover:border-primary/30
Strong Fit:     bg-emerald-500/15 text-emerald-400 border-emerald-500/30
Good Fit:       bg-amber-500/15 text-amber-400 border-amber-500/30
Not Qualified:  bg-destructive/15 text-destructive border-destructive/30
Primary accent: text-primary, bg-primary/10, border-primary/20
Animations:     animate-in fade-in duration-300, slide-in-from-bottom-2
```

---

### Files Modified

| File | Scope |
|---|---|
| `src/pages/ScreeningJobs.tsx` | Header, stats, skeleton, empty state |
| `src/components/screening/JobCard.tsx` | Full premium card redesign |
| `src/components/screening/CreateJobForm.tsx` | Form polish + success state |
| `src/components/screening/ApplicantCard.tsx` | Avatar, score ring, accent bar |
| `src/pages/JobApplicants.tsx` | Header, stat cards, tabs |
| `src/components/screening/ApplicantDetailModal.tsx` | Modal header, tabs, content blocks |
| `src/components/screening/InterviewQuestionsPanel.tsx` | Numbered cards, accent bars |
