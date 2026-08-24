// THE COMPANIES A MISSION NAMED, THROUGH THE SAME ENGINE AS EVERYONE ELSE.
//
// ── WHAT WAS BROKEN ─────────────────────────────────────────────────────────
//
// `known_company_resolution` was declared in the capability graph, forced as
// the entry capability whenever a mission supplied companies, and SKIPPED by
// the engine as `skipped_no_input`. Every route into the company pool ran
// through a discovery provider, so `company_profile.known_companies` was read
// by the compiler, the intent model and the playbook selector — and by nothing
// that executes.
//
// It cost Signals the most: every `tracked_company` and `competitor` monitoring
// subject compiles to `known_companies`, so the two subject kinds that make
// Signals *Signals* could not run at all.
//
// ── WHAT THIS FILE PROVES ───────────────────────────────────────────────────
//
//   1–2  a named company actually enters engine execution
//   3–5  identity strictness is UNCHANGED: a name alone never resolves, and a
//        wrong-domain result is refused rather than guessed
//   6–7  monitoring and sourcing travel the identical path
//   8    no Signals-specific identity logic exists anywhere
//   9–10 discovery missions are untouched
//
// ZERO network, ZERO Actor runs, ZERO model calls, ZERO database writes.

import {
  assert, assertEquals, assertFalse,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  runCapabilityPlan, type CapabilityEngineDeps,
} from "../../../supabase/functions/_shared/leadCapabilityEngine.ts";
import { buildCapabilityGraph } from "../../../supabase/functions/_shared/leadCapabilityGraph.ts";
import { compileMonitoringMission } from "../../../supabase/functions/_shared/monitoringMission.ts";
import {
  normalizeSuppliedCompanies, SUPPLIED_COMPANY_PROVENANCE,
} from "../../../supabase/functions/_shared/suppliedCompanyIdentity.ts";
import type { LeadMissionV1 } from "../../../supabase/functions/_shared/leadMission.ts";
import type { CompiledActorCall } from "../../../supabase/functions/_shared/hiringActorInputs.ts";
import { stubDiscoverySelector } from "./discoverySelectorFixture.ts";

// ── THE MISSIONS ────────────────────────────────────────────────────────────

/** A SOURCING mission that names its own companies. The Lead-side case. */
function sourcingMissionNaming(names: string[]): LeadMissionV1 {
  return {
    version: "lead-mission-v1",
    original_user_query: `Check ${names.join(" and ")} for hiring.`,
    mission_type: "company_research",
    target_entity: "company",
    requested_output: "qualified_companies",
    requested_count: 5,
    company_profile: {
      business_models: [], verticals: [], stages: [], locations: [],
      known_companies: names,
    },
    required_signals: [{ type: "hiring", timeframe_days: 90 }],
    decision_makers: { roles: [], current_employment_required: false },
    hard_constraints: {}, soft_preferences: {},
    required_capabilities: [], prohibited_capabilities: [],
    confidence: 1,
  } as unknown as LeadMissionV1;
}

/** The MONITORING mission for the same companies, from the real compiler. */
function monitoringMissionNaming(names: string[]): LeadMissionV1 {
  const r = compileMonitoringMission({
    workspace_id: "w",
    subjects: names.map((n) => ({
      kind: "tracked_company" as const, identifier: n, label: n,
      signals: [{ event: "hiring" as const, subject: "company" as const }],
      timeframe_days: 90,
    })),
    icp: null,
  });
  assert(r.ok && r.mission, `monitoring mission failed to compile: ${r.reason}`);
  return r.mission!;
}

// ── THE HARNESS ─────────────────────────────────────────────────────────────

interface Call { actorKey: string; input: Record<string, unknown> }

/**
 * Run a plan with a recording invoker.
 *
 * `rows` answers the LinkedIn company SEARCH — the only paid call a
 * known-company mission can reach before qualification. Everything else
 * returns nothing, so a stage that tries to buy something reveals itself as an
 * unanswered call in `calls` rather than as a silent success.
 */
