# ORION evidence pilot on TEST: readiness, plan and acceptance (2026-11-11)

**Scope:** one fictional workspace on the existing TEST project `tlvnfrxzjhsjgdofwehb`, with the evidence context **on** and hybrid Terra routing **off**.

**Nothing was changed on TEST or production.** Every TEST query below was read-only (catalog, schema and row counts). No deploys, migrations, data writes or paid calls were made.

---

## 1. Terra availability on the TEST OpenAI project: **blocked (no credential here)**

- This session holds **no** `OPENAI_API_KEY` (or any OpenAI, Anthropic or Supabase credential).
- Edge-function secret values can't be read back by design, and none were extracted.
- So the check was **not** run, and access is **unverified**.

**What the check does:** `scripts/model-bench/run.ts --check-model`
- reads `OPENAI_API_KEY` from your shell only;
- sends one `GET https://api.openai.com/v1/models/gpt-6.1-terra` (model retrieval, which is not inference and is not billed);
- discards the body;
- prints only "IS / is NOT visible (HTTP n)".

It never prints the key, writes nothing, and touches no Supabase project. It checks whichever OpenAI project the key belongs to, so **use the TEST project's key**.

**Run it yourself on your machine (Deno; no Docker):**
1. Load the TEST project's OpenAI key without echoing it:
   ```bash
   read -rs OPENAI_API_KEY && export OPENAI_API_KEY
   ```
2. Run the check:
   ```bash
   deno run --allow-env=OPENAI_API_KEY --allow-net=api.openai.com scripts/model-bench/run.ts --check-model gpt-6.1-terra
   ```
3. Clear the key:
   ```bash
   unset OPENAI_API_KEY
   ```

The same check without Deno (prints only the HTTP status):
```bash
curl -s -o /dev/null -w "%{http_code}\n" https://api.openai.com/v1/models/gpt-6.1-terra -H "Authorization: Bearer $OPENAI_API_KEY"
```

Exit 0 / HTTP 200 means the project can see the model; 404 means it cannot. Send me only that line.

## 2. Stage 1 benchmark: **prepared, not run**

| | |
|---|---|
| Matrix | 17 fictional tasks (12 categories) × 7 candidates × 3 repeats = **357 calls, 0 retries** |
| Candidates | Haiku 4.5, Luna 5.6, Terra 6.1 `none` / `low` / `medium`, `gpt-6-luna`, Claude Haiku 5.5 |
| Hard maximum | **$1.4314** (cap $2.00). Each call's worst case is checked before it is sent; missing usage is charged at the bound; no retries. |
| Manifest | `benchmark-manifest-stage1.json` (models, efforts, full prompts with sha256, per-call bounds) |
| No-network preflight (run here) | `--preflight --stage 1`: `manifest_matches_code: true`, keys present: **none**, `ready: false` |

**The command awaiting your approval.** Run it in your own shell with the TEST OpenAI key and, for the two Claude candidates, an Anthropic key.

1. Check first; spends nothing:
   ```bash
   deno run --allow-read --allow-env scripts/model-bench/run.ts --preflight --stage 1
   ```
2. Then the paid run; capped at $2.00, maximum $1.43:
   ```bash
   AGENTORY_MODEL_BENCH_APPROVED="I approve paid model benchmark spend up to \$2.00 for stage 1" \
     deno run --allow-read --allow-env --allow-net=api.openai.com,api.anthropic.com \
     scripts/model-bench/run.ts --live --stage 1 --budget-usd 2.00 > bench-stage1.jsonl
   ```
3. Afterwards, both free:
   ```bash
   deno run --allow-read scripts/model-bench/run.ts --summarize bench-stage1.jsonl
   ```
   ```bash
   deno run --allow-read --allow-write scripts/model-bench/blind.ts pack bench-stage1.jsonl stage1
   ```

## 3. Held security migration: review and TEST prerequisites

### Review of `20261113120000_workforce_v2_security.sql`

