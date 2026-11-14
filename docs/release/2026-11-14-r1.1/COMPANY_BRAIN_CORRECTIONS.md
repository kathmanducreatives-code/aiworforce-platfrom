# Company Brain corrections: proposed, not applied

**Status:** read-only findings. Nothing in the production Company Brain has been changed. Each correction below needs your decision; you can then make it in the Company Brain editor, or ask me to prepare it as an approved write.

**Source:** the `company_brain` row for your production workspace (`ohsdatpvfdjdemstoiuj`), read on 2026-11-13. It was last updated 2026-10-22.

## 1. Where "2–2 employees" came from

| Field | Stored value | Problem |
|---|---|---|
| `profile.target_customer.company_size` | `{ "min": 2, "max": 2, "label": "5" }` | The range is exactly 2 employees, and its label says "5", which contradicts it. ORION quoted the range as "2–2 employees". |
| `profile.icp.company_size` | `"5"` | A second, older ICP block holds a different value. |

**Proposed:** set one range in `target_customer.company_size` and make `icp.company_size` agree with it. You choose the numbers. Example: `{ "min": 2, "max": 20, "label": "2–20 employees" }` if you mean founder-led teams.

## 2. Positioning that may not reflect Agentory's intended ICP

| Field | Stored value | Problem |
|---|---|---|
| `profile.company.description` | "We help b2b saas companies reduce workflwo managment and combining everything toghter . " | Typos (quoted verbatim in test 1). It is vague about what Agentory actually does (an AI workforce: ORION, ATLAS, LISA, LYRA). |
| `profile.pain_points` / `profile.icp.pain_points` | "Managin to mcuh workflows and being the connector" | Typos. |
| `profile.target_customer.industries` | `["B2B Software"]` | Fine, but it conflicts with `business_models: ["Service model"]` unless you mean software companies with a services motion. Please confirm. |
| `profile.icp.buyer_roles` | `["Founder", "C founder", "cto"]` | "C founder" probably means "Co-founder"; inconsistent capitalisation. |
| `profile.positioning.*` | `offer`, `promise`, `pricing`, `use_cases`, `proof_points` and `differentiators` are all empty | This is why drafts must stay generic. ORION's draft prompt now lists these gaps rather than inventing claims. |
| `profile.goals.*` | `gtm`, `outreach` and `content` are all empty | The only goal stored is `founder.first_help_goal = "Find qualified companies"`. |
| `profile.company.stage`, `category`, `location`, `team_size` | Empty | |
| `profile.icp.disqualifiers` | 16 entries, mixing enterprise and recruiting-agency exclusions with "Sole traders" and "trading companies" | Several (for example "We need to hire more recruiters", "VP of Operations…") read like a recruiting-automation ICP, not workflow automation. Please confirm they still apply. `target_customer.disqualifiers.company_types` holds only the last two. |

## 3. Proposed corrected values (draft for your edit)

```json
{
  "company": {
    "description": "Agentory gives B2B founders an AI workforce (ORION, ATLAS, LISA, LYRA) that finds qualified companies, watches buying signals and drafts outreach, so the founder stops being the connector between tools.",
    "category": "AI workforce for B2B go-to-market",
    "location": "<your HQ>"
  },
  "pain_points": ["Managing too many workflows and being the connector between tools"],
  "target_customer": {
    "industries": ["B2B Software"],
    "business_models": ["<confirm: Service model?>"],
    "company_size": { "min": "<min>", "max": "<max>", "label": "<min>–<max> employees" }
  },
  "icp": {
    "buyer_roles": ["Founder", "Co-founder", "CTO"],
    "company_size": "<same range as above>"
  }
}
```

The description wording is my proposal, written from the product as it exists. Replace it with your own positioning if it differs.

## 4. How the change would be applied, after your approval

- **Preferred:** edit in the Company Brain page. Saves go through `generate-company-brain-draft` (`update`) and the authorized writer from D4. That path checks your role, records a revision (D5) and uses compare-and-swap.
- **Or I prepare it:** an approved write through the same authorized writer path, never a direct SQL `UPDATE`. I would show you the exact before and after first.
