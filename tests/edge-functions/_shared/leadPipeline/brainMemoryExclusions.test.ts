// Company Brain V2 · G1 — approved memory exclusions reach ATLAS discovery planning.
// They only NARROW: an approved "exclude this industry" becomes an explicit workspace
// exclusion in the Mission Contract; a request that asks for that industry becomes a
// question; pending / expired / retracted memory serves nothing; a memory read failure
// leaves planning exactly as before. Fictional data; fake DB through the REAL loader.
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { brainPlanningContext, loadBrainPlanningContext, withMemoryExclusions } from "../../../../supabase/functions/_shared/leadPipeline/brainContext.ts";
import { applyCompanyBrain } from "../../../../supabase/functions/_shared/missionContract/brain.ts";
import { contractFromProposal } from "../../../../supabase/functions/_shared/missionContract/interpret.ts";

const A = "aaaaaaaa-0000-4000-8000-0000000000a1";
const B = "bbbbbbbb-0000-4000-8000-0000000000b2";
const DAY = 86_400_000;
const iso = (offsetDays: number) => new Date(Date.now() + offsetDays * DAY).toISOString();
type Row = Record<string, unknown>;

const PROFILE = {
  schema_version: 2,
  company: { name: "Northwind Field Services (fictional)", description: "Scheduling software for field-service teams" },
  target_customer: { industries: ["Manufacturing", "Distribution"], geography: ["United States"], company_size: { min: 10, max: 200 },
    disqualifiers: { industries: ["Consumer retail"] } },
  icp: { industries: ["Manufacturing", "Distribution"], geography: "United States" },
};
let seq = 0;
const exclusion = (value: string, over: Row = {}): Row => ({
  id: `m-${++seq}`, workspace_id: A, kind: "preference", category: "exclusions", fact_key: `exclusion.industry:${value.toLowerCase()}`,
  scope: "workspace", scope_ref: null, value_type: "object", value: { type: "industry", value }, version: 1,
  source_type: "user_provided", source_ref: null, source_url: null, verification_status: "user_confirmed", confidence: "high",
  lifecycle_status: "active", persistence: "persistent", approval_status: "not_required", created_by_kind: "user", created_by_agent: null,
  approved_by: null, proposal_id: null, observed_at: iso(-1), review_at: null, expires_at: null, updated_at: iso(-1), redacted_at: null, reason: null,
  ...over,
});

/** A PostgREST-shaped fake that satisfies BOTH the ATLAS row read (maybeSingle) and the shared loader. */
function db(tables: Record<string, Row[]>, failing: string[] = []) {
  return {
    from(table: string) {
      let rows = [...(tables[table] ?? [])];
      // deno-lint-ignore no-explicit-any
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const q: any = {
        select() { return q; },
        eq(c: string, v: unknown) { rows = rows.filter((r) => r[c] === v); return q; },
        in(c: string, vs: unknown[]) { rows = rows.filter((r) => vs.includes(r[c])); return q; },
        order() { return q; },
        limit(n: number) { rows = rows.slice(0, n); return q; },
        maybeSingle() { return Promise.resolve(failing.includes(table) ? { data: null, error: { message: "x" } } : { data: rows[0] ?? null, error: null }); },
        then(res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) {
          return Promise.resolve(failing.includes(table) ? { data: null, error: { message: "relation does not exist" } } : { data: rows, error: null }).then(res, rej);
        },
      };
      return q;
    },
  };
}
const world = (memory: Row[]) => ({
  company_brain: [{ workspace_id: A, profile: PROFILE, updated_at: iso(-10), onboarding_completed: true },
    { workspace_id: B, profile: { ...PROFILE, target_customer: { ...PROFILE.target_customer, disqualifiers: {} } }, updated_at: iso(-10), onboarding_completed: true }],
  company_brain_memory: memory, company_brain_revisions: [], company_brain_memory_proposals: [],
});