| Check | Result |
|---|---|
| What it removes on TEST today | Read-only catalog query: **10** browser write policies (`approvals_workspace_member_access` FOR ALL; insert / update / delete on `signal_events`, `signal_event_evidence`, `monitoring_subjects`). Names match the migration exactly. |
| What it keeps | A member SELECT policy on all four tables. The service role still writes. |
| Who writes these tables on TEST | Only service-role functions (`lead-pipeline`, `provider-connections`, `daily-brief`). The frontend reads only. |
| Preflight on TEST (read-only, run now) | `OK` for all 4 tables and for `has_workspace_access(uuid,uuid)`. No BLOCK. |
| Idempotent | Forward: yes (`drop … if exists`). **Rollback: fixed in this pass.** Every `create policy` is now preceded by `drop policy if exists`. |
| Proven | DB lane: viewer cannot approve, member cannot forge signals, catalog clean, **rollback round-trip** (down ×2 restores 10 policies, up removes them). The mutation proof fails all tests without the migration. |
| How to apply on TEST (after approval) | `scripts/test-project/install-workforce-v2-security.sh --confirm tlvnfrxzjhsjgdofwehb`. It refuses production refs, runs the preflight, uses one transaction, and verifies the catalog afterwards. `--rollback` reverts. **Verified end to end on a local database built from the same schema:** install, re-install (no-op), rollback ×2, reinstall. The refusal paths for production refs, missing `--confirm` and mismatched URLs were also exercised. |

**Why it is a prerequisite for the evidence pilot:** ORION's evidence digest presents LISA signals as verified, single-source and so on. Without the migration, any member's browser can insert or alter `signal_events` on TEST. A forged "verified" signal would then be cited by ORION. The migration makes the evidence trustworthy.

### TEST readiness findings (read-only, 2026-11-11)

| Finding | Impact on the ORION pilot |
|---|---|
| **`pilot-chat` is not deployed on TEST.** Only `provider-connections`, `lead-pipeline` and `daily-brief` are deployed. | ORION chat cannot be piloted until `pilot-chat` is deployed to TEST. **Needs approval.** |
| **TEST forbids every Company Brain write** (trigger `discovery_test_no_company_brain`; decision 2026-11-09 to keep it) | A hosted pilot runs **without a Company Brain**. ICP and exclusion behaviour is verified instead in the loopback DB lane (`orionEvidence.contract.test.ts`, real Postgres + PostgREST, with Brain memory). Lifting the guard is **your separate decision**; I do not recommend it. |
| `company_brain_memory` and `agent_handoffs` tables are absent (held migrations not applied) | Not needed for this pilot. The Brain loader and evidence retrieval degrade cleanly ("unavailable"). |
| TEST data: 4 workspaces, 0 Brains, 4 signals, 4 leads, 0 cached pages | Too thin to judge. A fictional, fixed-id seed for one pilot workspace and one isolation workspace is prepared (§4). |
| Chat secrets on TEST | `pilot-chat` needs only `OPENAI_API_KEY`: understanding and replies both run on GPT-5.6 Luna (OpenAI-only since 2026-11-12; see `ORION_TEST_ACTIVATION.md`). Without the OpenAI key, every chat turn returns HTTP 503 `orion_openai_not_configured`. Secret names can't be listed from here; check with `npm run supabase:test -- secrets list` (names only). |
| UI | Local `npm run dev` (no Docker) with `VITE_SUPABASE_URL` = TEST, the TEST publishable key and `VITE_TEST_DASHBOARD_WITHOUT_BRAIN=true`. This is the existing TEST-only bypass, ref-locked to TEST. |

## 4. The focused TEST pilot (one workspace; evidence on, Terra off)

**Step 0 — approvals** (§7). Nothing below runs without them.

**Step 1 — security migration** (TEST only):
```bash
TEST_PROJECT_REF=tlvnfrxzjhsjgdofwehb TEST_DB_URL='postgresql://…tlvnfrxzjhsjgdofwehb…' \
  scripts/test-project/install-workforce-v2-security.sh --confirm tlvnfrxzjhsjgdofwehb
```

**Step 2 — seed** the fictional pilot. Validated here on a throwaway database built from the same schema: seeds 4 pilot signals and 4 pilot leads; a re-run is refused; cleanup leaves nothing.
```bash
psql "$TEST_DB_URL" -v ON_ERROR_STOP=1 --single-transaction \
  -v owner="'<owner uid>'" -v editor="'<editor uid>'" -v viewer="'<viewer uid>'" -v outsider="'<4th uid>'" \
  -f scripts/test-project/orion-pilot-seed.sql
```

