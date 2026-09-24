// THE ELEVEN CANARY COMPANIES, REPLAYED UNDER THE CORRECTED SIZE SEMANTICS.
//
// Four local canaries (87ecf153, 2978a5ba, ee68e102, ebd44262 — 2026-09-24)
// ran "Find 1 US company with 11–50 employees that raised funding in the last
// 2 years". Every company they returned DECLARES 11-50: the LinkedIn company
// search's `companySize: ["11-50"]` filter reads exactly that declared band.
// Every one was then failed or screened out on its `employeeCount` — 86 to
// 2,135 — which is LinkedIn ASSOCIATED MEMBERS, not staff (companySize.ts).
//
// The rows are rebuilt from the normalized snapshots the canaries persisted
// (fixture header says how). Replayed through the CURRENT normalizers,
// pre-pass, evidence graph, eligibility and verifier-target selection:
//
//   * no company fails, or is screened out, on its member count;
//   * the seven whose company record was bought PASS size on the proven band,
//     are viable, and are handed to Atomus;
//   * the four the old pre-pass removed now rank IN and reach enrichment —
//     size stays unknown only until the company record is read, and whether
//     they reach Atomus then rests on the record proving the US (no discovery
//     row carried a location).
//
// ZERO network, ZERO Actor runs, ZERO model calls.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  normalizeLinkedInCompanyCandidate, normalizeLinkedInCompanyEnriched,
} from "../../../supabase/functions/_shared/hiringActorNormalizers.ts";
import { prequalifyNormalizedCompany } from "../../../supabase/functions/_shared/leadGenericPrequalification.ts";
import { observationFromCompany, type ObservationContext } from "../../../supabase/functions/_shared/candidateObservation.ts";
import { buildCompanyEvidenceGraph } from "../../../supabase/functions/_shared/evidenceGraph.ts";
import { evaluateEligibility } from "../../../supabase/functions/_shared/candidateEligibility.ts";
import { deriveMissionCriteria } from "../../../supabase/functions/_shared/missionCriteria.ts";
import { verificationTargets } from "../../../supabase/functions/_shared/claimVerifier.ts";

globalThis.fetch = () => { throw new Error("replay tests must not reach the network"); };

interface FixtureCompany {
  task: string;
  name: string;
  discovery_row: Record<string, unknown>;
  company_record_row: Record<string, unknown> | null;
  old: { prequal_size_status: string; prequal_exclusion: string | null; bucket: string | null;
    hard_checks: Record<string, string> | null; size_reason: string | null; enriched: boolean };
}
const FIXTURE = JSON.parse(Deno.readTextFileSync(new URL(
  "../../fixtures/lead-v2/size-semantics-replay-2026-09-24/canary_companies.json", import.meta.url))) as {
  mission: never; companies: FixtureCompany[];
};
const CRITERIA = deriveMissionCriteria(FIXTURE.mission);
const RANGE = { min: 11, max: 50 };
const NOW = new Date("2026-09-24T12:00:00.000Z");
const ctx = (actor: string): ObservationContext => ({
  capability: actor === "apify_linkedin_company_details" ? "company_enrichment" : "general_company_discovery",
  actor_key: actor, provider: "apify", route_id: null, plan_version: null,
  provider_call_id: "pc_replay", mission_id: "replay", observed_at: NOW.toISOString(),
});

