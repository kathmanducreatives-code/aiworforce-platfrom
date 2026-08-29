// FROZEN PRODUCTION REPLAY — the engine's evidence path, against rows it bought.
//
// ── THE QUESTION THIS ANSWERS ───────────────────────────────────────────────
//
// The 2026-08-29 backend audit could not explain one thing. Task 237717dd bought
// dataset `S4mOFDce4ghLRDvmr` (run `kCcPbdENXxrueROWZ`, $0.016, 5 rows,
// `accepted_count: 5`) asking about [intelletec-ltd, storm4, atlas-search] — and
// its persisted checkpoint records ALL THREE as:
//
//   hiring: "not_verified"
//   hiring_assessment: { verdict: "hiring_not_verified", evidence_source: "none",
//                        reason: "No open roles at all — nothing to judge …" }
//   hiring_jobs: []
//
// The audit attributed the loss to concurrent generations restoring stale state.
// That explains the SIBLING tasks. It did not explain this one, because this task
// bought the rows itself. So either the rows never reached the assessor, or there
// is a second defect INSIDE the evidence path — and those two have very different
// repair plans. The repair plan (§16.1) made resolving it a precondition.
//
// ── THE ANSWER ─────────────────────────────────────────────────────────────
//
// The evidence path is CORRECT. Given the real rows, the real normalizer, the
// real routing and the real mission vocabulary, it produces:
//
//   storm4         → hiring_verified   tier A   "Inside Sales Representative"
//   atlas-search   → watch             (a role present, none matching — and
//                                       `watch` REACHES Company Brain)
//   intelletec-ltd → hiring_not_verified (the provider returned nothing for it)
//
// Production's recorded verdict is therefore unreachable from the rows it paid
// for. The loss is upstream of `assessOne`, in state propagation between
// generations — not in normalization, routing, or assessment.
//
// This test exists so that conclusion stays true. If it fails, the evidence path
// itself has regressed and the "repair, don't rebuild" assessment needs revisiting.
//
// ── WHY THE ROWS ARE INLINE ────────────────────────────────────────────────
//
// They are the dataset, read once from Apify and frozen here. A test that
// fetched them would be a network test, would cost nothing but prove less, and
// would stop working the day the dataset is garbage-collected.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  normalizeLinkedInJob,
} from "../../../supabase/functions/_shared/hiringActorNormalizers.ts";
import {
  normalizeCompanyLinkedInUrl,
} from "../../../supabase/functions/_shared/structuredCompanyEnrichment.ts";
import {
  assessHiring, reachesCompanyBrain,
} from "../../../supabase/functions/_shared/commercialSignalPolicy.ts";

/** Dataset `S4mOFDce4ghLRDvmr`, verbatim. Heavy display fields omitted. */
const DATASET_ROWS: Record<string, unknown>[] = [
  {
    id: "4457350203", title: "Sales Director",
    linkedinUrl: "https://www.linkedin.com/jobs/view/4457350203/",
    company: {
      id: "71303127", name: "Storm4", universalName: "storm4",
      linkedinUrl: "https://www.linkedin.com/company/storm4",
    },
    location: { linkedinText: "United States" },
    workplaceType: "remote", postedDate: "2026-08-21T12:58:47.000Z",
  },
  {
    id: "4456929214", title: "IR and BD Specialist ",
    linkedinUrl: "https://www.linkedin.com/jobs/view/4456929214/",
    company: {
      id: "4872007", name: "Atlas Search", universalName: "atlas-search",
      linkedinUrl: "https://www.linkedin.com/company/atlas-search",
    },
    location: { linkedinText: "Boston, MA" },
    workplaceType: "hybrid", postedDate: "2026-08-25T13:46:13.000Z",
  },
  {
    id: "4459306153", title: "Senior Originator",
    linkedinUrl: "https://www.linkedin.com/jobs/view/4459306153/",
    company: {
      id: "71303127", name: "Storm4", universalName: "storm4",
      linkedinUrl: "https://www.linkedin.com/company/storm4",
    },
    location: { linkedinText: "Texas, United States" },
    workplaceType: "hybrid", postedDate: "2026-08-26T13:04:48.000Z",
  },
  {
    id: "4453114358", title: "Inside Sales Representative",
    linkedinUrl: "https://www.linkedin.com/jobs/view/4453114358/",
    company: {
      id: "71303127", name: "Storm4", universalName: "storm4",
      linkedinUrl: "https://www.linkedin.com/company/storm4",
    },
    location: { linkedinText: "United States" },
    workplaceType: "remote", postedDate: "2026-08-12T12:09:59.000Z",
  },
  {
    // The Actor returned this row twice. Kept, because the dataset did.
    id: "4459306153", title: "Senior Originator",
    linkedinUrl: "https://www.linkedin.com/jobs/view/4459306153/",
    company: {
      id: "71303127", name: "Storm4", universalName: "storm4",
      linkedinUrl: "https://www.linkedin.com/company/storm4",
    },
    location: { linkedinText: "Texas, United States" },
    workplaceType: "hybrid", postedDate: "2026-08-26T13:04:48.000Z",
  },
];

