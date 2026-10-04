// PAID VERIFICATION IS WITHHELD ONLY WHEN TRIAGE AND THE COMPANY'S OWN LINKEDIN
// INDUSTRY AGREE IT IS NOT SOFTWARE.
//
// Canaries 3–6 (production, 2026-10-03/04) bought Atomus, Pvalyou, job search
// and Firecrawl for The Onion, Deadline Hollywood, Design Milk, Psychology
// Today … — companies triage had already called irrelevant at ≥ 0.9. Triage
// stays rank-only on its own (a6031b20, canary 2978a5ba; see
// enrichBeforeSizeRejection.test.ts): only a confident `irrelevant` PLUS a
// declared media/publishing/games industry withholds further purchases, and it
// never changes a verdict.

import { assert, assertAlmostEquals, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  NON_SOFTWARE_INDUSTRIES, PAID_VERIFICATION_TRIAGE_CONFIDENCE, paidVerificationBlockedBy,
} from "../../../supabase/functions/_shared/missionTriage.ts";
import { LINKEDIN_INDUSTRIES } from "../../../supabase/functions/_shared/linkedinIndustryTaxonomy.ts";
import { summarizeGaps, type EvidenceGap } from "../../../supabase/functions/_shared/evidenceGapRouter.ts";
import {
  canonicallyWorkableKeys, missionCandidatesFrom, runCapabilityPlan,
} from "../../../supabase/functions/_shared/leadCapabilityEngine.ts";
import { buildCapabilityGraph } from "../../../supabase/functions/_shared/leadCapabilityGraph.ts";
import { mergeCompanyBrainIntoMission, parseLeadMissionDeterministic } from "../../../supabase/functions/_shared/leadMission.ts";
import { deriveMissionCriteria } from "../../../supabase/functions/_shared/missionCriteria.ts";
import { readinessPolicy } from "../../../supabase/functions/_shared/routeReadiness.ts";
import { candidatePool } from "../../../supabase/functions/_shared/runBudget.ts";
import { evaluateEligibility } from "../../../supabase/functions/_shared/candidateEligibility.ts";
import { verificationTargets } from "../../../supabase/functions/_shared/claimVerifier.ts";
import { emptyDiscoverySelector } from "./discoverySelectorFixture.ts";

globalThis.fetch = () => { throw new Error("triage-gate tests must not reach the network"); };

const irrelevant = (confidence: number) => ({ relevance: "irrelevant" as const, confidence });

// ── THE PREDICATE ───────────────────────────────────────────────────────────

Deno.test("withheld only when BOTH agree: confident irrelevant AND a declared media/publishing industry", () => {
  assert(paidVerificationBlockedBy(irrelevant(0.99), "Online Media")?.startsWith("triage_irrelevant@0.99+industry:online media"));
  assert(paidVerificationBlockedBy(irrelevant(0.9), "Internet Publishing"), "the threshold is inclusive");
  // Either signal alone is not enough.
  assertEquals(paidVerificationBlockedBy(irrelevant(0.99), "Software Development"), null, "industry not corroborating");
  assertEquals(paidVerificationBlockedBy(irrelevant(0.99), "Technology, Information and Internet"), null);
  assertEquals(paidVerificationBlockedBy({ relevance: "uncertain", confidence: 0.99 }, "Online Media"), null, "uncertain never blocks");
  assertEquals(paidVerificationBlockedBy({ relevance: "relevant", confidence: 0.99 }, "Online Media"), null);
});

Deno.test("fail-open: low or malformed confidence, no verdict, no industry — nothing is withheld", () => {
  assertEquals(paidVerificationBlockedBy(irrelevant(0.89), "Online Media"), null);
  assertEquals(paidVerificationBlockedBy(irrelevant(Number.NaN), "Online Media"), null);
  assertEquals(paidVerificationBlockedBy({ relevance: "irrelevant", confidence: "0.99" as never }, "Online Media"), null);
  assertEquals(paidVerificationBlockedBy(null, "Online Media"), null);
  assertEquals(paidVerificationBlockedBy(undefined, "Online Media"), null);
  assertEquals(paidVerificationBlockedBy(irrelevant(0.99), null), null);
  assertEquals(paidVerificationBlockedBy(irrelevant(0.99), ""), null);
  assert(paidVerificationBlockedBy(irrelevant(0.99), "  internet NEWS "), "label compare is trimmed and case-insensitive");
  assertEquals(PAID_VERIFICATION_TRIAGE_CONFIDENCE, 0.9);
});

Deno.test("every corroborating industry is a real LinkedIn label (bar 'Online Media', which the provider still returns)", () => {
  const known = new Set(LINKEDIN_INDUSTRIES.map(([, label]) => label.toLowerCase()));
  const unknown = [...NON_SOFTWARE_INDUSTRIES].filter((l) => !known.has(l));
  assertEquals(unknown, ["online media"]);
  // The ambiguous ones are deliberately absent.
  for (const l of ["information services", "internet marketplace platforms", "staffing and recruiting", "software development"]) {
    assert(!NON_SOFTWARE_INDUSTRIES.has(l), l);
  }
});