async function runNamed(
  mission: LeadMissionV1,
  rows: Record<string, unknown>[],
  extraDeps: Partial<CapabilityEngineDeps> = {},
) {
  const calls: Call[] = [];
  const deps = {
    invoke: (call: CompiledActorCall<unknown>) => {
      calls.push({ actorKey: call.actorKey, input: call.input as Record<string, unknown> });
      return Promise.resolve(
        call.actorKey === "apify_linkedin_company_search" ? rows : [],
      );
    },
    verifyEmployer: () => ({ verified: false, outcome: "not_attempted" }),
    ...extraDeps,
  } as unknown as CapabilityEngineDeps;

  const plan = buildCapabilityGraph(mission as never);
  // deno-lint-ignore no-explicit-any
  const run = await runCapabilityPlan(deps, { mission, plan, maxCandidates: 25 } as any);
  return { run, calls, plan };
}

const outcomeOf = (run: { capability_outcomes: Array<{ capability: string }> }, cap: string) =>
  run.capability_outcomes.find((o) => o.capability === cap);

// A search result that CONFIRMS acme.com — same domain, so identity resolves.
const CONFIRMING_ROW = {
  name: "Acme", linkedinUrl: "https://www.linkedin.com/company/acme",
  website: "https://acme.com", description: "Acme makes things", location: "United States",
};
// A search result for a DIFFERENT Acme. The name agrees; nothing else does.
const IMPOSTOR_ROW = {
  name: "Acme", linkedinUrl: "https://www.linkedin.com/company/acme-industries-gmbh",
  website: "https://acme-industries.de", description: "Acoustic panels", location: "Germany",
};

// ── 1–2. THE COMPANY ACTUALLY ENTERS EXECUTION ──────────────────────────────

Deno.test("1. a named company enters the engine's own company pool", async () => {
  const { run } = await runNamed(sourcingMissionNaming(["acme.com"]), [CONFIRMING_ROW]);

  const seeded = outcomeOf(run, "known_company_resolution");
  assert(seeded, "the capability did not run at all");
  assertEquals(seeded!.status, "complete");
  assertEquals(seeded!.rows, 1);
  // IT BUYS NOTHING. The mission already supplied the input; this is the one
  // capability that completes without a provider.
  assertEquals(seeded!.providers_used, []);
  assert(
    run.state.completed_capabilities.includes("known_company_resolution"),
    "a completed capability must be recorded as completed",
  );

  // AND THE COMPANY IS REALLY THERE — not merely counted.
  assertEquals(run.companies.length, 1);
  assertEquals(run.companies[0].company.canonical_domain, "acme.com");
});

Deno.test("2. it continues into the ordinary identity stage, and pays there", async () => {
  const { run, calls } = await runNamed(
    sourcingMissionNaming(["acme.com"]), [CONFIRMING_ROW],
  );

  // The SAME provider a discovered company is identified with.
  const identity = calls.filter((c) => c.actorKey === "apify_linkedin_company_search");
  assertEquals(identity.length, 1, "the named company must reach identity resolution");
  // Asked about by name, exactly as any other company is.
  assert(
    JSON.stringify(identity[0].input).toLowerCase().includes("acme"),
    "the identity search must actually ask about the supplied company",
  );

  const resolved = outcomeOf(run, "company_identity_resolution");
  assert(resolved, "identity resolution never ran");
  // A CONFIRMED DOMAIN IS A REAL IDENTITY.
  assertEquals(run.companies[0].identity?.status, "verified_match");
  assertEquals(
    run.companies[0].identity?.linkedin_company_url,
    "https://www.linkedin.com/company/acme",
  );
});

// ── 3–5. IDENTITY STRICTNESS IS UNCHANGED ───────────────────────────────────

