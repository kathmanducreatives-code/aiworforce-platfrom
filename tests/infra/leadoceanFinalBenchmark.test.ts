import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { approvalFor, buildRequests, evaluateRow, homepageTech, independentChecks, isUseful, ledgerAppend, ledgerRead, MAX_RECORDS, planHashOf, SCENARIOS } from "../../scripts/leadocean-final-benchmark.ts";
import { loCompanyRow, loPerson } from "../edge-functions/_shared/discoveryProviders/fixtures.ts";

const sc = (id: string) => SCENARIOS.find((s) => s.id === id)!;

Deno.test("benchmark plan: 8 pinned requests, 15 records, 12 scenarios covered by counts or samples; hash changes with any body", () => {
  const r = buildRequests(["2", "1"]);
  assertEquals(r.reduce((a, x) => a + x.limit, 0), MAX_RECORDS);
  assertEquals(r.length, 8);
  assert(r.filter((x) => x.path === "/v1/search").every((x) => JSON.parse(x.body).excludeIds.join() === "1,2"), "people searches exclude bought ids, sorted");
  assert(r.filter((x) => x.path === "/v1/search/companies").every((x) => !("excludeIds" in JSON.parse(x.body))));
  assert(r.every((x) => !JSON.parse(x.body).reveal_email), "no contact reveal");
  assertEquals(planHashOf(buildRequests(["1", "2"])), planHashOf(r), "order of seen ids does not change the plan");
  assert(planHashOf(buildRequests(["1", "2", "3"])) !== planHashOf(r));
  assertEquals(approvalFor("abc", false), "leadocean=15,apify_usd=0,plan=abc");
  assertEquals(approvalFor("abc", true), "leadocean=15,apify_usd=0.07,plan=abc");
});

Deno.test("benchmark ledger: durable, append-only; a key in any state is visible to the next process", async () => {
  const p = await Deno.makeTempFile({ dir: "/tmp" });
  await Deno.remove(p);
  assertEquals(await ledgerRead(p), []);
  await ledgerAppend(p, { key: "h:P-S2", state: "reserved", records: 2, status: null, at: "t" });
  await ledgerAppend(p, { key: "h:P-S2", state: "failed", records: null, status: 429, at: "t" });
  const l = await ledgerRead(p);
  assertEquals(l.map((x) => x.state), ["reserved", "failed"]);
  assertEquals((await Deno.stat(p)).mode! & 0o777, 0o600);
  await Deno.remove(p);
});

Deno.test("benchmark evaluation: people row in the observed shape — size band, industry, decision-maker; HQ is not in a people row", () => {
  const row = loPerson({ id: "9", name: "Ann Bee", title: "Co-Founder & CEO", company: "Acme", domain: "acme.example", industry: "Software Development", employees: 120, phone: "+1 555 0100" });
  const e = evaluateRow(sc("P-S2"), row as never);
  assertEquals([e.checks.employees, e.checks.industry, e.checks.decisionMaker], ["pass", "pass", "pass"]);
  assertEquals(e.company.hqCountry, null);
  assertEquals(e.person?.hasPhone, true);
  const small = evaluateRow(sc("P-S2"), loPerson({ id: "8", name: "Cy Dee", title: "Founder", company: "Tiny", domain: "tiny.example", industry: "Software Development", employees: 12 }) as never);
  assertEquals(small.checks.employees, "fail");
  const notDm = evaluateRow(sc("P-S2"), loPerson({ id: "7", name: "Ed Fay", title: "Software Engineer", company: "Acme", domain: "acme.example", industry: "Software Development", employees: 120 }) as never);
  assertEquals(notDm.checks.decisionMaker, "fail");
  assertFalseUseful(notDm);
});
function assertFalseUseful(e: ReturnType<typeof evaluateRow>) { assertEquals(isUseful(e, null), false); }

Deno.test("benchmark evaluation: company row — funding type/year and founded are checked against the row; absent is not_in_row, never pass", () => {
  const withFunding = loCompanyRow({ id: "c1", name: "Fundco", domain: "fundco.example", industry: "Software Development", employees: 40, hqCountryCode: "US", funding: { last_round_type: "Seed", last_round_year: 2025, last_round_date: "2025-03-01" } });
  const e = evaluateRow(sc("C-S8"), withFunding as never);
  assertEquals([e.checks.fundingType, e.checks.employees, e.company.hqCountry], ["pass", "pass", "US"]);
  assertEquals(evaluateRow(sc("C-S7"), withFunding as never).checks.fundingYear, "pass");
  const none = evaluateRow(sc("C-S7"), loCompanyRow({ id: "c2", name: "Nofund", domain: "nofund.example", employees: 40, hqCountryCode: "US" }) as never);
  assertEquals(none.checks.fundingYear, "not_in_row");
  assert(none.missing.includes("funding"));
  assert(isUseful(none, null), "not_in_row is unknown, not a failure");
});

Deno.test("benchmark independence: Apify HQ / size and the homepage decide; LeadOcean's own fields never do", () => {
  const e = evaluateRow(sc("C-S9"), { ...loCompanyRow({ id: "c3", name: "Techco", domain: "techco.example", industry: "Software Development", employees: 60, hqCountryCode: "US" }), company_detected_technologies: { technologies: [{ name: "HubSpot" }] } } as never);
  assertEquals(e.checks.technologies, "pass");
  assertEquals(homepageTech('<script src="//js.hs-scripts.com/1.js"></script>'), ["hubspot"]);
  assertEquals(homepageTech("<html>plain</html>"), []);
  assertEquals(independentChecks(e, null).hq, "unavailable");
  const ok = independentChecks(e, { hqCountry: "United States of America", sizeBand: [51, 200], founded: null, homepageTech: ["hubspot"] });
  assertEquals([ok.hq, ok.size, ok.tech], ["pass", "pass", "pass"]);
  const bad = independentChecks(e, { hqCountry: "Canada", sizeBand: [201, 500], founded: null, homepageTech: [] });
  assertEquals([bad.hq, bad.size, bad.tech], ["fail", "fail", "fail"]);
  assertEquals(isUseful(e, bad), false, "an independent contradiction makes a row not useful");
});

Deno.test("benchmark regression: company technologies arrive as [{technology_product:{name}}] (observed 2026-10-31)", () => {
  const row = { ...loCompanyRow({ id: "c9", name: "Obs", domain: "obs.example", industry: "Software Development", employees: 40, hqCountryCode: "US" }),
    company_detected_technologies: [{ technology_product: { id: null, name: "Salesforce CRM", url: null } }, { technology_product: { id: null, name: "Hubspot", url: null } }] };
  const e = evaluateRow(sc("C-S9"), row as never);
  assertEquals(e.company.technologies, ["salesforce crm", "hubspot"]);
  assertEquals(e.checks.technologies, "pass");
  assert(!e.missing.includes("technologies"));
});
