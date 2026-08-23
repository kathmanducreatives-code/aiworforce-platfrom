// THE FREE PRE-PASS NOW COVERS EVERY SOURCE. THIS IS WHAT HOLDS IT HONEST.
//
// ── WHAT CHANGED ────────────────────────────────────────────────────────────
//
// `applyPrequalification` ran behind `if (rawYcRows.length > 0)`. A pool from
// the LinkedIn company search, the funding source or the news source got no
// free triage at all — every company went to identity resolution and enrichment
// (two paid calls, ~26s) before anything decided it was worth keeping, including
// companies whose discovery row ALREADY carried an exact headcount outside the
// mission's range.
//
// ── THE TWO WAYS THIS COULD GO WRONG, AND WHAT PINS EACH ───────────────────
//
// TOO EAGER — the pre-pass excludes on a field it should not trust, or on an
// absence, and companies are deleted for free before anything can reconsider.
// This is the worse failure: it is silent, it looks like a small pool, and the
// audit trail shows a company that was never investigated rather than one that
// was rejected. Tests 2, 3, 4, 5 and 9 pin it.
//
// TOO CLEVER — the pass grows an `if (actor === …)` and becomes a routing table,
// so a new discovery actor is silently ungated until someone remembers to add a
// branch. Tests 6 and 7 pin that structurally.
//
// EVERY COMPANY BELOW COMES FROM A REAL NORMALIZER, fed the row shape its actor
// really returns. A hand-built `NormalizedHiringCompany` would let a test pass
// against a `field_trust` map that no actor actually declares, which is the one
// thing these assertions must not be able to do.
//
// PURE. No network, provider, model or database access.

import {
  assert, assertEquals, assertFalse, assertThrows,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  prequalifyNormalizedCompany, prequalifyDiscoveredCompanies,
  genericPrequalificationKey, mergePrequalification, mayGateOn,
  emptyPrequalificationResult, GENERIC_PREQUALIFICATION_VERSION,
} from "../../../supabase/functions/_shared/leadGenericPrequalification.ts";
import {
  normalizeMemo23Company, normalizeSolidcodeCompany,
  normalizeLinkedInCompanyCandidate, normalizeLinkedInCompanyEnriched,
  fundingRoundToCompany, normalizeDatahyenaFundingRound,
  type NormalizedHiringCompany,
} from "../../../supabase/functions/_shared/hiringActorNormalizers.ts";
import {
  prequalifyYcCompanies,
} from "../../../supabase/functions/_shared/leadCommercialPrequalification.ts";

const SRC = new URL(
  "../../../supabase/functions/_shared/leadGenericPrequalification.ts",
  import.meta.url);

/** A LinkedIn company-search row, in `full` mode — the shape with a real count. */
const liRow = (over: Record<string, unknown> = {}) => ({
  id: "vaultline", name: "Vaultline",
  linkedinUrl: "https://www.linkedin.com/company/vaultline",
  website: "https://vaultline.io",
  description: "Vaultline sells encrypted document workflow software to banks.",
  employeeCount: 60,
  industries: [{ id: "4", name: "Computer Software", hierarchy: null }],
  locations: [{ linkedinText: "Berlin, Germany" }],
  companyType: "Privately Held",
  ...over,
});

const MISSION_10_150 = { min: 10, max: 150 };

// ═══════════════ 1. THE GATE THAT PAYS FOR ITSELF ══════════════════════════

