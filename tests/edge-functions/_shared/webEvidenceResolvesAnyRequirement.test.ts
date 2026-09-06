// ANY REQUIREMENT THAT DEPENDS ON WEB EVIDENCE MUST BE RESOLVABLE BY THE SAME
// GENERIC PIPELINE.
//
// ── THE RUNS THIS EXISTS FOR ───────────────────────────────────────────────
//
// Lineages 8cfdfd10, e5d4fc14, c31585f8 and ab06540f each bought pages for
// otherwise-qualified companies and each ended with the same requirement open.
// Replaying ab06540f's own payloads against its own cached pages, Metaview's
// re-evaluator quoted its homepage tagline VERBATIM and cited the PRICING
// page's id — the four `web_page` items share their first 4,596 characters of
// navigation, so they are near-indistinguishable in the projection. The quote
// was true, first-party and present in this company's registry, and
// `excerpt_not_in_source` destroyed it.
//
// ── WHAT IS BEING TESTED ───────────────────────────────────────────────────
//
// The mechanism, across requirement FAMILIES — business model, customer type,
// pricing, geography — never one wording. Nothing here reads a requirement
// string; the pipeline must not either. Cases 2, 6 and 7 are the other half of
// the bargain: the bar does not move.
//
// ZERO network, ZERO models, ZERO providers, ZERO database.

import { assert, assertEquals, assertFalse } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { buildEvidenceRegistry } from "../../../supabase/functions/_shared/leadEvidenceRegistry.ts";
import {
  parseMissionEvaluationStrict, mergeReevaluation, anchorCitation,
  EVIDENCE_POLICY, MISSION_EVALUATION_PROMPT, MISSION_REEVALUATION_PROMPT,
  type MissionEvaluation,
} from "../../../supabase/functions/_shared/missionEvaluation.ts";
import { reapplyMissionEvaluation } from "../../../supabase/functions/_shared/leadCapabilityEngine.ts";

// ───────────────────────────── the fixture site ─────────────────────────────
//
// Every page opens with the SAME banner, because every real site does. That
// shared chrome is what made a citation pick the wrong sibling, and it is what
// case 6 relies on to stay unresolvable.

const CHROME =
  "[Introducing Screening: talk to every candidate without picking up the phone.]" +
  " Product Pricing Customers Careers Log in Get started";

const page = (intent: string, body: string) => ({
  source_url: `https://acme.com/${intent === "homepage" ? "" : intent}`,
  page_intent: intent,
  source_text: `${CHROME}\n\n${body}`,
  fetched_at: "2026-09-05T10:00:00.000Z",
});

const PAGES = {
  homepage: page("homepage", "Acme is the workflow platform for modern operations teams."),
  pricing: page(
    "pricing",
    "Starter $100 monthly per user. Business $180 monthly per user, billed annually. " +
      "Enterprise plans are quoted for organisations over 500 seats.",
  ),
  customers: page(
    "customers",
    "Trusted by finance, legal and procurement teams at Barclays, Linklaters and Centrica.",
  ),
  contact: page(
    "contact",
    "Our London office is at 30 Finsbury Square, London EC2A 1AG, United Kingdom.",
  ),
  // The product page repeats the homepage's positioning line, exactly as
  // metaview.ai's does. A quote from it names two pages and therefore neither.
  product: page(
    "product",
    "Acme is the workflow platform for modern operations teams. Explore the product.",
  ),
  vague: page("about", "We are building the future of work. Join us on the journey."),
  contradiction: page(
    "product",
    "Acme is a free consumer app for individuals. We do not sell to businesses.",
  ),
};

const evidence = (over: Record<string, unknown> = {}) => ({
  version: "company-evidence-v1",
  company_key: "acme.com",
  company_name: "Acme",
  domain: "acme.com",
  linkedin_company_url: "https://www.linkedin.com/company/acme",
  identity_state: "resolved",
  geography_evidence: "London, United Kingdom",
  employee_evidence: 120,
  industry_evidence: ["Software Development", "provider_label:Software Development"],
  description: "Acme builds workflow software.",
  source_query: null,
  source_capability: "general_company_discovery",
  commercial_job_evidence: [{ title: "Account Executive", url: "https://x/1" }],
  strongest_signal: "Account Executive",
  evidence_urls: [],
  missing_fields: [],
  conflicting_evidence: [],
  ...over,
}) as never;

const registryOf = (pages: Array<typeof PAGES.homepage>, over = {}) =>
  buildEvidenceRegistry({ evidence: evidence(over), web_pages: pages } as never);

