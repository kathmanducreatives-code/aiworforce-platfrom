# Call-brief and import contracts for design review

Proposed contracts only. No sample below is an actual customer/model/provider execution. The record remains preparation for a human caller; this is not a qualified-company verdict or a message to send.

## Import lifecycle

`file selected → server preview → human confirms mapping/selected rows/workspace → scoped idempotent import → imported input records`.

The server canonicalizes parsed values and returns a preview digest over workspace/client binding, field mapping, selected normalized rows and policy version. Confirmation must match that digest and revalidate authorization/caps. Source filename and client-supplied hash are not identity/authorization. Repeat confirm with identical input returns the existing batch; the same request key with different input conflicts. An expired preview or changed policy requires preview again.

Imported data retains source system label `apollo_export` only because the user explicitly selects it; that is provenance from a supplied export, not cryptographic proof of Apollo origin. Preserve source record IDs where supplied, original row number, file digest, import time and actual source updated_at (nullable). Import time never becomes an event date. Row-level conflicts/ambiguities are previewed and held; no silent name-only merges, new lead searches or inferred employer identities.

An import does not create a discovery mission or a “qualified” lead. Use source snapshots/optional explicit internal links; never set evidence_strength=high, quota_eligible=true, gate_decision=pass or forge criterion verdicts just to satisfy existing downstream gates. No automatic `research_company`, `find_decision_makers`, contact purchase or sequence action.

## Structured brief schema (v1)

The server stores immutable provenance outside the model response: workspace/client, imported row and source record IDs, Brain/context/source digests, task ID, policy/registry/model versions, actual provider request/usage receipt, output version, validation result and review state. The model cannot set those fields or mark its own output approved.

The model response contains these bounded content fields:

| Field | Content and validation |
|---|---|
| `schema_version` | Exactly `call_brief_v1` |
| `account_fact_ids`, `contact_fact_ids` | Existing packet IDs for the intended company/contact; no name-only identity inference |
| `company_summary` | Bounded factual statements, each with text + nonempty fact references; supplied-only facts retain that status in the rendered brief |
| `contact_context` | Bounded statements about the supplied contact and employer; explicit uncertainty if employment/title is unverified |
| `reason_to_call` | Approved seller relevance plus buyer facts, or explicitly hypothetical relevance. No unproven buying intent or urgency |
| `seller_claim_ids` | Only approved claims/positioning from this task's Brain snapshot |
| `suggested_questions` | A few human-call questions. Any embedded factual premise must cite packet facts; no assumed hiring/funding/problems |
| `do_not_claim` | Missing/contradictory/stale information that the caller must not present as fact |
| `unknowns` | Missing required context, why missing and appropriate human verification question |
| `sources_used` | Subset of supplied packet IDs; the model cannot invent a URL or source body |

Use a strict JSON schema with bounded strings/arrays and rejected unknown keys. The provider schema and application validator must agree; if a provider cannot support it, keep that adapter disabled or use a reviewed provider-specific schema adapter with the same application contract. No regex-based truncation repair into an accepted brief.

### Example content (synthetic)

```json
{
  "schema_version": "call_brief_v1",
  "account_fact_ids": ["fact-company-domain"],
  "contact_fact_ids": ["fact-supplied-contact"],
  "company_summary": [
    {
      "text": "The supplied export identifies Example Software as the account.",
      "fact_ids": ["fact-company-domain"]
    }
  ],
  "contact_context": [
    {
      "text": "The export lists Alex as Head of Sales; current employment is unverified.",
      "fact_ids": ["fact-supplied-contact"]
    }
  ],
  "reason_to_call": {
    "text": "Explore whether the approved pipeline-support offer fits this team's current priorities.",
    "fact_ids": [],
    "seller_claim_ids": ["seller-offer-1"],
    "mode": "hypothesis"
  },
  "seller_claim_ids": ["seller-offer-1"],
  "suggested_questions": [
    { "text": "What are your team's current pipeline priorities?", "fact_ids": [] }
  ],
  "do_not_claim": ["Do not claim current hiring, funding or buying intent."],
  "unknowns": [
    {
      "field": "current_employment",
      "reason": "Only a supplied export entry is available.",
      "question": "Is Alex still responsible for sales at this account?"
    }
  ],
  "sources_used": ["source-export-row-1"]
}
```

