// FUNDING IS A REAL SIGNAL NOW — and it must stay an EVIDENCED one.
//
// ── WHAT PHASE 4 CHANGED, AND WHAT IT MUST NOT CHANGE ───────────────────────
//
// The Phase 0 audit found funding named in six vocabularies and runnable in
// none. `funding_signal_discovery` declared `apify_yc_companies_memo23` — a Y
// Combinator directory scraper with no funding field anywhere in its verified
// schema — while claiming to produce `funding_event`.
//
// `apify_funding_rounds_datahyena` returns one row per funding EVENT: company,
// stage, amount in USD, announced date, investors and the source articles, with
// the amount ungated by any session cookie. So the capability's claim became
// keepable and the capability became real.
//
// The danger in making a signal real is the opposite of the danger in leaving
// it fake. A fake signal reports evidence it never collected; a real one can
// report evidence it collected BADLY — a row with no date, a company that
// appeared in a funding search but carries no round. These tests pin the line:
// funding requires a dated event naming the company, and anything less is not
// a funding signal.
//
// PURE. No network, no Actor run, no model call.
import {
  assert, assertEquals, assertFalse,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  HIRING_ACTOR_CATALOG, FUNDING_ROUND_STAGES, FUNDING_STAGES_WITHOUT_COVERAGE,
  FUNDING_VERTICALS, FUNDING_COUNTRIES,
} from "../../../supabase/functions/_shared/hiringActorCatalog.ts";
import {
  compileDatahyenaFundingInput,
} from "../../../supabase/functions/_shared/hiringActorInputs.ts";
import {
  normalizeDatahyenaFundingRound, fundingRoundToCompany, fundingRoundIsWithin,
} from "../../../supabase/functions/_shared/hiringActorNormalizers.ts";
import {
  resolveSignalSupport,
} from "../../../supabase/functions/_shared/actorEvidenceCapability.ts";
import {
  describeSignal,
} from "../../../supabase/functions/_shared/missionSignalDescriptor.ts";
import {
  buildCapabilityGraph, CAPABILITY_REGISTRY, isCapabilitySupported,
} from "../../../supabase/functions/_shared/leadCapabilityGraph.ts";
import {
  parseLeadMissionDeterministic,
} from "../../../supabase/functions/_shared/leadMission.ts";
import {
  coverMissionSignals,
} from "../../../supabase/functions/_shared/signalActorCoverage.ts";
import {
  PUBLIC_CAPABILITY_CATALOGUE, catalogueForPrompt, toInternalCapabilities,
} from "../../../supabase/functions/_shared/leadCapabilityCatalogue.ts";
import { isEngineDriven } from "../../../supabase/functions/_shared/leadResearchPlaybooks.ts";

const KEY = "apify_funding_rounds_datahyena";

// ═════════════════════ 1-3. the card tells the truth ═══════════════════════

Deno.test("1. the funding card records what it cannot do, not only what it can", () => {
  const c = HIRING_ACTOR_CATALOG[KEY];
  assert(c, "the funding Actor must be catalogued to be executable at all");
  assertEquals(c.actor_id, "datahyena/company-funding-rounds");
  assertEquals(c.purposes, ["funding_discovery"]);

  // THE LIMITATION THAT SHAPES THE WHOLE PHASE: no company input exists, so
  // this can never verify funding for a pool found another way.
  assert(c.not_for.some((n) => /verifying funding for a company set/i.test(n)),
    "the discovery-only limitation must be on the card");

  // Enrichment is still required: a round proves the ROUND, not the ICP.
  assert(c.requires_enrichment_before_qualification);
});

Deno.test("2. confidence is MEDIUM after the live run, and the reason is recorded", () => {
  // Raised from `low` after run 0XchPqe0cJpx0Yc2T (18 real rows). Not `high`,
  // because the provider's company RESOLUTION was observed wrong on two rows —
  // the round is reliable, the company attached to it is not.
  const c = HIRING_ACTOR_CATALOG[KEY];
  assertEquals(c.confidence, "medium");
  assert(c.known_defects.some((d) => d.id === "datahyena_company_identity_collision"),
    "the observed identity collision must be recorded as a defect");
  assert(c.known_defects.some((d) => d.id === "datahyena_field_fill_rates"),
    "observed fill rates belong on the card, not in a commit message");
  for (const d of c.known_defects) {
    assert(d.mitigation.length > 20 && d.evidence_ref.length > 0,
      `${d.id}: a defect without a mitigation and evidence is a rumour`);
  }
});