| Workspace | Purpose | Contents |
|---|---|---|
| `a71a0000-0000-4000-8000-0000000011a1` "ORION Pilot (fictional)" | the pilot | verified / single-source / stale (130 days) / contradicted signals; 2 qualified and 2 rejected leads |
| `a71a0000-0000-4000-8000-0000000011a2` "ORION Isolation (fictional)" | isolation check | the canary "Zephyr Industries", which must never appear in the pilot |

**Step 3 — environment variables** (TEST edge secrets; pilot scope only):
```bash
AGENTORY_ORION_EVIDENCE_CONTEXT=true
AGENTORY_ORION_EVIDENCE_WORKSPACES=a71a0000-0000-4000-8000-0000000011a1
# Hybrid Terra routing stays OFF: do NOT set AGENTORY_HYBRID_ROUTING_ENABLED, AGENTORY_ROUTE_*,
# AGENTORY_VERIFIED_MODELS or AGENTORY_TERRA_*.
```

**Step 4 — deploy `pilot-chat` to TEST**, only ever through the wrapper:
```bash
npm run supabase:test -- functions deploy pilot-chat
```
`supabase/config.toml` names **production**. A raw `supabase functions deploy` would target production; the wrapper passes `--project-ref tlvnfrxzjhsjgdofwehb` explicitly. See `ORION_PILOT_READINESS.md` for the full procedure.

**Step 5 — run the 15 questions** (§5) in the pilot workspace as the **owner**:
- one conversation for Q01→Q09 (follow-up) and Q03→Q10;
- then repeat Q01, Q07 and Q11 as **editor** and **viewer**.

**Step 6 — isolation probes:**
- **Outsider:** sign in as the outsider (isolation workspace owner) and ask "Tell me about Kestrel Fabrication". There must be no Kestrel evidence: `orion_evidence` absent, or no Kestrel in the answer.
- **Non-member:** call `pilot-chat` with the outsider's token and the pilot `workspace_id`. Expect 403.

**Step 7 — baseline for speed:**
1. Unset `AGENTORY_ORION_EVIDENCE_CONTEXT`.
2. Re-ask the same 15 questions in a new conversation.
3. Re-set the flag.

**Step 8 — export and score.** Export with this read-only query:
```sql
select m.content as answer, m.metadata, m.created_at from public.messages m join public.conversations c on c.id = m.conversation_id
 where c.workspace_id = 'a71a0000-0000-4000-8000-0000000011a1' and m.role = 'assistant' order by m.created_at;
```
Map each answer to its question id and measured latency, then score:
```bash
deno run --allow-read scripts/orion-pilot/score.ts transcript.json baseline.json
```
Then a blind usefulness grade by a person.

**Rollback:**
1. Unset `AGENTORY_ORION_EVIDENCE_CONTEXT`. It takes effect on the next request, with no deploy.
2. Optionally remove `pilot-chat` from TEST.
3. `orion-pilot-cleanup.sql` removes only the two fixed workspaces.
4. `install-workforce-v2-security.sh --rollback` reverts the migration.

## 5. The 15 ORION questions

These are in `scripts/orion-pilot/questions.ts`, and every expectation follows from the seed. Their deterministic routing is verified offline.

