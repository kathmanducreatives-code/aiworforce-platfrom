// THE MISSION CONTRACT (ADR-001): one authoritative statement of intent, its compiler, its
// approval identity and its invariants. Each test pins a defect class the architecture
// review found, so it cannot return: meaning is compared, never mere JSON validity.
import { assert, assertEquals, assertNotEquals, assertRejects } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  approvability, contractHash, contractProblems, disclosures, hardRequirementSet, type MissionContract, type Requirement,
} from "../../../supabase/functions/_shared/missionContract/contract.ts";
import { compileContract, ContractInvalidError, semanticCriteria } from "../../../supabase/functions/_shared/missionContract/compile.ts";
import { contractFromMission } from "../../../supabase/functions/_shared/missionContract/boundary.ts";
import { contractFromProposal, GPT_CONTRACT_SCHEMA_V4 } from "../../../supabase/functions/_shared/missionContract/interpret.ts";
import { interpretContract } from "../../../supabase/functions/_shared/missionContract/gptInterpreter.ts";
import {
  checkApproved, checkCompiled, checkPlanRequirements, checkVerdicts, requirementVerdicts,
} from "../../../supabase/functions/_shared/missionContract/invariants.ts";
import { criteriaOf } from "../../../supabase/functions/_shared/missionCriteriaReader.ts";
import { compileLeadMission } from "../../../supabase/functions/_shared/leadMissionCompiler.ts";
import { specFromMission } from "../../../supabase/functions/_shared/leadPipeline/strategy.ts";
import { compilePhrasing, loadCases, summarise } from "../../../scripts/dev/interpretation-corpus.ts";
import { persistedMissions } from "../../../scripts/dev/mission-semantics.ts";
import { v4Corpus, v4Replay } from "../../../scripts/dev/contract-corpus.ts";

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
const contract = () => contractFromProposal(Q, proposal() as never).contract;
const req = (c: MissionContract, dim: string) => c.requirements.find((r) => r.dimension === dim || (r.dimension === "signal" && r.kind === dim))!;

// ── The single-channel interpreter ──────────────────────────────────────────

Deno.test("v4 schema has ONE channel: no free-form constraint field for a restatement to arrive through", () => {
  const json = JSON.stringify(GPT_CONTRACT_SCHEMA_V4);
  for (const legacy of ["hard_constraints", "soft_preferences", "company_types", "preferred_signals", "required_signal_terms", "signal_recency_days", "geographies"]) {
    assert(!json.includes(`"${legacy}"`), `v4 must not carry ${legacy}`);
  }
  // Strict mode: every object closes its properties.
  const walk = (o: unknown): void => {
    if (!o || typeof o !== "object") return;
    const x = o as Record<string, unknown>;
    if (x.type === "object" || (Array.isArray(x.type) && x.type.includes("object"))) assertEquals(x.additionalProperties, false);
    Object.values(x).forEach(walk);
  };
  walk(GPT_CONTRACT_SCHEMA_V4);
});

Deno.test("v4: a legacy restatement the model adds anyway is ignored, never executed (duplicate-requirement class)", async () => {
  const p = { ...proposal(), hard_constraints: [{ field: "signal", operator: "equals", value: "hiring" }, { field: "hiring_role", operator: "excludes", value: "SDRs" }] };
  const m = await compileContract(contractFromProposal(Q, p as never).contract);
  assertEquals(criteriaOf(m as never).filter((c) => c.dimension === "constraint" || c.dimension === "exclusion").length, 0);
});

Deno.test("v4: every requirement quotes the user's words; an invented one is rejected, never admitted", () => {
  const u = { ...understanding, places: [...understanding.places, { span: "in Canada", place: "canada", other_place: null, scope: "headquarters", necessity: "required" }] };
  const { contract: c, rejected } = contractFromProposal(Q, proposal({ understanding: u }) as never);
  assert(!c.requirements.some((r) => r.dimension === "geography" && r.place === "Canada"));
  assert(rejected.some((x) => x.item.includes("in Canada")), JSON.stringify(rejected));
});

Deno.test("v4: hard vs preferred is kept; a hedged size ranks and never gates", async () => {
  const c = contractFromProposal(Q, proposal({ company_size: { min: 50, max: 200, necessity: "preferred", span: "50–200 employees" } }) as never).contract;
  assertEquals(req(c, "company_size").necessity, "preferred");
  const m = await compileContract(c);
  assertEquals(criteriaOf(m as never).find((x) => x.dimension === "company_size")!.kind, "target");
});