Deno.test("3. the vendor's own coverage gaps are recorded as defects", () => {
  const c = HIRING_ACTOR_CATALOG[KEY];
  // Five stages are ACCEPTED by the filter and documented as returning nothing.
  // Accepting a value and returning rows for it are different facts.
  for (const stage of FUNDING_STAGES_WITHOUT_COVERAGE) {
    assert((FUNDING_ROUND_STAGES as readonly string[]).includes(stage),
      `${stage} must still be a legal enum value — the schema accepts it`);
  }
  assert(c.known_defects.some((d) => d.id === "datahyena_stage_coverage_gaps"));
  assert(c.known_defects.some((d) => d.id === "datahyena_missing_dimensions"));
});

// ═══════════════ 4-6. the compiler bounds cost and warns honestly ══════════

Deno.test("4. an unbounded or oversized run is REFUSED, not clamped", () => {
  // At $0.045 per record this is the most expensive row in the catalog, so
  // `maxItems` is required and capped rather than defaulted.
  const noMax = compileDatahyenaFundingInput({ maxItems: 0 });
  assertFalse(noMax.ok);

  const huge = compileDatahyenaFundingInput({ maxItems: 5000 });
  assertFalse(huge.ok);
  assert(!huge.ok && huge.errors.some((e) => /ceiling/.test(e) && /\$/.test(e)),
    "the refusal must state the money it would have cost");

  const ok = compileDatahyenaFundingInput({ maxItems: 50, since: "2026-06-01" });
  assert(ok.ok, JSON.stringify(!ok.ok ? ok.errors : []));
});

Deno.test("5. only verified enum values reach the provider", () => {
  assertFalse(compileDatahyenaFundingInput({
    maxItems: 10, round: ["series-z"],
  }).ok, "an invented round stage must be refused");

  assertFalse(compileDatahyenaFundingInput({
    maxItems: 10, verticals: ["blockchain-ai-quantum"],
  }).ok, "an invented vertical must be refused");

  assertFalse(compileDatahyenaFundingInput({
    maxItems: 10, countries: ["Germany"],
  }).ok, "the country enum is ISO alpha-2 — a full name must be refused");

  assert(compileDatahyenaFundingInput({
    maxItems: 10,
    round: [...FUNDING_ROUND_STAGES.slice(0, 3)],
    verticals: [FUNDING_VERTICALS[7]],
    countries: [FUNDING_COUNTRIES[15]],
  }).ok);

  // A malformed date is not a date.
  assertFalse(compileDatahyenaFundingInput({ maxItems: 10, since: "last week" }).ok);
  // An impossible amount window can match nothing and is refused up front.
  assertFalse(compileDatahyenaFundingInput({
    maxItems: 10, minAmountUsd: 50_000_000, maxAmountUsd: 1_000_000,
  }).ok);
});

Deno.test("6. a zero-coverage stage produces a warning, so an empty run is legible", () => {
  // Requesting only stages the vendor documents as uncovered runs, costs the
  // start fee and returns nothing. Without the warning that is indistinguishable
  // from "no company raised at that stage".
  const r = compileDatahyenaFundingInput({ maxItems: 10, round: ["safe", "pipe"] });
  assert(r.ok);
  assert(r.ok && r.warnings.some((w) => /no coverage yet/.test(w) && /zero rows/.test(w)),
    "an all-uncovered filter must warn that the emptiness is ours, not the market's");

  // A country filter silently drops the quarter of companies with no HQ.
  const c = compileDatahyenaFundingInput({ maxItems: 10, countries: ["DE"] });
  assert(c.ok && c.warnings.some((w) => /unknown/.test(w)));

  // And the announced amount is never presented as audited.
  assert(r.ok && r.warnings.some((w) => /not audited/.test(w)));
});

// ══════════════ 7-10. EVIDENCE DISCIPLINE: a date, or it is nothing ════════

