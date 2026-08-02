import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { companyKeyFor } from "../../supabase/functions/_shared/candidateEnvelope.ts";
import { dedupeCompanyEnrichment, DEFAULT_EVIDENCE_BUDGET, type EnrichmentPlan } from "../../supabase/functions/_shared/conditionalEnrichmentPlanner.ts";
import { buildCompanyEnrichmentInput } from "../../supabase/functions/_shared/structuredCompanyEnrichment.ts";

const B = DEFAULT_EVIDENCE_BUDGET;

const plan = (candidateId: string, companyKey: string): EnrichmentPlan => ({
  candidateId, companyKey, action: "structured_company_enrichment",
  actorKey: "apify_linkedin_company_details", actorId: "harvestapi/linkedin-company",
  requiredEvidence: ["company_website", "company_industry"],
  reasonCode: "missing_firmographics", estimatedCostClass: "low",
});

// ---- (18)(19) three founders at ONE company ----
Deno.test("18/19: three founders at one company ⇒ ONE call, fanned back to all three", () => {
  const plans = [plan("f1", "li:linkedin.com/company/acme"), plan("f2", "li:linkedin.com/company/acme"), plan("f3", "li:linkedin.com/company/acme")];
  const { actions, fanOut } = dedupeCompanyEnrichment(plans);
  assertEquals(actions.filter((a) => a.action === "structured_company_enrichment").length, 1);
  assertEquals(fanOut.get("li:linkedin.com/company/acme"), ["f1", "f2", "f3"]);
  // …and the actor input carries exactly one identifier for that company.
  const input = buildCompanyEnrichmentInput(
    plans.map((p) => ({ companyKey: p.companyKey!, companyLinkedInUrl: "https://www.linkedin.com/company/acme" })), B,
  );
  assertEquals(input.input.companies, ["https://www.linkedin.com/company/acme"]);
  assertEquals(input.targets.length, 1);
});

// ---- five founders across three companies ----
Deno.test("five founders at three companies ⇒ exactly three calls", () => {
  const plans = [
    plan("f1", "li:linkedin.com/company/acme"), plan("f2", "li:linkedin.com/company/acme"),
    plan("f3", "li:linkedin.com/company/beta"), plan("f4", "li:linkedin.com/company/beta"),
    plan("f5", "li:linkedin.com/company/gamma"),
  ];
  const { actions, fanOut } = dedupeCompanyEnrichment(plans);
  assertEquals(actions.filter((a) => a.action === "structured_company_enrichment").length, 3);
  assertEquals(fanOut.get("li:linkedin.com/company/acme")!.length, 2);
  assertEquals(fanOut.get("li:linkedin.com/company/beta")!.length, 2);
  assertEquals(fanOut.get("li:linkedin.com/company/gamma")!.length, 1);
  const input = buildCompanyEnrichmentInput([
    { companyKey: "li:linkedin.com/company/acme", companyLinkedInUrl: "https://www.linkedin.com/company/acme" },
    { companyKey: "li:linkedin.com/company/beta", companyLinkedInUrl: "https://www.linkedin.com/company/beta" },
    { companyKey: "li:linkedin.com/company/gamma", companyLinkedInUrl: "https://www.linkedin.com/company/gamma" },
  ], B);
  assertEquals(input.input.companies!.length, 3);
});

// ---- duplicate LinkedIn URL variants collapse to ONE key ----
Deno.test("duplicate LinkedIn URL variants resolve to one company key", () => {
  const variants = [
    "https://www.linkedin.com/company/acme",
    "https://www.linkedin.com/company/acme/",
    "http://linkedin.com/company/acme",
    "https://www.linkedin.com/company/acme?trk=public#top",
  ];
  const keys = new Set(variants.map((u) => companyKeyFor({ companyLinkedinUrl: u })));
  assertEquals(keys.size, 1, [...keys].join(" | "));
});

// ---- same NAME but conflicting LinkedIn URLs must NOT collapse ----
Deno.test("same company name with conflicting LinkedIn URLs does NOT collapse", () => {
  const a = companyKeyFor({ companyLinkedinUrl: "https://www.linkedin.com/company/acme-us", companyName: "Acme" });
  const b = companyKeyFor({ companyLinkedinUrl: "https://www.linkedin.com/company/acme-uk", companyName: "Acme" });
  assert(a !== b, `${a} must not equal ${b}`);
  const { actions } = dedupeCompanyEnrichment([plan("f1", a!), plan("f2", b!)]);
  assertEquals(actions.filter((x) => x.action === "structured_company_enrichment").length, 2);
});

// ---- key precedence: LinkedIn URL wins over domain wins over name ----
Deno.test("company key precedence: linkedin URL → domain → name+geo", () => {
  assertEquals(companyKeyFor({ companyLinkedinUrl: "https://www.linkedin.com/company/acme", website: "https://other.com", companyName: "Zzz" }), "li:linkedin.com/company/acme");
  assertEquals(companyKeyFor({ website: "https://acme.com/about?x=1", companyName: "Zzz" }), "dom:acme.com");
  assertEquals(companyKeyFor({ companyName: "Acme Inc.", countryCode: "US" }), "name:acme|us");
  // Same firm, different founders' records ⇒ same key.
  assertEquals(companyKeyFor({ domain: "acme.com" }), companyKeyFor({ website: "https://www.acme.com/" }));
  // No identifier at all ⇒ null (never a bogus shared key).
  assertEquals(companyKeyFor({}), null);
});

// ---- non-company-scoped plans are never merged ----
Deno.test("skip/stage plans are never collapsed by company dedupe", () => {
  const plans: EnrichmentPlan[] = [
    { candidateId: "a", companyKey: "li:x", action: "skip", requiredEvidence: [], reasonCode: "primary_source_sufficient", estimatedCostClass: "none" },
    { candidateId: "b", companyKey: "li:x", action: "stage", requiredEvidence: [], reasonCode: "budget_exhausted", estimatedCostClass: "none" },
  ];
  const { actions } = dedupeCompanyEnrichment(plans);
  assertEquals(actions.length, 2);
});
