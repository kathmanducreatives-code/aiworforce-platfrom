// ONE VOCABULARY, AND A PORTFOLIO THAT TELLS THE TRUTH.
//
// TEST continuation 90bad481 sent ZERO companies to the Company Brain — not one
// rejection, not one unknown. Prequalification scored on Tier A/B; hiring
// verification filtered the same YC evidence through role packs listing only
// literal "Sales Operations …" titles. Seven enriched companies were dropped
// between two capabilities that disagreed about what a commercial signal is.
//
// ZERO network, ZERO Actor runs, ZERO model calls, ZERO database writes.

import { assert, assertEquals, assertFalse } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  BROADENING_ROUNDS, assessHiring, classifyTitle, needsPaidJobVerification,
  reachesCompanyBrain, roundForTitle,
} from "../../../supabase/functions/_shared/commercialSignalPolicy.ts";
import {
  buildPortfolio, floorFailure, founderSearchEligible, interpretTargets,
  type PortfolioCandidate,
} from "../../../supabase/functions/_shared/opportunityPortfolio.ts";
import { classifyJobTitle } from "../../../supabase/functions/_shared/leadCommercialPrequalification.ts";

const job = (title: string) => ({ title, url: `https://yc/${title}` });

// ══════════════════ 1-3. the three companies that were dropped ══

Deno.test("1-3. SnapMagic, AgentMail and Tara AI verify from YC evidence alone", () => {
  const cases: Array<[string, string]> = [
    ["SnapMagic", "Head of Sales"],
    ["AgentMail", "GTM Engineer"],
    ["Tara AI", "Founding Account Executive"],
  ];
  for (const [name, title] of cases) {
    assertEquals(classifyTitle(title), "A", `${title} must be Tier A`);
    const a = assessHiring([job(title)]);
    assertEquals(a.verdict, "hiring_verified", `${name} must verify from YC evidence`);
    assertEquals(a.evidence_source, "yc_open_jobs");
    assertFalse(a.needs_external_verification, `${name} must not need a paid search`);
    assert(reachesCompanyBrain(a), `${name} must reach the Company Brain`);
  }
});

Deno.test("4/5. Tier B verifies WITH support, and is REVIEW alone", () => {
  // Zentail: BDR + Account Executive — two commercial openings is itself support.
  const supported = assessHiring([job("Business Development Representative"), job("Account Executive")]);
  assertEquals(supported.verdict, "hiring_verified");
  assertEquals(supported.tier, "B");
  assert(supported.supporting_signals.includes("multiple_commercial_openings"));
  assertFalse(needsPaidJobVerification(supported));

  // Bitmovin: a lone "Sales Director" is a question, not a rejection.
  const lone = assessHiring([job("Sales Director")]);
  assertEquals(lone.verdict, "hiring_verification_needed");
  assert(needsPaidJobVerification(lone), "the ONLY case that may buy a job search");
  assert(reachesCompanyBrain(lone), "and it still reaches the Brain");

  // Explicit external support also settles it.
  assertEquals(assessHiring([job("Sales Director")], ["recent_funding"]).verdict, "hiring_verified");
});

Deno.test("6/7. Tier C is a watch item; technical-only never qualifies", () => {
  const c = assessHiring([job("Head of Operations")]);
  assertEquals(c.verdict, "watch");
  assertFalse(c.verdict === "hiring_verified", "Tier C must not auto-qualify");
  assert(reachesCompanyBrain(c), "…and must not auto-reject either");

  const tech = assessHiring([job("Senior Software Engineer"), job("Member of Technical Staff")]);
  assertEquals(tech.verdict, "hiring_not_verified");
  assert(tech.reason.includes("technical"));
  assertFalse(reachesCompanyBrain(tech));
});

Deno.test("8/9. no paid job search when the free evidence is sufficient", () => {
  for (const title of ["Head of Sales", "GTM Engineer", "Founding Account Executive",
    "Sales Operations Manager", "Head of Operations"]) {
    assertFalse(needsPaidJobVerification(assessHiring([job(title)])),
      `${title} must not trigger a paid search`);
  }
  // Exactly one case may.
  assert(needsPaidJobVerification(assessHiring([job("Account Executive")])));
});

Deno.test("ROOT CAUSE: one vocabulary, shared by both consumers", () => {
  // Prequalification now DELEGATES; the two can no longer disagree.
  for (const t of ["Head of Sales", "GTM Engineer", "Founding Account Executive",
    "Account Executive", "Sales Director", "Head of Operations", "Senior Software Engineer"]) {
    assertEquals(classifyJobTitle(t), classifyTitle(t), `${t} must classify identically`);
  }
  // And every Tier A/B title the audited run carried is now verifiable evidence.
  for (const t of ["Head of Sales", "GTM Engineer", "Founding Account Executive",
    "Corporate Account Executive", "Business Development Representative",
    "Account Executive", "Sales Director"]) {
    const cls = classifyTitle(t);
    assert(cls === "A" || cls === "B", `${t} must be a commercial tier, got ${cls}`);
  }
});

