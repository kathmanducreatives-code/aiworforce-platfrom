# ScreeningPilot outreach rubric and workflow

## Lead qualification workflow
1. Normalize and deduplicate leads by canonical LinkedIn URL.
2. Hard-disqualify recruiters/staffing agencies/headhunters.
3. Score the profile using headline/company/hiring signals.
4. Assign tier and prioritize send queue.

## Lead score model
- `decision_maker` (primary: CEO/founder/owner/president): `+3`
- `decision_maker` (secondary: CTO/COO/CPO/CRO/Head/VP Eng): `+2`
- `people_leader` (Head/VP/Director of People/HR): `+2`
- `ACTIVELY_HIRING`: `+3`
- `growth_signal`: `+2`
- `tech_company`: `+2`
- `funded_startup`: `+1`
- `advisor_penalty` (advisor/consultant/fractional/freelance without founder/CEO context): `-1`
- `recruiter` match: disqualify (`-99`, skip)

## Tiering
- `HOT`: score `>= 4`
- `WARM`: score `2-3`
- `SKIP`: score `< 2`

## DM generation principles
- Personalize with lead first name and company.
- Mention a concrete hiring/growth context if available.
- Connect pain to ScreeningPilot value: direct hiring, no middleman, lower fee burden.
- Use soft CTA such as "Worth a quick look?" or "Open to a quick chat?"
- Keep concise; prefer under 300 chars for connection-note style outreach.

## DM quality scoring rubric (0-10)
- `personalization` up to `2.0`
- `clarity` up to `1.5`
- `relevance` up to `2.0`
- `credibility` up to `1.0`
- `cta` up to `2.0`
- `length` up to `1.0`
- `compliance` up to `0.5`

### Queue statuses
- `approved`: score `>= 6.5`
- `pending`: score `>= 4` and `< 6.5`
- `flagged`: score `< 4`

## Operational defaults (from Outreach UI)
- DM approval threshold: `6.5`
- Max regeneration attempts: `2`
- Send delay between approved DMs: `30s`
- Use dry run before live sending whenever requested.
