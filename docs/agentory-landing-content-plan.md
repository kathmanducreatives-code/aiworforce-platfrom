# Agentory Landing Page — Final Content Plan & Implementation Checklist

**Status:** LOCKED — awaiting approval. Nothing implemented.
**Branch:** `feat/lead-mission-v1`
**Scope:** Content, copy, labels, claims, SEO, and two approved component reorderings.

> ## VISUAL / GRAPHIC CHANGES: **NONE**
> No graphic is redesigned, redrawn, restyled, repositioned, recolored, or removed.
> Colors, gradients, backgrounds, animations, GSAP, spacing, typography, card styles,
> shadows, borders, glow effects, `DigitalBlueprintBg`, the hero constellation, the tool
> orbit, employee portraits, the war room, recruiting panel, outreach panel, monitoring
> visuals, timeline, pricing cards, FAQ design, footer design and the Agent Builder
> graphic are all preserved exactly.

---

## 0. Locked positioning

**Agentory gives your business AI employees that get your online work done.**

Mental model the page must produce:

```
I have work
↓  Agentory has AI employees for it
↓  they know my company
↓  they use the right tools/models/data underneath
↓  they can work together
↓  I get the result back in one place
```

Agentory is **not** a recruiting platform, a lead scraper, a research employee, a GTM
platform, a collection of AI tools, an integration marketplace, or one single AI agent.

**Banned category language:** AI Workforce Platform · GTM platform · agentic OS ·
AI operating system · orchestration platform · system of action · agent infrastructure.

---

## 1. Exact files to change

| # | File | Type of change |
|---|---|---|
| 1 | `index.html` | SEO / meta copy |
| 2 | `src/pages/Landing.tsx` | **Two approved reorderings + one unmount** |
| 3 | `src/components/Header.tsx` | Brand, nav labels, CTA |
| 4 | `src/components/landing/HeroHook.tsx` | Eyebrow, headline, sub, 5 captions, CTAs, footnote |
| 5 | `src/components/landing/GlobalTrustBar.tsx` | Headline, badges, remove fake counter |
| 6 | `src/components/landing/EcosystemSection.tsx` | Eyebrow, headline, sub, stats, closing, tab labels |
| 7 | `src/components/landing/TransformationSection.tsx` | Eyebrow, 10 rows, 2 badges |
| 8 | `src/components/landing/MeetYourAITeamSection.tsx` | Headline, sub, role labels, placeholder card |
| 9 | `src/components/landing/MeetTheTeamSection.tsx` | **Largest edit** — names, all messages, chrome, 3 truths |
| 10 | `src/components/landing/ProductScreening.tsx` | Badge, headline, sub, 4 steps, step-4 label |
| 11 | `src/components/landing/ExpertJourney.tsx` | Badge, 3 beats, closing, 1 chip |
| 12 | `src/components/landing/ProductLookalike.tsx` | Badge, headline, sub |
| 13 | `src/components/landing/DayTimelineSection.tsx` | Eyebrow, headline, sub, entries, 4 metrics |
| 14 | `src/components/landing/TeamsAtWorkSection.tsx` | Eyebrow, headline, sub, tile labels, button |
| 15 | `src/components/landing/TimeMath.tsx` | Headline, sub, columns, rows, counter target |
| 16 | `src/components/landing/AgentBuilderSection.tsx` | Eyebrow, headline, sub, 5 form labels |
| 17 | `src/components/landing/PricingCard.tsx` | `HOW_IT_WORKS`, credit explainer, `PLAN_VALUE` |
| 18 | `src/components/landing/FAQSection.tsx` | `faqs` array (6 → 7 entries) |
| 19 | `src/components/landing/GlobalSection.tsx` | 3 card bodies, closing line |
| 20 | `src/components/landing/MarqueeBanner.tsx` | `row1`, `row2` |
| 21 | `src/components/landing/FinalCTA.tsx` | Headline, body, CTAs, footnote |
| 22 | `src/components/landing/Footer.tsx` | Product column, ©, tagline |

**Explicitly NOT touched:** `tailwind.config.ts` · `src/index.css` · `DigitalBlueprintBg`
· `PoweredByStrip` · all `components/ui/*` · `agentRegistry.ts` · `agentProfiles.ts` ·
`plans.ts` · all product/app code outside `src/components/landing/`.