Deno.test("1. a TRUSTED EXACT headcount outside the mission range excludes, free", () => {
  // This is the whole point. Before this pass existed, a 500-person company
  // discovered by the LinkedIn search was carried through identity resolution
  // and enrichment to reach a conclusion its discovery row already stated.
  const big = normalizeLinkedInCompanyCandidate(liRow({ employeeCount: 500 }));
  const v = prequalifyNormalizedCompany(big, MISSION_10_150);

  assertEquals(v.size_status, "above_max");
  assertEquals(v.exclusion, "employee_size");
  assertFalse(v.eligible);
  // The reason must say what was SAVED, not merely that a bound was crossed —
  // a future reader deciding whether this pass earns its complexity needs it.
  assert(v.reasons.some((r) => /before identity resolution and enrichment/.test(r)),
    v.reasons.join(" | "));

  const small = normalizeLinkedInCompanyCandidate(liRow({ employeeCount: 3 }));
  assertEquals(prequalifyNormalizedCompany(small, MISSION_10_150).size_status, "below_min");

  // …and an in-range company is kept and scored up.
  const ok = prequalifyNormalizedCompany(
    normalizeLinkedInCompanyCandidate(liRow()), MISSION_10_150);
  assertEquals(ok.size_status, "in_range");
  assertEquals(ok.exclusion, null);
  assert(ok.eligible);
  assert(ok.score > prequalifyNormalizedCompany(big, MISSION_10_150).score);
});

// ═══════════════ 2-5. THE WAYS IT MUST REFUSE TO EXCLUDE ═══════════════════

Deno.test("2. an UNSAFE advisory band may never exclude anyone", () => {
  // `employee_range_advisory` is declared `unsafe` by every normalizer that
  // sets one: the LinkedIn company search's own band disagreed with the exact
  // count in four of eight observed rows. A band that says "201-500" against a
  // 10-150 mission is the single most tempting free exclusion available here,
  // and acting on it would reject companies over a field the system already
  // knows to be wrong.
  const banded = normalizeLinkedInCompanyCandidate(liRow({
    employeeCount: null,                       // no exact figure at all
    employeeCountRange: { start: 201, end: 500 },
  }));
  assertEquals(banded.employee_count, null);
  assertEquals(banded.field_trust.employee_range_advisory, "unsafe");
  assertFalse(mayGateOn(banded, "employee_range_advisory"));

  const v = prequalifyNormalizedCompany(banded, MISSION_10_150);
  assertEquals(v.size_status, "size_unverified");
  assertEquals(v.exclusion, null);
  assert(v.eligible, "an unsafe band must not be able to reject a company");

  // AND IT MUST SAY SO. Silently ignoring the only size figure present would
  // leave an auditor unable to tell this apart from a row that carried nothing.
  if (banded.employee_range_advisory) {
    assert(v.reasons.some((r) => /declared unsafe and may not exclude/.test(r)),
      v.reasons.join(" | "));
  }
});

Deno.test("3. ABSENCE never excludes — the three-valued rule, kept", () => {
  // memo23 returns no `employeeCount` at all: YC `teamSize` is self-reported and
  // was observed stale (ShipBob returned 1), so the normalizer omits it and
  // records the reason in `missing_fields`. A company nobody could size is not a
  // company of the wrong size.
  const yc = normalizeMemo23Company({
    name: "Letara", website: "https://letara.space", teamSize: 4,
    oneLiner: "Hybrid propulsion systems for spacecraft.", batch: "W23",
  });
  assertEquals(yc.employee_count, null);

  const v = prequalifyNormalizedCompany(yc, MISSION_10_150);
  assertEquals(v.size_status, "size_unverified");
  assertEquals(v.exclusion, null);
  assert(v.eligible);

  // A row with NOTHING but a name is still not excluded by the scorer — only
  // ranked to the bottom. Removal is the batch pass's job and only for
  // artifacts.
  const bare = normalizeLinkedInCompanyCandidate({ id: "x", name: "Bare Co" });
  const bv = prequalifyNormalizedCompany(bare, MISSION_10_150);
  assert(bv.eligible);
  assertEquals(bv.exclusion, null);
  assert(bv.score < v.score || bv.score >= 0);
});

