// PROTOTYPE TESTS (offline). deno test --allow-read --no-check prototypes/atlas-actor-selection/
import { assert, assertEquals, assertFalse } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { contractFromProposal } from "../../supabase/functions/_shared/missionContract/interpret.ts";
import { CATALOG } from "./catalog.ts";
import { buildInput, planSelection, proposeFromStore, sizeBands, validateInput, worstCaseUsd, type StoreSnapshot } from "./planner.ts";

const scenario = (name: string) => JSON.parse(Deno.readTextFileSync(new URL(`./review-scenarios/${name}.json`, import.meta.url)));
const contractOf = (s: { query: string; interpretation: unknown }) => contractFromProposal(s.query, s.interpretation as never).contract;
const schema = (f: string) => JSON.parse(Deno.readTextFileSync(new URL(`./snapshots/${f}`, import.meta.url)));
const actor = (id: string) => CATALOG.find((e) => e.actorId === id)!;

Deno.test("the pilot mission: same three approved Actors and the same worst case as the live plan ($0.07439)", () => {
  const s = JSON.parse(Deno.readTextFileSync(new URL("../../tests/fixtures/atlas-sim/pilot-industry-b2b.json", import.meta.url)));
  const p = planSelection(contractOf(s), { allowReviewOnly: true });
  assertEquals(p.steps.map((x) => x.actorId), ["harvestapi/linkedin-job-search", "harvestapi/linkedin-company", "apify/website-content-crawler"]);
  assertEquals(p.worstUsd, 0.07439);
  assert(p.executable, p.blockers.join(" | "));
  // …and, unlike the live input, the job search is narrowed to the four requested industries.
  assertEquals((p.steps[0].input!.industryIds as string[]).length, 12);
});

Deno.test("hiring at scale matches the live estimate: 25 companies cost $0.24105", () => {
  assertEquals(planSelection(contractOf(scenario("r2-hiring"))).worstUsd, 0.24105);
});

Deno.test("a role FAMILY searches the LinkedIn function, never one stand-in title", () => {
  const p = planSelection(contractOf(scenario("r3-signal")));
  assertEquals(p.steps[0].input!.functionIds, ["sale", "bd"]);
  assertFalse("jobTitles" in p.steps[0].input!, "no silent narrowing to 'Account Executive'");
});

Deno.test("firmographic discovery exists as a route, but a catalogued Actor is never executable", () => {
  const p = planSelection(contractOf(scenario("r4-industry")));
  assertEquals(p.steps[0].actorId, "harvestapi/linkedin-company-search");
  assert(p.steps[0].check.ok, p.steps[0].check.errors.join("; "));
  assertFalse(p.steps[0].executable);
  assert(p.blockers.some((b) => b.includes("catalogued, not approved")));
});

Deno.test("an industry with no reviewed code is disclosed, not dropped or guessed", () => {
  const p = planSelection(contractOf(scenario("r5-founders")));
  const d = p.steps[0].disclosures.find((x) => x.label.includes("B2B SaaS"))!;
  assertEquals(d.handling, "unverifiable");
  assertFalse("industryIds" in p.steps[0].input!);
});

Deno.test("the schema gate: unknown property, bad enum item, bound, missing required", () => {
  const job = schema("harvestapi__linkedin-job-search.schema.json");
  assertEquals(validateInput(job, { jobTitles: ["AE"], postedLimit: "year" }).ok, false);
  assertEquals(validateInput(job, { jobTitles: ["AE"], functionIds: ["sales"] }).ok, false);
  assertEquals(validateInput(job, { jobTitles: ["AE"], madeUp: 1 }).errors, ['unknown property "madeUp"']);
  assertEquals(validateInput(schema("harvestapi__linkedin-company-search.schema.json"), { maxItems: 5000 }).ok, false);
  assertEquals(validateInput(schema("apify__website-content-crawler.schema.json"), { startUrls: [] }).errors, ['missing required property "proxyConfiguration"']);
  assertEquals(validateInput(null, {}).ok, false, "no captured schema → cannot run");
});

Deno.test("size ranges map to every overlapping LinkedIn band and say when they are wider", () => {
  assertEquals(sizeBands(10, 200), { bands: ["1-10", "11-50", "51-200"], exact: false });
  assertEquals(sizeBands(11, 200), { bands: ["11-50", "51-200"], exact: true });
});

Deno.test("job search bills maxItems PER title × location; the run-level maxItems caps it", () => {
  const e = actor("harvestapi/linkedin-job-search");
  assertEquals(worstCaseUsd(e, { jobTitles: ["A", "B"], locations: ["United States"], maxItems: 20 }, 100), 0.041);
  assertEquals(worstCaseUsd(e, { jobTitles: ["A", "B"], locations: ["United States"], maxItems: 20 }, 20), 0.021);
});

Deno.test("AI-assisted Store discovery only PROPOSES; nothing it returns is executable", () => {
  const snap = JSON.parse(Deno.readTextFileSync(new URL("./snapshots/store-snapshot.json", import.meta.url))) as StoreSnapshot;
  const xs = proposeFromStore(snap, "company_discovery");
  assert(xs.length > 0);
  assert(xs.every((x) => x.executable === false && x.reviewChecklist.length === 5));
});

Deno.test("a built input never carries a model-chosen Actor or property: only catalogue slots", () => {
  const e = actor("harvestapi/linkedin-company-search");
  const { input } = buildInput(e, contractOf(scenario("r1-firmographic")), { limit: 20 });
  const allowed = new Set([...Object.values(e.slots), ...Object.keys(e.fixed ?? {})]);
  for (const k of Object.keys(input)) assert(allowed.has(k), k);
});