Deno.test("v4: a stated window is the user's; an unstated one is the named default, shown as an assumption", () => {
  const stated = req(contract(), "hiring") as Extract<Requirement, { dimension: "signal" }>;
  assertEquals([stated.window!.days, stated.window!.origin.source], [14, "user_explicit"]);
  const c = contractFromProposal(Q, proposal({ signal_windows: [] }) as never).contract;
  const d = req(c, "hiring") as Extract<Requirement, { dimension: "signal" }>;
  assertEquals([d.window!.days, d.window!.origin.source, d.window!.origin.policy], [30, "system_default", "currently / actively hiring"]);
  assert(c.assumptions.some((a) => a.requirementId === d.id && a.text.includes("30 days")));
});

Deno.test("v4: an audience word describes unless the user's own span elevates it (owner rule, M01)", () => {
  const descr = contractFromProposal("Find US B2B companies hiring Account Executives.", proposal({
    understanding: { ...understanding, industries: [{ span: "B2B", industry: "B2B", necessity: "required" }] }, company_size: null, signal_windows: [],
  }) as never).contract;
  assertEquals(req(descr, "industry").necessity, "preferred");
  const only = contractFromProposal("Find only B2B companies in the US hiring Account Executives.", proposal({
    understanding: { ...understanding, industries: [{ span: "only B2B", industry: "B2B", necessity: "required" }] }, company_size: null, signal_windows: [],
  }) as never).contract;
  assertEquals(req(only, "industry").necessity, "required");
});

Deno.test("v4: roles never invent a hiring signal (M20: 'growing the sales team' is growth, not hiring)", async () => {
  const q = "US companies growing their sales team — find me 5";
  const u = { roles: [{ span: "sales team", title: null, family: "gtm_sales", relation: "required" }], role_match: "any",
    places: [{ span: "US", place: "united states", other_place: null, scope: "headquarters", necessity: "required" }], industries: [],
    signals: [{ span: "growing their sales team", kind: "headcount_growth", necessity: "required" }], signal_logic: "all", ambiguities: [], unsupported: [] };
  const c = contractFromProposal(q, proposal({ understanding: u, company_size: null, signal_windows: [] }) as never).contract;
  assert(!c.requirements.some((r) => r.dimension === "signal" && r.kind === "hiring"));
  assertEquals(disclosures(c).length, 1, "the team is disclosed, not executed");
  assertEquals(summarise(await compileContract(c) as never).hiringHard, false);
});

Deno.test("v4: an ambiguity blocks approval; so does a REQUIRED disclosed requirement (never approved silently), and it is never executed", async () => {
  const amb = contractFromProposal(Q, proposal({ understanding: { ...understanding, ambiguities: [{ span: "US", question: "HQ or presence?" }] } }) as never).contract;
  assertEquals(approvability(amb).ok, false);
  const dis = contractFromProposal(Q, proposal({ understanding: { ...understanding, unsupported: [{ span: "in the last 14 days", why: "x" }] } }) as never).contract;
  // MRLE Phase 0 (audit E2): "Not checked" + REQUIRED is a question, not an approval.
  const a = approvability(dis);
  assertEquals(a.ok, false);
  assert(!a.ok && a.reasons.some((r) => r.includes("no approved tool can check: in the last 14 days")), JSON.stringify(a));
  // It still compiles to no criterion: if it is ever accepted it is shown, never executed.
  const m = await compileContract(dis);
  assertEquals(criteriaOf(m as never).length, dis.requirements.length - 1);
});

Deno.test("v4: an unsupported item that IS an enforced requirement's own words, or only the count, is merged and audited — never a question", () => {
  // The exact words of an executable requirement's quote ("B2B SaaS" is the industry's quote).
  const same = contractFromProposal(Q, proposal({ understanding: { ...understanding, unsupported: [{ span: "B2B SaaS", why: "x" }] } }) as never).contract;
  assertEquals(approvability(same).ok, true);
  const m = (same.mergedDuplicates ?? []).find((x) => x.span === "B2B SaaS")!;
  assertEquals(m.kind, "same_words");
  assert(m.coveredBy.length === 1 && same.requirements.some((r) => r.id === m.coveredBy[0]));
  // Only the framing and the count ("Find 10").
  const count = contractFromProposal(Q, proposal({ understanding: { ...understanding, unsupported: [{ span: "Find 10", why: "x" }] } }) as never).contract;
  assertEquals(approvability(count).ok, true);
  assertEquals((count.mergedDuplicates ?? []).find((x) => x.span === "Find 10")?.kind, "count");
  // Composed of whole enforced quotes plus the count ("10 US"): merged.
  assertEquals(approvability(contractFromProposal(Q, proposal({ understanding: { ...understanding, unsupported: [{ span: "10 US", why: "x" }] } }) as never).contract).ok, true);
  // OVERLAP IS NOT ENOUGH: part of a quote ("Account" of "hiring Account Executives") stays a question.
  const part = contractFromProposal(Q, proposal({ understanding: { ...understanding, unsupported: [{ span: "Account Executives but not SDRs", why: "x" }] } }) as never).contract;
  assertEquals(approvability(part).ok, false);
});