const idFor = (reg: ReturnType<typeof registryOf>, intent: string) =>
  reg.items.find((i) => i.metadata?.page_intent === intent)!.evidence_id;

const answer = (
  matched: Array<{ requirement: string; evidence_id: string; excerpt: string; support?: string }>,
  over: Record<string, unknown> = {},
) => ({
  mission_fit: "pass", icp_fit: "strong", hiring_fit: "verified",
  confidence: 0.9, match_score: 90,
  matched_requirements: matched,
  failed_requirements: [], reasoning: "", rejection_reasons: [],
  evidence_quality: "strong", unknown_fields: [], next_action: null,
  ...over,
});

const prior = (open: string[]): MissionEvaluation => ({
  version: "mission-evaluation-v1",
  decision: "insufficient_evidence",
  mission_fit: "review", icp_fit: "strong", hiring_fit: "verified",
  confidence: 0.8, match_score: 80,
  matched_requirements: [
    { requirement: "20–200 employees", evidence_id: "employee_count:linkedin:x", excerpt: "120 employees" },
  ],
  failed_requirements: [],
  reasoning: "", rejection_reasons: [], evidence_quality: "moderate",
  unknown_fields: open, next_action: null,
} as unknown as MissionEvaluation);

// ══════════ CASE 1 — business model, strong first-party pricing ════════════

Deno.test("CASE 1: a verbatim quote filed under the wrong sibling still resolves", () => {
  const reg = registryOf([PAGES.homepage, PAGES.pricing, PAGES.customers]);
  // THE PRODUCTION SHAPE: the quote is the PRICING page's, the id is the
  // HOMEPAGE's. Without anchoring this is `excerpt_not_in_source` and the
  // requirement stays open on evidence that is sitting in the registry.
  const p = parseMissionEvaluationStrict(
    answer([{
      requirement: "Company is a B2B SaaS company",
      evidence_id: idFor(reg, "homepage"),
      excerpt: "Business $180 monthly per user, billed annually",
    }]),
    reg,
  );

  assertEquals(p.raw_shape.dropped_citations, [], "a true first-party quote must not be destroyed");
  assertEquals(p.evaluation.matched_requirements.length, 1);
  assertEquals(
    p.evaluation.matched_requirements[0].evidence_id, idFor(reg, "pricing"),
    "the receipt must name the evidence a reviewer will actually open",
  );
  assert(p.raw_shape.repaired_fields.some((f) => f.startsWith("citation:")),
    "and the relocation must be recorded, not silent");
  assertEquals(p.evaluation.decision, "qualified");
});

// ══════════ CASE 2 — the same requirement on taxonomy alone ════════════════

Deno.test("CASE 2: a provider industry label cannot carry a business model", () => {
  const reg = registryOf([PAGES.homepage]);
  const label = reg.items.find((i) => i.source === "provider_label")!;
  const p = parseMissionEvaluationStrict(
    answer([{
      requirement: "Company is a B2B SaaS company",
      evidence_id: label.evidence_id,
      excerpt: "Software Development",
      support: "supported",
    }]),
    reg,
  );
  // The model ADMITTED this is one of a set; code insists on the second.
  assert(p.raw_shape.dropped_citations.some((d) => d.startsWith("insufficient_receipt")),
    "one hedged taxonomy citation is not a receipt");
  assertEquals(p.evaluation.matched_requirements.length, 0);

  // And the policy both passes are given says so in words.
  const n = (s: string) => s.replace(/\s+/g, " ");
  assert(n(EVIDENCE_POLICY).includes("A PROVIDER CATEGORY IS NOT A BUSINESS MODEL"));
  for (const [name, prompt] of [["first pass", MISSION_EVALUATION_PROMPT],
    ["re-evaluation", MISSION_REEVALUATION_PROMPT]] as const) {
    assert(n(prompt).includes(n(EVIDENCE_POLICY)), `${name} carries the one shared bar`);
  }
});

// ══════════ CASE 3 — customer type ════════════════════════════════════════

Deno.test("CASE 3: a customer-type requirement resolves from the same mechanism", () => {
  const reg = registryOf([PAGES.homepage, PAGES.customers]);
  const p = parseMissionEvaluationStrict(
    answer([{
      requirement: "Sells to enterprise business customers",
      evidence_id: idFor(reg, "homepage"),
      excerpt: "finance, legal and procurement teams at Barclays, Linklaters and Centrica",
    }]),
    reg,
  );
  assertEquals(p.raw_shape.dropped_citations, []);
  assertEquals(p.evaluation.matched_requirements[0].evidence_id, idFor(reg, "customers"));
  assertEquals(p.evaluation.decision, "qualified");
});

