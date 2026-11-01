import { assert, assertEquals, assertRejects, assertThrows } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { P1_APPROVAL, P1Refusal, p1Cohort, p1Guard } from "../../scripts/lead-pipeline-phone-test-p1.ts";
import { enrichPhones } from "../../supabase/functions/_shared/leadPipeline/phones.ts";
import { memoryLedger } from "../../supabase/functions/_shared/discoveryProviders/budget.ts";

const lead = (i: number, o: Record<string, unknown> = {}) => ({
  leadKey: `domain:c${i}.example`, company: { domain: `c${i}.example` }, rank: { score: 100 - i, lane: "queue" }, statuses: { qualification: "eligible" }, outreachBlockers: [],
  person: { key: `li:in/p${i}`, providerPersonId: String(1000 + i), linkedinUrl: `https://www.linkedin.com/in/p${i}`, roleFamily: "founder", hasPhoneFlag: true }, ...o,
});
const ok = (status = 200, body: unknown = { success: true, data: { key: "k", has_phone: true, contact_phones: [{ phone: "+1 512 555 0101", type: "mobile", dnc: null, priority: 1 }] }, meta: { credits: 1 } }) =>
  Promise.resolve(new Response(JSON.stringify(body), { status }));

Deno.test("P1: approval is exactly 5 records, $0 Apify", () => assertEquals(P1_APPROVAL, "leadocean=5,apify_usd=0"));

Deno.test("P1 cohort: top five by score; blocked, ineligible, flagless and non-decision-makers never selected", () => {
  const q = [lead(1), lead(2, { outreachBlockers: ["hold"] }), lead(3, { statuses: { qualification: "pending" } }), lead(4), lead(5), lead(6),
    lead(7, { person: { ...lead(7).person, hasPhoneFlag: false } }), lead(8), lead(9, { person: { ...lead(9).person, roleFamily: "other" } }), lead(10)];
  const c = p1Cohort({ queue: q as never });
  assertEquals(c.companies, ["c1.example", "c4.example", "c5.example", "c6.example", "c8.example"]);
  assertEquals(c.bodies[0], JSON.stringify({ linkedin_url: "https://www.linkedin.com/in/p1" }));
  assertThrows(() => p1Cohort({ queue: [lead(1)] as never }), P1Refusal);
});

Deno.test("P1 guard + enrichPhones: exactly the five bodies, each once; the probe once; everything else refused before sending", async () => {
  const c = p1Cohort({ queue: [1, 2, 3, 4, 5, 6].map((i) => lead(i)) as never });
  let sent = 0;
  const g = p1Guard(() => { sent++; return ok(); }, c.bodies);
  const deps = { apiKey: "x", fetch: g.fetch };
  const auth = { kind: "enrichment" as const, workspaceId: "w", missionId: "m", personKeys: c.targets.map((t) => t.personKey), revealEmail: false, phones: true, maxCredits: 5, approvedBy: "t", approvedAt: "t" };
  const r = await enrichPhones({ workspaceId: "w", missionId: "m", authorization: auth, targets: c.targets, deps, ledger: memoryLedger(), probe: null });
  assertEquals([r.records.length, r.recordsCharged, g.lookups(), sent], [5, 5, 5, 5]);
  assert(r.records.every((x) => x.class === "unverified_person_associated" && x.dnc === "unknown" && x.endpoint === "/v1/people/phone"));
  const post = (path: string, body: string) => g.fetch(`https://api.leadocean.io${path}`, { method: "POST", headers: {}, body });
  await assertRejects(() => post("/v1/people/phone", c.bodies[0]), P1Refusal, "already sent");
  await assertRejects(() => post("/v1/people/phone", JSON.stringify({ person_id: "999" })), P1Refusal, "approved five");
  await assertRejects(() => post("/v2/people/phone", c.bodies[0]), P1Refusal);
  await assertRejects(() => post("/v1/search", "{}"), P1Refusal);
  await assertRejects(() => post("/v1/people/enrich", c.bodies[0]), P1Refusal);
  await post("/v1/people/phone", "{}");
  await assertRejects(() => post("/v1/people/phone", "{}"), P1Refusal, "probe");
  assertEquals(sent, 6, "five lookups + one probe; every refusal sent nothing");
});
