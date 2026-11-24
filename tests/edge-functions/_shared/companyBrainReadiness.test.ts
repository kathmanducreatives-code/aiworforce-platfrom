// ONE READINESS RULE (roadmap Phase 2): what a Company Brain can power yet.
//
// Pins the per-capability minimums, the draft/usable/ready states, the
// "what to add" prompts, and parity between the server policy and its
// frontend mirror (same code, and the same answer on every fixture).
import { assert, assertEquals, assertFalse } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { BRAIN_CAPABILITIES, companyBrainReadiness } from "../../../supabase/functions/_shared/companyBrainReadiness.ts";
import { companyBrainReadiness as pageReadiness } from "../../../src/lib/companyBrainReadiness.ts";
import { normalizeCompanyBrain } from "../../../supabase/functions/_shared/normalizeCompanyBrain.ts";
import { normalizeCompanyBrain as pageNormalize } from "../../../src/lib/normalizeCompanyBrain.ts";
import { computeCompanyBrainCompleteness } from "../../../supabase/functions/_shared/companyBrainCompleteness.ts";

type Raw = Record<string, unknown>;
const brain = (p: Raw) => normalizeCompanyBrain({ schema_version: 2, ...p });
const tc = (t: Raw) => ({ target_customer: t });

const ACTIVATED_FULL: Raw = {
  company: { name: "Northwind", description: "Revenue analytics", business_model: "B2B SaaS" },
  target_customer: { industries: ["Fintech"], disqualifiers: { industries: ["Agencies"] } },
  buyer_personas: ["CFO"], triggers: ["New funding"], pain_points: ["Slow reporting"],
  positioning: { promise: "Close the quarter in days" },
};

Deno.test("R-1 an empty Brain is a draft: only read-only views open, and each capability says what it needs", () => {
  const r = companyBrainReadiness(brain({}), false);
  assertEquals(r.state, "draft");
  assertEquals(BRAIN_CAPABILITIES.filter((c) => r.can[c]), ["read_only"]);
  assertEquals(r.needs.signals.map((n) => n.key), ["target_customer.market"]);
  assertEquals(r.needs.lead_search.map((n) => n.key), ["target_customer.industries", "buyer_personas"]);
  assertEquals(r.needs.outreach.map((n) => n.key), ["activation", "positioning.promise"]);
  assertEquals(r.needs.content.map((n) => n.key), ["company.description", "content.voice"]);
  for (const c of BRAIN_CAPABILITIES) assertEquals(r.needs[c].length === 0, r.can[c], `${c}: needs and can agree`);
});

Deno.test("R-2 signals need industries OR must-have", () => {
  assert(companyBrainReadiness(brain(tc({ industries: ["Fintech"] })), false).can.signals);
  assert(companyBrainReadiness(brain(tc({ must_have: ["Uses Salesforce"] })), false).can.signals);
  assertFalse(companyBrainReadiness(brain({ buyer_personas: ["CFO"] }), false).can.signals);
});

Deno.test("R-3 lead search needs industries AND (buyers OR must-have)", () => {
  assertFalse(companyBrainReadiness(brain(tc({ industries: ["Fintech"] })), false).can.lead_search);
  assert(companyBrainReadiness(brain({ ...tc({ industries: ["Fintech"] }), buyer_personas: ["CFO"] }), false).can.lead_search);
  assert(companyBrainReadiness(brain(tc({ industries: ["Fintech"], must_have: ["SOC 2"] })), false).can.lead_search);
  assertFalse(companyBrainReadiness(brain({ ...tc({ must_have: ["SOC 2"] }), buyer_personas: ["CFO"] }), false).can.lead_search,
    "must-have alone is not a market to search");
});

Deno.test("R-4 outreach needs activation AND a positioning promise — a promise alone is not enough", () => {
  const withPromise = brain({ positioning: { promise: "Close faster" } });
  assertFalse(companyBrainReadiness(withPromise, false).can.outreach);
  assertEquals(companyBrainReadiness(withPromise, false).needs.outreach.map((n) => n.key), ["activation"]);
  assert(companyBrainReadiness(withPromise, true).can.outreach);
  assertFalse(companyBrainReadiness(brain({}), true).can.outreach, "activated without a promise");
});

Deno.test("R-5 content needs a description AND (a pain point OR a content angle)", () => {
  assertFalse(companyBrainReadiness(brain({ company: { description: "Analytics" } }), false).can.content);
  assert(companyBrainReadiness(brain({ company: { description: "Analytics" }, pain_points: ["Slow"] }), false).can.content);
  assert(companyBrainReadiness(brain({ company: { description: "Analytics" }, content_angles: ["Forecasting"] }), false).can.content);
});

Deno.test("R-6 states: usable below activation, ready exactly when activated", () => {
  assertEquals(companyBrainReadiness(brain(tc({ industries: ["Fintech"] })), false).state, "usable");
  assertEquals(companyBrainReadiness(brain(tc({ industries: ["Fintech"] })), null).state, "usable", "unknown activation is not activation");
  const full = brain(ACTIVATED_FULL);
  assert(computeCompanyBrainCompleteness(full).complete, "fixture satisfies every activation requirement");
  const r = companyBrainReadiness(full, true);
  assertEquals(r.state, "ready");
  assert(BRAIN_CAPABILITIES.every((c) => r.can[c]), "a complete, activated Brain with a promise can do everything");
});

Deno.test("R-7 a cleared field closes its capability again (readiness is derived, never stored)", () => {
  const before = companyBrainReadiness(brain({ ...tc({ industries: ["Fintech"] }), buyer_personas: ["CFO"] }), false);
  const after = companyBrainReadiness(brain({ ...tc({ industries: [] }), buyer_personas: ["CFO"] }), false);
  assert(before.can.lead_search);
  assertFalse(after.can.lead_search);
  assertFalse(after.can.signals);
});

Deno.test("R-8 parity: the frontend mirror is the same code and gives the same answer", async () => {
  const strip = (s: string) => s
    .replace(/^\/\/.*$/gm, "")
    .replace(/^import type \{ CompanyBrainV2 \} from .*$/m, "")
    .replace(/\s+/g, " ").trim();
  const server = await Deno.readTextFile(new URL("../../../supabase/functions/_shared/companyBrainReadiness.ts", import.meta.url));
  const page = await Deno.readTextFile(new URL("../../../src/lib/companyBrainReadiness.ts", import.meta.url));
  assertEquals(strip(page), strip(server), "the two copies differ beyond their import line and header");

  const fixtures: Raw[] = [
    {}, tc({ industries: ["Fintech"] }), tc({ must_have: ["SOC 2"] }), { buyer_personas: ["CFO"] },
    { ...tc({ industries: ["Fintech"] }), buyer_personas: ["CFO"] }, { company: { description: "x" }, pain_points: ["y"] },
    { positioning: { promise: "p" } }, ACTIVATED_FULL,
    // legacy-only shapes the normalizers fold in
    { icp: { industries: ["Healthcare"], buyer_roles: ["COO"] } }, { icp: { industries: "Fintech, SaaS" } },
  ];
  for (const f of fixtures) for (const activated of [false, true, null]) {
    assertEquals(pageReadiness(pageNormalize(f), activated), companyBrainReadiness(normalizeCompanyBrain(f), activated),
      `${JSON.stringify(f)} activated=${activated}`);
  }
});
