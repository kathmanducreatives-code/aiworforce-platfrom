// EXPLICIT-CONSTRAINT COVERAGE (missionContract/coverage.ts): a restriction the user states
// — an audience word, an excluded role, place or kind of company, a negatively written
// bound — can never silently disappear from the Mission Contract. Represented, or asked.
//
// Origin: TEST dry run 2026-11-06, "Find 5 US B2B companies actively hiring Account
// Executives, excluding SDRs." Two live readings of that sentence: one omitted "B2B", one
// filed it as `unsupported` (shown, never checked). Both plans were "ready".
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { approvability, contractProblems, disclosures, type MissionContract, type Requirement } from "../../../supabase/functions/_shared/missionContract/contract.ts";
import { contractFromProposal } from "../../../supabase/functions/_shared/missionContract/interpret.ts";
import { coverageQuestions, explicitCues, redundantUnsupported } from "../../../supabase/functions/_shared/missionContract/coverage.ts";
import { applyCompanyBrain } from "../../../supabase/functions/_shared/missionContract/brain.ts";

type U = Record<string, unknown>;
const US = { span: "US", place: "united states", other_place: null, scope: "headquarters", necessity: "required" };
const AE = { span: "Account Executives", title: "account_executive", family: null, relation: "required" };
const hiring = (span: string) => ({ span, kind: "hiring", necessity: "required" });
const read = (query: string, u: U, over: U = {}) => contractFromProposal(query, {
  understanding: { roles: [AE], role_match: "any", places: [US], industries: [], signals: [hiring("hiring Account Executives")], signal_logic: "all", ambiguities: [], unsupported: [], ...u },
  signal_windows: [], deliverable: { entity: "company", count: 5, count_span: "5", person_roles: [] }, company_size: null, funding_stages: [], forbid_broadening: [], ...over,
} as never).contract;
const asks = (c: MissionContract) => c.ambiguities.map((a) => a.span);
const hiringOf = (c: MissionContract) => c.requirements.find((r) => r.dimension === "signal" && r.kind === "hiring") as Extract<Requirement, { dimension: "signal" }>;

// ── The exact TEST dry-run sentence, every way the model has read it ──

const DRY = "Find 5 US B2B companies actively hiring Account Executives, excluding SDRs.";
const SDR_EX = { span: "SDRs", title: "sales_development_representative", family: null, relation: "excluded" };
const B2B = { span: "B2B", industry: "B2B", necessity: "required" };
const dry = (u: U) => read(DRY, { signals: [hiring("actively hiring Account Executives")], ...u });

Deno.test("dry run 2026-11-06: a complete reading (B2B kept, SDRs excluded) asks nothing and is approvable", () => {
  const c = dry({ roles: [AE, SDR_EX], industries: [B2B] });
  assertEquals(c.ambiguities, []);
  assert(approvability(c).ok);
  const b2b = c.requirements.find((r) => r.dimension === "industry")!;
  // The owner rule (M01) stands: a descriptive "US B2B companies" ranks; it is visible, attributed, in the hash.
  assertEquals([b2b.necessity, (b2b as { facet: string }).facet, b2b.origin.policy], ["preferred", "business_model", "audience_descriptor_is_preference"]);
  assert(c.assumptions.some((a) => a.requirementId === b2b.id), "the preference reading is shown at approval");
  assertEquals(hiringOf(c).excludedRoleTerms, ["Sales Development Representative"]);
});

Deno.test("dry run 2026-11-06 (reading 1): B2B OMITTED by the model → a blocking question, never 'ready'", () => {
  const c = dry({ roles: [AE, SDR_EX] });
  assertEquals(asks(c), ["B2B"]);
  assert(!approvability(c).ok);
});

Deno.test("dry run 2026-11-06 (reading 2): B2B filed as UNSUPPORTED → read as the business model it is, not 'Not checked'", () => {
  const c = dry({ roles: [AE, SDR_EX], unsupported: [{ span: "B2B", why: "this schema cannot represent an audience" }] });
  assertEquals(disclosures(c), [], "nothing is left shown-but-unchecked");
  const b2b = c.requirements.find((r) => r.dimension === "industry")!;
  assertEquals([(b2b as { value: string }).value, b2b.necessity], ["B2B", "preferred"]);
  assertEquals(c.ambiguities, []);
  // …and is identical to the reading that put it in industries (same approval identity).
  assertEquals(c.requirements.map((r) => r.id).sort(), dry({ roles: [AE, SDR_EX], industries: [B2B] }).requirements.map((r) => r.id).sort());
});