// The contract the request reads to, before the Brain (same builder as the contract tests).
const US = { span: "US", place: "united states", other_place: null, scope: "headquarters", necessity: "required" };
const AE = { span: "Account Executives", title: "account_executive", family: null, relation: "required" };
const contract = (query: string, industries: unknown[] = []) => contractFromProposal(query, {
  understanding: { roles: [AE], role_match: "any", places: [US], industries, signals: [{ span: "hiring Account Executives", kind: "hiring", necessity: "required" }],
    signal_logic: "all", ambiguities: [], unsupported: [] },
  signal_windows: [], deliverable: { entity: "company", count: 5, count_span: "five", person_roles: [] }, company_size: null, funding_stages: [], forbid_broadening: [],
} as never).contract;
const excluded = (c: { requirements: Array<Row> }) => c.requirements
  .filter((r) => r.dimension === "exclusion").flatMap((r) => (r.values as string[]) ?? []);

Deno.test("G1 (pure): approved exclusions are added as EXPLICIT exclusions, de-duplicated, and nothing else changes", () => {
  const base = brainPlanningContext({ profile: PROFILE, onboarding_completed: true });
  const out = withMemoryExclusions(base, ["Crypto", "consumer retail", " ", "crypto"]);
  assertEquals(out.contractInput?.excluded_industries_explicit, [...(base.contractInput?.excluded_industries_explicit ?? []), "Crypto"]);
  assertEquals(out.context, base.context, "targeting (industries, geography, size) is untouched");
  assert(out.fields.includes("memory_exclusions"));
  assertEquals(withMemoryExclusions(base, []), base, "no memory → identical");
  const absent = brainPlanningContext(null);
  assertEquals(withMemoryExclusions(absent, ["Crypto"]), absent, "no usable Brain → memory adds nothing either");
});

Deno.test("G1: an approved 'never target crypto' reaches the Mission Contract as a required workspace exclusion", async () => {
  const brain = await loadBrainPlanningContext(db(world([exclusion("Crypto")])) as never, A);
  assertEquals(brain.status, "used");
  assert(brain.contractInput?.excluded_industries_explicit?.includes("Crypto"), JSON.stringify(brain.contractInput));
  const { contract: c, report } = applyCompanyBrain(contract("Find five US companies actively hiring Account Executives."), brain.contractInput ?? null);
  assert(excluded(c as never).includes("Crypto"), "the exclusion is a requirement in the approved (hashed) contract");
  assert(report.applied.some((a) => a.requirementId === "brain:exclusion:industry:crypto" && a.authority === "policy"), `reported as an applied workspace policy (what the plan shows): ${JSON.stringify(report.applied)}`);
  assertEquals(c.ambiguities, [], "nothing to ask");
});

Deno.test("G1: a request that asks for the excluded industry becomes a QUESTION, never a silent winner", async () => {
  const brain = await loadBrainPlanningContext(db(world([exclusion("Crypto")])) as never, A);
  const { contract: c } = applyCompanyBrain(contract("Find five US crypto companies hiring Account Executives.",
    [{ span: "crypto", industry: "Crypto", necessity: "required" }]), brain.contractInput ?? null);
  assert(c.ambiguities.some((a) => /excludes "Crypto"/.test(a.question)), JSON.stringify(c.ambiguities));
});

Deno.test("G1: retracted, expired or pending memory serves nothing; another workspace's memory never applies", async () => {
  const notServable = [
    exclusion("Crypto", { lifecycle_status: "retracted" }),
    exclusion("Gambling", { expires_at: iso(-1) }),
    exclusion("Tobacco", { approval_status: "pending", verification_status: "unverified", source_type: "ai_inferred", created_by_kind: "agent" }),
    exclusion("Defense", { workspace_id: B }),
  ];
  const brain = await loadBrainPlanningContext(db(world(notServable)) as never, A);
  for (const v of ["Crypto", "Gambling", "Tobacco", "Defense"]) {
    assert(!brain.contractInput?.excluded_industries_explicit?.includes(v), `${v} must not apply: ${JSON.stringify(brain.contractInput)}`);
  }
  assert(!brain.fields.includes("memory_exclusions"));
});

Deno.test("G1: a memory read failure leaves planning exactly as it was before (no throw, no partial context)", async () => {
  const withFailure = await loadBrainPlanningContext(db(world([exclusion("Crypto")]), ["company_brain_memory"]) as never, A);
  const plain = brainPlanningContext({ profile: PROFILE, onboarding_completed: true });
  assertEquals(withFailure, plain);
});