// ── PRODUCTION REPLAY: CANARIES 3–6 ─────────────────────────────────────────
//
// Every company those canaries paid to verify, with triage's verdict, the
// LinkedIn industry its details record declared, and the provider spend
// attributed to it (lead_execution_calls, batch calls split per company).

type Row = [slug: string, relevance: "relevant" | "uncertain" | "irrelevant", confidence: number, industry: string, usd: number];
const PAID: Row[] = [
  // triage irrelevant ≥ 0.9
  ["usesav", "irrelevant", 0.93, "Internet Publishing", 0.0367],
  ["solanalabs", "irrelevant", 0.9, "Technology, Information and Internet", 0.0362],
  ["remotivatejobs", "irrelevant", 0.92, "Technology, Information and Internet", 0.0252],
  ["the-mullings-group", "irrelevant", 0.9, "Technology, Information and Internet", 0.0237],
  ["scholarships-com", "irrelevant", 0.95, "Technology, Information and Internet", 0.0237],
  ["design-milk", "irrelevant", 0.98, "Online Audio and Video Media", 0.0236 + 0.0236 + 0.0035],
  ["desiring-god", "irrelevant", 0.98, "Technology, Information and Internet", 0.0236],
  ["ere-media-inc", "irrelevant", 0.98, "Online Media", 0.0236],
  ["social-media-today-llc", "irrelevant", 0.96, "Technology, Information and Internet", 0.0236 + 0.0126],
  ["social-media-examiner", "irrelevant", 0.95, "Online Audio and Video Media", 0.0236 + 0.0236],
  ["how-to-ai-guide", "irrelevant", 0.97, "Business Content", 0.0236 + 0.0035],
  ["psychology-today", "irrelevant", 0.95, "Internet Publishing", 0.0236],
  ["bytebytego", "irrelevant", 0.98, "Software Development", 0.0236 + 0.0035],
  ["deadline-com", "irrelevant", 0.96, "Online Audio and Video Media", 0.0236],
  ["deltalake", "irrelevant", 0.91, "Software Development", 0.0236],
  ["nielsen-norman-group", "irrelevant", 0.96, "Technology, Information and Internet", 0.0236 + 0.0236 + 0.0126],
  ["bigrio", "irrelevant", 0.9, "Software Development", 0.0236],
  ["startup-grind", "irrelevant", 0.94, "Technology, Information and Internet", 0.017 + 0.0126],
  ["webbuddy-agency", "irrelevant", 0.92, "Software Development", 0.0126],
  ["the-onion", "irrelevant", 0.99, "Online Media", 0.0126],
  ["feufo", "irrelevant", 0.94, "Internet Marketplace Platforms", 0.012],
  ["venturebeat", "irrelevant", 0.97, "Software Development", 0.01],
  ["towards-data-science", "irrelevant", 0.97, "Internet Publishing", 0.0095 + 0.0077],
  ["bad-robot-games-llc", "irrelevant", 0.95, "Computer Games", 0.0035],
  ["inman-news", "irrelevant", 0.98, "Internet News", 0.0035],
  ["front-office-sports", "irrelevant", 0.98, "Internet News", 0.0035],
  ["digitaltrends-com", "irrelevant", 0.99, "Online Audio and Video Media", 0.0035],
  ["major-league-hacking", "irrelevant", 0.97, "Software Development", 0.0029],
  ["rarible", "irrelevant", 0.95, "Software Development", 0.0029],
  // plausible AI SaaS / software the gate must never touch
  ["llamaindex", "uncertain", 0.73, "Technology, Information and Internet", 0.0364],
  ["crewai-inc", "uncertain", 0.89, "Software Development", 0.0161],
  ["krea-ai", "uncertain", 0.96, "Technology, Information and Internet", 0.0162],
  ["relyanceai", "relevant", 0.78, "Data Security Software Products", 0.0287],
  ["cimba-ai", "uncertain", 0.91, "Technology, Information and Internet", 0.0224],
  ["actioneer-hq", "uncertain", 0.9, "Technology, Information and Internet", 0.0419],
  ["testfits", "uncertain", 0.92, "Software Development", 0.0252],
  ["unifize", "uncertain", 0.93, "Software Development", 0.0189],
  ["hushh-ai", "uncertain", 0.86, "Technology, Information and Internet", 0.0236],
  ["hyring-com", "relevant", 0.84, "Software Development", 0.0236],
  ["jobright-ai", "uncertain", 0.72, "Software Development", 0.0161],
  ["workerbeeai", "relevant", 0.84, "Software Development", 0.006],
  ["litellm", "uncertain", 0.8, "Software Development", 0.0035],
  ["skildai", "uncertain", 0.88, "Software Development", 0.0299],
];

