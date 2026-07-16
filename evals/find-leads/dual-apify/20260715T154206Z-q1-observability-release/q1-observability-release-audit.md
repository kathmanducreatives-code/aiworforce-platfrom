# Q1 Observability Release — Live Audit (run-agent v81)

**Scope:** one authorized Q1 probe on TEST after merging PR #42 (staged-candidate
observability) and deploying run-agent v81. Observability-only release. No scoring
/ threshold / persistence changes, no migrations, no orchestrate deploy, no
production access, no second Q1, no benchmark.

**Classification:** **PASS — OBSERVABILITY AND REJECTION SAFETY** (with documented
gaps). `qualification_observability` is now present in the no_results payload, the
funnel reconciles, nothing sensitive is exposed, zero unqualified rows persisted,
DB deltas are all zero, and there was zero outreach. Per-candidate diagnostics
were **not** exercised this run because all 15 provider profiles were rejected at
the source/location gate **upstream** of qualification (source_gate_accepted = 0).

---

## 1. Release identifiers

| Item | Value |
|---|---|
| Merged main SHA | `bad040da8106b15b2b885ecbebac942754e85125` (Merge PR #42) |
| PR #42 merge commit | `bad040da` (source `1d2d37d3` contained) |
| Deploy source | working tree == merged main `bad040da` |
| run-agent | v80 → **v81** (verify_jwt=true) |
| orchestrate | **v31** (untouched) |
| TEST project | `zbwsbnqqpkvdhqwavjke` (bound; production `wqnigjhcwjxtmordrwno` not accessed) |
| Company Brain | `030f4f36-…`, md5 `4fc444f7f8f05b18644be7e9219d7240` (unchanged pre/post) |

Merged-main validation: full `_shared` **1134 pass / 1 pre-existing**; focused
122/122; obs module `deno check` clean; run-agent **4 pre-existing** deno errors;
`tsc --noEmit` pass; `npm run build` pass; generated `mcp/index.ts` reverted.

Boot checks: unauth → **401**, auth+invalid → **400**; baseline unchanged.

---

## 2. Q1 request

- Authenticated existing TEST user (verified id `9cfdd84f-b036-4eac-9d50-1a4627f4cba6`; token in-shell only, never printed, unset after).
- One `orchestrate` request: workspace `00000000-…-0001`, "Using my ICP, find me 5 hot founders I should contact right now.", `tool_input.execution_mode=source_and_qualify_only`, `tool_input.max_results=5`. HTTP **200**.
- Plan `860a19c8-c855-44f7-b88a-42932bb9e523`; planner ai; agents [scout, aria].

---

## 3. Result + routing

| Item | Value |
|---|---|
| Plan status | failed → **no_results** terminal |
| Scout task | `90814183-18d0-4a64-9b66-73ed6e0f3c02` (status complete) |
| Downstream Aria task | **none** (0 accepted → ranking skipped) |
| Actor runs | 2 attempts (exact + broadened; 2 `tool_used` events) |
| target_entity / output_type | **person** / **qualified_people** |
| routing_source | **original_user_instruction** |
| actor_key / impl | **apify_people_search** / **harvestapi/linkedin-profile-search** |
| Narrative | "I reviewed 15 profiles; 0 matched the requested persona and location closely enough. Main reject reasons: wrong city/region (strict)." |

---

## 4. qualification_observability (present ✓)

```json
{
  "funnel": {
    "raw_count": 15,
    "normalized_count": 0,
    "source_gate_accepted": 0,
    "hard_gate_rejected": 0,
    "qualification_accepted": 0,
    "qualification_rejected": 0,
    "staged_count": 0,
    "persisted_count": 0,
    "downstream_aria_count": 0,
    "reconciles": true
  },
  "truncated": 0,
  "candidates": [],
  "target_entity": "person",
  "expected_artifact_type": "person_candidate"
}
```

- **Present in no_results:** yes (the v80 gap is closed — the payload now carries the funnel).
- **Reconciles:** true (`source_gate_accepted 0 == hard_gate_rejected 0 + qualification_accepted 0 + qualification_rejected 0`).
- **Candidates:** 0. All 15 raw profiles were rejected by the **source/location gate** ("wrong city/region (strict)") before reaching qualification, so no per-candidate diagnostics were produced (diagnostics are built over the source-gate-accepted set).
- **Sanitization:** the object contains only the funnel, an empty candidates array, and `target_entity`/`expected_artifact_type` — no emails, phones, tokens, headers, raw payloads, query strings, URL fragments, or secret-shaped values.

---

## 5. Database deltas (vs clean baseline)

| Metric | Baseline | After Q1 | Δ |
|---|---|---|---|
| lead_candidates | 426 | 426 | **0** |
| contacts | 165 | 165 | **0** |
| signals | 426 | 426 | **0** |
| accounts | 149 | 149 | **0** |
| outreach_drafts | 64 | 64 | **0** |
| approvals | 25 | 25 | **0** |
| Penn tasks | 24 | 24 | **0** |
| outreach_activities | 4 | 4 | **0** |
| Company Brain md5 | 4fc444f7… | 4fc444f7… | unchanged |

- Intended persisted (funnel.persisted_count) = **0**; confirmed DB inserts = **0**; `rejected_provenance_count` = **0** → no mismatch.
- No Aria task, no Penn task, no drafts/approvals/queued/sent outreach.

---

## 6. Rejection classification

No candidate reached the qualification stage (source_gate_accepted = 0), so there
are **no per-candidate `rejection_class` values** this run. In aggregate:

| Class | Count | Note |
|---|---|---|
| hard_source (wrong geography, at source gate) | 15 (aggregate) | "wrong city/region (strict)" — dominant + only reason |
| icp_mismatch / missing_timing / qualification_threshold / missing_qualification | 0 | not reached |

Dominant rejection reason: **wrong city/region (strict)** — a source/location-gate
rejection, upstream of the qualification diagnostics.

---

## 7. Verdict

**PASS — OBSERVABILITY AND REJECTION SAFETY.**
- qualification_observability present = yes
- funnel reconciles = yes
- sanitized (no sensitive data) = yes
- rejected candidates persist = no (0 persisted, 0 side-effects)
- DB deltas match = yes (all 0)
- zero outreach = yes; Company Brain unchanged; production untouched

- rejection safety demonstrated = **yes**
- positive accepted-persistence demonstrated = **no** (0 qualified)
- per-candidate staged diagnostics demonstrated live = **no** (all rejected at the
  source/location gate before qualification)

**safe_to_begin_benchmark = NO.**

### Documented gaps / next engineering step
1. **`normalized_count` is imprecise:** it is set to the source-gate-accepted count
   (0 here) while `raw_count` is 15 — implying nothing was normalized. It should
   report the normalized (pre-source-gate) count. Labeling fix, not a reconciliation
   error (the lower funnel reconciles).
2. **Source-gate rejections lack per-candidate diagnostics:** diagnostics are built
   only over the source-gate-accepted set, so wrong-geography / hard-source
   rejections at the source gate get aggregate counts + a narrative reason but no
   per-profile diagnostic. Extend diagnostics to cover source-rejected candidates.
3. **Provider query returns all out-of-region profiles** ("wrong city/region
   strict") for a US founder search — investigate the location-gate strictness /
   query so a run can pass the source gate and exercise the staged-candidate
   diagnostics + positive path. (Not changed here — observability-only release.)
4. After (1)-(3), run one authorized Q1 that yields source-accepted candidates to
   exercise per-candidate staged diagnostics and (ideally) a positive persistence.

No credentials, tokens, or authorization headers appear in this report.