/** `lead_execution_calls.request_input`, fingerprint `2df88a5a`. */
const BATCH = [
  "https://www.linkedin.com/company/intelletec-ltd",
  "https://www.linkedin.com/company/storm4",
  "https://www.linkedin.com/company/atlas-search",
];

/**
 * The run's compiled vocabulary, recovered verbatim from the persisted
 * `hiring_assessment.reason` of the very companies this test is about.
 */
const VOCAB = {
  source: "mission" as const,
  required_titles: [
    "sales roles", "sdr", "bdr", "sales development representative",
    "account executive", "founding sdr", "founding ae", "head of sales",
    "growth", "gtm", "go to market", "business development",
    "demand generation", "revenue", "salesperson", "sales representative",
    "territory sales manager", "ae", "enterprise ae", "seller",
    "enterprise seller", "enterprise sales",
  ],
};

/**
 * The engine's routing, reproduced exactly (`leadCapabilityEngine.ts`, the
 * hiring batch loop): a map keyed by the NORMALIZED requested URL, and a row
 * that names a company outside the batch is dropped rather than attributed to
 * whoever is nearby.
 */
function routeRowsToCompanies(
  rawRows: Record<string, unknown>[], batch: readonly string[],
): { byCompany: Map<string, ReturnType<typeof normalizeLinkedInJob>[]>; dropped: number } {
  const byUrl = new Map<string, string>();
  for (const url of batch) {
    const k = normalizeCompanyLinkedInUrl(url);
    if (k) byUrl.set(k, url);
  }
  const byCompany = new Map<string, ReturnType<typeof normalizeLinkedInJob>[]>();
  let dropped = 0;
  for (const raw of rawRows) {
    const j = normalizeLinkedInJob(raw);
    const owner = j.company_linkedin_url ? byUrl.get(j.company_linkedin_url) : undefined;
    if (!owner) { dropped++; continue; }
    const list = byCompany.get(owner) ?? [];
    list.push(j);
    byCompany.set(owner, list);
  }
  return { byCompany, dropped };
}

function assessFor(company: string) {
  const { byCompany } = routeRowsToCompanies(DATASET_ROWS, BATCH);
  const mine = byCompany.get(company) ?? [];
  return {
    rows: mine.length,
    assessment: assessHiring(
      mine.map((j) => ({ title: j.title ?? "", url: j.job_url, location: j.location })),
      ["another_active_gtm_opening"],
      { source: "external_job_search", vocab: VOCAB },
    ),
  };
}

Deno.test("every paid row carries the company identity the Actor nests under `company`", () => {
  // The a76c7b4c transport bug drove `company_linkedin_url` to null on all 84
  // rows of two paid calls. This is the pin that it stays fixed.
  for (const raw of DATASET_ROWS) {
    const j = normalizeLinkedInJob(raw);
    assert(j.company_linkedin_url, `row ${raw.id} lost its company identity`);
    assert(j.company_name, `row ${raw.id} lost its company name`);
  }
});