// THE REAL ROW SHAPE, taken from run 0XchPqe0cJpx0Yc2T. Company fields are
// NESTED under `company`, investors are {id,name} and sources are {url} — none
// of which matched the shape written from the vendor's README.
const ROW = {
  id: "01a02628-ec6a-7925-9e14-5968fc7e222c",
  round: "series-a",
  amountUsd: 12_000_000,
  amountOriginalCurrency: "USD",
  announcedAt: "2026-08-05",
  company: {
    name: "Vaultline",
    domain: "vaultline.io",
    linkedinUrl: "https://www.linkedin.com/company/vaultline",
    hqCity: "Berlin",
    hqCountry: { code: "DE", name: "Germany" },
    industryGroup: "Computer and Network Security",
    verticals: ["cybersecurity"],
    employeeCountBucket: "51-200",
  },
  investors: [{ id: "a", name: "Northbeam Capital" }, { id: "b", name: "Ridge VC" }],
  sources: [{ url: "https://example.test/vaultline-series-a" }],
};

Deno.test("7. a complete row is evidence, and carries every fact the claim needs", () => {
  const r = normalizeDatahyenaFundingRound(ROW);
  assert(r.is_evidence);
  assertEquals(r.company_name, "Vaultline");
  assertEquals(r.round_stage, "series-a");
  assertEquals(r.amount_usd, 12_000_000);
  assertEquals(r.announced_date, "2026-08-05");
  assertEquals(r.investors, ["Northbeam Capital", "Ridge VC"]);
  // `sources` is a list of {url} objects — the generic reader looked for `name`
  // and dropped the citation entirely until the live run exposed it.
  assertEquals(r.source_articles, ["https://example.test/vaultline-series-a"]);
  assertEquals(r.geography, "Berlin, Germany");
  assertEquals(r.linkedin_company_url, "https://www.linkedin.com/company/vaultline");

  // The provider's industry tag is NEVER proof of industry — same rule as every
  // other discovery source.
  assertEquals(r.field_trust.provider_industry, "unsafe");
  // And the amount is a transform of an announcement, not a direct reading.
  assertEquals(r.field_trust.amount_usd, "transformed");
});

Deno.test("8. THE GATE: a row without an announced date is NOT funding evidence", () => {
  // A funding event with no date is a rumour. This is the single assertion that
  // keeps "we found a company in a funding search" from becoming "this company
  // recently raised".
  const undated = normalizeDatahyenaFundingRound({ ...ROW, announcedAt: undefined });
  assertFalse(undated.is_evidence);
  assert(undated.missing_fields.includes("announced_date"));

  const malformed = normalizeDatahyenaFundingRound({ ...ROW, announcedAt: "recently" });
  assertFalse(malformed.is_evidence, "a malformed date is not a date");

  const nameless = normalizeDatahyenaFundingRound({
    ...ROW, company: { ...ROW.company, name: undefined },
  });
  assertFalse(nameless.is_evidence, "evidence must name the company it is about");

  // A row missing only the AMOUNT is still evidence: "raised recently" is a
  // weaker claim than "raised $X" and is a legitimate one.
  // OBSERVED: amountUsd is null on 11% of real rows, and `round` on 33%.
  const noAmount = normalizeDatahyenaFundingRound({ ...ROW, amountUsd: undefined });
  assert(noAmount.is_evidence);
  assertEquals(noAmount.amount_usd, null);
});

Deno.test("9. recency is judged against the mission's window, and fails closed", () => {
  const now = new Date("2026-08-22T00:00:00Z");
  const r = normalizeDatahyenaFundingRound(ROW);

  assert(fundingRoundIsWithin(r, 90, now), "17 days old is inside a 90-day window");
  assertFalse(fundingRoundIsWithin(r, 7, now), "17 days old is outside a 7-day window");

  // No date means never fresh — the same fail-closed rule as `is_evidence`.
  assertFalse(fundingRoundIsWithin({ announced_date: null }, 3650, now));
  // A future date is not "very recent", it is wrong.
  assertFalse(fundingRoundIsWithin({ announced_date: "2027-01-01" }, 90, now));
});