Deno.test("broadening preserves intent, in order", () => {
  assertEquals(roundForTitle("Sales Operations Manager"), 1, "the literal ask stays round 1");
  assertEquals(roundForTitle("Head of Sales"), 2);
  assertEquals(roundForTitle("Account Executive"), 3);
  assertEquals(roundForTitle("Chief of Staff"), 4);
  assertEquals(roundForTitle("Senior Software Engineer"), null);
  assertEquals(BROADENING_ROUNDS.map((r) => r.round), [1, 2, 3, 4]);
  // A later round may never claim a higher tier than its vocabulary supports.
  assertEquals(BROADENING_ROUNDS[3].max_tier_from_role, "C");
});

// ══════════════════ portfolio: volume vs contact-ready ══

Deno.test("16/20. requested opportunities and contact-ready are separate", () => {
  const leads = interpretTargets("Find 100 leads", 5);
  assertEquals(leads.requested_opportunity_count, 100);
  assertEquals(leads.requested_contact_ready_count, null, "volume alone demands no qualification");

  const qualified = interpretTargets("Find 100 qualified leads", 5);
  assertEquals(qualified.requested_opportunity_count, 100);
  assertEquals(qualified.requested_contact_ready_count, 100);

  const both = interpretTargets("Find 100 opportunities with at least 20 contact-ready founders", 5);
  assertEquals(both.requested_opportunity_count, 100);
  assertEquals(both.requested_contact_ready_count, 20);

  // BACKWARD COMPATIBILITY: the legacy field is preserved, never rewritten.
  assertEquals(both.requested_lead_count, 5);
  assertEquals(interpretTargets("Find founders of SaaS startups", 5).interpretation, "legacy_lead_count");
  assertEquals(interpretTargets("Find 500 leads", 5).requested_opportunity_count, 100, "clamped to 100");
  // The scaling case from the brief, with adjectives between number and noun.
  const scaled = interpretTargets("Find 100 US B2B SaaS companies with commercial expansion signals", 5);
  assertEquals(scaled.requested_opportunity_count, 100);
  assertEquals(scaled.requested_contact_ready_count, null);
});

const cand = (over: Partial<PortfolioCandidate>): PortfolioCandidate => ({
  company_key: "k", company_name: "Co", domain: "co.com", tier: "A", brain: "qualified",
  identity_status: "verified_match", active: true, geography_ok: true, b2b_use_case: true,
  has_factual_signal: true, source_evidence: true, source_url: "https://x", contact_ready: false,
  round: 1, score: 100, ...over,
});

Deno.test("17/19. the portfolio fills A then B then C, and the counts agree", () => {
  const many: PortfolioCandidate[] = [
    ...Array.from({ length: 18 }, (_, i) => cand({ company_key: `a${i}`, company_name: `A${i}`, tier: "A" })),
    ...Array.from({ length: 42 }, (_, i) => cand({ company_key: `b${i}`, company_name: `B${i}`, tier: "B", brain: "review", score: 60 })),
    ...Array.from({ length: 60 }, (_, i) => cand({ company_key: `c${i}`, company_name: `C${i}`, tier: "C", brain: null, score: 20 })),
  ];
  const p = buildPortfolio(many, interpretTargets("Find 100 leads", 5));
  assertEquals(p.counts.delivered, 100);
  assertEquals(p.counts.tier_a, 18, "every genuine Tier A first");
  assertEquals(p.counts.tier_b, 42);
  assertEquals(p.counts.tier_c, 40, "then Tier C fills the remainder");
  assertEquals(p.counts.tier_a + p.counts.tier_b + p.counts.tier_c, p.counts.delivered);
  assertEquals(p.counts.qualified, 18, "and NOT all 100 are qualified");

  // ── A FULL PAGE IS NOT A MET REQUEST ────────────────────────────────────
  //
  // This asserted `shortfall.opportunities === 0`, because 100 rows were shown
  // against 100 requested. Of those rows 18 qualified, 42 are under review and
  // 40 are Tier-C watch items — open questions, not answers. Measuring the
  // shortfall against the ROW COUNT is what let a live run that qualified three
  // companies report a shortfall of zero.
  assertEquals(p.counts.opportunities, 60, "qualified + review, not the page size");
  assertEquals(p.shortfall.opportunities, 40,
    "40 of the 100 rows are watch items and do not answer the request");
  assert(p.shortfall.opportunity_reason?.includes("60 of 100"),
    `the gap names both numbers, got: ${p.shortfall.opportunity_reason}`);
  assert(p.shortfall.opportunity_reason?.includes("40 more are shown as watch"),
    "and says what the remaining rows are");
});