**Out of scope, will contradict the new landing (flagged, not fixed):**
`src/pages/Features.tsx` · `src/pages/Pricing.tsx` · `src/pages/GetDemo.tsx`

---

## 2. What text / labels change in each file

### 2.1 `index.html`
See §10.

### 2.2 `src/components/Header.tsx`
- Wordmark: `ScreeningPilot` → **`Agentory`**
- Nav: `How It Works` · `Departments` · `Pricing` · `Enterprise`
  → **`How it works` · `What it does` · `Pricing` · `FAQ`**
- Buttons: remove `Launch App` from the logged-out state; keep `Sign in`;
  `Meet your workforce →` → **`Put Agentory to work →`**
- Language dropdown: unchanged.

### 2.3 `HeroHook.tsx`
Full copy in §7. Constellation captions (icons/colors/pulse/travelling dot unchanged):

| Current | New |
|---|---|
| TALENT | **RESEARCH** |
| GROWTH | **LEADS** |
| CONTENT | **CONTENT** |
| INTELLIGENCE | **SIGNALS** |
| COMMAND | **OUTREACH** |

### 2.4 `GlobalTrustBar.tsx`
- **Remove the looping 47→52 country counter** and its `setInterval`.
- Headline → **`Your company context stays yours.`**
- Badges: `SOC2 Ready` / `GDPR` / `Encrypted`
  → **`GDPR`** · **`Encrypted at rest`** · **`Encrypted in transit`**
- Flag ticker: **keep exactly**, as decoration, with no numeric claim.

### 2.5 `EcosystemSection.tsx`
- Eyebrow: `THE ECOSYSTEM` → **`UNDER THE HOOD`**
- Headline → **`The best AI for every job.`** / **`One place to run it all.`**
- Sub → *Your AI employees use the right model, research source and tool for each job.
  You give Agentory the work. Agentory handles what's underneath.*
- Stats: `15+ AI tools connected` → **`Many` — models and sources behind your employees**;
  `1 Company Brain` → **`1` — company context they all share**;
  `0 Tabs… Everything runs from ScreeningPilot` → **`0` — tools for you to manage**
- Closing: → **`You bring the work. Agentory brings the team, the tools and the result.`**
- `TAB_LABELS`: `All Tools / Talent / Growth / Content / Intelligence`
  → **`Everything / Research / Leads / Content / Signals`**
- Orbital rings, logos, rotation, connection lines: **unchanged**.

### 2.6 `TransformationSection.tsx`
- Headline: **unchanged** — *"Right now you are the only connection between tools that do not know each other."*
- Eyebrow: `WITH PILOT` → **`WITH AGENTORY`**
- Rows:

| Before ✗ | After ✓ |
|---|---|
| A dozen AI tools that forget your company every session | One company context every AI employee works from |
| Hours every week re-explaining your business | Tell Agentory once. Remembered from then on. |
| Research in one tab, content in another, leads in a third | Research, leads, content and outreach in one place |
| You copy the output of one tool into the next | Your employees pass work to each other |
| You are the connection between everything | You review the results and decide |

- Badges: `€149/MONTH` · `ALL FIVE DEPARTMENTS` → **`ONE COMPANY BRAIN`** · **`ONE PLACE`**

### 2.7 `MeetYourAITeamSection.tsx`
- Headline → **`Different employees.`** / **`Different jobs.`**
- Sub → *Each AI employee is good at a different part of your online work. They all work
  from the same company context, and they hand work to each other when a job needs more
  than one of them.*
- `departmentLabel` map → the public functions in §9.
- Role lines → the public functions in §9.
- Placeholder card: `More agents — Joining the team in v2`
  → **`More employees — New employees join as Agentory takes on more kinds of work.`**
- Portraits, rings, grid, hover, `PoweredByStrip`: **unchanged**.

### 2.8 `MeetTheTeamSection.tsx` — largest edit
- Headline → **`They work together.`** / **`You just decide.`**
- Eyebrow: `YOUR AI WORKFORCE` → **`A DAY INSIDE AGENTORY`**
- Sub → *Every AI employee has a job, the tools for it, and colleagues they hand work to.
  When one finds something another should act on, it passes it over — without you setting
  it up.* (remove the €149 sentence)
- Window chrome: `ScreeningPilot Internal · 5 agents online` → **`Agentory · your AI team`**
- Sidebar heading `DEPARTMENTS` → **`THE WORK`**; rows Talent/Growth/Content/Intelligence
  → **Research · Leads · Content · Signals · Recruiting**