Deno.test("4. a SEMANTIC field may never gate — company_type is ownership", () => {
  // `company_type` carries "Privately Held". The benchmark records it in those
  // words: ownership, NOT a business model. It is declared `semantic` precisely
  // so nothing downstream can treat it as a firmographic fact.
  const li = normalizeLinkedInCompanyCandidate(liRow());
  assertEquals(li.field_trust.company_type, "semantic");
  assertFalse(mayGateOn(li, "company_type"));
  // …and `provider_industry` is unsafe on this actor, for the same reason the
  // ICP filter prefixes it `provider_label:`.
  assertEquals(li.field_trust.provider_industry, "unsafe");
  assertFalse(mayGateOn(li, "provider_industry"));
  // The two trust levels that exist to be untrusted are both refused.
  assert(mayGateOn(li, "employee_count"), "direct must be gate-worthy");
  assert(mayGateOn(li, "geography"), "transformed is still the provider's own value");
});

Deno.test("5. an ADVISORY range the MISSION never set may rank but not reject", () => {
  // `size_enforceable: false` is how the engine says the employee bounds came
  // from the workspace Brain rather than from the user's sentence. Seven
  // companies were excluded on Brain bounds on TEST run cf6cce3d, and the rule
  // that fixed it must hold on this side of the pass too.
  const big = normalizeLinkedInCompanyCandidate(liRow({ employeeCount: 500 }));

  const enforced = prequalifyNormalizedCompany(big, MISSION_10_150, {
    size_enforceable: true,
  });
  assertEquals(enforced.exclusion, "employee_size");

  const advisory = prequalifyNormalizedCompany(big, MISSION_10_150, {
    size_enforceable: false,
  });
  assertEquals(advisory.exclusion, null);
  assert(advisory.eligible, "a bound the user never expressed may not reject");
  // It still ORDERS: the out-of-range company earns no size points.
  assertEquals(advisory.size_status, "above_max");
  assertFalse(advisory.size_fit);
});

// ═══════════════ 6-7. IT MUST NOT BECOME A ROUTING TABLE ═══════════════════

Deno.test("6. NO actor key appears in the generic pass", () => {
  const src = Deno.readTextFileSync(SRC);
  // The rule is "read the normalizer's declared field trust", not "know which
  // actor produced the row". An actor key here is the first line of a routing
  // table, and a routing table is silently incomplete the day an actor is added.
  const offenders = src.split("\n")
    .map((line, i) => [i + 1, line] as const)
    .filter(([, line]) => /\bapify_[a-z0-9_]+/.test(line) &&
      // The header names actors to explain the RULE; a comment cannot branch.
      !line.trimStart().startsWith("//") && !line.trimStart().startsWith("*"));
  assertEquals(offenders.map(([n, l]) => `${n}: ${l.trim()}`), [],
    "an actor key reached executable code in the generic pre-pass");
});

