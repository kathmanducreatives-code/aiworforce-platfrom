import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  filterByIcp, parseEmployeeCount, sizeBandToBounds, icpTopRejectReasons,
  DEFAULT_EXCLUDED_INDUSTRIES, matchedExcludedIndustries,
  type IcpCandidate,
} from "../../../supabase/functions/_shared/companyIcpFilter.ts";

const saasIcp = { positive_industries: ["B2B SaaS", "SaaS", "Software"], max_employees: 150, allow_enterprise: false };

// ---- Case A: SaaS ICP, "founders hiring assistants" → never oil/bank/hospital/enterprise ----
Deno.test("Case A: SaaS ICP rejects refineries, banks, hospitals, manufacturing, mega-enterprise", () => {
  const cands: IcpCandidate[] = [
    { company: "Acme SaaS", industry: "B2B SaaS", team_size: "42" },              // keep
    { company: "Gulf Refining Co", industry: "Oil & Gas Refinery", team_size: "8000" },
    { company: "First National Bank", industry: "Banking", team_size: "20000" },
    { company: "City General Hospital", industry: "Hospital", team_size: "5000" },
    { company: "SteelWorks Manufacturing", industry: "Heavy Manufacturing", team_size: "12000" },
    { company: "Microsoft", industry: "Software", team_size: "220000" },          // mega-cap, size-capped
  ];
  const r = filterByIcp(cands, saasIcp);
  const names = r.accepted.map((c) => c.company);
  assertEquals(names, ["Acme SaaS"]);
  assert(!names.includes("Gulf Refining Co") && !names.includes("First National Bank"));
  assert(!names.includes("City General Hospital") && !names.includes("SteelWorks Manufacturing"));
  assert(!names.includes("Microsoft"), "mega-cap rejected when size-capped");
  // accepted row explains why it matched
  assert((r.matched.get(r.accepted[0]) ?? []).some((w) => /SaaS/i.test(w)));
});

// ---- Case B: Recruiting-agency ICP, "hiring recruiters" → returns recruiting companies ----
Deno.test("Case B: Recruiting ICP keeps recruiting agencies (not excluded as a company type)", () => {
  const icp = { positive_industries: ["Recruiting", "Staffing", "Talent"], max_employees: 500, allow_enterprise: false };
  const r = filterByIcp([
    { company: "Beacon Hill Staffing", industry: "Recruiting / Staffing", team_size: "300" },
    { company: "Oilfield Services LLC", industry: "Oilfield", team_size: "40" },
  ], icp);
  assertEquals(r.accepted.map((c) => c.company), ["Beacon Hill Staffing"]);
});

// ---- Case C: Manufacturing ICP → manufacturing is ALLOWED (Brain targets it) ----
Deno.test("Case C: Manufacturing ICP allows manufacturing (default exclusion suppressed)", () => {
  const icp = { positive_industries: ["Manufacturing", "Industrial"], max_employees: 2000, allow_enterprise: false };
  const r = filterByIcp([
    { company: "Precision Manufacturing Inc", industry: "Heavy Manufacturing", team_size: "800" },
    { company: "Downtown Law Firm", industry: "Legal Services", team_size: "60" },
  ], icp);
  const names = r.accepted.map((c) => c.company);
  assert(names.includes("Precision Manufacturing Inc"), "manufacturing allowed when ICP targets it");
  assert(!names.includes("Downtown Law Firm"), "law firm still excluded by default");
});

// ---- Case D: Enterprise ICP → Fortune 500 / mega-caps allowed ----
Deno.test("Case D: Enterprise ICP (allow_enterprise) permits Fortune-500 / mega-caps", () => {
  const icp = { positive_industries: ["Software", "SaaS"], allow_enterprise: true, max_employees: null };
  const r = filterByIcp([
    { company: "Microsoft", industry: "Software", team_size: "220000" },
    { company: "Oracle", industry: "Enterprise Software", team_size: "140000" },
  ], icp);
  assertEquals(r.accepted.length, 2, "enterprise allowed → both kept");
});

// ---- negatives / disqualifiers / excluded types ----
Deno.test("negatives: Brain 'avoid agencies/consultancies' rejects them even with SaaS-ish naming", () => {
  const icp = { positive_industries: ["SaaS"], excluded_company_types: ["agency", "consultancy", "consulting"], max_employees: 150 };
  const r = filterByIcp([
    { company: "Growth SaaS Co", industry: "B2B SaaS", team_size: "30" },
    { company: "BrightWave Agency", industry: "Marketing Agency", team_size: "25" },
    { company: "Peak Consulting", industry: "Consultancy", team_size: "40" },
  ], icp);
  assertEquals(r.accepted.map((c) => c.company), ["Growth SaaS Co"]);
});

Deno.test("strict_industry off → non-ICP-industry rows kept if not otherwise excluded", () => {
  const icp = { positive_industries: ["SaaS"], strict_industry: false, max_employees: 150 };
  const r = filterByIcp([{ company: "Neutral Startup", industry: "Consumer App", team_size: "20" }], icp);
  assertEquals(r.accepted.length, 1);
});

// ---- Phase 1B merge parity: companyIcpFilter's DEFAULT_EXCLUDED_INDUSTRIES and
// leadQualityGate's now-deleted DEFAULT_DISQUALIFIERS were merged into one
// canonical list. Every company either original list excluded must still be
// excluded by the merged one. ----

