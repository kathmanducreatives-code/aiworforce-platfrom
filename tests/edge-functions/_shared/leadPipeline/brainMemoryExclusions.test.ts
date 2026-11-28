// Company Brain V2 · G1 — approved memory exclusions reach ATLAS through the shared
// interface field `excluded_industries_memory` (docs/atlas/ATLAS_V5_SHARED_MEMORY_INTERFACE.md).
// They only NARROW: an approved "exclude this industry" becomes an explicit workspace
// exclusion in the Mission Contract; a request that asks for that industry becomes a
// question; pending / expired / retracted memory serves nothing; a memory read failure
// leaves planning exactly as before. Fictional data; fake DB through the REAL loader.
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { brainPlanningContext, loadBrainPlanningContext, memoryExclusionKey, memoryIndustryExclusions, withMemoryExclusions } from "../../../../supabase/functions/_shared/leadPipeline/brainContext.ts";
import { legacyWorkspaceExclusions } from "../../../../supabase/functions/_shared/leadPipeline/workspaceExclusions.ts";
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
const approvedByReview = { created_by_kind: "agent", created_by_agent: "orion", approval_status: "approved", approved_by: "u-editor", proposal_id: "p-1", source_type: "agent_proposed" };
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

const ws = (memory: Row[]) => db(world(memory)) as never;

Deno.test("G1 (pure): one interface entry per industry, provenance as stored; profile exclusions and targeting untouched", () => {
  const items = memoryIndustryExclusions([exclusion("Crypto", approvedByReview), exclusion("Gambling"),
    exclusion("x", { value: { type: "company", value: "rival.example" }, fact_key: "exclusion.company:rival.example" }),
    exclusion("multi", { value: { type: "industry", values: ["Oil and gas", " "] } })] as never);
  assertEquals(items.map((i) => i.value), ["Crypto", "Gambling", "Oil and gas"], "industries only; companies are not industry exclusions");
  assertEquals(items[0].approval_status, "approved"); assertEquals(items[1].approval_status, "not_required", "never relabelled");
  assert(items.every((i) => i.memory_id && i.version === 1 && i.lifecycle_status === "active"));
  const base = brainPlanningContext({ profile: PROFILE, onboarding_completed: true });
  const out = withMemoryExclusions(base, items);
  assertEquals(out.contractInput?.excluded_industries_memory?.length, 3);
  assertEquals(out.contractInput?.excluded_industries_explicit, base.contractInput?.excluded_industries_explicit, "not folded into the profile list");
  assertEquals([out.context, out.fields], [base.context, base.fields]);
  assertEquals(withMemoryExclusions(base, []), base);
  assertEquals(withMemoryExclusions(brainPlanningContext(null), items), brainPlanningContext(null));
});

Deno.test("G1 contract mode: an approved memory exclusion is its own requirement, carrying its memory id", async () => {
  const brain = await loadBrainPlanningContext(ws([exclusion("Crypto", approvedByReview)]), A);
  const mem = brain.contractInput?.excluded_industries_memory ?? [];
  assertEquals(mem.map((m) => [m.value, m.approval_status]), [["Crypto", "approved"]]);
  const { contract: c, report } = applyCompanyBrain(contract("Find five US companies actively hiring Account Executives."), brain.contractInput ?? null, { workspaceId: A });
  const req = c.requirements.find((r) => r.id === "memory:exclusion:industry:crypto");
  assert(req, JSON.stringify(c.requirements.map((r) => r.id)));
  assertEquals((req!.origin as { memoryIds?: string[] }).memoryIds, [mem[0].memory_id]);
  assertEquals(report.refusedMemory ?? [], []);
  assertEquals(c.ambiguities, []);
});

Deno.test("G1 contract mode: a request for the excluded industry is a question, never a silent winner", async () => {
  const brain = await loadBrainPlanningContext(ws([exclusion("Crypto", approvedByReview)]), A);
  const { contract: c } = applyCompanyBrain(contract("Find five US crypto companies hiring Account Executives.",
    [{ span: "crypto", industry: "Crypto", necessity: "required" }]), brain.contractInput ?? null, { workspaceId: A });
  assert(c.ambiguities.length > 0, "a conflict question blocks approval");
});