Deno.test("3. a bare NAME never becomes a verified identity", async () => {
  // The supplied string is "Acme" — a word, not an identifier. The search
  // returns a company genuinely called Acme, with a real LinkedIn page.
  const { run } = await runNamed(sourcingMissionNaming(["Acme"]), [CONFIRMING_ROW]);

  const id = run.companies[0]?.identity;
  assert(id, "the company should still exist and still have been attempted");
  assertFalse(
    id!.status === "verified_match",
    "a name with nothing confirming it was accepted as an identity",
  );
  assertEquals(id!.linkedin_company_url, null);
  // AND THE REASON IS RECORDED, not just the refusal.
  assert(
    id!.evidence.some((e) => e.includes("name_match_without_domain_confirmation") ||
      e.includes("candidate_has_no_domain")),
    `the refusal must say why: ${JSON.stringify(id!.evidence)}`,
  );
});

Deno.test("4. a same-name different-company result is refused, not guessed", async () => {
  const { run } = await runNamed(sourcingMissionNaming(["acme.com"]), [IMPOSTOR_ROW]);

  const id = run.companies[0]?.identity;
  assertFalse(
    id?.status === "verified_match",
    "a German acoustics firm was accepted as the supplied acme.com",
  );
  assertEquals(id?.linkedin_company_url, null);
});

Deno.test("5. an unresolved identity blocks the paid stages after it", async () => {
  const { run, calls } = await runNamed(sourcingMissionNaming(["Acme"]), [CONFIRMING_ROW]);

  // Enrichment and hiring verification are only for ACTIONABLE identities.
  const paidAfterIdentity = calls.filter((c) =>
    c.actorKey !== "apify_linkedin_company_search");
  assertEquals(
    paidAfterIdentity, [],
    `nothing may be bought for a company we cannot prove we found: ${
      JSON.stringify(paidAfterIdentity)}`,
  );
  // And the run says so rather than reporting a silent success.
  const enrich = outcomeOf(run, "company_enrichment");
  if (enrich) assertFalse(enrich.status === "complete" && enrich.evidence_satisfied);
});

// ── 6–7. ONE PATH FOR MONITORING AND SOURCING ───────────────────────────────

Deno.test("6. monitoring and sourcing schedule the same entry capability", () => {
  const sourcing = buildCapabilityGraph(sourcingMissionNaming(["acme.com"]) as never);
  const monitoring = buildCapabilityGraph(monitoringMissionNaming(["acme.com"]) as never);

  assertEquals(sourcing.steps[0].capability, "known_company_resolution");
  assertEquals(monitoring.steps[0].capability, "known_company_resolution");

  // The ONLY difference between the two plans is the Lead-only terminal, which
  // monitoring omits by design. Everything that collects intelligence is shared.
  const s = sourcing.steps.map((x) => x.capability);
  const m = monitoring.steps.map((x) => x.capability);
  assertEquals(s.filter((c) => c !== "persistence"), m);
  assert(s.includes("persistence"), "a sourcing mission still persists");
  assertFalse(m.includes("persistence"), "a monitoring mission still must not");
});

Deno.test("7. both produce the same pool entry, through the same seeding code", async () => {
  const sourcing = await runNamed(sourcingMissionNaming(["acme.com"]), [CONFIRMING_ROW]);
  const monitoring = await runNamed(monitoringMissionNaming(["acme.com"]), [CONFIRMING_ROW]);

  assertEquals(sourcing.run.companies.length, 1);
  assertEquals(monitoring.run.companies.length, 1);
  // Same key, same domain, same provenance, same resolved identity.
  assertEquals(monitoring.run.companies[0].key, sourcing.run.companies[0].key);
  assertEquals(
    monitoring.run.companies[0].company.source_provenance,
    sourcing.run.companies[0].company.source_provenance,
  );
  assertEquals(monitoring.run.companies[0].company.source_provenance, SUPPLIED_COMPANY_PROVENANCE);
  assertEquals(
    monitoring.run.companies[0].identity?.linkedin_company_url,
    sourcing.run.companies[0].identity?.linkedin_company_url,
  );
});

