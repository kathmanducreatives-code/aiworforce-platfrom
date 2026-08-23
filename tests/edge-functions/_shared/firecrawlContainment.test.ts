// FIRECRAWL IS AN UNLOCK. THIS IS THE TEST THAT KEEPS IT ONE.
//
// ── THE COST THIS PREVENTS ──────────────────────────────────────────────────
//
// Measured against a representative run — 50 companies discovered, ~8 finally
// qualified — routing a crawl into qualification costs 50 credits to produce 8
// leads: 6.2 credits of research per useful lead, roughly 84% of it bought for
// companies the ICP gate was about to reject. The same crawl bought AFTER
// qualification, by a user clicking Research on a lead they have already seen,
// costs 1 credit and is never wasted.
//
// That difference is the whole argument, and it is not enforced by anything a
// type checker can see. `planEnrichment` had a `targeted_firecrawl` branch and
// a default budget of five companies × three pages for months without a single
// production caller — dead, and one `import` away from being alive.
//
// ── WHAT IS ASSERTED, AND WHY EACH ONE ──────────────────────────────────────
//
// 1. NO QUALIFICATION MODULE MENTIONS FIRECRAWL. Read from the source text,
//    because the property being defended is "nobody wired it in", and an import
//    is how wiring starts. This catches the change at the moment it is typed,
//    which no behavioural test can do.
// 2. THE DEAD PLANNER MODULE STAYS DELETED. A file that plans Firecrawl page
//    sets, imported by nothing, is a loaded gun.
// 3. THE UNLOCK PATH STILL WORKS. A containment test that passes because the
//    capability was removed entirely would be worse than no test.
//
// PURE. Reads source text; no network, provider, model or database access.

import {
  assert, assertEquals, assertFalse,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  UNLOCK_PRICES, priceFor,
} from "../../../supabase/functions/_shared/creditPricing.ts";
import {
  DEFAULT_EVIDENCE_BUDGET, emptyLedger, FORBIDDEN_AUTOMATIC_ACTIONS,
} from "../../../supabase/functions/_shared/conditionalEnrichmentPlanner.ts";

const SHARED = new URL("../../../supabase/functions/_shared/", import.meta.url);

const read = (file: string): string | null => {
  try { return Deno.readTextFileSync(new URL(file, SHARED)); }
  catch { return null; }
};

/**
 * Every module that runs between "a company was discovered" and "a company was
 * qualified". If Firecrawl ever becomes automatic, it becomes automatic here.
 *
 * Listed explicitly rather than globbed: a glob silently shrinks when files are
 * renamed, and this list failing to find a file is itself a finding.
 */
const QUALIFICATION_PATH: readonly string[] = [
  "leadCapabilityEngine.ts",
  "leadCapabilityGraph.ts",
  "companyFirstStages.ts",
  "companyIcpFilter.ts",
  "companyBrainSemanticFit.ts",
  "evidenceSufficiency.ts",
  "structuredCompanyEnrichment.ts",
  "companyEnrichmentOrchestrator.ts",
  "leadCompanyEvidence.ts",
  "leadEvidenceRegistry.ts",
  "leadEligiblePool.ts",
  "leadCommercialPrequalification.ts",
  "leadGenericPrequalification.ts",
];

Deno.test("1. NO module on the qualification path references Firecrawl", () => {
  const offenders: string[] = [];
  for (const file of QUALIFICATION_PATH) {
    const src = read(file);
    assert(src !== null,
      `${file} is on the qualification path and could not be read — if it was ` +
      `renamed, update this list; the list is the contract`);
    // Word boundary on purpose: `firecrawl_scrape_url`, `planTargetedFirecrawl`
    // and a bare mention in a comment are all hits, and all three are the thing
    // being watched for.
    for (const [i, line] of src!.split("\n").entries()) {
      if (/firecrawl/i.test(line)) offenders.push(`${file}:${i + 1}: ${line.trim()}`);
    }
  }
  assertEquals(offenders, [],
    "a qualification-path module now mentions Firecrawl. Web research is a " +
    "user-triggered unlock (research_company, 1 credit) and must not become a " +
    "per-candidate cost — see this file's header for the measured price.");
});

Deno.test("2. the dead automatic-crawl planner module stays deleted", () => {
  assertEquals(read("evidenceEnrichmentAdapters.ts"), null,
    "evidenceEnrichmentAdapters.ts is back. It built Firecrawl page-crawl " +
    "plans, was imported by nothing but its own test, and is exactly the kind " +
    "of unreachable code that becomes reachable by one import.");
});

Deno.test("3. the workflow budget authorises no automatic crawling", () => {
  const budget = DEFAULT_EVIDENCE_BUDGET as unknown as Record<string, unknown>;
  for (const field of Object.keys(budget)) {
    assertFalse(/firecrawl|crawl/i.test(field),
      `${field} is a standing authorisation to crawl. A budget line is ` +
      `permission; there must not be one.`);
  }
  for (const field of Object.keys(emptyLedger() as unknown as Record<string, unknown>)) {
    assertFalse(/firecrawl|crawl/i.test(field), `${field} counts crawl spend`);
  }
  // Non-empty, so test 4 cannot pass by forbidding nothing.
  assert(FORBIDDEN_AUTOMATIC_ACTIONS.length > 0);
});

Deno.test("4. the planner cannot name an arbitrary actor by key", () => {
  const src = read("conditionalEnrichmentPlanner.ts")!;
  // `getActorCapability("firecrawl_scrape_url")` was the exact call in both
  // deleted branches. The narrow lookups that remain — the structured company
  // enricher by name, and a `maxCost: "medium"` search — cannot return a
  // high-cost crawler.
  assertFalse(/import\b[^;]*\bgetActorCapability\b/s.test(src),
    "conditionalEnrichmentPlanner imports getActorCapability again. That " +
    "resolves ANY actor by key and is how both deleted branches reached the " +
    "crawler.");
  assertFalse(/action:\s*"targeted_firecrawl"/.test(src));
});

Deno.test("5. THE CAPABILITY STILL EXISTS — as a priced, user-triggered unlock", () => {
  // Containment must not become removal. Firecrawl earns its credit at the
  // outreach layer, where the personalized opener HARD-BLOCKS without it.
  assertEquals(UNLOCK_PRICES.research_company, 1);
  assertEquals(priceFor("research_company"), 1);
  assertEquals(UNLOCK_PRICES.find_decision_makers, 2);
  assertEquals(UNLOCK_PRICES.generate_outreach, 0);

  const exec = read("leadActionExecutor.ts")!;
  // The crawl is reached through the unlock and names its own price, so the
  // quote the button showed and the credits reserved cannot drift.
  assert(/unlock_capability:\s*"research_company"/.test(exec),
    "the research_company action no longer names its unlock capability to " +
    "runTool — the charge would stop being reserved against the quoted price");
  assert(/max_pages:\s*1\b/.test(exec),
    "the research crawl is no longer capped at one page");

  // And outreach still refuses to invent personalization without it.
  const opener = Deno.readTextFileSync(
    new URL("../../../supabase/functions/_shared/workbench/openerBackend.ts", import.meta.url));
  assert(/blocked_missing_company_research/.test(opener),
    "the opener no longer blocks on missing research — personalization would " +
    "then be written from nothing");
});
