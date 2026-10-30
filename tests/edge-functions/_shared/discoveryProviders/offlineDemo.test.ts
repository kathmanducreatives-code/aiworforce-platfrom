// The offline end-to-end workflow, asserted: request → compiled mission →
// provider plan → mocked search → qualification → Leads rows. Also proves it
// is offline: the only fetches are to the mock, and nothing else is reached.

import { assert, assertEquals, assertFalse } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { runOfflineDemo } from "../../../../scripts/provider-discovery-offline-demo.ts";

Deno.test("offline demo (auto): LeadOcean primary, five leads pass the provider checks and await canonical evidence, Apollo fallback unused", async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = () => { throw new Error("network is not allowed in the offline demo"); };
  try {
    const { compiled, req, plan, run, rows, calls } = await runOfflineDemo("auto");
    assertEquals(compiled.final_mission.requested_count, 5);
    assertEquals(req.hard.length, 5);
    assertEquals(plan.steps.map((s) => s.provider), ["leadocean", "apollo"]);
    assertEquals(calls.length, 1);
    assertEquals(run.status, "completed");
    assertEquals(run.counts, { qualified: 0, needsVerification: 5, rejected: 5 });
    assertEquals(run.leads.filter((l) => l.providerStatus === "qualified").length, 5);
    assertEquals(rows.length, 5);
    assert(rows.every((r) => (r!.account.raw.agentory_discovery as { provider_status: string }).provider_status === "qualified"));
    assert(rows.every((r) => r!.lead_candidate.status === "new"), "no lead is labelled qualified on a provider's word");
  } finally {
    globalThis.fetch = realFetch;
  }
});

Deno.test("offline demo (Apollo + Apify): free search, site reads settle industry and exclusions, nothing over-claimed", async () => {
  const { plan, run, rows } = await runOfflineDemo(["apollo", "apify"]);
  assertEquals(plan.steps.map((s) => [s.provider, s.estimatedCredits]), [["apollo", 0]]);
  const by = Object.fromEntries(run.leads.map((l) => [l.company.name[0].value, l]));
  // Industry and exclusion matched on the site; size and HQ rest on Apollo's filter alone.
  assertEquals(by["Stonebridge Fabrication"].status, "needs_verification");
  assertEquals(by["Stonebridge Fabrication"].checks.filter((c) => c.outcome === "provider_filter").map((c) => c.trusted), [false, false]);
  // The software shop's own site does not say "manufacturing": unknown, not qualified, not rejected.
  assertEquals(by["Patel Software"].status, "needs_verification");
  assertEquals(by["Rivers Staffing"].status, "rejected");
  assert(by["Rivers Staffing"].reasons[0].startsWith("Excluding: staffing agencies: contradicted"));
  // Apollo search carries no contact values at all.
  assertFalse(run.leads.some((l) => l.contacts.some((c) => c.person.contactPoints.length)));
  assertEquals(rows.length, 2, "needs-verification leads are written, labelled; the rejected one is not");
});