// ── 8. NO SECOND IDENTITY PIPELINE ──────────────────────────────────────────

Deno.test("8. no Signals module resolves a company identity of its own", async () => {
  const SIGNALS_MODULES = [
    "monitoringMission.ts", "monitoringRunner.ts", "monitoringPreflight.ts",
  ];
  // Anything that would constitute a second identity path.
  const FORBIDDEN = [
    "companyIdentityResolution", "resolveIdentityAgainstLookups",
    "acceptLinkedInMatch", "compileHarvestCompanySearchInput",
    "apify_linkedin_company_search", "suppliedCompanyIdentity",
  ];
  for (const m of SIGNALS_MODULES) {
    const src = await Deno.readTextFile(
      new URL(`../../../supabase/functions/_shared/${m}`, import.meta.url),
    );
    for (const f of FORBIDDEN) {
      assertFalse(
        src.includes(f),
        `${m} references ${f} — that is a second identity pipeline`,
      );
    }
  }
  // The endpoint must not seed companies either: naming them is the mission's
  // job and seeding them is the engine's.
  const endpoint = await Deno.readTextFile(
    new URL("../../../supabase/functions/run-monitoring-scan/index.ts", import.meta.url),
  );
  assertFalse(endpoint.includes("known_companies"),
    "the monitoring endpoint touches known_companies — seeding belongs to the engine");
});

// ── 9–10. DISCOVERY MISSIONS ARE UNTOUCHED ──────────────────────────────────

Deno.test("9. a mission naming no company still routes to discovery", () => {
  const m = sourcingMissionNaming([]);
  // deno-lint-ignore no-explicit-any
  delete (m.company_profile as any).known_companies;
  const plan = buildCapabilityGraph(m as never);
  const caps = plan.steps.map((s) => s.capability);
  assertFalse(
    caps.includes("known_company_resolution"),
    "a mission that named nothing must not schedule known-company seeding",
  );
  assert(
    caps.some((c) => c.endsWith("_company_discovery")),
    `a mission that named nothing must discover: ${JSON.stringify(caps)}`,
  );
});

Deno.test("10. seeding runs for named companies and for nobody else", async () => {
  // The empty case reaches the same branch and refuses it honestly.
  const m = sourcingMissionNaming([]);
  const plan = buildCapabilityGraph(sourcingMissionNaming(["acme.com"]) as never);
  const calls: Call[] = [];
  const run = await runCapabilityPlan(
    {
      invoke: (call: CompiledActorCall<unknown>) => {
        calls.push({ actorKey: call.actorKey, input: {} });
        return Promise.resolve([]);
      },
      verifyEmployer: () => ({ verified: false, outcome: "not_attempted" }),
      // deno-lint-ignore no-explicit-any
    } as any,
    // deno-lint-ignore no-explicit-any
    { mission: m, plan, maxCandidates: 25 } as any,
  );
  const seeded = outcomeOf(run, "known_company_resolution");
  assertEquals(seeded?.status, "skipped_no_input");
  assertEquals(seeded?.rows, 0);
  assertEquals(run.companies.length, 0);
  assertEquals(calls, [], "an empty supplied list must spend nothing");
});

// ── 11. THE NORMALIZER'S OWN RULE ───────────────────────────────────────────