function replay(c: FixtureCompany) {
  const disc = normalizeLinkedInCompanyCandidate(c.discovery_row);
  const pq = prequalifyNormalizedCompany(disc, RANGE, { size_enforceable: true });
  const evidence = [...observationFromCompany(disc, ctx("apify_linkedin_company_search")).evidence];
  if (c.company_record_row) {
    evidence.push(...observationFromCompany(normalizeLinkedInCompanyEnriched(c.company_record_row),
      ctx("apify_linkedin_company_details")).evidence);
  }
  const key = disc.canonical_domain ?? c.name;
  const graph = buildCompanyEvidenceGraph(key, evidence, { now: NOW });
  const e = evaluateEligibility(CRITERIA, graph);
  const hard = (e.checks ?? []).filter((x) => x.kind === "hard");
  const check = (dim: string) => hard.find((x) => x.dimension === dim)?.result ?? null;
  const candidate = {
    company_key: key, name: c.name, domain: disc.canonical_domain, linkedin_url: disc.linkedin_company_url,
    graph, eligibility: e.eligibility, hard_checks: hard, attempted_routes: [],
  };
  const atomus = verificationTargets({ route_actor: "apify_funding_atomus", max_targets: 6 }, [candidate] as never,
    (id) => CRITERIA.find((x) => x.id === id)?.value).length > 0;
  return {
    name: c.name, band: disc.company_size_band, members: disc.linkedin_associated_member_count,
    prequal: [pq.size_status, pq.exclusion] as const, size: check("company_size"), geography: check("geography"),
    eligibility: e.eligibility, atomus, graph,
  };
}

const RESULTS = FIXTURE.companies.map((c) => ({ c, r: replay(c) }));

Deno.test("REPLAY: the fixture is the eleven canary companies, each declaring 11-50 with more than 50 members", () => {
  assertEquals(FIXTURE.companies.map((c) => c.name), [
    "ByteByteGo", "Psychology Today", "Deadline Hollywood", "How to AI", "Recode", "Design Milk",
    "Braintrust", "DeepLearning.AI", "Wall Street Oasis", "BigRio", "Inman",
  ]);
  for (const { r } of RESULTS) {
    assertEquals([r.band?.min, r.band?.max], [11, 50], r.name);
    assert((r.members ?? 0) > 50, `${r.name}: members above the band is the case under test`);
  }
  // …and the old code failed or screened out every one of them on that count.
  for (const { c } of RESULTS) {
    assert(/headcount \d+ is (reported )?outside the/.test(c.old.size_reason ?? ""), `${c.name}: ${c.old.size_reason}`);
    assert(c.old.bucket === "ineligible" || c.old.bucket === "screened_out", `${c.name}: ${c.old.bucket}`);
  }
});

Deno.test("REPLAY: no company fails — or is ranked out — because its member count exceeds its declared band", () => {
  for (const { r } of RESULTS) {
    assertEquals(r.prequal, ["in_range", null], `${r.name}: the pre-pass reads the band`);
    assert(r.size !== "fail", `${r.name}: size must not fail on ${r.members} members`);
    assert(r.eligibility !== "ineligible", `${r.name}: nothing else here is disproven`);
    assert(!r.graph.claims.some((x) => x.dimension === "headcount"), `${r.name}: no staff-count claim`);
  }
});

Deno.test("REPLAY: the seven with a bought company record PASS size on the proven band, are viable, and reach Atomus", () => {
  const recorded = RESULTS.filter(({ c }) => c.company_record_row);
  assertEquals(recorded.map(({ c }) => c.name),
    ["Recode", "Design Milk", "Braintrust", "DeepLearning.AI", "Wall Street Oasis", "BigRio", "Inman"]);
  for (const { c, r } of recorded) {
    assertEquals(c.old.hard_checks?.company_size, "fail", `${c.name}: the old verdict`);
    assertEquals([r.size, r.geography, r.eligibility, r.atomus], ["pass", "pass", "pending", true], c.name);
  }
});

Deno.test("REPLAY: the four the old pre-pass removed now reach enrichment; the company record decides the rest", () => {
  const unrecorded = RESULTS.filter(({ c }) => !c.company_record_row);
  assertEquals(unrecorded.map(({ c }) => c.name), ["ByteByteGo", "Psychology Today", "Deadline Hollywood", "How to AI"]);
  for (const { c, r } of unrecorded) {
    assertEquals(c.old.prequal_size_status, "above_max", `${c.name}: the old pre-pass ranked it out`);
    // A discovery row's band is plausible: size is unsettled until the record is
    // read, and with no location on the row the US claim is open too — so the
    // cheap claims are settled before any funding spend.
    assertEquals([r.size, r.geography, r.eligibility, r.atomus], ["unknown", "unknown", "pending", false], c.name);
  }
});