Deno.test("dry run 2026-11-06: the SDR exclusion OMITTED, or turned into a required role, is asked about", () => {
  assertEquals(asks(dry({ roles: [AE], industries: [B2B] })), ["excluding SDRs"]);
  const flipped = dry({ roles: [AE, { ...SDR_EX, relation: "required" }], industries: [B2B] });
  assert(asks(flipped).includes("excluding SDRs"), "a required SDR role is not an exclusion");
  const disclosed = dry({ roles: [AE], industries: [B2B], unsupported: [{ span: "excluding SDRs", why: "x" }] });
  assert(asks(disclosed).includes("excluding SDRs"), "an exclusion only 'shown' is not enforced, so it is asked");
});

// ── Excluded roles and abbreviations ──

Deno.test("excluded roles: abbreviations resolve through the title registry (SDRs, BDRs, AEs)", () => {
  const q = "US companies hiring Account Executives but not BDRs";
  const ok = read(q, { roles: [AE, { span: "BDRs", title: "business_development_representative", family: null, relation: "excluded" }] });
  assertEquals(ok.ambiguities, []);
  assertEquals(asks(read(q, {})), ["but not BDRs"]);
  const spelled = read("US companies hiring account execs, no sales development reps", {
    roles: [{ span: "account execs", title: "account_executive", family: null, relation: "required" }, { span: "sales development reps", title: "sales_development_representative", family: null, relation: "excluded" }],
    signals: [hiring("hiring account execs")],
  });
  assertEquals(spelled.ambiguities, []);
});

Deno.test("excluded roles: every role in a list must be excluded ('excluding SDRs and BDRs' with only SDRs kept asks)", () => {
  const q = "US companies hiring Account Executives, excluding SDRs and BDRs";
  const both = read(q, { roles: [AE, SDR_EX, { span: "BDRs", title: "business_development_representative", family: null, relation: "excluded" }] });
  assertEquals(both.ambiguities, []);
  assertEquals(asks(read(q, { roles: [AE, SDR_EX] })), ["excluding SDRs and BDRs"]);
});

Deno.test("excluded roles: an unidentifiable role is asked about ONCE (registry question, no duplicate)", () => {
  const c = read("Find US companies hiring Account Executives but not growth hackers.", { roles: [AE, { span: "growth hackers", title: null, family: null, relation: "excluded" }] });
  assertEquals(c.ambiguities.length, 1);
});

// ── Audience restrictions ──

Deno.test("audience: 'only B2B' omitted asks; kept, it is REQUIRED", () => {
  const q = "Find only B2B companies in the US hiring Account Executives";
  assertEquals(asks(read(q, {})), ["B2B"]);
  const c = read(q, { industries: [{ span: "only B2B", industry: "B2B", necessity: "required" }] });
  assertEquals(c.ambiguities, []);
  assertEquals(c.requirements.find((r) => r.dimension === "industry")!.necessity, "required");
});

Deno.test("audience: 'no B2C' must be an EXCLUSION — an included B2C, or B2C filed as unsupported, is asked, never inverted", () => {
  const q = "US companies hiring Account Executives, no B2C";
  const ok = read(q, { industries: [{ span: "B2C", industry: "B2C", necessity: "excluded" }] });
  assertEquals(ok.ambiguities, []);
  assertEquals(ok.requirements.find((r) => r.dimension === "exclusion")!.necessity, "required");
  assertEquals(asks(read(q, { industries: [{ span: "B2C", industry: "B2C", necessity: "required" }] })), ["B2C"]);
  const un = read(q, { unsupported: [{ span: "B2C", why: "x" }] });
  assertEquals(asks(un), ["B2C"], "not re-read as an include");
  assert(!un.requirements.some((r) => r.dimension === "industry"));
});

Deno.test("audience: a permissive mention restricts nothing and asks nothing ('include strong B2C opportunities')", () => {
  assertEquals(explicitCues("US B2B companies hiring AEs; include strong B2C opportunities too").filter((c) => c.audience === "consumer"), []);
});

Deno.test("audience: 'B2B SaaS' as one industry answers the B2B cue", () => {
  const c = read("US B2B SaaS companies hiring Account Executives", { industries: [{ span: "B2B SaaS", industry: "B2B SaaS", necessity: "required" }] });
  assertEquals(c.ambiguities, []);
});

// ── Other negative constraints ──