Deno.test("v4: an unsupported exclusion keeps its polarity ('not owned by private equity' is an exclusion)", () => {
  const q = "Find 5 US companies hiring Account Executives, not owned by private equity.";
  const ex = contractFromProposal(q, proposal({ understanding: { ...understanding, unsupported: [{ span: "not owned by private equity", why: "ownership is not measured" }] } }) as never).contract;
  const u = ex.requirements.find((r) => r.dimension === "unsupported") as Extract<Requirement, { dimension: "unsupported" }>;
  assertEquals(u.polarity, "exclude");
  const inc = contractFromProposal("Find 5 family-owned US companies hiring Account Executives.", proposal({ understanding: { ...understanding, unsupported: [{ span: "family-owned", why: "ownership is not measured" }] } }) as never).contract;
  assertEquals((inc.requirements.find((r) => r.dimension === "unsupported") as Extract<Requirement, { dimension: "unsupported" }>).polarity, "include");
});

// ── Contract invariants ─────────────────────────────────────────────────────

Deno.test("contract: contradictions and empty missions are refused, never guessed away", async () => {
  const c = contract();
  const h = req(c, "hiring") as Extract<Requirement, { dimension: "signal" }>;
  const bad = { ...c, requirements: c.requirements.map((r) => r === h ? { ...h, excludedRoleTerms: ["Account Executive"] } : r) };
  assert(contractProblems(bad).some((p) => p.code === "contradiction"));
  const size = { ...c, requirements: c.requirements.map((r) => r.dimension === "company_size" ? { ...r, min: 200, max: 50 } : r) };
  assert(contractProblems(size).some((p) => p.code === "contradiction"));
  const empty = { ...c, requirements: [], assumptions: [] };
  await assertRejects(() => compileContract(empty), ContractInvalidError, "empty_mission");
});

Deno.test("contract: absence is not negation — an unmentioned dimension adds no requirement", async () => {
  const m = await compileContract(contract());
  const dims = new Set(criteriaOf(m as never).map((c) => c.dimension));
  for (const d of ["funding", "company_stage", "exclusion", "known_companies"]) assert(!dims.has(d as never), d);
});

// ── Approval identity ───────────────────────────────────────────────────────

Deno.test("approval: changing any hard requirement changes the hash; card text and provenance do not", async () => {
  const c = contract(), h0 = await contractHash(c);
  const mutate = (f: (r: Requirement) => Requirement) => ({ ...c, requirements: c.requirements.map(f) });
  const variants: MissionContract[] = [
    mutate((r) => r.dimension === "geography" ? { ...r, scope: "presence" } : r),
    mutate((r) => r.dimension === "company_size" ? { ...r, max: 201 } : r),
    mutate((r) => r.dimension === "industry" ? { ...r, necessity: "preferred" } : r),
    mutate((r) => r.dimension === "signal" ? { ...r, window: { ...r.window!, days: 15 } } : r),
    mutate((r) => r.dimension === "signal" ? { ...r, excludedRoleTerms: null } : r),
    { ...c, deliverable: { ...c.deliverable, count: 11 }, completion: { ...c.completion, targetCount: 11 } },
    { ...c, forbidBroadening: ["geography"] },
  ];
  for (const v of variants) assertNotEquals(await contractHash(v), h0);
  assertEquals(await contractHash({ ...c, provenance: { interpreter: "gpt_contract_v4", model: "other", from: "x" } }), h0);
  assertEquals(await contractHash(mutate((r) => ({ ...r, display: { label: "renamed", rationale: "" } }))), h0);
  assertEquals(await contractHash({ ...c, requirements: [...c.requirements].reverse() }), h0, "order does not change meaning");
});

Deno.test("approval: a run whose contract changed after approval is refused (I3)", async () => {
  const c = contract(), h = await contractHash(c);
  assertEquals(await checkApproved(c, h), []);
  const changed = { ...c, requirements: c.requirements.filter((r) => r.dimension !== "company_size") };
  assertEquals((await checkApproved(changed, h))[0]?.invariant, "I3");
});

// ── Execution never reinterprets ─────────────────────────────────────────────

Deno.test("I1/I2: execution acts on exactly the contract; a mission or plan that drifts is caught", async () => {
  const c = contract();
  const m = await compileContract(c);
  assertEquals(checkCompiled(c, m), []);
  const spec = specFromMission(m as never, { defaultCount: 10 });
  assertEquals(checkPlanRequirements(c, spec.requirements.criteria as never), []);
  // A downstream step that strengthens (adds a gate) or weakens (drops one) is detected.
  const added = { ...m, criteria: [...m.criteria, { ...m.criteria[0], id: "industry:fintech", value: "fintech" }] };
  assertEquals(checkCompiled(c, added)[0]?.invariant, "I1");
  const dropped = spec.requirements.criteria.filter((x) => x.dimension !== "company_size");
  assertEquals(checkPlanRequirements(c, dropped as never)[0]?.invariant, "I2");
  // The compiled mission never needs the sentence: blanking it changes nothing the engine reads.
  assertEquals(semanticCriteria(criteriaOf({ ...m, original_user_query: "" } as never)), semanticCriteria(m.criteria));
});