Deno.test("G1 whole words: an approved 'AI' exclusion does not claim a retail request", async () => {
  const w = world([exclusion("AI", approvedByReview)]);
  w.company_brain[0] = { ...w.company_brain[0], profile: { ...PROFILE, target_customer: { ...PROFILE.target_customer, disqualifiers: {} } } };
  const brain = await loadBrainPlanningContext(db(w) as never, A);
  const { contract: c } = applyCompanyBrain(contract("Find five US retail companies hiring Account Executives.",
    [{ span: "retail", industry: "Retail", necessity: "required" }]), brain.contractInput ?? null, { workspaceId: A });
  assertEquals(c.ambiguities, [], JSON.stringify(c.ambiguities));
  assert(c.requirements.some((r) => r.id === "memory:exclusion:industry:ai"));
});

Deno.test("G1 legacy mode: approved memory exclusions become REQUIRED criteria with their memory ids", async () => {
  const brain = await loadBrainPlanningContext(ws([exclusion("Crypto", approvedByReview)]), A);
  const mission = { criteria: [] };
  const out = legacyWorkspaceExclusions(mission, brain.contractInput ?? null, { workspaceId: A });
  const crit = (out.mission as { criteria: Row[] }).criteria.find((c) => c.id === "memory:exclusion:industry:crypto");
  assert(crit, JSON.stringify(out));
  assertEquals([crit!.kind, crit!.memory_ids], ["hard", [brain.contractInput!.excluded_industries_memory![0].memory_id]]);
});

Deno.test("G1 KNOWN GAP (pending ATLAS): a person's own exclusion (approval_status not_required) is REFUSED with a visible reason", async () => {
  // DB constraint cbm_agent_needs_approval: only agent proposals carry `approved`; a person's own
  // entry is `not_required` and is authoritative in Company Brain. servableMemoryExclusions accepts
  // only "approved", so today it is refused (listed on the plan, never silently dropped).
  // When ATLAS accepts not_required for human-authored memory, flip this test.
  const brain = await loadBrainPlanningContext(ws([exclusion("Gambling")]), A);
  const { contract: c, report } = applyCompanyBrain(contract("Find five US companies actively hiring Account Executives."), brain.contractInput ?? null, { workspaceId: A });
  assertEquals((report.refusedMemory ?? []).map((r) => [r.value, r.reason]), [["Gambling", "memory is not_required"]]);
  assert(!c.requirements.some((r) => r.id === "memory:exclusion:industry:gambling"));
});

Deno.test("G1: retracted, expired, unapproved or another workspace's memory never reaches the contract", async () => {
  const brain = await loadBrainPlanningContext(ws([
    exclusion("Crypto", { ...approvedByReview, lifecycle_status: "retracted" }),
    exclusion("Mining", { ...approvedByReview, expires_at: iso(-1) }),
    exclusion("Tobacco", { created_by_kind: "agent", approval_status: "approved", approved_by: null, proposal_id: null }),
    exclusion("Defense", { ...approvedByReview, workspace_id: B }),
  ]), A);
  assertEquals(brain.contractInput?.excluded_industries_memory ?? [], []);
});

Deno.test("G1: a memory read failure leaves planning exactly as before", async () => {
  assertEquals(await loadBrainPlanningContext(db(world([exclusion("Crypto", approvedByReview)]), ["company_brain_memory"]) as never, A),
    brainPlanningContext({ profile: PROFILE, onboarding_completed: true }));
});

Deno.test("G1 invalidation key: editing, retracting or adding an exclusion memory changes it; unrelated memory does not", async () => {
  const keyOf = async (memory: Row[]) => memoryExclusionKey((await loadBrainPlanningContext(ws(memory), A)).contractInput);
  const crypto = exclusion("Crypto", { ...approvedByReview, id: "m-crypto" });
  const k0 = await keyOf([crypto]);
  assertEquals(k0, "m-crypto@1");
  assert(await keyOf([{ ...crypto, version: 2 }]) !== k0, "edited (new version)");
  assertEquals(await keyOf([{ ...crypto, lifecycle_status: "retracted" }]), "", "retracted");
  assert(await keyOf([crypto, exclusion("Mining", { ...approvedByReview, id: "m-mining" })]) !== k0, "added");
  const unrelated = { ...crypto, id: "m-tone", category: "brand_voice", fact_key: "tone", value_type: "text", value: "plain" };
  assertEquals(await keyOf([crypto, unrelated]), k0, "a non-exclusion memory does not invalidate");
  assertEquals(memoryExclusionKey(null), "");
});