Deno.test("negative constraints: excluded places and kinds of company are represented or asked", () => {
  const geo = "Companies hiring Account Executives, not based in Canada";
  assertEquals(asks(read(geo, { places: [] })), ["not based in Canada"]);
  assertEquals(read(geo, { places: [{ span: "Canada", place: null, other_place: "Canada", scope: "headquarters", necessity: "excluded" }] }).ambiguities, []);
  const ag = "US companies hiring Account Executives — no agencies";
  assertEquals(asks(read(ag, {})), ["no agencies"]);
  assertEquals(read(ag, { industries: [{ span: "agencies", industry: "agencies", necessity: "excluded" }] }).ambiguities, []);
  // An included "agencies" is not the exclusion.
  assertEquals(asks(read(ag, { industries: [{ span: "agencies", industry: "agencies", necessity: "required" }] })), ["no agencies"]);
});

Deno.test("negative constraints: one the vocabulary cannot express is asked, not 'shown and run anyway'", () => {
  const q = "US companies hiring Account Executives without outside funding";
  const c = read(q, { unsupported: [{ span: "without outside funding", why: "funding source is not in the vocabulary" }] });
  assert(asks(c).includes("without outside funding"));
  assert(!approvability(c).ok);
});

Deno.test("bounds written negatively: 'no more than 200 employees' is a limit — kept, or asked", () => {
  const q = "US companies with no more than 200 employees hiring Account Executives";
  assertEquals(asks(read(q, {})), ["no more than 200 employees"]);
  const c = read(q, {}, { company_size: { min: null, max: 200, necessity: "required", span: "no more than 200 employees" } });
  assertEquals(c.ambiguities, []);
});

Deno.test("fillers are not restrictions: 'not sure', 'no preference', 'not just', 'no rush' ask nothing", () => {
  for (const q of ["US companies hiring AEs, not sure about size", "US companies hiring AEs, no preference on industry", "US companies hiring AEs, not just startups but anyone", "US companies hiring AEs, no rush"]) {
    assertEquals(explicitCues(q).filter((c) => c.kind !== "audience"), [], q);
  }
});

Deno.test("coverage counts only the USER's requirements: a Company Brain exclusion never answers the user's words", () => {
  const c = dry({ roles: [AE, SDR_EX], industries: [B2B] });
  const { contract } = applyCompanyBrain(c, null);
  assertEquals(coverageQuestions(DRY, contract), []);
  const noB2b = { ...c, requirements: c.requirements.map((r) => r.dimension === "industry" ? { ...r, origin: { ...r.origin, source: "company_brain_preference" as const } } : r) };
  assertEquals(coverageQuestions(DRY, noB2b).map((q) => q.span), ["B2B"]);
});

// ── Strength and roles inside a longer clause (TEST mission, 2026-11-07) ──

const MUST = "Find 5 companies headquartered in the United States that must operate as B2B businesses, are actively hiring Account Executives, and exclude companies whose hiring evidence is only for SDR/BDR roles.";
const BDR_EX = { span: "BDR", title: "business_development_representative", family: null, relation: "excluded" };
const must = (u: U, over: U = {}) => read(MUST, { places: [{ ...US, span: "headquartered in the United States" }], signals: [hiring("actively hiring Account Executives")], ...u }, over);

Deno.test("strength: 'must operate as B2B' read with its own words is REQUIRED; with SDR and BDR excluded nothing is asked", () => {
  const c = must({ roles: [AE, { ...SDR_EX, span: "SDR" }, BDR_EX], industries: [{ span: "must operate as B2B", industry: "B2B", necessity: "required" }] });
  assertEquals(c.ambiguities, []);
  assertEquals(c.requirements.find((r) => r.dimension === "industry")!.necessity, "required");
  assertEquals(hiringOf(c).excludedRoleTerms, ["Sales Development Representative", "Business Development Representative"]);
  assert(approvability(c).ok);
});

Deno.test("strength: a 'must B2B' the reading WEAKENED to a preference is asked, never silently softened", () => {
  // The model itself marks the user's mandatory B2B as only preferred.
  const c = must({ roles: [AE, { ...SDR_EX, span: "SDR" }, BDR_EX], industries: [{ ...B2B, necessity: "preferred" }] });
  assertEquals(c.requirements.find((r) => r.dimension === "industry")!.necessity, "preferred");
  assertEquals(asks(c), ["B2B"]);
  assert(c.ambiguities[0].question.includes("only as a preference"));
  assert(!approvability(c).ok);
  // A descriptive mention stays a preference and asks nothing (owner rule M01 unchanged).
  assertEquals(dry({ roles: [AE, SDR_EX], industries: [B2B] }).ambiguities, []);
});

