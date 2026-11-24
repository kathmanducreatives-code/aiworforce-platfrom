// SEMANTIC CLASSES — a lead request mixes company attributes, qualification requirements,
// signals, preferences, exclusions and PIPELINE OPERATIONS. Only the first five are criteria.
//
// Regression for the TEST live pilot (2026-11-21, lead-pipeline v47): the real GPT reading of the
// phase D hiring-first request filed "active B2B companies" and "duplicates" under
// `unsupported`, and a REQUIRED unsupported item blocks approval ("a required requirement no
// approved tool can check: duplicates"). The offline pilot passed because its interpretation
// fixture was hand-written with `unsupported: []` — it never saw how the model actually files
// these words. Every proposal below is shaped like a real model reading, misfilings included.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { contractFromProposal, type ContractProposalV4 } from "../../../supabase/functions/_shared/missionContract/interpret.ts";
import { approvability, contractProblems } from "../../../supabase/functions/_shared/missionContract/contract.ts";
import { compileContract } from "../../../supabase/functions/_shared/missionContract/compile.ts";
import { meaningUnits, OPERATION_APPLIED_BY } from "../../../supabase/functions/_shared/missionContract/semanticClasses.ts";

const PILOT = "Find up to 5 active B2B companies headquartered in the United States, preferably with 10–200 employees, operating in commercial contracting, industrial distribution, commercial field services or manufacturing, that are actively hiring Account Executives. Companies must be B2B. Exclude consumer-only businesses, companies headquartered outside the US and duplicates.";

type U = Record<string, unknown>;
const hiringAEs = (span: string) => ({ roles: [{ span: "Account Executives", title: "account_executive", family: null, relation: "required" }], signals: [{ span, kind: "hiring", necessity: "required" }] });
const proposal = (u: U, extra: Partial<ContractProposalV4> = {}): ContractProposalV4 => ({
  understanding: { roles: [], role_match: "any", places: [], industries: [], signals: [], signal_logic: "all", ambiguities: [], unsupported: [], ...u },
  signal_windows: [], deliverable: { entity: "company", count: 5, count_span: "5", person_roles: [] }, company_size: null, funding_stages: [], forbid_broadening: [], ...extra,
} as ContractProposalV4);
const read = (q: string, p: ContractProposalV4) => contractFromProposal(q, p).contract;
const labels = (q: string, p: ContractProposalV4) => read(q, p).requirements.map((r) => `${r.necessity}:${r.dimension}:${r.display.label}`);
const blockers = (q: string, p: ContractProposalV4) => { const a = approvability(read(q, p)); return a.ok ? [] : a.reasons; };
const b2b = (q: string, p: ContractProposalV4) => read(q, p).requirements.find((r) => r.dimension === "industry" && /^b2b$/i.test(String(r.value)) && r.polarity === "include")?.necessity ?? null;
/** "must be B2B" REQUIRES it; a descriptive "B2B firms" is a preference (owner policy AUDIENCE_POLICY). Either way it is never lost. */
const hasB2B = (q: string, p: ContractProposalV4) => b2b(q, p) === "required";
const ops = (q: string, p: ContractProposalV4) => (read(q, p).operations ?? []).map((o) => o.operation);
const implied = (q: string, p: ContractProposalV4) => (read(q, p).mergedDuplicates ?? []).filter((m) => m.kind === "implied").map((m) => m.span);

/** The pilot as the model actually read it on TEST: most of it right, two phrases misfiled. */
function pilotReading(unsupported: { span: string; why: string }[], industriesExtra: U[] = [], extra: Partial<ContractProposalV4> = {}): ContractProposalV4 {
  return proposal({
    ...hiringAEs("actively hiring Account Executives"),
    places: [{ span: "headquartered in the United States", place: "united states", other_place: null, scope: "headquarters", necessity: "required" },
      { span: "companies headquartered outside the US", place: "united states", other_place: null, scope: "headquarters", necessity: "required" }],
    industries: [
      { span: "commercial contracting", industry: "commercial contracting", necessity: "required" },
      { span: "industrial distribution", industry: "industrial distribution", necessity: "required" },
      { span: "commercial field services", industry: "commercial field services", necessity: "required" },
      { span: "manufacturing", industry: "manufacturing", necessity: "required" },
      { span: "Exclude consumer-only businesses", industry: "consumer", necessity: "excluded" },
      ...industriesExtra,
    ],
    unsupported,
  }, { company_size: { min: 10, max: 200, necessity: "preferred", span: "preferably with 10–200 employees" }, deliverable: { entity: "company", count: 5, count_span: "up to 5", person_roles: [] }, ...extra });
}

// ── Meaning units: vocabulary, not phrases ───────────────────────────────────