// ══════════ CASE 4 — pricing / subscription ═══════════════════════════════

Deno.test("CASE 4: a subscription requirement resolves from the pricing page", () => {
  const reg = registryOf([PAGES.homepage, PAGES.pricing]);
  const p = parseMissionEvaluationStrict(
    answer([{
      requirement: "Product is sold on a recurring subscription",
      evidence_id: idFor(reg, "pricing"),
      excerpt: "Starter $100 monthly per user",
    }]),
    reg,
  );
  assertEquals(p.raw_shape.dropped_citations, []);
  assertEquals(p.evaluation.decision, "qualified");
});

// ══════════ CASE 5 — geography / branch presence ══════════════════════════

Deno.test("CASE 5: an office-presence requirement resolves from a contact page", () => {
  const reg = registryOf([PAGES.homepage, PAGES.contact]);
  const p = parseMissionEvaluationStrict(
    answer([{
      requirement: "Has a real presence in the United Kingdom",
      // again the wrong sibling, again a true quote
      evidence_id: idFor(reg, "homepage"),
      excerpt: "Our London office is at 30 Finsbury Square, London EC2A 1AG",
    }]),
    reg,
  );
  assertEquals(p.raw_shape.dropped_citations, []);
  assertEquals(p.evaluation.matched_requirements[0].evidence_id, idFor(reg, "contact"));
  assertEquals(p.evaluation.decision, "qualified");
});

// ══════════ CASE 6 — weak and non-identifying evidence ════════════════════

Deno.test("CASE 6: a quote that identifies no page proves nothing", () => {
  const reg = registryOf([PAGES.homepage, PAGES.product, PAGES.pricing]);
  // THE REAL METAVIEW DRAW: the positioning line is verbatim on the homepage
  // AND the product page, and the model cited the pricing page. A quote that
  // names two pages names neither — and `page_intent` is what tells
  // corroboration from one page quoted twice, so guessing here would let a
  // site's own boilerplate corroborate itself.
  const p = parseMissionEvaluationStrict(
    answer([{
      requirement: "Company is a B2B SaaS company",
      evidence_id: idFor(reg, "pricing"),
      excerpt: "Acme is the workflow platform for modern operations teams",
    }]),
    reg,
  );
  assert(p.raw_shape.dropped_citations.some((d) => d.startsWith("ambiguous_excerpt")));
  assertEquals(p.evaluation.matched_requirements.length, 0);
  assertEquals(p.evaluation.decision, "insufficient_evidence");

  // And vague first-party prose the model never quoted leaves it open too.
  const vague = registryOf([PAGES.vague]);
  const q = parseMissionEvaluationStrict(
    answer([], { mission_fit: "review", unknown_fields: ["Company is a B2B SaaS company"] }),
    vague,
  );
  assertEquals(q.evaluation.decision, "insufficient_evidence");
});

Deno.test("CASE 6b: an invented evidence_id is still refused outright", () => {
  const reg = registryOf([PAGES.pricing]);
  const p = parseMissionEvaluationStrict(
    answer([{
      requirement: "Product is sold on a recurring subscription",
      evidence_id: "web_page:company_website:deadbeef",
      excerpt: "Starter $100 monthly per user",
    }]),
    reg,
  );
  assert(p.raw_shape.dropped_citations.some((d) => d.startsWith("unknown_evidence_id")),
    "anchoring repairs a mis-picked sibling; it never adopts an id this registry lacks");
  assertEquals(p.evaluation.mission_fit, "review");
});

// ══════════ CASE 7 — contradiction ════════════════════════════════════════

Deno.test("CASE 7: a contradicted requirement cannot be promoted", () => {
  const reg = registryOf([PAGES.homepage, PAGES.contradiction]);
  const before = prior(["Sells to business customers"]);
  const parsed = parseMissionEvaluationStrict(
    answer([], {
      mission_fit: "fail",
      failed_requirements: [{
        requirement: "Sells to business customers",
        evidence_id: idFor(reg, "product"),
        why: "the product page states it is a free consumer app",
      }],
      unknown_fields: [],
    }),
    reg,
  );
  const merged = mergeReevaluation(before, parsed.evaluation);
  assertEquals(merged.decision, "not_qualified", "a contradiction wins; it is new information");
  assertEquals(merged.failed_requirements.length, 1);
  assert(merged.failed_requirements[0].evidence_id !== null, "and it carries its citation");
});