Deno.test("10. the company projection carries the round without promoting its tags", () => {
  const c = fundingRoundToCompany(normalizeDatahyenaFundingRound(ROW));

  assertEquals(c.company_name, "Vaultline");
  assertEquals(c.canonical_domain, "vaultline.io");
  // The evidence travels WITH the candidate.
  assertEquals(
    (c.startup_evidence as Record<string, unknown>).funding_announced_date, "2026-08-05");
  assertEquals(
    (c.startup_evidence as Record<string, unknown>).funding_round_stage, "series-a");

  // A funding source says NOTHING about hiring. Null, never false — false would
  // be a claim this Actor cannot support.
  assertEquals(c.hiring_status, null);
  // And no exact headcount is invented from the provider's band.
  assertEquals(c.employee_count, null);
  assertEquals(c.field_trust.employee_range_advisory, "unsafe");
});

// ═══════════════ 11-13. the capability is real, and honest about scope ═════

Deno.test("11. the funding capability's claim is now keepable", () => {
  assert(isCapabilitySupported("funding_signal_discovery"));
  const spec = CAPABILITY_REGISTRY.funding_signal_discovery;
  assertEquals(spec.providers, [KEY]);
  // The evidence bar gained the date, because that is what makes it evidence.
  assert(spec.evidence_required.includes("announced_date"));
  assert(isEngineDriven("funding_signal_discovery"),
    "a capability nothing drives is not a capability");
});

Deno.test("12. funding is DISCOVERY-only — it can never be a verification path", () => {
  const support = resolveSignalSupport(describeSignal("funding", "company"));
  assertEquals(support.status, "supported");
  assertEquals(support.discovery_actors, [KEY]);
  assertEquals(support.verification_actors, [],
    "no source can confirm funding for a company set already in hand");

  // A funding mission that discovered its pool some OTHER way must be told so,
  // or an uncollected requirement looks like a served one.
  const m = parseLeadMissionDeterministic(
    "Find B2B SaaS companies hiring SDRs that recently raised");
  const plan = buildCapabilityGraph({ ...m, strategies: ["hiring"] } as never);
  assertFalse(plan.steps.some((s) => s.capability === "funding_signal_discovery"));
  assert(plan.routing_advisories.some((a) => /DISCOVERY-ONLY/.test(a)),
    "a funding requirement this plan will not collect must be stated");
});

Deno.test("13. an amount qualifier is honoured; a role qualifier on funding is not", () => {
  // The source filters on stage and country, so those qualifiers are real.
  const staged = describeSignal("funding", "company", { round_type: "series-a", region: "DE" });
  assertEquals(resolveSignalSupport(staged).unhonoured_qualifiers, []);

  // It cannot filter funding by a hiring role, and says so rather than
  // pretending the requirement was met.
  const roled = describeSignal("funding", "company", { role_families: ["gtm_sales"] });
  assert(resolveSignalSupport(roled).unhonoured_qualifiers.includes("role_families"));
});

// ═══════════════════ 14-16. GPT can see it and choose it ═══════════════════

Deno.test("14. GPT is offered the funding capability in outcome language only", () => {
  const cat = catalogueForPrompt();
  const entry = cat.find((c) => c.capability === "funding_event_discovery");
  assert(entry, "the model must be able to request funding evidence");
  assertEquals(entry!.kind, "execution");

  // The briefing must name the LIMITATION, or the model will choose it to
  // confirm funding for a pool it already has — which this source cannot do.
  assert(/cannot check whether a company you already have has raised/i
    .test(entry!.description));

  // AND IT MUST NAME NO ACTOR. The containment property is that the model has no
  // field in which to say "datahyena".
  for (const c of cat) {
    assertFalse(/datahyena|apify_|harvestapi|memo23/i.test(c.description),
      `${c.capability}: a provider name leaked into the model-facing catalogue`);
    assertFalse("actor_keys" in (c as Record<string, unknown>));
  }
});

Deno.test("15. the public capability expands to the internal stage, and nothing else", () => {
  const spec = PUBLIC_CAPABILITY_CATALOGUE.funding_event_discovery;
  assertEquals(spec.internal, ["funding_signal_discovery"]);
  assertEquals(spec.paid, true, "it spends, so it must say it spends");
  assertEquals(toInternalCapabilities(["funding_event_discovery"]), ["funding_signal_discovery"]);

  // It must not reach a people stage — the unlock boundary is unchanged.
  for (const c of spec.internal) {
    assertFalse(
      ["founder_discovery", "employer_verification", "contact_enrichment"].includes(c),
      "a funding capability must never reach a people stage",
    );
  }
});