Deno.test("meaning units: audience, status and operations resolve across wordings; anything else is residual", () => {
  const u = (s: string) => { const m = meaningUnits(s); return { units: m.units.map((x) => x.kind === "audience" ? `audience:${x.audience}` : x.kind === "status" ? `status:${x.status}` : `op:${x.operation}`).sort(), residual: m.residual }; };
  assertEquals(u("active B2B companies"), { units: ["audience:b2b", "status:active"], residual: [] });
  assertEquals(u("currently operating business-to-business firms"), { units: ["audience:b2b", "status:active"], residual: [] });
  assertEquals(u("duplicates"), { units: ["op:deduplicate"], residual: [] });
  assertEquals(u("no dupes"), { units: ["op:deduplicate"], residual: [] });
  assertEquals(u("repeat companies"), { units: ["op:deduplicate"], residual: [] });
  assertEquals(u("companies already in my CRM"), { units: ["op:exclude_known_records"], residual: [] });
  assertEquals(u("ones we've already contacted"), { units: ["op:exclude_known_records"], residual: ["ve"] }, "an unknown token stays residual — nothing is guessed");
  assertEquals(u("family-owned B2B companies").residual, ["family", "owned"]);
  assertEquals(u("same industry").units, [], "'same' alone is not a duplicate");
});

// ── The exact pilot request: every way the model was seen (or could be expected) to file it ──

const PILOT_READINGS: [string, ContractProposalV4][] = [
  ["TEST run 1 — 'active B2B companies' unsupported, B2B also in industries", pilotReading([{ span: "active B2B companies", why: "activity status not expressible" }],
    [{ span: "Companies must be B2B", industry: "B2B", necessity: "required" }])],
  ["TEST run 2 — 'duplicates' unsupported", pilotReading([{ span: "duplicates", why: "deduplication is not a company attribute" }],
    [{ span: "Companies must be B2B", industry: "B2B", necessity: "required" }])],
  ["both misfiled, and B2B ONLY inside the compound phrase", pilotReading([{ span: "active B2B companies", why: "" }, { span: "duplicates", why: "" }])],
  ["the whole exclusion clause filed as one unsupported item", pilotReading([{ span: "Exclude consumer-only businesses, companies headquartered outside the US and duplicates", why: "" }],
    [{ span: "Companies must be B2B", industry: "B2B", necessity: "required" }])],
  ["read correctly with the new fields", pilotReading([], [{ span: "B2B", industry: "B2B", necessity: "required" }],
    { operations: [{ span: "duplicates", operation: "deduplicate" }], company_status: [{ span: "active", status: "active", necessity: "required" }] })],
];

for (const [name, p] of PILOT_READINGS) {
  Deno.test(`pilot request — ${name}: approvable, B2B required, dedupe recorded, 'active' proven by the hiring signal`, async () => {
    const c = read(PILOT, p);
    assertEquals(contractProblems(c), []);
    assertEquals(blockers(PILOT, p), []);
    assert(hasB2B(PILOT, p), "B2B is a required business-model requirement");
    assert(c.requirements.some((r) => r.dimension === "signal" && r.necessity === "required"), "hiring stays a required signal");
    assert(c.requirements.every((r) => r.dimension !== "unsupported"), `nothing is left 'Not checked': ${labels(PILOT, p).join(" | ")}`);
    if (!/run 1/.test(name)) assertEquals(ops(PILOT, p), ["deduplicate"]);
    if (!/run 2|whole exclusion/.test(name)) assertEquals(implied(PILOT, p).length, 1, "'active' is covered by the dated hiring signal, named");
    await compileContract(c);
  });
}

// ── Ten natural-language variations (each with the misfiling the model is prone to) ──

