// THE COMPANY BRAIN PAGE'S INLINE EDITS WRITE THE DRAWER'S PATCH — AND ITS
// SENTENCE, STEPS AND SOURCES ONLY SAY WHAT THE BRAIN HOLDS.
//
// The page edits values in place (a chip added to "Industries", a rule moved
// from "Manual review" to "Reject"). Those edits must save exactly what the
// section drawer would save for the same change, or the page and the drawer
// slowly disagree about the profile's shape. And the read-outs (the ICP
// sentence, "next best improvement", "built from") must come from real fields,
// never placeholders that look like data.
//
// Pure. No React, no network.

import { assert, assertEquals, assertFalse } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { normalizeCompanyBrain } from "../../src/lib/normalizeCompanyBrain.ts";
import { buildFieldPatch, buildPatch, initialFor } from "../../src/lib/companyBrainPatch.ts";
import {
  brainSources, buildIcpSentences, companySizeLabel, deriveNextSteps, joinValues, monogram,
} from "../../src/lib/companyBrainInsights.ts";

const FULL = normalizeCompanyBrain({
  company: { name: "Northwind Analytics", description: "Revenue analytics.", category: "Analytics" },
  target_customer: {
    industries: ["B2B SaaS", "Fintech"], business_models: ["Subscription"], geography: ["UK"],
    company_size: { min: 50, max: 200, label: "" }, funding_stage: ["Series A"],
    must_have: ["Hiring RevOps"], nice_to_have: [],
    disqualifiers: { industries: ["Agencies"], company_types: [], domains: ["example.org"], keywords: [], titles: [] },
  },
  buyer_personas: ["CFO"], pain_points: ["Slow reporting"],
  triggers: ["New CFO"], jobs_to_watch: ["FP&A Lead"],
  content_angles: ["Close faster"],
  positioning: { promise: "Board numbers in a day.", differentiators: [], proof_points: [] },
  brand_voice: { tone: "Direct" },
  qualification_rules: { required_evidence: ["Pricing page"], reject_if: [], manual_review_if: ["Holding group"] },
  evidence: {
    source_pages: ["https://www.northwind.example/pricing/", "javascript:alert(1)", "https://www.northwind.example/pricing"],
    linkedin_sources: ["https://linkedin.com/company/northwind"],
  },
});

Deno.test("1. an inline edit saves the drawer's patch for the same change", () => {
  const drawerState = { ...initialFor("targeting", FULL), industries: ["Logistics"] };
  assertEquals(buildFieldPatch("targeting", { industries: ["Logistics"] }, FULL), buildPatch("targeting", drawerState, FULL));
});

Deno.test("2. an inline edit keeps every other field of its section", () => {
  const patch = buildFieldPatch("targeting", { industries: ["Logistics"] }, FULL) as { target_customer: Record<string, unknown> };
  const tc = patch.target_customer;
  assertEquals(tc.industries, ["Logistics"]);
  assertEquals(tc.geography, ["UK"]);
  assertEquals(tc.company_size, { min: 50, max: 200, label: "50-200 employees" }, "the range, readable by the backend");
  // Disqualifiers share target_customer; a targeting edit must not drop them.
  assertEquals((tc.disqualifiers as Record<string, unknown>).domains, ["example.org"]);
  assertEquals(Object.keys(patch), ["target_customer"], "no positive examples yet, so no empty key is added");
});

Deno.test("3. moving a rule between lanes is one patch that removes and adds", () => {
  const patch = buildFieldPatch("disqualifiers", { manual_review_if: [], reject_if: ["Holding group"] }, FULL) as {
    qualification_rules: Record<string, string[]>;
  };
  assertEquals(patch.qualification_rules.manual_review_if, []);
  assertEquals(patch.qualification_rules.reject_if, ["Holding group"]);
  assertEquals(patch.qualification_rules.required_evidence, ["Pricing page"]);
});

Deno.test("4. the ICP sentence reads the brain, and every list slot names its drawer field", () => {
  const [who, fit, skip] = buildIcpSentences(FULL);
  const slots = [...who, ...fit, ...skip].filter((p) => p.kind === "slot");
  const industries = slots.find((s) => s.kind === "slot" && s.label === "industries");
  assert(industries && industries.kind === "slot");
  assertEquals(industries.values, ["B2B SaaS", "Fintech"]);
  assertEquals(industries.ref, { section: "targeting", field: "industries" });
  const size = slots.find((s) => s.kind === "slot" && s.label === "company size");
  assert(size && size.kind === "slot");
  assertEquals(size.values, ["50–200 employees"]);
  assertEquals(size.ref, null, "size is a range, edited in the drawer");
  // Every ref must be a field the drawer's state actually has.
  for (const s of slots) {
    if (s.kind !== "slot" || !s.ref) continue;
    assert(s.ref.field in initialFor(s.ref.section, FULL), `${s.ref.field} is not a ${s.ref.section} field`);
  }
  assertEquals(joinValues(["A", "B", "C"], "or"), "A, B or C");
  // The normalizer fills a missing size label from the SELLER's team size; a
  // real target range must win over it.
  const seller24 = normalizeCompanyBrain({ company: { team_size: "24" }, target_customer: { company_size: { min: 50, max: 200 } } });
  assertEquals(companySizeLabel(seller24), "50–200 employees");
});