Deno.test("18/22. rejects, duplicates and floor failures never fill the number", () => {
  const dirty: PortfolioCandidate[] = [
    cand({ company_key: "ok" }),
    cand({ company_key: "ok" }),                                   // duplicate
    cand({ company_key: "rej", brain: "reject" }),
    cand({ company_key: "dead", active: false }),
    cand({ company_key: "b2c", b2b_use_case: false }),
    cand({ company_key: "geo", geography_ok: false }),
    cand({ company_key: "mismatch", identity_status: "rejected_mismatch" }),
    cand({ company_key: "nosig", has_factual_signal: false }),
    cand({ company_key: "nosrc", source_evidence: false }),
  ];
  const p = buildPortfolio(dirty, interpretTargets("Find 100 leads", 5), { sourcesExhausted: true });
  assertEquals(p.counts.delivered, 1, "only the clean candidate is admitted");
  assertEquals(p.excluded.length, 8);
  for (const f of ["duplicate", "brain_reject", "inactive", "consumer_only",
    "wrong_geography", "identity_mismatch", "no_factual_signal", "no_source_evidence"]) {
    assert(p.excluded.some((e) => e.failure === f), `${f} must be excluded by name`);
  }
  // ── AN UNTIERED COMPANY IS UNRANKED, NOT UNQUALIFIED ────────────────────
  //
  // `tier` is derived from the commercial ROLE VOCABULARY, so a null tier says
  // the keyword list did not recognise the openings — a fact about the list,
  // never about the company. Flooring on it unconditionally deleted a QUALIFIED
  // lead: on task 55cf2ca4 `godela.ai` passed the Company Brain with a verified
  // identity and three grounded claims that survived verification, and never
  // reached the portfolio, while seven unidentifiable watch rows did.
  assertEquals(floorFailure(cand({ tier: null, brain: null })), "no_tier",
    "with no Brain verdict, an untiered company has nothing to stand on");
  assertEquals(floorFailure(cand({ tier: null, brain: "review" })), "no_tier");
  assertEquals(floorFailure(cand({ tier: null, brain: "qualified" })), null,
    "a Brain pass is an answer; a missing ranking hint may not delete it");
});

Deno.test("21. a shortfall is reported honestly, not padded", () => {
  const only73 = Array.from({ length: 73 }, (_, i) =>
    cand({ company_key: `x${i}`, company_name: `X${i}`, tier: "B", brain: "review" }));
  const p = buildPortfolio(only73, interpretTargets("Find 100 leads", 5), { sourcesExhausted: true });
  assertEquals(p.counts.delivered, 73);
  assertEquals(p.shortfall.opportunities, 27);
  assert(String(p.shortfall.opportunity_reason).includes("sources exhausted"));
});

Deno.test("2/26/27. Tier C watches are never actionable and never buy people", () => {
  const mixed = [
    cand({ company_key: "a", tier: "A", brain: "qualified", contact_ready: true }),
    cand({ company_key: "b", tier: "B", brain: "review" }),
    cand({ company_key: "c", tier: "C", brain: null, identity_status: "unresolved" }),
  ];
  const p = buildPortfolio(mixed, interpretTargets("Find 10 opportunities", 5));
  const byKey = Object.fromEntries(p.entries.map((e) => [e.company_key, e]));

  assertEquals(byKey.a.state, "qualified");
  assert(byKey.a.actionable);
  assertEquals(byKey.b.state, "review");
  assertFalse(byKey.b.actionable, "REVIEW is not actionable without a Brain pass");
  assertEquals(byKey.c.state, "identity_unresolved_watch");
  assertFalse(byKey.c.actionable);

  const eligible = founderSearchEligible(p);
  assertEquals(eligible.length, 1);
  assertEquals(eligible[0].company_key, "a");
  assertFalse(eligible.some((e) => e.tier === "C"), "Tier C must never enter people discovery");

  // Contact-ready is counted separately and only for actionable entries.
  assertEquals(p.counts.contact_ready, 1);
  assertFalse(p.counts.contact_ready === p.counts.delivered);
});

Deno.test("24. deduplication is stable across rounds and providers", () => {
  const dupAcrossRounds = [
    cand({ company_key: "snapmagic.com", round: 1 }),
    cand({ company_key: "snapmagic.com", round: 3, score: 999 }),
  ];
  const p = buildPortfolio(dupAcrossRounds, interpretTargets("Find 10 leads", 5));
  assertEquals(p.counts.delivered, 1);
  assertEquals(p.excluded[0].failure, "duplicate");
});