// Companies that only companyIcpFilter's pre-merge list excluded.
Deno.test("merge parity: pre-merge companyIcpFilter-only exclusions still reject", () => {
  const icp = { positive_industries: ["SaaS"], max_employees: 150 };
  const r = filterByIcp([
    { company: "Acme SaaS", industry: "B2B SaaS", team_size: "40" },
    { company: "Petro Refining Co", industry: "Petroleum Refinery", team_size: "9000" },
    { company: "State University", industry: "Universities", team_size: "5000" },
    { company: "Downtown Law Firm", industry: "Legal Services", team_size: "60" },
    { company: "Grand Resort & Casino", industry: "Hospitality", team_size: "800" },
  ], icp);
  const names = r.accepted.map((c) => c.company);
  assertEquals(names, ["Acme SaaS"]);
});

// Companies that only leadQualityGate's pre-merge DEFAULT_DISQUALIFIERS list
// excluded (bare "manufacturing", "plant operations", "construction",
// "staffing agency", "recruiting agency") — the merge's whole point was that
// companyIcpFilter's list did NOT reject these before, so this proves the
// union actually landed, not just that nothing regressed.
Deno.test("merge parity: pre-merge leadQualityGate-only exclusions now also reject via companyIcpFilter", () => {
  const icp = { positive_industries: ["SaaS"], max_employees: 500 };
  const r = filterByIcp([
    { company: "Acme SaaS", industry: "B2B SaaS", team_size: "40" },
    { company: "Riverside Manufacturing Co", industry: "Consumer Goods Manufacturing", team_size: "200" },
    { company: "Site Plant Operations LLC", industry: "Plant Operations", team_size: "150" },
    { company: "BuildRight Construction", industry: "Construction", team_size: "300" },
    { company: "Apex Staffing Agency", industry: "Staffing Agency", team_size: "80" },
    { company: "Talent Bridge Recruiting Agency", industry: "Recruiting Agency", team_size: "50" },
  ], icp);
  const names = r.accepted.map((c) => c.company);
  assertEquals(names, ["Acme SaaS"]);
});

// The Brain-override behavior (a Brain that positively targets a bucket keeps
// it) must still work identically for the newly-merged terms, exactly as it
// already did for the pre-existing "heavy manufacturing" entry (Case C above).
Deno.test("merge parity: Brain override still un-suppresses the newly-merged terms", () => {
  const constructionIcp = { positive_industries: ["Construction", "Contractor"], max_employees: 2000 };
  const r1 = filterByIcp([{ company: "BuildRight Construction", industry: "Construction", team_size: "800" }], constructionIcp);
  assert(r1.accepted.map((c) => c.company).includes("BuildRight Construction"), "construction allowed when ICP targets it");

  const staffingIcp = { positive_industries: ["Staffing", "Recruiting"], max_employees: 500 };
  const r2 = filterByIcp([
    { company: "Apex Staffing Agency", industry: "Staffing Agency", team_size: "80" },
    { company: "Talent Bridge Recruiting Agency", industry: "Recruiting Agency", team_size: "50" },
  ], staffingIcp);
  assertEquals(r2.accepted.map((c) => c.company).sort(), ["Apex Staffing Agency", "Talent Bridge Recruiting Agency"]);
});

Deno.test("matchedExcludedIndustries: the shared matcher used by both former list owners", () => {
  assertEquals(matchedExcludedIndustries("A Staffing Agency in Chicago"), ["staffing agency"]);
  assertEquals(matchedExcludedIndustries("Nothing off-ICP here"), []);
  assert(DEFAULT_EXCLUDED_INDUSTRIES.includes("manufacturing"));
  assert(DEFAULT_EXCLUDED_INDUSTRIES.includes("construction"));
  assert(DEFAULT_EXCLUDED_INDUSTRIES.includes("staffing agency"));
  assert(DEFAULT_EXCLUDED_INDUSTRIES.includes("recruiting agency"));
  assert(DEFAULT_EXCLUDED_INDUSTRIES.includes("plant operations"));
});

// ---- helpers ----
Deno.test("parseEmployeeCount: ranges, plus, single, string", () => {
  assertEquals(parseEmployeeCount("5-150"), 150);
  assertEquals(parseEmployeeCount("1000+"), 1000);
  assertEquals(parseEmployeeCount("42 employees"), 42);
  assertEquals(parseEmployeeCount(1200), 1200);
  assertEquals(parseEmployeeCount(""), null);
});
Deno.test("sizeBandToBounds: bands → bounds + enterprise flag", () => {
  assertEquals(sizeBandToBounds("5-150 employees").max, 150);
  assert(sizeBandToBounds("Enterprise / Fortune 500").enterprise);
  assertEquals(sizeBandToBounds("SMB").max, 200);
});
Deno.test("icpTopRejectReasons aggregates the trace", () => {
  const r = filterByIcp([
    { company: "Oil Co", industry: "oil", team_size: "9000" },
    { company: "Bank Co", industry: "bank", team_size: "9000" },
  ], saasIcp);
  const top = icpTopRejectReasons(r.trace);
  assert(top.length >= 1 && top[0].count >= 1);
});