Deno.test("the requested URL and the returned URL normalize to the same key", () => {
  // If these two ever diverge, every row is dropped SILENTLY by the `continue`
  // in the routing loop — which is the shape of loss this replay was built to
  // rule out.
  assertEquals(
    normalizeCompanyLinkedInUrl("https://www.linkedin.com/company/storm4"),
    normalizeLinkedInJob(DATASET_ROWS[0]).company_linkedin_url,
  );
});

Deno.test("ALL FIVE PAID ROWS REACH A COMPANY — none are dropped", () => {
  const { byCompany, dropped } = routeRowsToCompanies(DATASET_ROWS, BATCH);
  assertEquals(dropped, 0);
  assertEquals(byCompany.get("https://www.linkedin.com/company/storm4")?.length, 4);
  assertEquals(byCompany.get("https://www.linkedin.com/company/atlas-search")?.length, 1);
  // The Actor returned nothing for this company. That is an ANSWER, not a loss.
  assertEquals(byCompany.get("https://www.linkedin.com/company/intelletec-ltd"), undefined);
});

Deno.test("STORM4 IS HIRING — the verdict production could not reach", () => {
  const { rows, assessment } = assessFor("https://www.linkedin.com/company/storm4");
  assertEquals(rows, 4);
  assertEquals(assessment.verdict, "hiring_verified");
  assertEquals(assessment.evidence_source, "external_job_search");
  assertEquals(assessment.tier, "A");
  assert(
    assessment.commercial_jobs.some((j) => j.title === "Inside Sales Representative"),
    "the Tier A role the mission asked for must be cited",
  );
  assert(reachesCompanyBrain(assessment));
  // Production persisted the exact opposite for this company.
  assert(assessment.verdict !== "hiring_not_verified");
  assert(assessment.evidence_source !== "none");
});

Deno.test("ATLAS SEARCH IS `watch`, NOT A TERMINAL NEGATIVE — and still reaches the Brain", () => {
  // Worth its own test: production recorded `hiring_not_verified`, which does
  // NOT reach Company Brain. The loss did not only destroy a verified company,
  // it converted a Brain-eligible company into a terminal rejection.
  const { rows, assessment } = assessFor("https://www.linkedin.com/company/atlas-search");
  assertEquals(rows, 1);
  assertEquals(assessment.verdict, "watch");
  assertEquals(assessment.evidence_source, "external_job_search");
  assert(reachesCompanyBrain(assessment));
});

Deno.test("INTELLETEC IS THE ONE HONEST NEGATIVE — asked, answered, nothing there", () => {
  // The discriminator Phase 3 has to get right. This company reached
  // `hiring_not_verified` legitimately: a settled provider call covered it and
  // returned no rows for it. That is EVIDENCE OF ABSENCE.
  //
  // The other two reached the identical persisted state without any of that
  // being true, which is ABSENCE OF EVIDENCE. Today the two are indistinguishable
  // — same verdict, same `evidence_source: "none"`, same reason string — and
  // that indistinguishability is what makes the state terminal for both.
  const { rows, assessment } = assessFor("https://www.linkedin.com/company/intelletec-ltd");
  assertEquals(rows, 0);
  assertEquals(assessment.verdict, "hiring_not_verified");
  assertEquals(assessment.evidence_source, "none");
  assertEquals(reachesCompanyBrain(assessment), false);
});

Deno.test("THE PRODUCTION VERDICT IS UNREACHABLE FROM THE ROWS THAT WERE PAID FOR", () => {
  // The single assertion this replay exists to make. Two of the three companies
  // in the batch cannot be assessed as production assessed them, so no defect in
  // the evidence path can account for what was persisted.
  const storm4 = assessFor("https://www.linkedin.com/company/storm4").assessment;
  const atlas = assessFor("https://www.linkedin.com/company/atlas-search").assessment;
  const productionSaid = { verdict: "hiring_not_verified", evidence_source: "none" };

  for (const [name, a] of [["storm4", storm4], ["atlas-search", atlas]] as const) {
    assert(
      a.verdict !== productionSaid.verdict || a.evidence_source !== productionSaid.evidence_source,
      `${name}: the evidence path reproduces the persisted verdict — the loss IS in the ` +
      `evidence path after all, and the repair plan's §18 conclusion needs revisiting`,
    );
  }
});