// ══════════ CASE 8 — the upgrade reaches the authoritative count ══════════

const engineCompany = (key: string) => ({
  key,
  company: { company_name: key },
  fit: { missing_evidence: [] },
  enrichment_outcome: "success",
  verdict: "unknown",
  decision_source: "insufficient_evidence",
  mission_evaluation: prior(["Company is a B2B SaaS company"]),
  brain: { outcome: "REVIEW", reason: "one requirement open" },
  brain_inputs: {
    gates: {
      identity_status: "verified_match", active: true, geography: "United Kingdom",
      required_geography: null, employee_count: 120, employee_min: 20, employee_max: 200,
    },
    policy: {}, hiring_verified: true, grounding: null, enrichment_planned: true,
  },
}) as never;

const engineRun = () => ({
  companies: [engineCompany("acme.com")] as never,
  state: { qualified_company_keys: [] as string[], unknown_company_keys: [] as string[] } as never,
});

Deno.test("CASE 8: a web-evidence upgrade reaches qualified_company_keys", () => {
  const reg = registryOf([PAGES.homepage, PAGES.pricing]);
  const parsed = parseMissionEvaluationStrict(
    answer([{
      requirement: "Company is a B2B SaaS company",
      evidence_id: idFor(reg, "homepage"),
      excerpt: "Business $180 monthly per user, billed annually",
    }], { unknown_fields: [] }),
    reg,
  );
  const merged = mergeReevaluation(prior(["Company is a B2B SaaS company"]), parsed.evaluation);
  assertEquals(merged.decision, "qualified");

  const r = engineRun();
  const out = reapplyMissionEvaluation(r as never, [
    { company_key: "acme.com", evaluation: merged },
  ]);
  assertEquals(out.reapplied, 1);
  assertEquals(
    (r.state as unknown as { qualified_company_keys: string[] }).qualified_company_keys,
    ["acme.com"],
    "the count the quota, delivery and persistence all read",
  );
});

// ══════════ CASE 9 — idempotence ══════════════════════════════════════════

Deno.test("CASE 9: the same evidence applied twice changes nothing", () => {
  const reg = registryOf([PAGES.homepage, PAGES.pricing]);
  const raw = answer([{
    requirement: "Company is a B2B SaaS company",
    evidence_id: idFor(reg, "pricing"),
    excerpt: "Starter $100 monthly per user",
  }], { unknown_fields: [] });

  const once = mergeReevaluation(prior(["Company is a B2B SaaS company"]),
    parseMissionEvaluationStrict(raw, reg).evaluation);
  const twice = mergeReevaluation(once, parseMissionEvaluationStrict(raw, reg).evaluation);

  assertEquals(twice.decision, once.decision);
  assertEquals(twice.matched_requirements.length, once.matched_requirements.length,
    "a receipt applied twice is one receipt, not two");
  assertEquals(twice.unknown_fields, once.unknown_fields);

  const r = engineRun();
  reapplyMissionEvaluation(r as never, [{ company_key: "acme.com", evaluation: twice }]);
  reapplyMissionEvaluation(r as never, [{ company_key: "acme.com", evaluation: twice }]);
  assertEquals(
    (r.state as unknown as { qualified_company_keys: string[] }).qualified_company_keys,
    ["acme.com"], "and the company is counted once, not twice");
});

// ══════════ CASE 10 — cached and fresh evidence decide alike ══════════════

Deno.test("CASE 10: a cached page and a freshly fetched one decide identically", () => {
  const body = PAGES.pricing;
  const fresh = { ...body, fetched_at: new Date().toISOString() };
  const cached = { ...body, fetched_at: "2026-08-20T09:00:00.000Z" };

  const rf = registryOf([PAGES.homepage, fresh]);
  const rc = registryOf([PAGES.homepage, cached]);

  // Same URL, same text — so the same identity. A page is not a different fact
  // for having been bought earlier.
  assertEquals(idFor(rf, "pricing"), idFor(rc, "pricing"));

  const cite = (reg: typeof rf) => parseMissionEvaluationStrict(
    answer([{
      requirement: "Product is sold on a recurring subscription",
      evidence_id: idFor(reg, "pricing"),
      excerpt: "Starter $100 monthly per user",
    }], { unknown_fields: [] }),
    reg,
  ).evaluation;

  assertEquals(cite(rf).decision, cite(rc).decision);
  assertEquals(cite(rf).matched_requirements[0].evidence_id,
    cite(rc).matched_requirements[0].evidence_id);
});

