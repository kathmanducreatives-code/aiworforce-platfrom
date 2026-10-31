import { assert, assertEquals, assertThrows } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { assertLiveTestsEnabled, LIVE_TEST_ENV, LiveTestsClosed } from "../../scripts/_liveTestGate.ts";
import { compileIcp, ICP_A, ICP_B } from "../../supabase/functions/_shared/leadPipeline/icp.ts";
import { planDiscovery } from "../../supabase/functions/_shared/discoveryProviders/routing.ts";
import { leadOceanAdapter } from "../../supabase/functions/_shared/discoveryProviders/adapters/leadocean.ts";
import { enrichPhones } from "../../supabase/functions/_shared/leadPipeline/phones.ts";
import { memoryLedger } from "../../supabase/functions/_shared/discoveryProviders/budget.ts";

Deno.test("live provider tests are closed by default; only an explicit env value opens one run", () => {
  assertThrows(() => assertLiveTestsEnabled(() => undefined), LiveTestsClosed);
  assertThrows(() => assertLiveTestsEnabled(() => "true"), LiveTestsClosed, LIVE_TEST_ENV);
  assertLiveTestsEnabled((k) => (k === LIVE_TEST_ENV ? "enabled" : undefined));
});

Deno.test("every live script is gated (static check)", async () => {
  for (const f of ["provider-benchmark-run.ts", "leadocean-validation-v.ts", "lead-pipeline-test-e.ts", "lead-pipeline-phone-test-p1.ts", "leadocean-final-benchmark.ts"]) {
    const src = await Deno.readTextFile(new URL(`../../scripts/${f}`, import.meta.url));
    assert(src.includes("assertLiveTestsEnabled()"), `${f} must call the live-test gate`);
  }
});

Deno.test("ICP queries exclude non-decision titles seen in the final benchmark (Investor, Developer co-founder)", async () => {
  const conns = [{ provider: "leadocean" as const, connected: true, enabled: true, commercialTermsConfirmed: true, remainingCredits: null, recentFailures: 0 }];
  for (const icp of [ICP_A, ICP_B]) {
    const req = compileIcp(icp).requirements;
    const plan = planDiscovery({ requirements: req, connections: conns, selection: ["leadocean"] });
    let body: Record<string, unknown> = {};
    await leadOceanAdapter({ apiKey: "x", fetch: (_u, i) => { body = JSON.parse(i.body!); return Promise.resolve(new Response(JSON.stringify({ success: true, data: [], meta: { credits: 0 } }), { status: 200 })); } }).search(plan.steps[0], req, null, 5);
    assert((body.excludeTitle as string[]).includes("Investor") && (body.excludeTitle as string[]).includes("Developer"));
    assertEquals([body.hqCountry, body.country], [["US"], ["US"]], "employer HQ and person location are separate filters");
  }
});

Deno.test("phone records flag non-NANP numbers (P1: 3 of 5 US-HQ founders had a non-US mobile)", async () => {
  const mk = (phone: string) => ({ apiKey: "k", fetch: (() => Promise.resolve(new Response(JSON.stringify({ success: true, data: { has_phone: true, contact_phones: [{ phone, type: "mobile", dnc: null }] }, meta: { credits: 1 } }), { status: 200 }))) as never });
  const auth = (m: string) => ({ kind: "enrichment" as const, workspaceId: "w", missionId: m, personKeys: ["p"], revealEmail: false, phones: true, maxCredits: 1, approvedBy: "t", approvedAt: "t" });
  const t = [{ personKey: "p", leadId: null, providerPersonId: "1", linkedinUrl: null, eligibility: "eligible" as const, hasPhone: true, outreachBlocked: false, employment: { status: "provider_consistent" as const, sources: ["leadocean"], checkedAt: null } }];
  const intl = await enrichPhones({ workspaceId: "w", missionId: "a", authorization: auth("a"), targets: t, deps: mk("+91 98450 12345"), ledger: memoryLedger(), probe: null });
  const us = await enrichPhones({ workspaceId: "w", missionId: "b", authorization: auth("b"), targets: t, deps: mk("+1 512 555 0101"), ledger: memoryLedger(), probe: null });
  assertEquals([intl.records[0].international, intl.records[0].class], [true, "unverified_person_associated"]);
  assertEquals(us.records[0].international, false);
});