- `AGENTS ONLINE: Scout, Aria, Penn, Hawk, Scribe`
  → **`EMPLOYEES ONLINE: Lyra, Atlas, Mira, Orion`**
- Message thread rewritten to span signals → research → leads → content → outreach →
  recruiting, keeping the same bubbles, timestamps and `Passed to:` handoff lines:

| Time | Employee | Message |
|---|---|---|
| 07:00 | **Lyra** | Overnight scan done. A competitor changed pricing, and two companies in your market raised. Flagging the pricing change for you. |
| 07:12 | **You** | Reviewed. Asked Mira to draft a response post on our pricing. |
| 07:18 | **Mira** | Post drafted in your brand voice. Ready for your review. *Passed to: You* |
| 09:04 | **Atlas** | Researched 40 companies against your ICP. 12 qualified, ranked by fit. *Passed to: Mira* |
| 09:14 | **Mira** | Outreach drafted for the top 3, each referencing the signal that made them relevant. Nothing sends until you approve. |
| 11:30 | **Atlas** | Screened this week's applicants against the role. Six worth your time, ranked. *Passed to: Orion* |
| 18:00 | **Orion** | End of day: 1 outreach approved, 12 companies qualified, 6 candidates shortlisted, 1 competitor alert handled. Your time today: 47 minutes. |

- Three "truths":
  1. **One company context. Every employee has it.** — Tell Agentory about your company
     once: what you sell, who you sell to, your voice, your competitors, your goals. From
     then on every AI employee works from that same context. What you tell one, all of
     them know.
  2. **They pass work to each other.** — Lyra spots a signal and hands it to Atlas. Atlas
     qualifies a company and hands it to Mira. Mira drafts the outreach and hands it to
     you. No configuration, no re-prompting, no copy-paste between tabs.
  3. **You are the only human in the room.** — Your employees do the work and bring you
     the decisions. Minutes of reviewing replaces hours of doing.

### 2.9 Demo 1 — `ProductScreening.tsx` (Leads & Outreach)
- Badge: `GROWTH DEPARTMENT · Penn Agent` → **`ONE JOB YOU CAN HAND OVER · LEADS & OUTREACH`**
- Headline → **`Give them a lead job.`** / **`Get companies worth contacting back.`**
- Sub → *Describe the companies you want. Your AI employees find them, confirm the signal
  you asked for is real and recent — hiring, funding, growth, technology, activity — then
  draft outreach in your voice referencing the exact reason each company is worth
  contacting. Nothing sends until you approve it.*
- Four steps → **1.** Lyra finds the signal · **2.** Atlas checks it's real ·
  **3.** Mira drafts the outreach · **4.** You approve and send from your own inbox
- **Step-4 button label:** `✓ Reply Received — Meeting Booked`
  → **`✓ Approved — ready to send from your inbox`**
- Panel, fields, signal chips, animation: **unchanged**.

### 2.10 Demo 2 — `ExpertJourney.tsx` (Signals & Monitoring)
- Badge: `Intelligence · Hawk Agent` → **`ONE JOB YOU CAN HAND OVER · SIGNALS & MONITORING`**
- Headline → **`Give them a watching job.`** / **`Know what changed before anyone tells you.`**
- Beat 1 → *Lyra watches competitor pricing, product launches, hiring patterns and public
  reviews, and flags what actually changed.*
- Beat 2 → *Lyra also tracks hiring activity, funding and market movement, so you always
  know what your space looks like.* (drop "real time")
- Beat 3 → *Overnight findings come back as a short daily brief: what happened, and what
  needs you.*
- Closing → **`Your AI employees watch. You read three minutes and decide.`**
- Chips: unchanged except `Salary benchmark updates` → **`Market & funding updates`**

### 2.11 Demo 3 — `ProductLookalike.tsx` (Recruiting)
- Badge: `TALENT DEPARTMENT · Scout Agent Active` → **`ONE JOB YOU CAN HAND OVER · RECRUITING`**
- Headline → **`Give them a hiring job.`** / **`Get a ranked shortlist back.`**
- Sub → *Tell Agentory the role you're filling. Your AI employees find people who match,
  review every applicant against what the job actually needs, and bring back a ranked
  shortlist with the reasoning attached. You decide who to talk to.*