const V = (q: string, u: U, checks: { b2b?: boolean; ops?: string[]; implied?: number; blocked?: RegExp | null }, extra: Partial<ContractProposalV4> = {}) => ({ q, p: proposal(u, extra), checks });
const usHQ = (span: string) => ({ span, place: "united states", other_place: null, scope: "headquarters", necessity: "required" });
const VARIATIONS = [
  V("Find 5 active B2B firms in the US hiring account executives, no duplicates.",
    { ...hiringAEs("hiring account executives"), places: [usHQ("in the US")], unsupported: [{ span: "active B2B firms", why: "" }, { span: "no duplicates", why: "" }] }, { b2b: true, ops: ["deduplicate"], implied: 1 }),
  V("Give me 5 currently operating business-to-business companies in the United States that are recruiting Account Executives. Remove dupes.",
    { ...hiringAEs("recruiting Account Executives"), places: [usHQ("in the United States")], unsupported: [{ span: "currently operating business-to-business companies", why: "" }, { span: "Remove dupes", why: "" }] }, { b2b: true, ops: ["deduplicate"], implied: 1 }),
  V("5 US-based B2B manufacturers actively hiring AEs — skip any companies already in my CRM.",
    { ...hiringAEs("actively hiring AEs"), places: [usHQ("US-based")], industries: [{ span: "B2B manufacturers", industry: "manufacturing", necessity: "required" }], unsupported: [{ span: "B2B", why: "" }, { span: "skip any companies already in my CRM", why: "" }] }, { b2b: true, ops: ["exclude_known_records"] }),
  V("Looking for active B2B distributors in America that are hiring account executives. Don't repeat companies.",
    { ...hiringAEs("hiring account executives"), places: [usHQ("in America")], industries: [{ span: "distributors", industry: "industrial distribution", necessity: "required" }], unsupported: [{ span: "active B2B distributors", why: "" }, { span: "Don't repeat companies", why: "" }] },
    { b2b: true, ops: ["deduplicate"], implied: 1 }),
  V("Find five B2B companies hiring Account Executives in the US. They must be active. Exclude duplicates and consumer brands.",
    { ...hiringAEs("hiring Account Executives"), places: [usHQ("in the US")], industries: [{ span: "B2B", industry: "B2B", necessity: "required" }, { span: "consumer brands", industry: "consumer", necessity: "excluded" }], unsupported: [{ span: "They must be active", why: "" }, { span: "Exclude duplicates", why: "" }] },
    { b2b: true, ops: ["deduplicate"], implied: 1 }),
  V("Need 5 operating B2B field services companies in the US with open Account Executive roles, deduplicated.",
    { ...hiringAEs("open Account Executive roles"), places: [usHQ("in the US")], industries: [{ span: "field services", industry: "commercial field services", necessity: "required" }], unsupported: [{ span: "operating B2B field services companies", why: "" }, { span: "deduplicated", why: "" }] },
    { b2b: true, ops: ["deduplicate"], implied: 1 }),
  V("5 B2B contractors in the United States hiring AEs; don't include companies we already have, and no duplicates please.",
    { ...hiringAEs("hiring AEs"), places: [usHQ("in the United States")], industries: [{ span: "B2B contractors", industry: "commercial contracting", necessity: "required" }, { span: "B2B", industry: "B2B", necessity: "required" }], unsupported: [{ span: "don't include companies we already have", why: "" }, { span: "no duplicates please", why: "" }] },
    { b2b: true, ops: ["exclude_known_records", "deduplicate"] }),
  // Hedged: "ideally active" with the model's own company_status field.
  V("Find 5 B2B companies in the US hiring Account Executives, ideally active ones, without duplicate entries.",
    { ...hiringAEs("hiring Account Executives"), places: [usHQ("in the US")], industries: [{ span: "B2B", industry: "B2B", necessity: "required" }], unsupported: [] },
    { b2b: true, ops: ["deduplicate"], implied: 1 },
    { operations: [{ span: "without duplicate entries", operation: "deduplicate" }], company_status: [{ span: "ideally active", status: "active", necessity: "preferred" }] }),
  // NEGATIVE: "active" without any dated signal is never assumed — it blocks, named.
  V("Find 5 active B2B manufacturers in the US. No duplicates.",
    { places: [usHQ("in the US")], industries: [{ span: "manufacturers", industry: "manufacturing", necessity: "required" }], unsupported: [{ span: "active B2B manufacturers", why: "" }, { span: "No duplicates", why: "" }] },
    { b2b: true, ops: ["deduplicate"], implied: 0, blocked: /company status: active/ }),
  // NEGATIVE: a word no vocabulary explains keeps the WHOLE phrase unsupported and blocking.
  V("Find 5 family-owned B2B companies in the US hiring account executives, no duplicates.",
    { ...hiringAEs("hiring account executives"), places: [usHQ("in the US")], unsupported: [{ span: "family-owned B2B companies", why: "ownership not expressible" }, { span: "no duplicates", why: "" }] },
    { b2b: true, ops: ["deduplicate"], blocked: /family-owned B2B companies/ }),
];

Deno.test("ten natural-language variations: classified by meaning; never dropped, never guessed", () => {
  assert(VARIATIONS.length >= 10);
  for (const { q, p, checks } of VARIATIONS) {
    const c = read(q, p);
    assertEquals(contractProblems(c), [], q);
    if (checks.b2b) assert(b2b(q, p) !== null, `B2B is represented (required or, when only descriptive, preferred): ${q}`);
    if (checks.ops) assertEquals(ops(q, p), checks.ops, q);
    if (checks.implied !== undefined) assertEquals(implied(q, p).length, checks.implied, q);
    const b = blockers(q, p);
    if (checks.blocked) assert(b.some((x) => checks.blocked!.test(x)), `${q} must block on ${checks.blocked}: ${b.join("; ")}`);
    else assertEquals(b, [], q);
  }
});

Deno.test("an operation the pipeline does not perform, or one that quotes nothing, is a contract problem", () => {
  const c = read(PILOT, PILOT_READINGS[2][1]);
  assertEquals(contractProblems({ ...c, operations: [{ span: "", operation: "deduplicate", appliedBy: OPERATION_APPLIED_BY.deduplicate }] }).map((x) => x.code), ["operation"]);
  assertEquals(contractProblems({ ...c, operations: [{ span: "duplicates", operation: "deduplicate", appliedBy: "trust me" }] }).map((x) => x.code), ["operation"]);
});

Deno.test("the model's operations and statuses must quote the request: invented ones are ignored", () => {
  const p = pilotReading([], [{ span: "B2B", industry: "B2B", necessity: "required" }],
    { operations: [{ span: "never contact them twice", operation: "deduplicate" }], company_status: [{ span: "profitable and active", status: "active", necessity: "required" }] });
  const c = read(PILOT, p);
  assertEquals(c.operations, undefined);
  assertEquals(implied(PILOT, p), []);
});