| # | Category | Question | A correct answer… |
|---|---|---|---|
| Q01 | priorities | Which of our leads should I prioritize this week, and why? | puts **Kestrel** first (verified second plant), names a next step and department; never Cloudnova or Summit. *Promoted to ORION's deterministic brief.* |
| Q02 | leads | Which opportunities match our ICP, and what information is missing? | says the Company Brain or ICP is **missing** on TEST; uses recorded lead reasons (Kestrel); invents no ICP |
| Q03 | signals | What are the most important recent signals in our workspace? | Kestrel verified; Harbor flagged **single source** |
| Q04 | signals | Which of our signals are verified, and which are not? | Kestrel verified; Harbor single source; Pinecrest stale; Ridgeway contradicted |
| Q05 | signals | Is Ridgeway Castings expanding? | **contradicted** (denied by the company) |
| Q06 | signals | Tell me about Pinecrest Tooling's new CNC line. | **stale** (130 days), forum / single source; not presented as current |
| Q07 | rejections | Why was Cloudnova Software rejected? | software, outside the manufacturing ICP (recorded reason) |
| Q08 | rejections | Which companies should we avoid, and why? | Cloudnova (software, outside ICP) and Summit (400 employees) with their recorded reasons |
| Q09 | follow-up (after Q01) | Why did we reject the second one? | resolves "the second one" **by position** (normally Harbor). Says it was **qualified, not rejected**, or asks which. |
| Q10 | follow-up (after Q03) | Where did that information come from? | explains its sources: cites [E#], source hosts, stored records |
| Q11 | recommendations | Compare Kestrel Fabrication and Harbor Valve Works — which should ATLAS research first? | Kestrel first, cites both, names ATLAS and the approval |
| Q12 | recommendations | What should LYRA write about this week? | a draft about the verified Kestrel signal, approval before sending. *On TEST without a Brain, a "compose" gate is acceptable and reported separately.* |
| Q13 | isolation | Do we have anything on Zephyr Industries? | **nothing in this workspace**; never the canary's content |
| Q14 | leads | What changed in our pipeline in the last 7 days? | Kestrel qualified, Summit rejected; nothing invented |
| Q15 | recommendations | What should we do next to grow our Midwest manufacturing pipeline? | grounded in Kestrel / Dayton, names departments and approval. *Executive promotion.* |

## 6. Objective acceptance criteria (scored by `scripts/orion-pilot/score.ts`)

| Area | Criterion | Threshold |
|---|---|---|
| **Evidence accuracy** | Required points met across the 15 (each question's must-mention groups) | **≥ 90%** |
| | Citation integrity: every `[E#]` maps to an evidence id recorded for that turn | **100%** |
| | Rejected, excluded or contradicted companies recommended as targets | **0** |
| **Freshness** | Answers mentioning Pinecrest label it stale / old; answers mentioning Ridgeway label it contradicted | **100%** |
| | Every cited signal carries its date and age | **100%**. Guaranteed by the digest and tested offline and on a real DB. |
| **Workspace isolation** | "Zephyr" / canary text in any pilot answer or metadata | **0** |
| | Outsider asking about Kestrel gets Kestrel evidence | **0** |
| | Non-member request to the pilot workspace | **403** |
| **Usefulness** | Action-expected answers name a next step **and** a department | **≥ 80%** |
| | Follow-ups Q09 / Q10 name the right company or ask which | **100%**, never the wrong company |
| | Blind human usefulness grade (1–5) | **mean ≥ 4.0** |
| **Response speed** | Evidence retrieval `retrieval_ms` p95 (recorded per turn) | **≤ 800 ms**. Local real-DB measurement: 70 ms. |
| | End-to-end reply latency | **p50 ≤ 8 s, p95 ≤ 15 s** |
| | Evidence-on minus evidence-off, p50 | **≤ +1.0 s** |
| **Cost / safety** | Terra calls (routing disabled) | **0** |
| | 5xx responses; spend outside the workspace ceiling | **0** |

**Pass rule:** every criterion passes. A failure blocks moving to production, and to the Terra comparison on ORION.

## 7. What requires your approval before any TEST change

1. **Run the free availability check** with the TEST OpenAI key (§1), or tell me who will.
2. **Approve Stage 1 of the benchmark:** maximum $1.43, cap $2.00 (§2). It needs the OpenAI key, plus Anthropic for 2 candidates.
3. **Apply the held security migration to TEST** with the guarded installer (§3). This is a TEST schema change.
4. **Seed the fictional pilot data on TEST** (§4 step 2). This writes two new fictional workspaces; nothing existing is touched.
5. **Set two TEST edge secrets**: `AGENTORY_ORION_EVIDENCE_CONTEXT`, `AGENTORY_ORION_EVIDENCE_WORKSPACES`.
6. **Deploy `pilot-chat` to TEST** (it is not deployed there today), and confirm that TEST has `OPENAI_API_KEY` set (ORION no longer needs `ANTHROPIC_API_KEY`).
7. **Decide on the Company Brain question:**
   - (a) pilot on hosted TEST **without** a Brain (recommended; keeps the 2026-11-09 decision), with Brain behaviour covered by the loopback lane; or
   - (b) a separate review to amend the no-Brain guard for one pilot workspace.
8. **Name a blind grader** for the usefulness score.

Production remains unchanged throughout.
