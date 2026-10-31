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

Deno.test("offline demo (Apollo + Apify): Apollo's people rows name an employer only, so nothing can be verified or rejected", async () => {
  const { plan, run, rows } = await runOfflineDemo(["apollo", "apify"]);
  assertEquals(plan.steps.map((s) => [s.provider, s.estimatedCredits]), [["apollo", 0]]);
  const by = Object.fromEntries(run.leads.map((l) => [l.company.name[0].value, l]));
  // People API Search returns the organization's NAME only (documented): no domain,
  // so no website check can be aimed at it and no company fact is established.
  assertEquals(run.verification?.checked, 0);
  for (const name of ["Stonebridge Fabrication", "Patel Software", "Rivers Staffing"]) {
    assertEquals(by[name].status, "needs_verification", `${name}: nothing establishes or rules it out`);
    assertEquals(by[name].company.domain, []);
  }
  // Apollo's own size / HQ filters stay untrusted.
  assertEquals(by["Stonebridge Fabrication"].checks.filter((c) => c.outcome === "provider_filter").map((c) => c.trusted), [false, false]);
  // Apollo search carries no contact values at all.
  assertFalse(run.leads.some((l) => l.contacts.some((c) => c.person.contactPoints.length)));
  assertEquals(rows.length, 3, "needs-verification leads are written, labelled");
});