Deno.test("7. EVERY discovery normalizer flows through with no per-actor code", () => {
  // The proof that test 6's rule is sufficient rather than merely tidy: five
  // different actors, five different row shapes, one scorer, no branches.
  const companies: NormalizedHiringCompany[] = [
    normalizeMemo23Company({
      name: "Letara", website: "https://letara.space", teamSize: 4,
      oneLiner: "Hybrid propulsion for spacecraft.", batch: "W23",
    }),
    normalizeSolidcodeCompany({
      name: "Solidco", website: "https://solidco.dev", teamSize: 30,
      longDescription: "Developer tooling for regulated industries.",
    }),
    normalizeLinkedInCompanyCandidate(liRow()),
    // A DIFFERENT company, not a second row for the same one — `liRow()` keeps
    // the vaultline.io domain, and two rows sharing a domain are one company by
    // design (test 8). Reusing it here would have deduped and this test would
    // have been asserting the wrong thing.
    normalizeLinkedInCompanyEnriched(liRow({
      id: "harbor", name: "Harbor Metrics", website: "https://harbormetrics.com",
      linkedinUrl: "https://www.linkedin.com/company/harbormetrics",
      employeeCount: 85,
    })),
    fundingRoundToCompany(normalizeDatahyenaFundingRound({
      company: {
        name: "Northwind Systems", domain: "northwind.io",
        linkedinUrl: "https://www.linkedin.com/company/northwind",
        description: "Industrial telemetry for wind farms.",
      },
      roundType: "Series A", announcedDate: "2026-07-02",
      amountUsd: 12_000_000, investors: ["Acme Ventures"],
    })),
  ];

  const res = prequalifyDiscoveredCompanies(companies, MISSION_10_150);

  // Every one produced a verdict — that is the generalization.
  assertEquals(res.companies.length, companies.length,
    `expected a verdict per company, got ${res.companies.length}`);
  assertEquals(res.version, GENERIC_PREQUALIFICATION_VERSION);
  for (const c of res.companies) {
    assert(c.company_key.length > 0, "every verdict has a key");
    assert(c.reasons.length > 0, `${c.name} produced a verdict with no reason`);
    // NO INVENTED YC FACTS. A generic company has no cohort, and filling the
    // shape with a plausible batch would put a fabricated fact where a reader
    // expects a provider's.
    assertEquals(c.batch, null);
    assertEquals(c.yc_url, null);
    assertEquals(c.best_tier, null, "no job rows were seen, so there is no tier");
    assertEquals(c.jobs, []);
  }

  // ── WHAT THE POOL ACTUALLY CONTAINS, PER SOURCE ─────────────────────────
  //
  // Only the two LinkedIn sources carry an exact headcount. YC `teamSize` is
  // omitted by its normalizer as self-reported, and the funding source carries
  // a band at best.
  assertEquals(res.companies_with_trusted_size, 2);

  // FOUR OF FIVE, and the fifth is the finding. `fundingRoundToCompany` sets
  // `description: null` outright — the funding row names a company and its
  // round, not what the company does. So a funding-discovered company reaches
  // the ICP gate with the gate's primary input missing, ranks down here, and
  // correctly resolves to `unknown` rather than `fail` there.
  //
  // Asserted as 4 deliberately. Writing 5 and "fixing" it by inventing a
  // description from the round would be the exact failure this architecture
  // keeps deleting.
  assertEquals(res.companies_with_description, 4);
  const funded = res.companies.find((c) => c.name === "Northwind Systems")!;
  assert(funded.reasons.some((r) => /no description yet/.test(r)),
    funded.reasons.join(" | "));
  assert(funded.eligible, "a missing description ranks a company down, never out");
});

// ═══════════════ 8. IDENTITY AND KEYS ══════════════════════════════════════

Deno.test("8. the key is derived in ONE place, and the pass proves it", () => {
  const li = normalizeLinkedInCompanyCandidate(liRow());
  assertEquals(genericPrequalificationKey(li), "vaultline.io");
  assertEquals(prequalifyNormalizedCompany(li, {}).company_key,
    genericPrequalificationKey(li));

  // Domain first, normalized name second — the same precedence as the YC key
  // and the internal identity.
  const noDomain = normalizeLinkedInCompanyCandidate({ id: "n", name: "Acme Inc" });
  assertEquals(genericPrequalificationKey(noDomain), "name:acme");

  // Two rows for one company are ONE verdict, not two shortlist slots.
  const dup = prequalifyDiscoveredCompanies([
    normalizeLinkedInCompanyCandidate(liRow()),
    normalizeLinkedInCompanyCandidate(liRow({ id: "other", name: "Vaultline GmbH" })),
  ], MISSION_10_150);
  assertEquals(dup.unique_companies, 1);
});

Deno.test("9. a directory artifact is refused — but nothing else is", () => {
  const res = prequalifyDiscoveredCompanies([
    normalizeLinkedInCompanyCandidate(liRow({
      id: "yc", name: "Y Combinator", website: "https://www.ycombinator.com",
    })),
    normalizeLinkedInCompanyCandidate(liRow()),
    // No name AND no website is not a company row. memo23 returns five of these.
    normalizeLinkedInCompanyCandidate({ id: "empty" }),
  ], MISSION_10_150);

  assertEquals(res.companies.length, 1);
  assertEquals(res.companies[0].name, "Vaultline");
  assertEquals(res.excluded.length, 2);
  assert(res.excluded.some((e) => /directory\/platform artifact/.test(e.reason)));
  assert(res.excluded.some((e) => /no name and no website/.test(e.reason)));
});