Deno.test("11. only a real identifier fills an identity field", () => {
  const { companies, rejected } = normalizeSuppliedCompanies([
    "Acme", "acme.com", "https://linkedin.com/company/acme", "   ", "!!!",
  ]);
  assertEquals(rejected.length, 2);
  const [byName, byDomain, byUrl] = companies;

  // A NAME PROVES ONLY A NAME.
  assertEquals(byName.kind, "name");
  assertEquals(byName.company.canonical_domain, null);
  assertEquals(byName.company.linkedin_company_url, null);
  assertEquals(byName.company.website, null);

  assertEquals(byDomain.kind, "domain");
  assertEquals(byDomain.company.canonical_domain, "acme.com");
  // The name derived from a hostname is TRANSFORMED, never direct evidence.
  assertEquals(byDomain.company.field_trust.company_name, "transformed");

  assertEquals(byUrl.kind, "linkedin_url");
  // CANONICALISED by the same normalizer identity resolution uses, so a URL a
  // person pasted and one a provider returned compare equal.
  assertEquals(byUrl.company.linkedin_company_url, "https://www.linkedin.com/company/acme");

  // NOBODY CLAIMED THIS COMPANY IS HIRING. Unknown is not false.
  assertEquals(byName.company.hiring_status, null);
  // And no actor is implied in the evidence trail.
  assertEquals(byName.company.raw_ref.actor_key, SUPPLIED_COMPANY_PROVENANCE);
});


// ── 12–13. "NOBODY ASKED" IS NOT "NOTHING FOUND" ────────────────────────────
//
// `freeHiringAssessment` judges the openings a company already carries, and
// with none it returns `hiring_not_verified` — correct for a company a provider
// answered the jobs question about, and false for one the mission merely named,
// whose job evidence was never sought. The paid fallback now covers that second
// case, and ONLY that one.

/** A YC row with no openings at all — a company a provider DID answer about. */
function ycRowNoJobs(name: string, slug: string) {
  return {
    id: slug, name, website: `https://${slug}.com`,
    industry: "B2B", industries: ["B2B"], batch: "W22", teamSize: 42,
    oneLiner: `${name} is a B2B SaaS platform.`,
    allLocations: "San Francisco, CA, USA",
    openJobs: [],
  };
}

Deno.test("12. a NAMED company with no job evidence is asked about, not written off", async () => {
  const { calls } = await runNamed(
    sourcingMissionNaming(["acme.com"]),
    [CONFIRMING_ROW],
  );
  assert(
    calls.some((c) => c.actorKey === "apify_linkedin_job_search"),
    `a company nobody has asked about must be asked about: ${
      calls.map((c) => c.actorKey).join(", ")}`,
  );
});

Deno.test("13. a DISCOVERED company with no openings is unchanged — still no paid check", async () => {
  // The discovery provider ANSWERED the jobs question for this company and the
  // answer was "none". That is evidence, and re-buying it is the waste the
  // lone-Tier-B rule exists to prevent. This is the assertion that keeps the
  // fix above scoped to supplied rows.
  const mission = sourcingMissionNaming([]);
  // A mission the YC directory genuinely covers, so the cohort validator admits
  // the actor and this test exercises discovery rather than a refusal.
  // deno-lint-ignore no-explicit-any
  (mission.company_profile as any) = {
    business_models: [], verticals: ["b2b saas"], stages: ["seed"], locations: [],
  };
  const plan = buildCapabilityGraph(mission as never);
  const calls: Call[] = [];
  await runCapabilityPlan(
    {
      invoke: (call: CompiledActorCall<unknown>) => {
        calls.push({ actorKey: call.actorKey, input: {} });
        return Promise.resolve(
          call.actorKey === "apify_yc_companies_memo23"
            ? [ycRowNoJobs("Acme", "acme")]
            : call.actorKey === "apify_linkedin_company_search"
            ? [CONFIRMING_ROW]
            : [],
        );
      },
      verifyEmployer: () => ({ verified: false, outcome: "not_attempted" }),
      planDiscovery: stubDiscoverySelector(),
      // deno-lint-ignore no-explicit-any
    } as any,
    // deno-lint-ignore no-explicit-any
    { mission, plan, maxCandidates: 25 } as any,
  );
  assertFalse(
    calls.some((c) => c.actorKey === "apify_linkedin_job_search"),
    `a discovery mission's spend changed: ${calls.map((c) => c.actorKey).join(", ")}`,
  );
});