Deno.test("REPLAY: the gate withholds exactly the media, publishing and games brands — $0.2763 of spend", () => {
  const blocked = PAID.filter(([, rel, conf, ind]) => paidVerificationBlockedBy({ relevance: rel, confidence: conf }, ind));
  assertEquals(blocked.map(([s]) => s).sort(), [
    "bad-robot-games-llc", "deadline-com", "design-milk", "digitaltrends-com", "ere-media-inc", "front-office-sports",
    "how-to-ai-guide", "inman-news", "psychology-today", "social-media-examiner", "the-onion", "towards-data-science", "usesav",
  ]);
  assertAlmostEquals(blocked.reduce((n, r) => n + r[4], 0), 0.2763, 0.0001);
});

Deno.test("REPLAY: no plausible AI SaaS company in those canaries is ever withheld", () => {
  const plausible = PAID.filter(([, rel]) => rel !== "irrelevant");
  for (const [slug, rel, conf, ind] of plausible) {
    assertEquals(paidVerificationBlockedBy({ relevance: rel, confidence: conf }, ind), null, slug);
  }
  // Nor the irrelevant software-labelled ones (consultancies, communities): still verified, by design.
  for (const slug of ["bigrio", "venturebeat", "bytebytego", "nielsen-norman-group", "startup-grind", "rarible"]) {
    const r = PAID.find(([s]) => s === slug)!;
    assertEquals(paidVerificationBlockedBy({ relevance: r[1], confidence: r[2] }, r[3]), null, slug);
  }
});

// ── CONTINUATION READS THE SAME RULE ────────────────────────────────────────

Deno.test("summarizeGaps: a withheld pending candidate is not a route a verification slice could take", () => {
  const verifiable = [{ dimension: "funding", next: "verify", considered: [] } as unknown as EvidenceGap];
  const before = summarizeGaps([{ gaps: verifiable }, { gaps: verifiable }]);
  assertEquals([before.with_executable_route, before.blocked, before.triage_deprioritized], [2, 0, 0]);
  const after = summarizeGaps([{ gaps: verifiable, paid_verification_blocked: true }, { gaps: verifiable }]);
  assertEquals([after.pending, after.with_executable_route, after.blocked, after.triage_deprioritized], [2, 1, 1, 1]);
});

// ── THROUGH THE REAL ENGINE ─────────────────────────────────────────────────

const PROBE = readinessPolicy({ mode: "provider_probe", probe_routes: ["apify_linkedin_company_search|general_company_discovery"] });
const MISSION = (() => {
  const m = parseLeadMissionDeterministic("Find 1 US company with 11-50 employees that raised funding in the last 6 months");
  return mergeCompanyBrainIntoMission({ ...m, company_profile: { ...m.company_profile, employee_range: { min: 11, max: 50 } },
    field_provenance: { ...m.field_provenance, "company_profile.employee_range": "explicit_user_request" as const } },
  { industries: ["b2b saas", "fintech"] } as never).mission;
})();
const CRITERIA = deriveMissionCriteria(MISSION, PROBE);
const row = (slug: string, name: string, industry: string) => ({
  id: slug, name, linkedinUrl: `https://www.linkedin.com/company/${slug}/`, website: `https://${slug}.com`,
  description: `${name}.`, employeeCount: 30, employeeCountRange: { start: 11, end: 50 },
  industries: [{ id: 0, name: industry }],
  locations: [{ parsed: { text: "New York, NY, United States", countryFull: "United States" }, country: "US", headquarter: true }],
});
const ROWS = [
  row("the-onion", "The Onion", "Online Media"),
  row("venturebeat", "VentureBeat", "Software Development"),
  row("acme-ai", "Acme AI", "Software Development"),
];
/** Triage as production answered: both publications irrelevant at ≥ 0.97; the AI company uncertain. */
const TRIAGE = ({ company_keys }: { company_keys: string[] }) => Promise.resolve({
  verdicts: company_keys.map((k) => ({
    company_key: k, matched_roles: [], signal_strength: k.includes("acme") ? 40 : 2,
    relevance: k.includes("acme") ? "uncertain" : "irrelevant", confidence: k.includes("acme") ? 0.8 : 0.98,
    reasons: [k.includes("acme") ? "AI product, unclear delivery." : "A news publication, not an AI SaaS company."],
  })),
});