Deno.test("roles inside a longer clause: 'exclude companies whose hiring evidence is only for SDR/BDR roles' needs BOTH excluded", () => {
  const cue = explicitCues(MUST).find((x) => x.kind === "exclusion")!;
  assert(cue.span.includes("SDR/BDR"));
  const req = { industries: [{ span: "must operate as B2B", industry: "B2B", necessity: "required" }] };
  assertEquals(asks(must({ ...req, roles: [AE] })), [cue.span]);
  assertEquals(asks(must({ ...req, roles: [AE, { ...SDR_EX, span: "SDR" }] })), [cue.span], "BDR missing");
  assertEquals(must({ ...req, roles: [AE, { ...SDR_EX, span: "SDR" }, BDR_EX] }).ambiguities, []);
});

Deno.test("strength: the user's 'must' just outside the model's quote ('must operate as | B2B businesses') makes B2B REQUIRED", () => {
  const c = must({ roles: [AE, { ...SDR_EX, span: "SDR" }, BDR_EX], industries: [{ span: "B2B businesses", industry: "B2B", necessity: "required" }] });
  assertEquals(c.requirements.find((r) => r.dimension === "industry")!.necessity, "required");
  assertEquals(c.ambiguities, []);
  // Not across a clause: "US B2B companies, must be hiring AEs" leaves B2B descriptive.
  const far = read("US B2B companies, must be hiring Account Executives", { industries: [B2B], signals: [hiring("hiring Account Executives")] });
  assertEquals(far.requirements.find((r) => r.dimension === "industry")!.necessity, "preferred");
});

Deno.test("windows: a 'stated' window whose words state no duration ('actively' → 90 days) is the named DEFAULT, shown as an assumption", () => {
  const c = must({ roles: [AE, { ...SDR_EX, span: "SDR" }, BDR_EX], industries: [{ span: "B2B businesses", industry: "B2B", necessity: "required" }] },
    { signal_windows: [{ event: "hiring", days: 90, phrase: "actively", signal: null }] });
  const w = hiringOf(c).window!;
  assertEquals([w.days, w.origin.source, w.origin.policy], [30, "system_default", "currently / actively hiring"]);
  assert(c.assumptions.some((a) => a.text === "hiring: last 30 days (default)"));
  const stated = read("US companies hiring Account Executives in the last 14 days", {}, { signal_windows: [{ event: "hiring", days: 14, phrase: "in the last 14 days", signal: null }] });
  assertEquals([hiringOf(stated).window!.days, hiringOf(stated).window!.origin.source], [14, "user_explicit"]);
});

// ── An unsupported item that only REPEATS an enforced requirement (TEST live attempt 2026-11-07) ──
// The live plan b8f307b2…: SDR and BDR excluded from the AE hiring signal (enforced) AND the
// same clause filed as `unsupported` → "Not checked" → the run script refused a correct plan.

const CLAUSE = "exclude companies whose hiring evidence is only for SDR/BDR roles";
const LIVE = { roles: [AE, { ...SDR_EX, span: "SDR" }, BDR_EX], industries: [{ span: "B2B businesses", industry: "B2B", necessity: "required" }] };
const enforced = () => must(LIVE).requirements;

Deno.test("duplicate: the failed live plan — the SDR/BDR clause filed as unsupported is merged into the hiring signal that enforces it, with an audit record", () => {
  const c = must({ ...LIVE, unsupported: [{ span: CLAUSE, why: "company-level exclusion based on role mix" }] });
  assertEquals(disclosures(c), [], "nothing is left 'Not checked'");
  assertEquals(c.ambiguities, []);
  assert(approvability(c).ok);
  assertEquals(contractProblems(c), []);
  const h = hiringOf(c);
  assertEquals(h.excludedRoleTerms, ["Sales Development Representative", "Business Development Representative"]);
  assertEquals(c.mergedDuplicates!.map((m) => [m.span, m.coveredBy]), [[CLAUSE, [h.id]]]);
  assert(c.mergedDuplicates![0].reason.includes("never count"));
  // The requirements are exactly the clean reading's: nothing added, nothing weakened.
  assertEquals(c.requirements, must(LIVE).requirements);
  // A reading with no duplicate carries no audit field (its approval identity is unchanged).
  assert(!("mergedDuplicates" in must(LIVE)));
});

