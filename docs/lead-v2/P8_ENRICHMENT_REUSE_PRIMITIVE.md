# P8 — Cross-mission enrichment reuse (deferred from P5)

Status: **deferred.** P5 does not reuse enrichment across missions. This
document records why, and the primitive that P8 has to build first.

## The question

Two missions in one workspace often discover the same company. Each mission
buys its own LinkedIn company details (`apify_linkedin_company_details`), its
own web grounding and, where enabled, its own team lookup. Could the second
mission reuse the first mission's purchase?

Within one mission it already does. The checkpoint carries the working set,
evidence, observations and executed call keys, so a continuation slice never
buys the same thing twice (P5 invariant suite, "three slices").

## Why P5 does not reuse across missions

The P5 rule is correctness over credits. Reuse is only safe when all six of
these hold for the stored record. Today no store satisfies them:

| Requirement | Why it matters | Today |
|---|---|---|
| **Strong identity key** (canonical domain or LinkedIn company URL, never a name) | A name match merges two different companies, and one company's evidence proves the other's criteria | `company_web_evidence` is keyed by company, but the full LinkedIn company-details record is not stored at all |
| **Known source** (provider, actor, provider call id) | Provenance on a hard check must name the call that produced it | Kept only inside the mission's checkpoint |
| **Reusable evidence type** (a fact about the company, not about the mission) | "Hiring a growth marketer" answers one mission's question; headcount is a fact about the company | Not modelled per record |
| **Observed-at time and a TTL per type** | A stale hiring or funding signal must not pass a hard check | `EVIDENCE_VALIDITY_DAYS` in `candidateObservation.ts` exists, but is only applied inside a mission |
| **Provenance carried into the new mission** (`origin: "reused"`, source mission id) | The Workbench must show that the evidence came from an earlier purchase | Not representable today |
| **Workspace scoping** | One workspace's purchases must never become another's evidence | n/a |

The existing stores are partial:

- `company_headcount_snapshots` holds dated headcount readings, but for growth, not as a reusable record.
- `company_web_evidence` holds scraped web evidence.
- `lead_enrichments` holds contact enrichment written by `memoryWriter.ts`.

None of them is the full company-details record keyed by canonical identity.

Reusing one of these partial stores would give a hard check evidence whose
identity, freshness or provenance the engine cannot verify. That is the class
of bug P5 exists to remove, so reuse waits.

## The P8 primitive: a canonical company enrichment store

One row per `(workspace_id, identity_key, source_actor, evidence_type, observed_at)`:

- `identity_key`: `domain:<canonical domain>` or `linkedin:<normalized company URL>`. It is produced by the P4 entity resolver, never from a name.
- `source_provider`, `source_actor`, `provider_call_id`, `source_mission_id`.
- `evidence_type`: an `EvidenceDimension`.
- `value` (normalized), `raw_ref` (pointer to the raw payload), `excerpt`.
- `observed_at` (the provider's reading), `valid_until` (from the type's TTL), `created_at`.
- `status` and `confidence`, exactly as the evidence item had them. Reuse never upgrades either.

Suggested TTLs, extending `EVIDENCE_VALIDITY_DAYS`:

| Type | TTL | Reason |
|---|---|---|
| hiring / job | 30 days | Changes weekly |
| funding, leadership change, news | 30–90 days | Event-driven |
| headcount | 90 days | Moves slowly, but moves |
| domain, LinkedIn URL, HQ, industry metadata | 180–365 days | Near-static identity facts |
| grounded business-model decision | **not reusable** | It is a model judgement against one mission's criteria, so a new mission re-grounds |

### Rules the engine would apply

1. **Look up before buying**, by strong identity only. A name-only candidate always buys.
2. **Fresh only.** If `valid_until` has passed, the record counts as absent, and the engine buys.
3. **Reused evidence keeps its original status and confidence.** Its `origin` becomes `reused`, and the item links to `source_mission_id` and `provider_call_id`. The Workbench shows "from an earlier search, <date>".
4. **Hard checks may pass on reused evidence** only when that evidence would have passed as a fresh purchase. The same claim-level rules apply.
5. **Never reused:** mission-specific signal matches, grounded decisions, and anything whose source actor's Actor Intelligence readiness has since changed.
6. **Workspace-scoped** by RLS, the same as `lead_mission_queue`.

### Tests P8 must ship with

- Two missions share a company: the second mission makes no details purchase, and its evidence says `origin: reused`.
- An expired record causes a purchase.
- A name-only match causes a purchase.
- A cross-workspace record is invisible.
- A reused record never upgrades `plausible` to `proven`.
- A reused hiring signal older than 30 days does not pass the hiring anchor.