async function runEngine() {
  const sent: string[] = [];
  const byUrl = (u: string) => ROWS.find((r) => r.linkedinUrl.replace(/\/$/, "") === u.replace(/\/$/, ""));
  const deps = {
    triageCompanies: TRIAGE,
    planDiscovery: emptyDiscoverySelector(),
    planExecution: () => Promise.resolve({ reasoning: "replay", steps: [
      { capability: "general_company_discovery", actor_key: "apify_linkedin_company_search", purpose: "d",
        input: { industryIds: ["4", "6"], locations: ["United States"], companySize: ["11-50"], maxItems: 10, scraperMode: "full" }, depends_on: [] },
      { capability: "company_identity_resolution", actor_key: "apify_linkedin_company_search", purpose: "i", input: { searchQuery: "{{name}}", maxItems: 5 }, depends_on: [1] },
      { capability: "company_enrichment", actor_key: "apify_linkedin_company_details", purpose: "e", input: { companies: ["{{url}}"] }, depends_on: [2] },
      { capability: "company_brain_qualification", actor_key: null, purpose: "q", input: {}, depends_on: [3] },
      { capability: "persistence", actor_key: null, purpose: "p", input: {}, depends_on: [4] },
    ] }),
    controlRoutes: () => Promise.resolve({ action: "continue" }),
    invoke: (call: { actorKey: string; input: { searchQuery?: string; companies?: string[] }; onProviderRun?: (r: { run_id: string; dataset_id: null }) => void }) => {
      sent.push(call.actorKey);
      call.onProviderRun?.({ run_id: `run-${sent.length}`, dataset_id: null });
      if (call.actorKey === "apify_linkedin_company_search") return Promise.resolve(call.input.searchQuery ? [] : ROWS);
      if (call.actorKey === "apify_linkedin_company_details") {
        return Promise.resolve((call.input.companies ?? []).map(byUrl).filter(Boolean));
      }
      throw new Error(`unexpected provider call: ${call.actorKey}`);
    },
    verifyEmployer: () => ({ verified: true, outcome: "verified_match" }),
  };
  const opts = {
    mission: MISSION, plan: buildCapabilityGraph(MISSION, { executability: "enforce", readiness: PROBE }),
    maxCandidates: candidatePool(1, null), readiness: PROBE,
    readEnv: (k: string) => (k === "LEAD_INVESTIGATION_MAX_PASSES" ? "1" : undefined),
    specMode: "enforce", specScope: { workspace_id: "ws", lineage_id: "ln" },
  };
  const result = await runCapabilityPlan(deps as never, opts as never) as unknown as { companies: unknown[] };
  return { result, sent };
}
const verifiable = (result: { companies: unknown[] }) => missionCandidatesFrom(result as never, { missionId: "t" }).map((c) => {
  const e = evaluateEligibility(CRITERIA, c.graph);
  return { ...c, eligibility: e.eligibility, hard_checks: e.checks.filter((x) => x.kind === "hard"), attempted_routes: c.attempted_routes ?? [] };
});

Deno.test("ENGINE: all three are still investigated and enriched; only The Onion is withheld from Atomus; no verdict moves", async () => {
  const { result, sent } = await runEngine();
  assert(sent.includes("apify_linkedin_company_details"), "investigation still happens");
  const cands = verifiable(result);
  const by = (n: string) => cands.find((c) => c.name === n)!;
  assert(by("The Onion").paid_verification_blocked?.includes("online media"));
  assertEquals(by("VentureBeat").paid_verification_blocked, null, "irrelevant but software-labelled: still verified");
  assertEquals(by("Acme AI").paid_verification_blocked, null);
  // Every verdict is exactly what the evidence says — the flag is not read by eligibility.
  for (const c of cands) assertEquals(c.eligibility, "pending", c.name ?? "");
  const atomus = verificationTargets({ route_actor: "apify_funding_atomus", max_targets: 6 }, cands as never,
    (id) => CRITERIA.find((x) => x.id === id)?.value, undefined, PROBE).map((t) => t.name).sort();
  assertEquals(atomus, ["Acme AI", "VentureBeat"]);
  // Without the flag the same candidates are all targeted — the skip is the only difference.
  const unflagged = cands.map((c) => ({ ...c, paid_verification_blocked: null }));
  assertEquals(verificationTargets({ route_actor: "apify_funding_atomus", max_targets: 6 }, unflagged as never,
    (id) => CRITERIA.find((x) => x.id === id)?.value, undefined, PROBE).map((t) => t.name).sort(),
    ["Acme AI", "The Onion", "VentureBeat"]);
});

Deno.test("ENGINE: discovery's 'enough work' rule agrees — the withheld company is not workable", async () => {
  const { result } = await runEngine();
  const workable = canonicallyWorkableKeys(result.companies as never, {
    mission: MISSION, plan: { entry_capability: "general_company_discovery" }, readiness: PROBE, identity: { task_id: "t" },
  } as never);
  const keys = [...workable].map((k) => k.replace(/^.*\/company\//, "").replace(/\/$/, "")).sort();
  assertEquals(keys, ["acme-ai", "venturebeat"]);
});
