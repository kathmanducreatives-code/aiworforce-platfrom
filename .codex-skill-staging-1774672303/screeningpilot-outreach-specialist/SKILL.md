---
name: screeningpilot-outreach-specialist
description: ScreeningPilot high-intent outreach lead sourcing and enrichment system. Use when Codex must find or scrape outreach leads, hiring leads, LinkedIn post commenters, LinkedIn job posts, YC or startup job-board leads, funding or news signals, or enrich startup contacts with Apify and Firecrawl.
---

# Outreach

Use this skill when the task is to find, score, enrich, and rank ScreeningPilot leads.

Default to:
- `US startups`
- `high intent`
- public-data workflows only
- `Apify <= $5/run`
- `Firecrawl <= 500 credits/run`

Do not draft messages unless the user explicitly asks for DMs or emails after lead selection.

## Workflow
1. Load [source-priority.md](references/source-priority.md) for source order, quotas, and budget caps.
2. Run the exact Apify and Firecrawl defaults from [query-sets.md](references/query-sets.md).
3. Score, dedupe, and rank with [scoring.md](references/scoring.md).
4. Only enrich contacts after company-level dedupe using [contact-selection.md](references/contact-selection.md).
5. Return lead-centric output only.

## Output Contract
Return normalized lead rows with:
- `company_name`
- `company_url`
- `source_channel`
- `source_subtype`
- `evidence_url`
- `evidence_excerpt`
- `signal_summary`
- `recency_days`
- `score`
- `tier`
- `preferred_contact`
- `fallback_contacts`
- `funding_signal`
- `enrichment_summary`

## Guardrails
- Exclude recruiters, staffing firms, agencies, coaches, job seekers, and low-intent enterprise noise before ranking.
- Keep contact enrichment to shortlisted hot leads only.
- Reduce caps before widening scope if a run approaches the Apify or Firecrawl budget cap.
- Use only real evidence from source data. Do not invent applicant counts, funding details, or contact info.

## Optional Extension
If the user explicitly asks for message drafting after leads are chosen, then load:
- [signal-and-scoring.md](references/signal-and-scoring.md)
- [master-writing-system.md](references/master-writing-system.md)