- Panel: **unchanged**.

### 2.12 `DayTimelineSection.tsx`
- Eyebrow → **`A MONDAY WITH YOUR AI TEAM`**
- Headline → **`Your Monday.`** / **`Agentory handled the rest.`**
- Sub → *This is a normal day's work handed to Agentory. Your only job is to review and decide.*
- Entries re-attributed `Scout`/`Scribe` → **Lyra / Atlas / Mira / Orion**, spread across
  signals, research, content, outreach and recruiting.
- Metrics: `Your time invested` *(keep)* · `Meeting booked` → **`Companies researched`** ·
  `Candidates screened` → **`Drafts ready for review`** · `Agency fees paid` → **`Decisions you made`**

### 2.13 `TeamsAtWorkSection.tsx`
- Eyebrow: `YOUR DEPARTMENTS, LIVE` → **`WHAT AGENTORY HANDLES`**
- Headline: `Three active departments. / Five working agents.` → **`The work you can hand over.`**
- Sub → *Research, leads, signals, content, outreach, recruiting and company intelligence —
  handled by AI employees who all know your business. More kinds of work as Agentory grows.*
- Tiles → **Research · Leads · Signals · Content · Outreach · Recruiting · Monitoring · Company Intelligence**
- Button: `View Department` → **`View the work`**
- `COMING SOON` / `Join waitlist`: keep where genuinely upcoming.

### 2.14 `TimeMath.tsx`
- Headline: `Five working AI agents vs. a human team.` → **`What this replaces.`**
- Sub → *Not your team — the stack of separate tools you're paying for, and the hours you
  spend moving work between them.*
- Columns: `Human Team` / `Your AI Workforce` → **`Doing it the current way`** / **`With Agentory`**
- Rows:

| Current way | With Agentory |
|---|---|
| A research tool, a lead tool, a content tool, a monitoring tool — each billed separately | One subscription, one place |
| Every tool re-briefed on your company, every session | One company context, shared by every employee |
| You move results from one tool into the next by hand | Your employees pass work to each other |
| Hours a week of coordination that isn't your job | Minutes of review, and a decision |

- **Counter:** remove the `192212` target. See §11.
- **Remove:** *"Same output. Same quality."*

### 2.15 `AgentBuilderSection.tsx` — **STAYS MOUNTED**
- Eyebrow: `BUILD YOUR OWN` → **`BUILD YOUR OWN AI EMPLOYEE`**
- Headline → **`Need an employee for something else?`** / **`Build one.`**
- Sub → *Start with Agentory's ready-to-work AI employees, then create new ones for the
  jobs unique to your business. They inherit your company context and work alongside the
  rest of your Agentory team.*
- Form labels (graphic unchanged):

| Current | New |
|---|---|
| Agent name | **What should this employee do?** |
| Department: Custom ▾ | **Kind of work: Custom ▾** |
| **AI Model** | **Handled for you** |
| Assign tools | **Chosen for the job** |
| Company Brain inherited automatically | **Knows your company automatically** |
| Agent joins workforce immediately | **Joins your team immediately** |

> The `AI Model` → `Handled for you` relabel is the single most important line in this
> section: a user-facing model picker directly contradicts the locked positioning.

### 2.16 `PricingCard.tsx`
- `HOW_IT_WORKS` → **`Give Agentory a job`** (in plain language) → **`See the cost before
  it runs`** (always, up front) → **`Agentory does the work`** *(unchanged)* → **`You only
  pay for useful output`** (partial results are charged fairly)
- Credit explainer → *Every plan includes monthly credits. Credits are used when your AI
  employees do real work — researching companies, finding leads, checking signals,
  drafting outreach, writing content and screening candidates.*
- `PLAN_VALUE` broadened beyond leads, e.g. `~8 research jobs` · `~80 companies
  researched` · `~30 drafts` · `Daily monitoring`
- **Prices continue to read from `PRICING_PLANS`. Never hardcode a price.**

### 2.17 `FAQSection.tsx` — 6 → 7 entries
1. **How is this different from just using ChatGPT or Claude?** — A chat assistant starts
   from nothing every session. Agentory's AI employees already know your company — what
   you sell, who you sell to, your voice, your competitors — before the conversation
   starts. It's the difference between briefing a new freelancer every morning and having
   a team that's worked with you for six months.