// ═══════════════ 10. THE MERGE REPORTS ONE POOL, TRUTHFULLY ════════════════

Deno.test("10. merging never claims role evidence the generic pass cannot have", () => {
  const yc = prequalifyYcCompanies([{
    name: "Hiring Co", website: "https://hiring.co", teamSize: 40,
    openJobs: [{ title: "Head of Sales" }, { title: "Account Executive" }],
  }], MISSION_10_150, { any_open_role_satisfies_signal: true });
  assertEquals(yc.companies_with_commercial_roles, 1);

  const generic = prequalifyDiscoveredCompanies(
    [normalizeLinkedInCompanyCandidate(liRow())], MISSION_10_150);

  const merged = mergePrequalification(yc, generic);

  // The pool grew…
  assertEquals(merged.unique_companies, 2);
  assertEquals(merged.eligible_companies, 2);
  assertEquals(merged.companies.length, 2);
  // …but the ROLE facts did not. The generic company has no job rows, and
  // counting it as having commercial roles would assert a fact nobody
  // established — the exact failure `companies_with_commercial_roles` exists to
  // prevent.
  assertEquals(merged.companies_with_commercial_roles,
    yc.companies_with_commercial_roles);
  assertEquals(merged.tier_a_companies, yc.tier_a_companies);
  assertEquals(merged.technical_only_companies, yc.technical_only_companies);

  // An out-of-range generic company shows up in the exclusion count, because
  // that number drives the funnel and must describe the whole pool.
  const big = prequalifyDiscoveredCompanies(
    [normalizeLinkedInCompanyCandidate(liRow({ employeeCount: 900 }))], MISSION_10_150);
  assertEquals(mergePrequalification(yc, big).employee_size_excluded,
    yc.employee_size_excluded + 1);
});

Deno.test("11. an empty YC result is a valid base for a pure non-YC pool", () => {
  // The common case after this change: a mission whose discovery was a LinkedIn
  // or funding search has no YC rows at all, and the free pass must still
  // report a coherent result rather than a null.
  const empty = emptyPrequalificationResult();
  const generic = prequalifyDiscoveredCompanies([
    normalizeLinkedInCompanyCandidate(liRow()),
    normalizeLinkedInCompanyCandidate(liRow({ id: "b", name: "Bigco", website: "https://bigco.com", employeeCount: 4000 })),
  ], MISSION_10_150);

  const merged = mergePrequalification(empty, generic);
  assertEquals(merged.total_rows, 2);
  assertEquals(merged.unique_companies, 2);
  assertEquals(merged.eligible_companies, 1);
  assertEquals(merged.employee_size_excluded, 1);
  // No role facts were invented out of an empty base.
  assertEquals(merged.companies_with_commercial_roles, 0);
});

// ═══════════════ 12. THE INVARIANT THAT CAUGHT A REAL BUG ══════════════════

Deno.test("12. key drift throws rather than silently losing a company", () => {
  // While wiring this in, the engine derived the lookup key with its own inline
  // copy of `normalizeCompanyName`. A verdict filed under one key and looked up
  // under another is not a crash — it is a company that quietly never gets a
  // verdict, which on the YC side means deletion. The scorer now asserts its own
  // key matches the exported derivation, so a divergence is loud.
  const li = normalizeLinkedInCompanyCandidate(liRow());
  let reads = 0;
  const rogue = {
    ...li,
    // A field that answers differently on every read is the cheapest faithful
    // stand-in for two derivations of one key disagreeing. A getter that only
    // drifts after N reads is not: the scorer's key read and the invariant's
    // check read can both land past the threshold and agree, which is how the
    // first version of this test passed while asserting nothing.
    get canonical_domain(): string { return `drift${reads++}.example`; },
  } as unknown as NormalizedHiringCompany;

  assertThrows(
    () => prequalifyDiscoveredCompanies([rogue], MISSION_10_150),
    Error,
    "key drift",
  );
  assert(reads > 1, "the invariant must actually re-derive the key to compare it");
});