// ══════════════════ 34. nothing here can start an Actor ══

Deno.test("34. the policy and portfolio modules are pure", async () => {
  for (const f of ["commercialSignalPolicy.ts", "opportunityPortfolio.ts"]) {
    const src = await Deno.readTextFile(
      new URL(`../../../supabase/functions/_shared/${f}`, import.meta.url));
    for (const forbidden of ["fetch(", "apifyFetch", "createClient", "Deno.env"]) {
      assertFalse(src.includes(forbidden), `${forbidden} must not appear in ${f}`);
    }
  }
});

Deno.test("the engine uses the canonical policy, not the legacy packs", async () => {
  const src = await Deno.readTextFile(
    new URL("../../../supabase/functions/_shared/leadCapabilityEngine.ts", import.meta.url));
  assert(src.includes("assessHiring("), "hiring verification must use the canonical policy");
  assert(src.includes("needsPaidJobVerification(assessment)"),
    "a paid search must be gated on the lone-Tier-B case");
  assert(src.includes("reachesCompanyBrain(c.hiring_assessment)"),
    "review and watch companies must reach the Brain, not vanish");
  assertFalse(/const fromYc = keptForPacks\(c\.yc_open_jobs, packs\);/.test(src),
    "the narrow role-pack filter on YC evidence is what dropped seven companies");
});

// ═══════ P1-P3. THE PORTFOLIO MUST NOT DROP A QUALIFIED COMPANY ══
//
// Task 55cf2ca4 qualified four companies. The portfolio reported three, and
// shipped seven `identity_unresolved_watch` rows — companies nobody could even
// confirm the identity of. `godela.ai`, which had passed the Company Brain with
// a verified identity and three grounded claims at score 1.0, was absent.
//
// Two mechanisms, both fixed here: the quality floor deleted it for having a
// null tier, and the sort ranked tier ABOVE qualification so watch rows filled
// the slice ahead of it.

Deno.test("P1. THE godela.ai CASE: a qualified, untiered company is not floored", () => {
  const godela = cand({
    company_key: "godela.ai", company_name: "Godela", tier: null,
    brain: "qualified", identity_status: "verified_match", score: 40,
  });
  const watchers = Array.from({ length: 10 }, (_, i) => cand({
    company_key: `w${i}`, company_name: `W${i}`, tier: "A",
    brain: null, identity_status: "unresolved", score: 200,
  }));

  const p = buildPortfolio([...watchers, godela], interpretTargets("Find 10 leads", 10));

  const keys = p.entries.map((e) => e.company_key);
  assert(keys.includes("godela.ai"),
    `a qualified company must reach the portfolio; got ${keys.join(", ")}`);
  assertFalse(p.excluded.some((e) => e.company_key === "godela.ai"),
    "and it must not be floored");
});

Deno.test("P2. qualification outranks tier — watch rows cannot displace an answer", () => {
  // Ten Tier-A watch rows with far higher scores, against one qualified
  // company. The qualified one ranks FIRST, not eleventh-and-cut.
  const godela = cand({
    company_key: "godela.ai", company_name: "Godela", tier: null,
    brain: "qualified", identity_status: "verified_match", score: 40,
  });
  const watchers = Array.from({ length: 10 }, (_, i) => cand({
    company_key: `w${i}`, company_name: `W${i}`, tier: "A",
    brain: null, identity_status: "unresolved", score: 200,
  }));

  const p = buildPortfolio([...watchers, godela], interpretTargets("Find 10 leads", 10));
  assertEquals(p.entries[0].company_key, "godela.ai",
    "the company the Brain qualified leads the portfolio");
  assertEquals(p.entries[0].state, "qualified");
  assert(p.entries[0].actionable, "and it is actionable — verified identity, Brain pass");
  // The page is still full, and still honest about what fills it.
  assertEquals(p.counts.delivered, 10);
  assertEquals(p.counts.qualified, 1);
  assertEquals(p.counts.watch, 9);
  assertEquals(p.counts.opportunities, 1);
  assertEquals(p.shortfall.opportunities, 9,
    "ten rows shown, one opportunity found — the gap is nine");
});

Deno.test("P3. tier still orders companies of the same decision", () => {
  // The fix reorders across decision classes only. Within them, tier is
  // unchanged — A before B before C, and null last.
  const q = (key: string, tier: PortfolioCandidate["tier"]) =>
    cand({ company_key: key, company_name: key, tier, brain: "qualified", score: 50 });
  const p = buildPortfolio(
    [q("untiered", null), q("c", "C"), q("a", "A"), q("b", "B")],
    interpretTargets("Find 10 leads", 10));
  assertEquals(p.entries.map((e) => e.company_key), ["a", "b", "c", "untiered"]);
});