2. **Do the AI employees actually work together?** — Yes. When one finds something another
   should act on, it hands it over — a signal becomes research, research becomes a draft,
   a draft comes to you. You don't set the handoffs up.
3. **What kinds of work can I give it?** *(new)* — Research, finding and qualifying leads,
   watching competitors and markets, writing content, drafting outreach, screening
   candidates, and company research. You can also build AI employees for jobs unique to
   your business.
4. **Which AI model does it use?** *(replaces the integrations question)* — Whichever one
   is right for the job. Your employees choose the model, the research source and the tool
   each piece of work needs. You never pick one, and you never manage a subscription to one.
5. **How long does setup take?** — A few minutes: a short set of questions about your
   company, your voice, your customers and your goals. From then on every AI employee is
   briefed.
6. **Do they act on their own, or do I review everything?** — You control that. By default
   nothing is sent or published without your approval. As you build trust you can let
   specific employees act on their own.
7. **What about my data?** — *pending the §11 decision.*

### 2.18 `GlobalSection.tsx`
- **Works everywhere** — *Agentory runs in the cloud with no regional restrictions. Your
  AI employees work at full capacity wherever you're building.*
- **Knows your market** — *Your company context includes the markets you sell into, so
  your employees research and write differently for different audiences — because they
  know who you're talking to.*
- **Your data stays yours** — *pending the §11 decision.* Remove `SOC2 ready`.
- Closing: `Join founders from 50+ countries` → **`Built for founders anywhere.`**

### 2.19 `MarqueeBanner.tsx`
- `row1` → **`RESEARCH · LEADS · SIGNALS · CONTENT · OUTREACH · RECRUITING · MONITORING ◆ ONE PLACE ◆ `**
- `row2` → **`AI EMPLOYEES FOR YOUR BUSINESS ◆ ONE COMPANY BRAIN ◆ SET UP IN MINUTES ◆ CANCEL ANYTIME ◆ `**

### 2.20 `FinalCTA.tsx`
- Headline → **`Your AI team is ready.`** / **`They just need to know your company.`**
- Body → *A few minutes and a few questions about your business. From then on your AI
  employees know who you are, what you sell and who you sell to — and you can start
  handing them work.*
- CTAs → **`Put Agentory to work →`** (`/auth`) · `Book a 20-minute setup call` *(keep)*
- Footnote → **`Start free · No credit card · Cancel anytime`**
  (remove `Join 50+ countries` and `Early access pricing locks in for life`)

### 2.21 `Footer.tsx`
- Product column: `AI Workforce Platform / Talent Department / Growth Department /
  Intelligence Department / Custom Agent Builder / Pricing`
  → **`Research · Leads · Signals · Content & Outreach · Recruiting · Build your own · Pricing`**
- `© 2026 ScreeningPilot` → **`© 2026 Agentory`**
- Tagline → **`Built to give every business an AI team.`**
- *(Note: every footer link is `href="#"`. Separate, non-content fix.)*

---

## 3. The two component reorderings — `src/pages/Landing.tsx`

Both are pure reorderings of already-mounted components. Same components, same props,
same styling, no new sections.

### Move 1 — `EcosystemSection` after the employee/team sections
Readers must understand the AI employees first, then what's underneath them.

### Move 2 — Group the three demos: Leads → Signals → Recruiting
Recruiting moves to third so it reads as one example of breadth, not the identity.

```
BEFORE (current mount order)          AFTER (approved)
────────────────────────────          ─────────────────────────────
 1  Header                             1  Header
 2  HeroHook                           2  HeroHook
 3  GlobalTrustBar                     3  GlobalTrustBar
 4  EcosystemSection          ──┐      4  TransformationSection
 5  TransformationSection       │      5  MeetYourAITeamSection
 6  MeetYourAITeamSection       │      6  MeetTheTeamSection
 7  MeetTheTeamSection          └───►  7  EcosystemSection        (moved)
 8  ProductLookalike   (recruit)       8  TeamsAtWorkSection      (moved up with group)
 9  ProductScreening   (leads)         9  ProductScreening   (leads)      ─┐
10  ExpertJourney      (signals)      10  ExpertJourney      (signals)     │ demos
11  DayTimelineSection                11  ProductLookalike   (recruiting) ─┘ grouped
12  TeamsAtWorkSection                12  DayTimelineSection
13  TimeMath                          13  TimeMath
14  SocialProof                       ──  SocialProof            (UNMOUNTED)
15  AgentBuilderSection               14  AgentBuilderSection    (STAYS)
16  PricingCard                       15  PricingCard
17  FAQSection                        16  FAQSection
18  GlobalSection                     17  GlobalSection
19  MarqueeBanner                     18  MarqueeBanner
20  FinalCTA                          19  FinalCTA
21  Footer                            20  Footer
```