Deno.test("16. a funding mission is planned, covered and reported as served", () => {
  const m = parseLeadMissionDeterministic("Find recently funded B2B SaaS companies.");
  const plan = buildCapabilityGraph(m);

  assertEquals(plan.entry_capability, "funding_signal_discovery");
  assert(plan.allowed_providers.includes(KEY));

  // Enrichment still precedes qualification: raising is not fitting the ICP.
  const order = plan.steps.map((s) => s.capability);
  assert(order.indexOf("company_enrichment") < order.indexOf("company_brain_qualification"));

  const cov = coverMissionSignals(m);
  assertEquals(cov.signals[0].status, "covered");
  assert(cov.runnable_actors.includes(KEY));
  assert(cov.fully_covered);
  assertEquals(cov.shortfall_statement, "");
});

// ═══════════════ 17-18. PINNED TO REAL OBSERVED OUTPUT ═════════════════════

Deno.test("17. REAL ROW: every company field is nested under `company`", () => {
  // Verbatim from run 0XchPqe0cJpx0Yc2T (2026-08-22). Written from the vendor
  // README, the normalizer read these from the TOP level and produced a null
  // company name for all 18 rows — a funding capability that returned nothing.
  const r = normalizeDatahyenaFundingRound({
    id: "01a02628-ec6a-7925-9e14-5968fc7e222c",
    round: "series-c",
    amountUsd: null,
    amountOriginalCurrency: null,
    announcedAt: "2026-08-21",
    company: {
      name: "Helcim", domain: "helcim.com",
      linkedinUrl: "https://www.linkedin.com/company/helcim",
      hqCity: "Seattle", hqCountry: { code: "US", name: "United States" },
      industryGroup: "Technology, Information and Internet",
      verticals: ["fintech"], employeeCountBucket: "51-200",
    },
    investors: [{ id: "a", name: "Aquiline" }, { id: "b", name: "Headline" }],
    sources: [{ url: "https://betakit.com/helcim-raises-53-million/" }],
  });

  assert(r.is_evidence);
  assertEquals(r.company_name, "Helcim");
  assertEquals(r.canonical_domain, "helcim.com");
  assertEquals(r.geography, "Seattle, United States");
  assertEquals(r.investors, ["Aquiline", "Headline"]);
  // `sources` is [{url}], not [{name}] — the citation was dropped entirely
  // until the live run exposed the shape.
  assertEquals(r.source_articles, ["https://betakit.com/helcim-raises-53-million/"]);

  // OBSERVED: amountUsd is null on 11% of rows. A round with a date and a
  // company is still evidence — "raised" is a weaker claim than "raised $X".
  assertEquals(r.amount_usd, null);
  assert(r.is_evidence);
});

Deno.test("18. the provider's company tags are UNSAFE, as the live run proved", () => {
  // Run 0XchPqe0cJpx0Yc2T attached an Australian fintech round to a Montreal
  // performing-arts ensemble's domain, and tagged a biotech as Retail/commerce.
  // The ROUND is reliable; the company attached to it is not.
  const r = normalizeDatahyenaFundingRound({
    id: "x", round: "series-b", amountUsd: 44414440, announcedAt: "2026-08-21",
    company: {
      name: "Constantinople", domain: "constantinople.ca",
      linkedinUrl: "https://www.linkedin.com/company/ensemble-constantinople",
      hqCity: "Montreal", hqCountry: { code: "CA", name: "Canada" },
      industryGroup: "Performing Arts", verticals: [],
    },
    investors: [{ id: "a", name: "Airtree" }, { id: "b", name: "Square Peg" }],
    sources: [{ url: "https://example.test/anz-roundup" }],
  });

  // The evidence gate still passes — the ROUND is real and dated.
  assert(r.is_evidence);
  // But nothing about the company may be trusted as identity or ICP evidence.
  assertEquals(r.field_trust.provider_industry, "unsafe");
  assertEquals(r.field_trust.provider_verticals, "unsafe");
  assertEquals(r.field_trust.employee_range_advisory, "unsafe");

  // And the projection must not promote any of it into a qualifying fact.
  const c = fundingRoundToCompany(r);
  assertEquals(c.employee_count, null);
  assertEquals(c.industry_ids, []);
  assertEquals(c.field_trust.provider_industry, "unsafe");
  assertEquals(c.hiring_status, null);
});