Deno.test("duplicate: PARTIAL coverage is never merged — a role not excluded, or extra words, stay 'Not checked'", () => {
  // Only SDR excluded: the clause also names BDR.
  const onlySdr = must({ ...LIVE, roles: [AE, { ...SDR_EX, span: "SDR" }], unsupported: [{ span: CLAUSE, why: "x" }] });
  assertEquals(disclosures(onlySdr).length, 1);
  assertEquals(onlySdr.mergedDuplicates, undefined);
  assert(!approvability(onlySdr).ok, "the uncovered BDR exclusion is also asked");
  // Extra restriction words the enforced requirement does not carry.
  for (const s of [`${CLAUSE} in Europe`, "excluding SDRs and agencies", "exclude companies whose hiring evidence is only for SDR/BDR roles under 50 employees"]) {
    assertEquals(redundantUnsupported(s, enforced()), null, s);
  }
});

Deno.test("duplicate: a DIFFERENT exclusion is never merged", () => {
  for (const s of ["exclude companies whose hiring evidence is only for Customer Success Manager roles", "excluding Solutions Engineers", "excluding recruiters", "not in Canada"]) {
    assertEquals(redundantUnsupported(s, enforced()), null, s);
  }
});

Deno.test("duplicate: CONFLICTING polarity or scope is never merged", () => {
  for (const s of [
    "hiring SDR/BDR roles", // an inclusion, not an exclusion
    "exclude companies hiring Account Executives", // excludes the required role
    "exclude companies hiring SDRs", // company-scoped: rejects an AE-hiring company that also hires SDRs
    "exclude companies with any SDR/BDR roles",
  ]) assertEquals(redundantUnsupported(s, enforced()), null, s);
  // Role-scoped wording is the excluded-role meaning: merged.
  assertEquals(redundantUnsupported("excluding SDRs", enforced())?.coveredBy, [hiringOf(must(LIVE)).id]);
  // A preferred (non-gating) signal never answers it.
  const soft = enforced().map((r) => (r.dimension === "signal" ? { ...r, necessity: "preferred" as const } : r));
  assertEquals(redundantUnsupported(CLAUSE, soft), null);
});

Deno.test("duplicate: AMBIGUOUS wording is never merged", () => {
  for (const s of [
    "exclude companies whose hiring evidence is mostly for SDR/BDR roles",
    "maybe exclude SDR roles",
    "ideally excluding SDRs",
    "not excluding SDRs",
    "exclude companies whose hiring evidence is only for SDR/BDR roles unless they also hire AEs",
  ]) assertEquals(redundantUnsupported(s, enforced()), null, s);
});

Deno.test("duplicate: a genuinely unsupported requirement stays 'Not checked'; a company exclusion merges only at the same scope", () => {
  const q = `${MUST} Prefer companies with a strong engineering culture.`;
  const c = contractFromProposal(q, { understanding: { roles: LIVE.roles, role_match: "any", places: [{ ...US, span: "headquartered in the United States" }], industries: LIVE.industries,
    signals: [hiring("actively hiring Account Executives")], signal_logic: "all", ambiguities: [], unsupported: [{ span: "a strong engineering culture", why: "x" }, { span: CLAUSE, why: "x" }] },
    signal_windows: [], deliverable: { entity: "company", count: 5, count_span: "5", person_roles: [] }, company_size: null, funding_stages: [], forbid_broadening: [] } as never).contract;
  assertEquals(disclosures(c).map((r) => r.origin.span), ["a strong engineering culture"]);
  assertEquals(c.mergedDuplicates!.map((m) => m.span), [CLAUSE]);
  // Places: "not based in Canada" enforced → its unsupported copy merges; a different scope does not.
  const geo = "Companies hiring Account Executives, not based in Canada";
  const g = read(geo, { places: [{ span: "not based in Canada", place: null, other_place: "Canada", scope: "headquarters", necessity: "excluded" }] }).requirements;
  assertEquals(redundantUnsupported("not based in Canada", g)?.coveredBy, ["exclusion:geography:canada"]);
  assertEquals(redundantUnsupported("not headquartered in Canada", g), null);
  assertEquals(redundantUnsupported("not based in Canada or Mexico", g), null);
});

Deno.test("duplicate: an audit record that names no enforced requirement is an invalid contract", () => {
  const c = must(LIVE);
  assertEquals(contractProblems({ ...c, mergedDuplicates: [{ span: CLAUSE, coveredBy: ["hiring:nope"], reason: "x" }] }).map((p) => p.code), ["merged_duplicate"]);
  assertEquals(contractProblems({ ...c, mergedDuplicates: [{ span: CLAUSE, coveredBy: [], reason: "x" }] }).map((p) => p.code), ["merged_duplicate"]);
});