**Also required:** the hero's secondary CTA anchor currently targets `#day-timeline`.
Retarget to the team section (`#how-it-works`), which now answers "how it works," and
update the `Header` nav anchors to match the new order.

---

## 4. Claims being removed

### Factually contradicted by our own code
| Claim | Where | Reality |
|---|---|---|
| **€149/month** | Marquee, Transformation ×2, MeetTheTeam | `plans.ts` is USD $0/$29/$79/$199/$499 |
| **"15 AGENTS"** | Marquee | 5 public identities; 4 specialists |
| **"Five specialized AI agents"** | MeetYourAITeam | Section renders four |
| **Scout / Aria / Penn / Hawk / Scribe** | 7 sections | `agentRegistry.ts` states these must never render publicly |

### Unverifiable / fabricated
- Looping **47→52 country counter** (hardcoded `setInterval`, not data)
- **"Trusted by founders from 50+ countries"** (Hero, FinalCTA, GlobalSection)
- **"€192,212 saved every year"** (TimeMath)
- **"€80,000 saved"**, **"6 weeks → 48 hours"**, **"€28,000 agency fee per hire"**
- **"SOC2 Ready"** (GlobalTrustBar, GlobalSection)
- **"15+ AI tools connected"** — orbit shows Notion, Linear, GitHub, Cal, Canva, Gamma,
  ElevenLabs, Replicate, Instantly, Hunter; the product's real provider set is Apify,
  Firecrawl, Resend, Perplexity, Lovable AI
- **"Early access pricing locks in for life"** (FinalCTA)

### Overclaims
- **"Founders who replaced their team with an AI workforce"**
- **"Same output. Same quality."**
- **"They handle everything else."**
- **"autonomous workforce"** — the product is approval-first by design
- **"Reply received — meeting booked"** — Agentory drafts; you send

### Too recruiting-specific for their position
- **"Your recruiting team. Always hiring. While you sleep."** (first demo headline)
- **"Recruiting: 6 weeks per hire → 48 hours"** (both Transformation rows)
- **"127 candidates screened"**, **"Candidates screened"**, **"Agency fees paid"**
- **`<title>AI Workforce for Recruiting Agencies`**

### Category language retired
- **"THE AI WORKFORCE PLATFORM"** / **"AI Workforce Platform"**
- **"Department"** as a public-facing noun (nav, footer, badges, tabs, sidebar, tiles)
- **"ScreeningPilot"** — 17 mounted occurrences across Header, HeroHook, GlobalTrustBar,
  EcosystemSection ×3, MeetTheTeamSection ×2, FAQSection, GlobalSection, Footer

### Softened per instruction
- **"Set up in 10 minutes"** → **"Set up in minutes"** / "Tell Agentory about your company once"
  (3 places: Hero footnote, FAQ, FinalCTA)

---

## 5. Sections being unmounted

| Section | File | Reason |
|---|---|---|
| **SocialProof** | `src/components/landing/SocialProof.tsx` | Anonymous, unverifiable testimonials carrying specific financial claims (€80K saved, 6 weeks → 48 hours). Its own footnote reads *"Names anonymized pending permission."* |

**Method:** remove the `<SocialProof />` mount and its import from `Landing.tsx` only.
**The file stays on disk, unmodified**, ready to restore when real attributable customer
quotes exist. Nothing else is unmounted.

---

## 6. AgentBuilderSection — CONFIRMED STAYS MOUNTED

✅ **`AgentBuilderSection` remains mounted on the landing page.**

- Not unmounted. Not removed. Not downgraded.
- The existing Agent Builder graphic is kept **exactly** as it is.
- It is strategically important: it proves Agentory is **not limited to a fixed set of
  prebuilt AI employees**, and it delivers story beat 9.
- Framing: the builder is **one capability inside the broader Agentory system** — not a
  generic agent-builder platform.
- Copy per §2.15.

---

## 7. Exact final hero copy