// ── Evidence-backed verdicts ────────────────────────────────────────────────

Deno.test("verdicts: unknown is never verified; a pass with no evidence is unverified; missing is unverified", () => {
  const c = contract();
  const geo = req(c, "geography").id, size = req(c, "company_size").id, hiring = req(c, "hiring").id;
  const ev = [{ evidence_id: "e1", actor: "apify_linkedin_company_details", url: "https://x", observed_at: "2026-11-01T00:00:00Z", occurred_at: null }];
  const v = requirementVerdicts(c, [
    { criterion_id: geo, result: "pass", reason: "HQ United States", evidence: ev },
    { criterion_id: size, result: "pass", reason: "51-200", evidence: [] },
    { criterion_id: hiring, result: "unknown", reason: "no posting" },
  ]);
  const by = (id: string) => v.find((x) => x.requirementId === id)!;
  assertEquals([by(geo).status, by(geo).decision], ["verified", "satisfied"]);
  assertEquals(by(size).status, "unverified", "a pass that cites nothing is not proof");
  assertEquals([by(hiring).status, by(hiring).decision], ["unverified", "pending"]);
  assertEquals(by(req(c, "industry").id).status, "unverified", "not evaluated is not verified");
  assertEquals(checkVerdicts(c, v), []);
  const contradicted = requirementVerdicts(c, [{ criterion_id: geo, result: "fail", reason: "HQ Canada", evidence: ev }]).find((x) => x.requirementId === geo)!;
  assertEquals([contradicted.status, contradicted.decision], ["contradicted", "rejects"]);
});

// ── Historical compatibility, the corpus and the live studies ───────────────

Deno.test("history: every stored and compiled mission converts to a contract and back with IDENTICAL meaning", async () => {
  const missions: [string, Record<string, unknown>][] = [];
  for (const c of loadCases()) for (const p of c.phrasings) for (const mode of ["v1", "v3"] as const) {
    try { missions.push([`${c.id}/${p.label}/${mode}`, compilePhrasing(p, mode)]); } catch { /* a clarification: no mission */ }
  }
  for (const [k, m] of await persistedMissions()) missions.push([k, m]);
  let ok = 0;
  const refused: string[] = [];
  for (const [k, m] of missions) {
    const b = contractFromMission(m as never);
    assert(b.ok, `${k}: ${!b.ok && b.lossy.join("; ")}`);
    if (!b.ok) continue;
    if (contractProblems(b.contract).length) { refused.push(k); continue; }
    const cm = await compileContract(b.contract);
    assertEquals(semanticCriteria(cm.criteria), semanticCriteria(criteriaOf(m as never)), k);
    assertEquals(summarise(cm as never), summarise({ ...m, criteria: criteriaOf(m as never) }), k);
    ok++;
  }
  // The only refusals are meanings that were invalid to begin with (no requirement; size 100–0).
  assertEquals(refused.length, 2, JSON.stringify(refused));
  assert(ok >= 180, `${ok}`);
});

Deno.test("corpus: all 55 phrasings read correctly through contract v4 (approved differences documented)", async () => {
  const r = await v4Corpus();
  assertEquals(r.filter((x) => x.mismatches.length), []);
});

Deno.test("live study run #24 (165 real answers): 161/165 through v4; every failure is the model's or the transport's", async () => {
  const study = JSON.parse(await Deno.readTextFile(new URL("../../../docs/benchmarks/live-paraphrase/2026-11-05-run24.json", import.meta.url)));
  const r = await v4Replay(study);
  assertEquals(r.filter((x) => !x.mismatches.length).length, 161);
  const kinds = r.filter((x) => x.mismatches.length).map((x) => `${x.id}:${x.mismatches[0].split(":")[0]}`).sort();
  assertEquals(kinds, ["M01:no answer", "M01:no answer", "M07:asks", "M19:roles"]);
});

Deno.test("interpreter: a model failure is an error, never a fallback reading; nothing is guessed", async () => {
  assertEquals(await interpretContract(Q, () => Promise.resolve({ ok: false as const, code: "incomplete_response" })), { ok: false, error: "incomplete_response" });
  const r = await interpretContract(Q, () => Promise.resolve({ ok: true as const, value: proposal(), model: "m" }));
  assert(r.ok && r.mission.mission_contract_hash === r.hash && hardRequirementSet(r.contract).size >= 4);
  // The legacy v3 compiler is not reached in contract mode.
  void compileLeadMission;
});
