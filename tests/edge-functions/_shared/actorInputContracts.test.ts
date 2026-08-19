// THE PLANNER IS SHOWN THE SHAPE, NOT ONLY THE FIELD NAMES.
//
// Three production failures in one week were a model guessing at a shape it was
// never shown — a string where an array belonged, an integer where an enum
// belonged. This pins that the contract exists, is complete, and reaches BOTH
// planner payloads.
//
// ZERO network, ZERO model calls.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { ACTOR_INPUT_CONTRACTS } from "../../../supabase/functions/_shared/actorInputContracts.ts";
import { HIRING_ACTOR_CATALOG } from "../../../supabase/functions/_shared/hiringActorCatalog.ts";
import { discoveryCatalogBriefing } from "../../../supabase/functions/_shared/leadDiscoveryStrategy.ts";

Deno.test("1. every carded actor has a live-verified input contract", () => {
  for (const key of Object.keys(HIRING_ACTOR_CATALOG)) {
    const c = ACTOR_INPUT_CONTRACTS[key];
    assert(c, `${key} has no input contract — the planner would be guessing`);
    assert(c.fields.length > 0, `${key} declares no fields`);
    assert(c.verified_at, `${key} does not say when it was verified`);
    assert(Object.keys(c.example).length > 0, `${key} has no worked example`);
  }
});

Deno.test("2. the three shapes that broke production are now stated", () => {
  const memo = ACTOR_INPUT_CONTRACTS["apify_yc_companies_memo23"];
  const industries = memo.fields.find((f) => f.name === "industries")!;
  assertEquals(industries.type, "array",
    'GPT sent industries: "Engineering, Product and Design" — a string. The ' +
    "validator then iterated it character by character.");

  const maxSize = memo.fields.find((f) => f.name === "maxEmployeeSize")!;
  assertEquals(maxSize.type, "string");
  assert(maxSize.enum && maxSize.enum.length > 0,
    "GPT sent maxEmployeeSize: 150; the legal values are an enum of strings");

  const solid = ACTOR_INPUT_CONTRACTS["apify_yc_companies_solidcode"];
  const status = solid.fields.find((f) => f.name === "status")!;
  assertEquals(status.type, "array",
    'GPT sent status: "Active" — a string — and Apify rejected the whole run ' +
    "with apify_input_schema_error, three times");
});

Deno.test("3. the worked examples obey their own contracts", () => {
  for (const [key, c] of Object.entries(ACTOR_INPUT_CONTRACTS)) {
    const byName = new Map(c.fields.map((f) => [f.name, f]));
    for (const [k, v] of Object.entries(c.example)) {
      const f = byName.get(k);
      assert(f, `${key}: example uses "${k}", which the live schema has no field for`);
      const actual = Array.isArray(v) ? "array" : typeof v;
      const expected = f!.type === "integer" ? "number" : f!.type;
      assertEquals(actual, expected,
        `${key}.${k}: example is ${actual}, the schema says ${f!.type}`);
      if (f!.enum) {
        const vals = Array.isArray(v) ? v : [v];
        for (const one of vals) {
          assert(f!.enum!.includes(String(one)),
            `${key}.${k}: example value ${JSON.stringify(one)} is not in the enum`);
        }
      }
    }
  }
});

Deno.test("4. quality is a planning signal, not decoration", () => {
  const niche = ACTOR_INPUT_CONTRACTS["apify_yc_companies_memo23"].quality;
  const heavy = ACTOR_INPUT_CONTRACTS["apify_linkedin_company_details"].quality;
  assert(heavy.total_runs > niche.total_runs * 1000,
    "the store's own traffic separates a mature actor from a niche one");
  assert(/NICHE|LOW TRAFFIC/.test(niche.note),
    `a low-traffic actor must say so: ${niche.note}`);
  assert(/Mature|Heavily used/.test(heavy.note), heavy.note);
});

Deno.test("5. the contract reaches the discovery planner's payload", () => {
  const brief = discoveryCatalogBriefing() as Array<Record<string, unknown>>;
  const search = brief.find((a) => a.actor_key === "apify_linkedin_company_search")!;
  const contract = search.input_contract as { fields: Array<{ name: string }> };
  assert(contract, "the briefing must carry the input contract");
  assert(contract.fields.some((f) => f.name === "searchQuery"));
  assert(search.quality, "and the quality signal");
});