// ══════════ the anchor itself, as a unit ══════════════════════════════════

Deno.test("the anchor is text-to-text and knows nothing about requirements", () => {
  const reg = registryOf([PAGES.homepage, PAGES.product, PAGES.pricing, PAGES.customers]);
  const home = idFor(reg, "homepage");

  assertEquals(anchorCitation(reg, home, "Acme is the workflow platform").outcome, "as_cited");
  assertEquals(anchorCitation(reg, home, "Starter $100 monthly per user").outcome, "repaired");
  // Quoted against an id that does NOT carry it, and carried by two others.
  const pricing = idFor(reg, "pricing");
  assertEquals(
    anchorCitation(reg, pricing, "Acme is the workflow platform for modern operations").outcome,
    "ambiguous_excerpt");
  // But a quote the cited item DOES carry is accepted as cited, chrome or not —
  // the anchor only ever runs when the named item failed.
  assertEquals(anchorCitation(reg, pricing, "Product Pricing Customers").outcome, "as_cited");
  assertEquals(anchorCitation(reg, home, "we host it on Mars").outcome, "excerpt_not_in_source");
  assertEquals(anchorCitation(reg, "web_page:company_website:0", "Starter $100 monthly per user")
    .outcome, "unknown_evidence_id");
  // Too short to identify a source, so never relocated.
  assertEquals(anchorCitation(reg, home, "$100").outcome, "excerpt_not_in_source");
});

// ══════════ the policy states what CAN establish a requirement ════════════

Deno.test("the shared bar says what settles a requirement, not only what does not", () => {
  const n = (s: string) => s.replace(/\s+/g, " ");
  const policy = n(EVIDENCE_POLICY);
  assert(policy.includes("WHAT CAN ESTABLISH A REQUIREMENT"),
    "a policy that lists only prohibitions has one answer for everything");
  assert(policy.includes("ENTAILS"), "an entailment is how a fact carries a category");
  assert(policy.includes("An entailment is not a widening"),
    "or the widening prohibition swallows it");
  assert(policy.includes("CONTRADICTED IS NOT UNRESOLVED"));
  // Both passes, one bar.
  for (const p of [MISSION_EVALUATION_PROMPT, MISSION_REEVALUATION_PROMPT]) {
    assert(n(p).includes(policy));
  }
});

// ══════════ CASE 11 — the false positive the replay found ═════════════════

Deno.test("CASE 11: evidence the first pass already had cannot close what it left open", () => {
  const reg = registryOf([PAGES.homepage, PAGES.pricing]);
  const description = reg.items.find((i) => i.evidence_type === "company_description")!;

  // THE REPLAY: InEvent's re-evaluator settled "Whether InEvent is
  // specifically a B2B SaaS company" by quoting the LinkedIn profile
  // description the FIRST pass had already read and declined to act on.
  const parsed = parseMissionEvaluationStrict(
    answer([{
      requirement: "Company is a B2B SaaS company",
      evidence_id: description.evidence_id,
      excerpt: "Acme builds workflow software",
    }], { unknown_fields: [] }),
    reg,
  );
  assertEquals(parsed.raw_shape.dropped_citations, [], "the quote itself is genuine");

  const firstPassHeld = new Set([description.evidence_id]);
  const held = mergeReevaluation(
    prior(["Company is a B2B SaaS company"]), parsed.evaluation, undefined,
    (id) => !firstPassHeld.has(id),
  );
  assertEquals(held.decision, "insufficient_evidence",
    "a re-reading of evidence already in hand is not evidence arriving");
  assertEquals(held.unknown_fields, ["Company is a B2B SaaS company"]);

  // The SAME answer, resting on a page that arrived since, does close it.
  const onPage = parseMissionEvaluationStrict(
    answer([{
      requirement: "Company is a B2B SaaS company",
      evidence_id: idFor(reg, "pricing"),
      excerpt: "Starter $100 monthly per user",
    }], { unknown_fields: [] }),
    reg,
  );
  const closed = mergeReevaluation(
    prior(["Company is a B2B SaaS company"]), onPage.evaluation, undefined,
    (id) => !firstPassHeld.has(id),
  );
  assertEquals(closed.decision, "qualified");

  // And with no prior registry to compare against, nothing is held back.
  const cannotTell = mergeReevaluation(
    prior(["Company is a B2B SaaS company"]), parsed.evaluation, undefined, undefined,
  );
  assertEquals(cannotTell.decision, "qualified",
    "the gate is a comparison, not a new prohibition");
});