```
EYEBROW
AI EMPLOYEES FOR YOUR BUSINESS

HEADLINE
You're doing the work of ten people.
Now you don't have to.

SUPPORTING COPY
Agentory gives you AI employees for the work your business does online —
research, leads, content, signals, outreach, recruiting and more.
One place to give them the work. One place to get the results.

CONSTELLATION CAPTIONS  (graphic unchanged)
RESEARCH · LEADS · SIGNALS · CONTENT · OUTREACH

PRIMARY CTA
Put Agentory to work →        → /auth

SECONDARY CTA
See how it works              → #how-it-works

FOOTNOTE
Set up in minutes · Start free · Cancel anytime
```

---

## 8. Exact CTA system

**One primary CTA everywhere: `Put Agentory to work →` → `/auth`**

| Position | Current | Final |
|---|---|---|
| Header primary | `Meet your workforce →` | **`Put Agentory to work →`** → `/auth` |
| Header secondary | `Sign In` + `Launch App` | **`Sign in`** only |
| Hero primary | `Build your AI workforce` | **`Put Agentory to work →`** → `/auth` |
| Hero secondary | `See how it works` → `#day-timeline` | **`See how it works`** → `#how-it-works` |
| Section CTA | `View Department` | **`View the work`** |
| Final primary | `Build your AI workforce` | **`Put Agentory to work →`** → `/auth` |
| Final secondary | `Book a 20-minute setup call` | **unchanged** |

**Route `/auth` confirmed.** `Landing.tsx` already redirects authenticated users to
`/dashboard`, and the Free Trial plan ($0, 30 credits, Company Brain setup) means a signup
lands on something real. No reason to route to `/get-demo`.

---

## 9. Exact employee / function labels

Grounded in `src/config/agentRegistry.ts` — the canonical public roster.

| Employee | Internal title (do not display) | **Public function label** | Public caption |
|---|---|---|---|
| **Pilot** | AI Workforce Coordinator | **Coordinator** | The one you talk to. Takes the job, gives it to the right employee, brings the result back. |
| **Lyra** | AI Signal Scout | **Signals & Monitoring** | Watches hiring, funding, growth, technology and competitor activity — tells you what changed. |
| **Atlas** | AI Account Analyst | **Research & Company Intelligence** | Researches companies and markets, checks the facts, ranks what's worth your time. |
| **Mira** | AI Message Strategist | **Content & Outreach** | Writes in your voice — outreach, posts, replies. Every draft comes to you for approval. |
| **Orion** | AI Pipeline Operator | **Pipeline & Review** | Tracks what's waiting on you, and what to approve, contact, watch or skip next. |
| *(future)* | — | **More employees** | New employees join as Agentory takes on more kinds of work. |

**Retired from all public surfaces:** `Scout` · `Aria` · `Penn` · `Hawk` · `Scribe`
(legacy backend slugs; `agentRegistry.ts:6-8` states they must never render publicly).

**Recruiting has no named employee, and that is correct.** The backend is real
(`screen-candidate`, `parse-resume`, `generate-screening-questions`,
`send-interview-invite`, `screening-notifications`, `job-feed`), so recruiting is presented
as **a job the team handles** — Atlas researches candidates, Mira writes to them, Orion
queues them for review. This is honest and reinforces "employees work together."

**Capability labels (8), used in TeamsAtWork, Footer and Marquee:**
`Research` · `Leads` · `Signals` · `Content` · `Outreach` · `Recruiting` · `Monitoring` ·
`Company Intelligence`

---

## 10. SEO / meta changes — `index.html`

| Tag | Current | Final |
|---|---|---|
| `<title>` | Agentory — AI Workforce for Recruiting Agencies | **Agentory — AI Employees for Your Business** |
| `description` | …automates passive talent discovery, candidate intelligence, and outreach for recruiting agencies. | **Agentory gives your business AI employees that handle your online work — research, leads, signals, content, outreach and recruiting. Give them the job, get the results in one place.** |
| `og:title` | *(recruiting)* | **Agentory — AI Employees for Your Business** |
| `og:description` | *(recruiting)* | **Give Agentory the work. Research, leads, signals, content, outreach and recruiting — handled by AI employees who all know your company.** |
| `twitter:title` | *(recruiting)* | *(match `og:title`)* |
| `twitter:description` | *(recruiting)* | *(match `og:description`)* |
| `author` · `canonical` · favicon · fonts | Agentory / agentory.space | **unchanged** |