Deno.test("5. an empty brain has empty slots — no placeholder values", () => {
  const empty = normalizeCompanyBrain({});
  for (const sentence of buildIcpSentences(empty)) {
    for (const p of sentence) if (p.kind === "slot") assertEquals(p.values, []);
  }
});

Deno.test("6. next steps name real gaps first, then polish", () => {
  const empty = deriveNextSteps(normalizeCompanyBrain({}));
  assertEquals(empty.map((s) => s.section), ["company", "targeting", "buyers", "signals", "disqualifiers", "messaging"]);
  assert(empty.every((s) => s.kind === "gap"));
  const full = deriveNextSteps(FULL);
  assertFalse(full.some((s) => s.kind === "gap"), "a fully configured brain has no gaps");
  assertEquals(full.map((s) => s.title), [
    "Add proof points", "Name what makes you different", "Add a second buyer role", "Add a hard reject rule",
  ]);
});

Deno.test("7. sources are de-duplicated and only http(s) becomes a link", () => {
  const sources = brainSources(FULL);
  assertEquals(sources.map((s) => s.label), ["northwind.example/pricing", "javascript:alert(1)", "linkedin.com/company/northwind"]);
  assertEquals(sources[1].href, null);
  assertEquals(sources[2].kind, "linkedin");
  assertEquals(monogram("Northwind Analytics"), "NA");
  assertEquals(monogram("acme"), "AC");
});

// ── Sync with the rest of the system ───────────────────────────────────────

// 8. (moved) "the seller's own team size is never the target size" ships with
//    roadmap 1.4 on branch design/target-size (UI-3): the frontend normalizer
//    must change together with the backend normalizer and compiler, or the page
//    and lead search disagree. See docs/plans/company-brain-completion.

Deno.test("9. a saved range is spelled out in the label the backend reads first", () => {
  const b = normalizeCompanyBrain({ target_customer: { company_size: { label: "11-50" } } });
  const size = (changes: Record<string, unknown>) =>
    (buildFieldPatch("targeting", changes, b) as { target_customer: { company_size: { label: string } } }).target_customer.company_size;
  assertEquals(size({ size_min: "50", size_max: "200" }).label, "50-200 employees", "a stale label is replaced");
  assertEquals(size({ size_min: "11", size_max: "50" }).label, "11-50", "a label that states the range is kept");
  assertEquals(size({ size_min: "", size_max: "", size_label: "Mid-market" }).label, "Mid-market");
});

Deno.test("10. competitors are written where they are read, keeping legacy data", () => {
  const v2 = normalizeCompanyBrain({ schema_version: 2, competitors: ["Clay"] });
  assertEquals(Object.keys(buildFieldPatch("company", { competitors: ["Clay", "Apollo"] }, v2)).includes("competitors"), true);
  const legacy = normalizeCompanyBrain({ competitors: { known: ["Clay"], adjacent: ["Zapier"] } });
  const lp = buildFieldPatch("company", { competitors: ["Clay", "Apollo"] }, legacy) as Record<string, unknown>;
  assertEquals(lp.competitors_v2, ["Clay", "Apollo"]);
  assertFalse("competitors" in lp, "the legacy {known, adjacent} object is untouched");
  // Round trip: the page reads back what it wrote.
  assertEquals(normalizeCompanyBrain({ competitors: { known: ["Clay"], adjacent: ["Zapier"] }, ...lp }).competitors, ["Clay", "Apollo"]);
});

Deno.test("11. new fields round-trip, and saving never adds empty keys", () => {
  const empty = normalizeCompanyBrain({ schema_version: 2 });
  const rename = buildFieldPatch("company", { name: "Acme" }, empty);
  assertEquals(Object.keys(rename), ["company"], "no empty founder/tools/competitors keys");
  const withFounder = buildFieldPatch("company", { founder_name: "Ada", tools: ["HubSpot"] }, empty) as Record<string, unknown>;
  const back = normalizeCompanyBrain({ schema_version: 2, ...withFounder });
  assertEquals(back.founder.name, "Ada");
  assertEquals(back.tools, ["HubSpot"]);
  const offer = normalizeCompanyBrain({ schema_version: 2, ...buildFieldPatch("messaging", { offer: "Pilot", use_cases: ["Board packs"] }, empty) });
  assertEquals(offer.positioning.offer, "Pilot");
  assertEquals(offer.positioning.use_cases, ["Board packs"]);
  const good = normalizeCompanyBrain({ schema_version: 2, ...buildFieldPatch("targeting", { positive_examples: ["Ledgerly"] }, empty) });
  assertEquals(good.positive_examples, ["Ledgerly"]);
});

Deno.test("12. the page's saves are versioned like every other writer of the brain", () => {
  // The version check is the SERVER's (generate-company-brain-draft `update`,
  // #147): a save carries the version it was built on and is refused if the row
  // moved on. The page never writes the row itself — companyBrainPageSave.test.ts.
  const page = Deno.readTextFileSync(new URL("../../src/pages/CompanyBrainDashboard.tsx", import.meta.url));
  const hook = Deno.readTextFileSync(new URL("../../src/hooks/useCompanyBrain.ts", import.meta.url));
  assert(/expectedUpdatedAt: version\.current/.test(page), "every save names the version it builds on");
  assert(/updated_at'\)/.test(hook), "the shared read carries the version");
});