The schema implementation will make `reason_to_call`'s mode explicit (`fact_supported` or `hypothesis`) and require references for factual premises. A hypothesis does not establish qualification or intent. Structured formatting is not semantic truth: reviewer acceptance is still required, and model-drafted prose can misinterpret a real quote. V1 should render sensitive factual fields directly from validated packet facts where possible rather than invite free-form claims.

## Evidence packet rules

Every fact has: packet ID, subject company/contact identity, workspace ownership, source ID/type, original location (CSV row/column or source excerpt), exact excerpt/value, observed_at, source updated/event dates when known, provenance class and uncertainty/conflict flags. Sources remain outside system instructions. The browser/model cannot assign workspace ownership.

Allowed classes: `supplied_claim`, `corroborated_fact`, `unknown`, `conflicting`. A supplied employer/title is not verified current employment. Uploaded page text is a supplied snapshot until its origin/subject is checked; a URL alone is not collected evidence. Existing lexical/extraction hints are candidate facts, not buying-signal verification. A recency-dependent claim requires an actual event date; old content scraped today remains old. Missing dates remain missing.

Validation order:

1. Verify task/record/Brain/seller identity and active scope before model or research.
2. Normalize sources, enforce subject ownership, retain conflicts and digest exact content.
3. Strictly parse returned schema; reject invented IDs, extra keys, missing mandatory sections and truncated output.
4. Match all references to the frozen packet and approved seller claims. Reject unsupported factual/temporal claims; preserve unresolved contradictions as unknowns. Never coerce the brief into PASS.
5. Store a version only with explicit validation status and actual model/accounting receipt. `ready_for_review` requires completed persistence. Invalid content stays failed/held and cannot be exported as reviewed.

No new model call for validation or repair in v1. Existing deterministic grounding/identity rules are reused where compatible. Human review must check meaning and client relevance; it is not represented as proof that automatic semantic validation is complete.

## Review/export lifecycle

`imported → context_ready or blocked → generating → ready_for_review or failed/uncertain → human-reviewed exact version → export_prepared`.

A new human edit/regeneration produces a new unreviewed version. Append-only review/export events reference the immutable version/hash, current reviewer permission and selected manual destination descriptor/version. The source IDs, uncertainty and provenance remain in exports. Do not export a model-supplied approval status.

`export_prepared` means a local file was prepared, **not** received by Apollo/iGTM/Jungler, sent, scheduled, sequenced or synced. A browser cannot prove where a person later uploads it. Until the actual CRM/export format is confirmed, the artifact is a generic review CSV and a human-readable brief, not a promised Apollo re-import format.

CSV fields include client/workspace label, original source record ID, internal input row/version, supplied company/contact, brief statements, questions, unknowns, source links/dates/classes, chosen and actual model, context/source hashes, reviewer/version and prepared timestamp. Do not include raw prompts, secrets, unnecessary personal contact data or internal provider payloads. Formula-like cells and Unicode/control characters require defensive serialization even inside quoted CSV; test against spreadsheet interpretation, not just round-trip string parsing.

## Task/model behavior

The user selects from server-approved **enabled** task model entries. The task stores the exact policy, provider/model and credential-binding versions. Disabled selections are rejected, never mapped to “something similar.” UI choices such as generic Claude/Gemini logos do not count as transport support.

Normal completion requires selected/actual provider and model to match, structured/evidence validation to pass, usage/receipt persistence to succeed and the output to be stored. Accounting or storage failure after a potential paid call becomes pending/uncertain with the real receipt preserved. Repeated UI requests reuse operation identity; no blind repurchase. Limits include all underlying attempts and safe transient retries. No cross-provider fallback, planner, multi-agent fanout, model voting or unbounded evaluator loop.

Before any real operation: operator validation of that exact adapter/model/account, approved data-sharing policy, workspace binding, explicit budget and separate live authorization. The planning/test phase uses synthetic keys/responses and no provider network access.