> The `<title>` is the highest-leverage single line in this plan — it is currently the most
> explicitly recruiting-specific statement in the codebase and appears in every search
> result and link preview.

---

## 11. Copy that still needs a factual decision

Nothing below is implemented until answered. Each has a safe fallback.

| # | Question | Affects | Safe fallback if unverified |
|---|---|---|---|
| 1 | **Can we say data is never used to train models?** Needs verification across the full provider chain (Apify, Firecrawl, Perplexity, Lovable AI/Gemini/OpenAI, Resend) — not just Agentory's own storage. | GlobalTrustBar badges, GlobalSection card 3, FAQ 7 | Drop the training claim. Say only what we control: *"Your company context is encrypted at rest and in transit."* |
| 2 | **Can users actually export or delete everything?** | GlobalSection, FAQ 7 | Omit the sentence until confirmed |
| 3 | **Is `SOC2 Ready` defensible?** | GlobalTrustBar, GlobalSection | **Remove** (current plan assumes removal) |
| 4 | **Is onboarding really ~10 minutes / 12 questions?** | Hero footnote, FAQ 5, FinalCTA | **"Set up in minutes"** (current plan assumes this) |
| 5 | **Do we have real country/user numbers?** | GlobalTrustBar counter, Hero, FinalCTA, GlobalSection | Remove all count claims (current plan assumes removal) |
| 6 | **Does the custom agent builder ship today?** | AgentBuilderSection tense | Keep mounted with present-tense copy but add a small `COMING SOON` treatment if not yet live |
| 7 | **Does `TimeMath` keep a headline number?** Any replacement must be sourced. | TimeMath counter | Remove the counter; let the comparison rows carry the section |
| 8 | **Is "Early access pricing locks in for life" a real commitment?** | FinalCTA footnote | **Remove** (current plan assumes removal) |
| 9 | **Trim the tool orbit to real providers, or keep all logos with no countable claim?** | EcosystemSection | **Keep all logos, drop the count** — requires no graphic change (current plan assumes this) |
| 10 | **Does the natural-language "give Agentory any job" promise hold beyond leads?** `mission.ts:18` declares `leads \| signals \| content`, and the capability registry currently holds 5 capabilities, all in `leads`. Recruiting/content/monitoring run through their own edge functions. | Hero sub, FAQ 3, TeamsAtWork | Keep the capability list as *kinds of work Agentory handles* (true) rather than implying one natural-language planner covers all of them |

---

## 12. VISUAL / GRAPHIC CHANGES = **NONE**

Confirmed. Every existing visual is preserved:

| Graphic | Status |
|---|---|
| `DigitalBlueprintBg` (glow grid + searchlight) | **UNTOUCHED** |
| Hero five-circle constellation + travelling dot | **KEEP** — 5 caption labels only |
| Country flag ticker + badge pills | **KEEP** — badge text only |
| Orbital tool rings + central brain | **KEEP** — tab and stat labels only |
| Before/after ✗ ✓ comparison | **KEEP** — row text only |
| AI employee portraits + colored rings | **KEEP EXACTLY** — captions only |
| `PoweredByStrip` | **UNTOUCHED** |
| War-room workspace simulation | **KEEP** — message text and names only |
| Outreach pipeline + signal chips | **KEEP** — step-4 label only |
| Intelligence scroll sequence | **KEEP EXACTLY** — badge and prose only |
| Recruiting interface panel | **KEEP EXACTLY** — badge only |
| Monday timeline + metric tiles | **KEEP** — metric labels only |
| Work/capability status board | **KEEP** — tile labels only |
| Two-column comparison | **KEEP** — text and counter value only |
| **Agent Builder form graphic** | **KEEP EXACTLY** — field labels only |
| Pricing grid | **KEEP EXACTLY** |
| FAQ accordion | **KEEP EXACTLY** |
| Global trust cards | **KEEP EXACTLY** |
| Scrolling marquee tickers | **KEEP** — string content only |
| Final CTA block | **KEEP EXACTLY** |
| Footer columns | **KEEP** — link labels only |
| All GSAP / Framer animation, all design tokens | **UNTOUCHED** |

`tailwind.config.ts` and `src/index.css` are not opened.

---

## STOP — awaiting approval

No source file has been modified. Implementation begins only on your go-ahead, and the ten
open questions in §11 should be answered first (or their safe fallbacks confirmed).
