// MISSION CONTRACT IN PRODUCTION CHAT (ADR-001 stages A–C) and COMPANY BRAIN AUTHORITY.
//
// Pins: flags default off with zero model calls; the shadow never changes the mission and
// cannot be executed; v4 cards are the approved contract with no v1 fallback; approval binds
// the complete contract (tampering is detected, history runs as before); execution-side
// integrity refuses a changed contract; the Brain never overrides the user and never turns a
// preference into a gate; and the comparison detects each semantic defect class.
import { assert, assertEquals, assertNotEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { contractFromProposal } from "../../../supabase/functions/_shared/missionContract/interpret.ts";
import { approvability, contractHash, type MissionContract, type Requirement } from "../../../supabase/functions/_shared/missionContract/contract.ts";
import {
  bindingDecision, carrierDivergence, chatContractFlags, compareContracts, contractBindingOf, contractMissionIntegrity,
  missionFromContract, verifyApprovalBinding,
} from "../../../supabase/functions/_shared/missionContract/chatMission.ts";
import { checkStart, contractForCard } from "../../../supabase/functions/_shared/missionContract/chatIntegration.ts";
import { applyCompanyBrain, BRAIN_SIZE_POLICY } from "../../../supabase/functions/_shared/missionContract/brain.ts";
import { contractFromMission } from "../../../supabase/functions/_shared/missionContract/boundary.ts";
import type { ContractGenerate } from "../../../supabase/functions/_shared/missionContract/gptInterpreter.ts";
import { criteriaOf } from "../../../supabase/functions/_shared/missionCriteriaReader.ts";
import { isLeadMissionV1 } from "../../../supabase/functions/_shared/leadMission.ts";
import { compilePhrasing, loadCases } from "../../../scripts/dev/interpretation-corpus.ts";
import { v4From } from "../../../scripts/dev/contract-corpus.ts";

const Q = "Find 10 US B2B SaaS companies with 50–200 employees hiring Account Executives but not SDRs in the last 14 days.";
const understanding = {
  roles: [{ span: "Account Executives", title: "account_executive", family: null, relation: "required" },
    { span: "SDRs", title: "sales_development_representative", family: null, relation: "excluded" }],
  role_match: "any", places: [{ span: "US", place: "united states", other_place: null, scope: "headquarters", necessity: "required" }],
  industries: [{ span: "B2B SaaS", industry: "B2B SaaS", necessity: "required" }],
  signals: [{ span: "hiring Account Executives", kind: "hiring", necessity: "required" }],
  signal_logic: "all", ambiguities: [], unsupported: [],
};
const proposal = (over: Record<string, unknown> = {}) => ({
  understanding, signal_windows: [{ event: "hiring", days: 14, phrase: "in the last 14 days", signal: null }],
  deliverable: { entity: "company" as const, count: 10, count_span: "10", person_roles: [] },
  company_size: { min: 50, max: 200, necessity: "required" as const, span: "50–200 employees" },
  funding_stages: [], forbid_broadening: [], ...over,
});
const contract = (over: Record<string, unknown> = {}) => contractFromProposal(Q, proposal(over) as never).contract;
const gen = (value: unknown, calls: { n: number }): ContractGenerate => (_q) => {
  calls.n++;
  return Promise.resolve({ ok: true, value, model: "stub" });
};
const failing = (calls: { n: number }): ContractGenerate => () => { calls.n++; return Promise.resolve({ ok: false, code: "upstream_500" }); };
const neverCalled: ContractGenerate = () => { throw new Error("a model call was made with every flag off"); };
const OFF = { shadow: false, v4: false, enforceBinding: false };
// A real v1 mission: a recorded corpus phrasing through the production v1 compiler.
const v1Mission = () => compilePhrasing(loadCases()[0].phrasings[0], "v1");
const sizeOf = (c: MissionContract) => c.requirements.find((r) => r.dimension === "company_size") as Extract<Requirement, { dimension: "company_size" }> | undefined;

// ── Flags ────────────────────────────────────────────────────────────────────

Deno.test("chat contract flags: every switch is OFF unless set exactly", () => {
  assertEquals(chatContractFlags(() => undefined), OFF);
  assertEquals(chatContractFlags((k) => ({ AGENTORY_CHAT_CONTRACT_V4: "true", AGENTORY_CHAT_CONTRACT_V4_SHADOW: "on", AGENTORY_CHAT_CONTRACT_BINDING: "enabled" })[k]), OFF);
  assertEquals(chatContractFlags((k) => ({ AGENTORY_CHAT_CONTRACT_V4: "enabled", AGENTORY_CHAT_CONTRACT_V4_SHADOW: "enabled", AGENTORY_CHAT_CONTRACT_BINDING: "enforce" })[k]),
    { shadow: true, v4: true, enforceBinding: true });
});

// ── Stage A: flags off and shadow ────────────────────────────────────────────

Deno.test("flags off (production): the v1 mission is returned untouched, bound, with zero model calls", async () => {
  const m = v1Mission();
  const before = JSON.stringify(m);
  const d = await contractForCard({ message: Q, v1Mission: m, flags: OFF, generate: neverCalled, brain: null });
  assertEquals(d.kind, "mission");
  if (d.kind !== "mission") return;
  assert(d.mission === m, "the very same object");
  assertEquals(JSON.stringify(m), before);
  assertEquals(d.source, "v1");
  assert("hash" in d.metadata.mission_contract_binding && typeof d.metadata.mission_contract_binding.hash === "string");
  assertEquals(d.metadata.mission_contract_shadow, undefined);
});

Deno.test("shadow: v4 is read beside v1 and compared; the mission stays v1 and the shadow carries no executable mission", async () => {
  const m = v1Mission();
  const calls = { n: 0 };
  const d = await contractForCard({ message: Q, v1Mission: m, flags: { ...OFF, shadow: true }, generate: gen(proposal(), calls), brain: null });
  assertEquals(calls.n, 1);
  assert(d.kind === "mission" && d.mission === m && d.source === "v1");
  if (d.kind !== "mission") return;
  const sh = d.metadata.mission_contract_shadow as Record<string, unknown>;
  assertEquals(sh.version, "contract-shadow-v1");
  assert(Array.isArray(sh.added) && Array.isArray(sh.removed));
  // Non-secret: no request text in the comparison.
  assert(!JSON.stringify(sh).includes("Find 10"));
  assert(!("mission" in sh) && !("criteria" in sh));
});

Deno.test("shadow: a model failure is recorded and changes nothing", async () => {
  const m = v1Mission();
  const calls = { n: 0 };
  const d = await contractForCard({ message: Q, v1Mission: m, flags: { ...OFF, shadow: true }, generate: failing(calls), brain: null });
  assert(d.kind === "mission" && d.mission === m);
  if (d.kind !== "mission") return;
  assertEquals((d.metadata.mission_contract_shadow as { error: string }).error, "upstream_500");
});

// ── Stage B: v4 card ─────────────────────────────────────────────────────────

Deno.test("v4: the card's mission IS the contract — frozen criteria, bound by the contract hash, a valid lead-mission-v1", async () => {
  const calls = { n: 0 };
  const d = await contractForCard({ message: Q, v1Mission: v1Mission(), flags: { ...OFF, v4: true }, generate: gen(proposal(), calls), brain: null });
  assert(d.kind === "mission" && d.source === "v4");
  if (d.kind !== "mission") return;
  assert(isLeadMissionV1(d.mission));
  const m = d.mission as unknown as Record<string, unknown>;
  assertEquals(m.criteria_contract_version, "criteria-v1");
  const c = m.mission_contract as MissionContract;
  assertEquals((d.metadata.mission_contract_binding as { hash: string }).hash, await contractHash(c));
  assertEquals(m.mission_contract_hash, await contractHash(c));
  // Every hard criterion traces to a required requirement of the approved contract.
  const required = new Set(c.requirements.filter((r) => r.necessity === "required").map((r) => r.id));
  for (const cr of criteriaOf(m as never)) if (cr.kind === "hard") assert(required.has(cr.id), `${cr.id} is not an approved requirement`);
  assertEquals((await contractMissionIntegrity(m)).status, "valid");
});

Deno.test("v4: a model failure is refused honestly — never a v1 fallback reading", async () => {
  const d = await contractForCard({ message: Q, v1Mission: v1Mission(), flags: { ...OFF, v4: true }, generate: failing({ n: 0 }), brain: null });
  assertEquals(d.kind, "refuse");
  if (d.kind === "refuse") assertEquals(d.reason, "interpretation_failed");
});

Deno.test("v4: an ambiguity is asked, a contradiction is refused (never guessed)", async () => {
  const amb = { ...understanding, ambiguities: [{ span: "B2B SaaS", question: "Do you mean software sold to businesses only?" }] };
  const a = await contractForCard({ message: Q, v1Mission: v1Mission(), flags: { ...OFF, v4: true }, generate: gen(proposal({ understanding: amb }), { n: 0 }), brain: null });
  assertEquals(a.kind, "ask");
  const contradictory = proposal({ company_size: { min: 200, max: 50, necessity: "required", span: "50–200 employees" } });
  const r = await contractForCard({ message: Q, v1Mission: v1Mission(), flags: { ...OFF, v4: true }, generate: gen(contradictory, { n: 0 }), brain: null });
  assertEquals(r.kind, "refuse");
});

Deno.test("v4 bridge: every approvable corpus phrasing round-trips to its exact contract hash (54/55; M20 asks)", async () => {
  let n = 0;
  const blocked: string[] = [];
  for (const c of loadCases()) for (const p of c.phrasings) {
    const k = contractFromProposal(p.query, v4From(p as never)).contract;
    if (!approvability(k).ok) { blocked.push(c.id); continue; }
    const m = await missionFromContract(k);
    assertEquals((await contractBindingOf(m)).hash, await contractHash(k), `${c.id}/${p.label}`);
    n++;
  }
  // MRLE Phase 0: M20 ("growing their sales team") keeps "sales team" as a REQUIRED item no tool
  // checks; it is now a question instead of a silently approved "Not checked" (audit E2).
  assertEquals([n, blocked], [54, ["M20"]]);
});

Deno.test("v4 bridge: carriers never ADD a hard requirement a legacy re-derivation could gate on", async () => {
  // A legacy re-reading of the carriers may only fail to see a requirement (which the frozen
  // criteria keep); it must never invent one the contract does not hold.
  for (const c of loadCases()) for (const p of c.phrasings) {
    const k = contractFromProposal(p.query, v4From(p as never)).contract;
    if (!approvability(k).ok) continue;
    const d = carrierDivergence(await missionFromContract(k) as never);
    assertEquals(d.added, [], `${c.id}/${p.label}`);
  }
});

Deno.test("v4 bridge: a preference never narrows a carrier (company_profile holds only required values)", async () => {
  const k = contract({ company_size: { min: 50, max: 200, necessity: "preferred", span: "50–200 employees" } });
  const m = await missionFromContract(k) as unknown as { company_profile: { employee_range?: unknown }; soft_preferences: Record<string, unknown> };
  assertEquals(m.company_profile.employee_range, undefined);
  assertEquals(m.soft_preferences.employee_range, { min: 50, max: 200 });
});

// ── Stage C: approval binding ────────────────────────────────────────────────

Deno.test("binding: the same mission matches; a dropped hard requirement is a mismatch, refused only when enforced", async () => {
  const m = await missionFromContract(contract());
  const card = { mission_contract_binding: await contractBindingOf(m) };
  assertEquals((await checkStart({ started: m, cardMetadata: card, flags: OFF })).verdict.status, "match");
  // Tamper: drop the size requirement from both the contract and the criteria consistently.
  const k2 = contract({ company_size: null });
  const tampered = await missionFromContract(k2);
  const observe = await checkStart({ started: tampered, cardMetadata: card, flags: OFF });
  assertEquals(observe.verdict.status, "mismatch");
  assertEquals(observe.decision, "run"); // observe mode: logged, behaviour unchanged
  const enforce = await checkStart({ started: tampered, cardMetadata: card, flags: { ...OFF, enforceBinding: true } });
  assertEquals(enforce.decision, "refuse");
});

Deno.test("binding: a preference turned into a requirement (or the reverse) changes the approval identity", async () => {
  const hard = await contractHash(contract());
  const soft = await contractHash(contract({ company_size: { min: 50, max: 200, necessity: "preferred", span: "50–200 employees" } }));
  assertNotEquals(hard, soft);
});

Deno.test("binding: a historical card (no binding stored) runs exactly as before, even when enforced", async () => {
  const v = await verifyApprovalBinding(v1Mission(), undefined);
  assertEquals(v.status, "unbound");
  assertEquals(bindingDecision(v, { enforceBinding: true }), "run");
});

Deno.test("binding: a v1 mission is bound through the boundary (history keeps working)", async () => {
  const m = v1Mission();
  const b = await contractBindingOf(m);
  const conv = contractFromMission(m as never);
  assert(conv.ok);
  if (conv.ok) assertEquals((b as { hash: string }).hash, await contractHash(conv.contract));
  assertEquals((await contractMissionIntegrity(m)).status, "not_contract");
});

Deno.test("binding: a v4 mission with no verifiable card is refused when enforced (it cannot be historical)", async () => {
  const m = await missionFromContract(contract());
  const r = await checkStart({ started: m, cardMetadata: null, flags: { ...OFF, enforceBinding: true } });
  assertEquals(r.decision, "refuse");
});

// ── Execution-side integrity ─────────────────────────────────────────────────

Deno.test("integrity: criteria edited beside an untouched contract are refused before execution", async () => {
  const m = await missionFromContract(contract()) as unknown as Record<string, unknown>;
  const edited = { ...m, criteria: (m.criteria as Record<string, unknown>[]).filter((c) => c.dimension !== "company_size") };
  assertEquals((await contractMissionIntegrity(edited)).status, "invalid");
});

Deno.test("integrity: a contract changed after approval (hash no longer matches) is refused", async () => {
  const m = await missionFromContract(contract()) as unknown as Record<string, unknown>;
  const other = await missionFromContract(contract({ company_size: null })) as unknown as Record<string, unknown>;
  // Swap in a different (self-consistent) contract + criteria, keep the approved hash.
  const swapped = { ...other, mission_contract_hash: m.mission_contract_hash };
  assertEquals((await contractMissionIntegrity(swapped)).status, "invalid");
});

// ── The comparison detects each semantic defect class ────────────────────────

Deno.test("comparison: dropped, invented, strengthened, weakened and changed requirements are each reported", async () => {
  const base = contract();
  const same = await compareContracts(base, base);
  assert(same.identical_meaning);
  const dropped = await compareContracts(base, contract({ company_size: null }));
  assertEquals(dropped.removed, ["company_size"]);
  assertEquals(dropped.plan_hard.removed, ["company_size"]);
  const invented = await compareContracts(contract({ company_size: null }), base);
  assertEquals(invented.added, ["company_size"]);
  const weakened = await compareContracts(base, contract({ company_size: { min: 50, max: 200, necessity: "preferred", span: "50–200 employees" } }));
  assertEquals(weakened.weakened, ["company_size"]);
  const strengthened = await compareContracts(contract({ company_size: { min: 50, max: 200, necessity: "preferred", span: "50–200 employees" } }), base);
  assertEquals(strengthened.strengthened, ["company_size"]);
  const changed = await compareContracts(base, contract({ company_size: { min: 50, max: 500, necessity: "required", span: "50–200 employees" } }));
  assertEquals(changed.changed, ["company_size"]);
  assert(!changed.identical_meaning);
});

// ── Company Brain authority ──────────────────────────────────────────────────

Deno.test("brain: the user's stated size outranks the Brain's size policy, and the conflict is visible", () => {
  const { contract: c, report } = applyCompanyBrain(contract(), { employee_min: 1, employee_max: 50, employee_policy: true });
  assertEquals(sizeOf(c)!.min, 50);
  assertEquals(sizeOf(c)!.max, 200);
  assertEquals(report.notApplied[0].dimension, "company_size");
  assertEquals(report.notApplied[0].authority, "policy");
});

Deno.test("brain: an enforced size policy fills an open size as a REQUIRED, attributed, disclosed requirement", () => {
  const { contract: c, report } = applyCompanyBrain(contract({ company_size: null }), { employee_min: 11, employee_max: 200, employee_policy: true });
  const s = sizeOf(c)!;
  assertEquals([s.min, s.max, s.necessity, s.origin.source, s.origin.policy], [11, 200, "required", "company_brain_policy", BRAIN_SIZE_POLICY]);
  assert(c.assumptions.some((a) => a.requirementId === s.id), "shown on the card as an assumption");
  assertEquals(report.applied[0].authority, "policy");
  assert(approvability(c).ok);
});

Deno.test("brain: preferences fill only open dimensions and are NEVER required", () => {
  const { contract: c, report } = applyCompanyBrain(contract(), { industries: ["Fintech"], locations: ["Canada"], stages: ["seed"] });
  // Geography and industry were stated by the user: not added to, not narrowed.
  assert(!c.requirements.some((r) => r.dimension === "geography" && r.place === "Canada"));
  assert(!c.requirements.some((r) => r.dimension === "industry" && r.value === "Fintech"));
  assertEquals(report.notApplied.map((x) => x.dimension).sort(), ["geography", "industry"]);
  // Stage was open: added, as a preference only.
  const st = c.requirements.find((r) => r.dimension === "company_stage")!;
  assertEquals([st.necessity, st.origin.source], ["preferred", "company_brain_preference"]);
  for (const r of c.requirements) if (r.origin.source === "company_brain_preference") assertEquals(r.necessity, "preferred");
});

Deno.test("brain: the hard requirement set changes only by the explicit size policy, never by a preference", async () => {
  const before = contract({ company_size: null });
  const prefOnly = applyCompanyBrain(before, { industries: ["Fintech"], stages: ["seed"], locations: ["Canada"] }).contract;
  const cmp = await compareContracts(before, prefOnly);
  assertEquals(cmp.plan_hard.added, []);
  assertEquals(cmp.strengthened, []);
});

Deno.test("brain: applied once — a contract already carrying Brain requirements is unchanged", () => {
  const once = applyCompanyBrain(contract({ company_size: null }), { employee_min: 11, employee_max: 200, employee_policy: true }).contract;
  const twice = applyCompanyBrain(once, { employee_min: 1, employee_max: 10, employee_policy: true });
  assertEquals(twice.contract, once);
  assertEquals(twice.report.status, "nothing_to_apply");
});

Deno.test("brain in the v4 card: applied before approval, so it is part of the approved hash", async () => {
  const d = await contractForCard({
    message: Q, v1Mission: v1Mission(), flags: { ...OFF, v4: true }, generate: gen(proposal({ company_size: null }), { n: 0 }),
    brain: { employee_min: 11, employee_max: 200, employee_policy: true, industries: ["Fintech"] },
  });
  assert(d.kind === "mission");
  if (d.kind !== "mission") return;
  const c = (d.mission as { mission_contract: MissionContract }).mission_contract;
  assert(c.requirements.some((r) => r.origin.source === "company_brain_policy"));
  assertEquals((d.metadata.mission_contract_binding as { hash: string }).hash, await contractHash(c));
  assertEquals(d.metadata.mission_contract_brain?.status, "applied");
});

// ── Evidence-backed verdicts: an unknown is never verified, even with evidence attached ──

Deno.test("verdicts: an UNKNOWN result stays unverified even when evidence is attached; an unknown or unmapped result never satisfies", async () => {
  const { requirementVerdicts } = await import("../../../supabase/functions/_shared/missionContract/invariants.ts");
  const c = contract();
  const geo = c.requirements.find((r) => r.dimension === "geography")!.id;
  const ev = [{ evidence_id: "e1", actor: "apify", url: "https://example.com", observed_at: "2026-11-06T00:00:00Z", occurred_at: null }];
  for (const result of ["unknown", "error", "", "maybe"]) {
    const v = requirementVerdicts(c, [{ criterion_id: geo, result, reason: "no data", evidence: ev }]).find((x) => x.requirementId === geo)!;
    assertEquals(v.status, "unverified", result);
    assertEquals(v.decision, "pending", result);
  }
});

// ── Shadow baseline (offline, $0): v3 production reading vs the v4 contract ──

Deno.test("shadow baseline: on 55 corpus phrasings and 162 recorded live answers, v4 never adds or strengthens a hard requirement over v3, and the only hard-plan difference is the documented M17 duplicate", async () => {
  const { shadowRows, summariseShadow } = await import("../../../scripts/dev/mission-contract-shadow.ts");
  const rows = await shadowRows();
  const s = summariseShadow(rows);
  for (const set of [s.corpus_v3, s.run24_v3]) {
    assertEquals(set.with_added, 0);
    assertEquals(set.with_strengthened, 0);
    assertEquals(set.with_weakened, 0);
  }
  // MRLE Phase 0: v4 now refuses to approve a REQUIRED "Not checked" item that v3 ran without.
  // The only such row in the corpus is M20 ("growing their sales team": "sales team" unchecked).
  for (const [set, stat] of [["corpus", s.corpus_v3], ["run24", s.run24_v3]] as const) {
    const differs = rows.filter((r) => r.baseline === "v3" && r.set === set && r.comparison && r.comparison.approval.baseline !== r.comparison.approval.candidate);
    assertEquals(stat.approval_differs, differs.length);
    for (const r of differs) {
      assertEquals(r.id, "M20", `${r.set} ${r.id}/${r.label}`);
      assertEquals(r.comparison!.approval.candidate, false, "v4 asks; it never approves what v3 refused");
    }
  }
  const planDiffs = rows.filter((r) => r.baseline === "v3" && r.comparison &&
    (r.comparison.plan_hard.added.length || r.comparison.plan_hard.removed.length));
  for (const r of planDiffs) {
    assertEquals(r.id, "M17", `${r.set} ${r.id}/${r.label}`);
    assertEquals(r.comparison!.plan_hard, { added: [], removed: ["industry:include:saas"] });
  }
  // One recorded answer is a genuine clarification (M07): it is an error row, never a guess.
  assertEquals(s.run24_v3.errors, 1);
});

// ── The version boundary: contract missions never re-read the sentence at run time ──

Deno.test("authority: a v4 mission is read through its contract; a v1 mission keeps the legacy path", async () => {
  const { interpretationAuthority, executionQueryOf, contractQueryText } = await import("../../../supabase/functions/_shared/missionContract/authority.ts");
  const m = await missionFromContract(contract());
  assertEquals(interpretationAuthority(m), "contract");
  assertEquals(interpretationAuthority(v1Mission()), "legacy");
  const text = executionQueryOf(m as never);
  assertEquals(text, contractQueryText((m as unknown as { mission_contract: MissionContract }).mission_contract));
  assert(!text.includes("SDR"), "an excluded role is never written into free text");
  assert(!text.includes("Find"), "the sentence is not the text");
  assertEquals(executionQueryOf(v1Mission() as never), String((v1Mission() as { original_user_query: string }).original_user_query));
});

Deno.test("authority: job-family inference from the contract matches the sentence's whenever the sentence yields one (corpus)", async () => {
  const { contractQueryText } = await import("../../../supabase/functions/_shared/missionContract/authority.ts");
  const { compileJobIntent } = await import("../../../supabase/functions/_shared/jobIntentTaxonomy.ts");
  let compared = 0;
  for (const c of loadCases()) for (const p of c.phrasings) {
    const k = contractFromProposal(p.query, v4From(p as never)).contract;
    if (!k.requirements.some((r) => r.dimension === "signal" && r.kind === "hiring")) continue;
    const fromSentence = compileJobIntent(p.query).family_key;
    const fromContract = compileJobIntent(contractQueryText(k)).family_key;
    if (fromSentence !== null) { assertEquals(fromContract, fromSentence, `${c.id}/${p.label}`); compared++; }
    else assertNotEquals(fromContract, undefined);
  }
  assert(compared >= 40);
});

Deno.test("authority: run-time Brain gates for a v4 mission are exactly the contract's (no separate size rule, no keywords)", async () => {
  const { runtimeBrainGatesFromContract } = await import("../../../supabase/functions/_shared/missionContract/authority.ts");
  const withBrain = applyCompanyBrain(contract({ company_size: null }), {
    employee_min: 11, employee_max: 200, employee_policy: true, excluded_industries_explicit: ["Staffing"],
  }).contract;
  const g = runtimeBrainGatesFromContract(withBrain);
  assertEquals([g.employee_min, g.employee_max, g.hard_constraints, g.disqualifier_keywords], [null, null, [], []]);
  assertEquals(g.excluded_industries, ["Staffing"]);
});

Deno.test("brain: an explicit workspace exclusion that conflicts with the request blocks approval as a question; a generic one yields", () => {
  const ask = applyCompanyBrain(contract(), { excluded_industries_explicit: ["SaaS"] });
  assertEquals(ask.contract.ambiguities.length, 1);
  assert(!approvability(ask.contract).ok);
  const yields = applyCompanyBrain(contract(), { excluded_industries_generic: ["SaaS"] });
  assertEquals(yields.contract.ambiguities.length, 0);
  assert(!yields.contract.requirements.some((r) => r.dimension === "exclusion" && JSON.stringify(r.values).includes("SaaS")));
  const applies = applyCompanyBrain(contract(), { excluded_industries_explicit: ["Staffing"] });
  const ex = applies.contract.requirements.find((r) => r.dimension === "exclusion" && r.origin.source === "company_brain_policy")!;
  assertEquals(ex.necessity, "required");
});

Deno.test("chat contract flags: a workspace allowlist scopes shadow and v4 (canary), never binding", () => {
  const env = (k: string) => ({ AGENTORY_CHAT_CONTRACT_V4: "enabled", AGENTORY_CHAT_CONTRACT_V4_SHADOW: "enabled", AGENTORY_CHAT_CONTRACT_BINDING: "enforce", AGENTORY_CHAT_CONTRACT_V4_WORKSPACES: "ws-canary, ws-two" })[k];
  assertEquals(chatContractFlags(env, "ws-canary"), { shadow: true, v4: true, enforceBinding: true });
  assertEquals(chatContractFlags(env, "ws-other"), { shadow: false, v4: false, enforceBinding: true });
  assertEquals(chatContractFlags(env, null), { shadow: false, v4: false, enforceBinding: true });
});

// ── Live study v4 (run 42194537607, 2026-11-06): 164/165; the one failure, pinned ──

const STUDY_V4 = new URL("../../../docs/benchmarks/live-paraphrase/2026-11-06-contract-v4.json", import.meta.url);

Deno.test("study v4 M07#3: a quoted excluded role the model left without an id is resolved from the user's own word, never dropped", async () => {
  const d = JSON.parse(await Deno.readTextFile(STUDY_V4));
  const row = d.rows.find((r: { case: string; repeat: number; label: string }) => r.case === "M07" && r.repeat === 3 && r.label.startsWith("exclusion restated"));
  const p = loadCases().find((c) => c.id === "M07")!.phrasings.find((x) => x.label === row.label)!;
  // The recorded answer: "SDRs" excluded, title null, family null.
  assert(row.proposal.answer.understanding.roles.some((r: { span: string; title: unknown; family: unknown }) => r.span === "SDRs" && r.title === null && r.family === null));
  const { contract: k } = contractFromProposal(p.query, row.proposal.answer);
  const hiring = k.requirements.find((r) => r.dimension === "signal" && r.kind === "hiring") as Extract<Requirement, { dimension: "signal" }>;
  assert((hiring.excludedRoleTerms ?? []).length === 1, JSON.stringify(hiring.excludedRoleTerms));
  assertEquals(k.ambiguities, []);
});

Deno.test("v4: a role the user named that no registry can identify becomes a blocking question, never a silent omission", () => {
  const q = "Find US companies hiring Account Executives but not growth hackers.";
  const answer = {
    understanding: {
      roles: [{ span: "Account Executives", title: "account_executive", family: null, relation: "required" },
        { span: "growth hackers", title: null, family: null, relation: "excluded" }],
      role_match: "any", places: [{ span: "US", place: "united states", other_place: null, scope: "headquarters", necessity: "required" }],
      industries: [], signals: [{ span: "hiring Account Executives", kind: "hiring", necessity: "required" }],
      signal_logic: "all", ambiguities: [], unsupported: [],
    },
    signal_windows: [], deliverable: { entity: "company", count: 5, count_span: null, person_roles: [] },
    company_size: null, funding_stages: [], forbid_broadening: [],
  };
  const { contract: k } = contractFromProposal(q, answer as never);
  assertEquals(k.ambiguities.length, 1);
  assert(k.ambiguities[0].question.includes("growth hackers"));
  assert(!approvability(k).ok, "not approvable until the user answers");
});

Deno.test("study v4: every recorded live answer reads correctly through the current interpreter (165/165)", async () => {
  const { compare, summarise } = await import("../../../scripts/dev/interpretation-corpus.ts");
  const { v4Expect } = await import("../../../scripts/dev/contract-corpus.ts");
  const { compileContract } = await import("../../../supabase/functions/_shared/missionContract/compile.ts");
  const d = JSON.parse(await Deno.readTextFile(STUDY_V4));
  assertEquals([d.contract, d.calls, d.rows.length, d.dry_run], ["v4", 165, 165, false]);
  const cases = loadCases();
  const wrong: string[] = [];
  for (const r of d.rows) {
    const c = cases.find((x) => x.id === r.case)!;
    const p = c.phrasings.find((x) => x.label === r.label)!;
    const { contract: k } = contractFromProposal(p.query, r.proposal.answer);
    if (k.ambiguities.length) { wrong.push(`${r.case}#${r.repeat}: asks`); continue; }
    const m = compare(v4Expect(c.id, c.expect), summarise(await compileContract(k) as never));
    if (m.length) wrong.push(`${r.case}/${r.label}#${r.repeat}: ${m.join("; ")}`);
  }
  assertEquals(wrong, []);
});
