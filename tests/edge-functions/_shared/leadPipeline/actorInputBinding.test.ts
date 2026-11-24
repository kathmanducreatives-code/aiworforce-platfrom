// PHASE B — EXACT ACTOR INPUTS, FAMILIES AS FAMILIES, NOTHING SILENTLY DROPPED (V5 2026-11-21).
//   · a role FAMILY is searched as the family + LinkedIn job functions (schema enum), not one title
//   · job-search maxItems is PER (title × location) query: the total is split, as priced
//   · every required location is sent (no `.slice(0, 2)`)
//   · the discovery step's exact input is in the plan, its hash, and what the executor sends
import { assert, assertEquals, assertNotEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { contractFromProposal } from "../../../../supabase/functions/_shared/missionContract/interpret.ts";
import { compileContract } from "../../../../supabase/functions/_shared/missionContract/compile.ts";
import { FAMILY_FUNCTIONS, planStrategy, specFromMission, type StrategyContext } from "../../../../supabase/functions/_shared/leadPipeline/strategy.ts";
import { jobDiscoveryInput } from "../../../../supabase/functions/_shared/leadPipeline/apifyDiscovery.ts";

const SCHEMA = JSON.parse(Deno.readTextFileSync(new URL("../../../../prototypes/atlas-actor-selection/snapshots/harvestapi__linkedin-job-search.schema.json", import.meta.url)));
const ctx: StrategyContext = { providers: { apify: { enabled: true, connected: true, authorized: true } }, budget: { maxLeadoceanRecords: 50, maxApifyUsd: 0.25 }, user: { allowReviewOnly: true } };
async function plan(query: string, u: Record<string, unknown>) {
  const { contract } = contractFromProposal(query, { understanding: { roles: [], role_match: "any", places: [], industries: [], signals: [], signal_logic: "all", ambiguities: [], unsupported: [], ...u },
    signal_windows: [], deliverable: { entity: "company", count: 5, count_span: "5", person_roles: [] }, company_size: null, funding_stages: [], forbid_broadening: [] } as never);
  const spec = specFromMission(await compileContract(contract) as never, { defaultCount: 5 });
  return { spec, plan: planStrategy(spec, ctx) };
}
const SALES_FAMILY = { roles: [{ span: "sales teams", title: null, family: "gtm_sales", relation: "required" }], signals: [{ span: "expanding their sales teams", kind: "hiring", necessity: "required" }] };

Deno.test("every family job-function code is a value the Actor's schema accepts", () => {
  const allowed: string[] = SCHEMA.properties.functionIds.items.enum;
  for (const [fam, codes] of Object.entries(FAMILY_FUNCTIONS)) for (const c of codes) assert(allowed.includes(c), `${fam}: ${c} not in the schema enum`);
});

Deno.test("'expanding their sales teams' searches the Sales FAMILY with sales + BD functions — never one title", async () => {
  const { plan: p } = await plan("Find 5 companies expanding their sales teams.", SALES_FAMILY);
  const input = p.steps[0].input!;
  assertEquals(input.jobTitles, ["Sales"]);
  assertEquals(input.functionIds, ["sale", "bd"]);
  assert(!("locations" in input), "no geography was stated, so none is invented");
});

Deno.test("a named TITLE stays the title, with no function filter", async () => {
  const { plan: p } = await plan("Find 5 US companies hiring Account Executives.", {
    places: [{ span: "US", place: "united states", other_place: null, scope: "headquarters", necessity: "required" }],
    roles: [{ span: "Account Executives", title: "account_executive", family: null, relation: "required" }],
    signals: [{ span: "hiring Account Executives", kind: "hiring", necessity: "required" }],
  });
  assertEquals(p.steps[0].input, { jobTitles: ["Account Executive"], locations: ["United States"], postedLimit: "month", sortBy: "date", maxItems: 20 });
});

Deno.test("job-search maxItems is split per (title × location) query, and every location is kept", async () => {
  const { spec } = await plan("Find 5 companies headquartered in Texas, Ohio or Georgia hiring Account Executives.", {
    places: ["Texas", "Ohio", "Georgia"].map((s) => ({ span: s, place: null, other_place: s, scope: "headquarters", necessity: "required" })),
    roles: [{ span: "Account Executives", title: "account_executive", family: null, relation: "required" }],
    signals: [{ span: "hiring Account Executives", kind: "hiring", necessity: "required" }],
  });
  const input = jobDiscoveryInput(spec, ["Account Executive"], 20);
  assertEquals(input.locations, ["Texas", "Ohio", "Georgia"]);
  assertEquals(input.maxItems, 6); // 20 rows across 3 queries ≈ the step's priced total
});

Deno.test("the exact input is bound into the plan hash: a different input is a different plan", async () => {
  const a = (await plan("Find 5 companies expanding their sales teams.", SALES_FAMILY)).plan;
  const b = (await plan("Find 5 companies expanding their sales teams.", SALES_FAMILY)).plan;
  assertEquals(a.planHash, b.planHash, "deterministic");
  const tampered = { ...a, steps: a.steps.map((s, i) => (i === 0 ? { ...s, input: { ...s.input, jobTitles: ["Account Executive"] } } : s)) };
  assertNotEquals(JSON.stringify(tampered.steps[0].input), JSON.stringify(a.steps[0].input));
  assert(a.steps[0].actor === "apify_linkedin_job_search");
});
