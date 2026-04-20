# ScreeningPilot signal and scoring rules

This file is for message-angle selection after a lead shortlist already exists.
For sourcing, ranking, and shortlist construction, use [scoring.md](scoring.md).

## Signal priority
Use the highest-quality real signal available.

### Tier 1
- applicant count
- funding round and amount
- LinkedIn comment topic
- exact live job title or job description

### Tier 2
- founder's previous experience
- current tenure
- YC batch
- company description

### Tier 3 fallback
- company actively hiring
- founder building a startup where every early hire matters

## Role types and pain mapping
- `founder`: time first, then bad agency spend
- `engineering`: time + screening accuracy
- `executive`: money + urgency of open roles
- `hr`: volume + quality noise from recruiters
- `product`: roadmap drag from open roles
- `general`: default to time unless money signal is stronger

## Disqualify immediately
- recruiters
- staffing agencies
- headhunters
- agency owners pitching recruiting services
- advisors/consultants without direct hiring ownership

## Qualification flow
1. Normalize fields
2. Dedupe by canonical LinkedIn URL or company+role
3. Disqualify recruiter/agency profiles
4. Choose primary signal
5. Choose pain angle
6. Draft message
7. Check word count and CTA compliance

## Simple score model
- founder / CEO / cofounder: `+3`
- CTO / VP Eng / Head Eng: `+2`
- Head / VP People or Talent: `+2`
- active hiring signal: `+3`
- funding signal: `+2`
- applicant overload or screening pain signal: `+3`
- recruiter / agency profile: `skip`

## Tiering
- `HOT`: score `>= 6`
- `WARM`: score `4-5`
- `SKIP`: `< 4` or disqualified

## Firecrawl lead-finding defaults
- Funding: recent funding announcements plus hiring pages
- Jobs: engineering, product, data, AI roles at startups and scaleups
- LinkedIn/public posts: `we are hiring`, `join our team`, `we just raised`, `scaling our team`
