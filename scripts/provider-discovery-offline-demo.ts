// OFFLINE end-to-end demonstration of multi-provider lead discovery:
//
//   user request → mission compiler → requirements → provider plan → approval
//   → mocked provider search → merge + verify → Leads-dashboard rows
//
//   deno run --no-check --allow-read --allow-env scripts/provider-discovery-offline-demo.ts
//
// No network: the model's reading of the request is a fixture, provider
// responses are fixtures served by a mock fetch, and the Apify invoker is a
// stub. No key, no database, no worker.

import { requirementsFromMission } from "../supabase/functions/_shared/discoveryProviders/requirements.ts";
import { planDiscovery, type Selection } from "../supabase/functions/_shared/discoveryProviders/routing.ts";
import { leadOceanAdapter } from "../supabase/functions/_shared/discoveryProviders/adapters/leadocean.ts";
import { apolloAdapter } from "../supabase/functions/_shared/discoveryProviders/adapters/apollo.ts";
import { apifyAdapter, type ActorInvoker } from "../supabase/functions/_shared/discoveryProviders/adapters/apify.ts";
import { memoryLedger, type DiscoveryApproval } from "../supabase/functions/_shared/discoveryProviders/budget.ts";
import { runDiscovery } from "../supabase/functions/_shared/discoveryProviders/orchestrator.ts";
import { projectLead } from "../supabase/functions/_shared/discoveryProviders/leadProjection.ts";
import {
  ALL_CONNECTED, FIXED_NOW, MANUFACTURER_QUERY, MARKET, apPerson, compileManufacturerMission, loPage, loPerson, mockFetch, noSleep,
} from "../tests/edge-functions/_shared/discoveryProviders/fixtures.ts";

const WS = "11111111-1111-4111-8111-111111111111";

export async function runOfflineDemo(selection: Selection = "auto", log: (s: string) => void = () => {}) {
  log(`REQUEST   ${MANUFACTURER_QUERY}`);
  const compiled = compileManufacturerMission();
  const mission = compiled.final_mission as never;
  const req = requirementsFromMission(mission);
  log(`MISSION   target=${req.targetEntity} count=${req.requestedCount} forbid-broadening=[${req.forbidBroadening.join(", ")}]`);
  for (const h of req.hard) log(`  hard    ${h.label}`);

  const plan = planDiscovery({ requirements: req, connections: ALL_CONNECTED, selection });
  log(`PLAN      ${plan.status}${plan.blockedReason ? ` — ${plan.blockedReason}` : ""}  hash=${plan.planHash}`);
  for (const s of plan.steps) {
    log(`  ${s.role.padEnd(8)} ${s.provider} ${s.kind} ≤${s.maxRecords} rows, ≤${s.maxPages} pages, est ${s.estimatedCredits} credit(s)`);
    for (const r of s.requirements) log(`           ${r.handling.padEnd(11)} ${r.label}${r.via ? ` (via ${r.via})` : ""}`);
  }
  for (const r of plan.refused) log(`  refused  ${r.provider}: ${r.reason}`);
  if (plan.verification) log(`  verify   ${plan.verification.provider} [${plan.verification.keys.join(", ")}] ≤${plan.verification.maxRuns} runs`);
  log(`APPROVAL  ${plan.requiresApproval ? `required: ${JSON.stringify(plan.estimatedCredits)}` : "not required (free)"}`);

  const approval: DiscoveryApproval | null = plan.requiresApproval
    ? { kind: "discovery", workspaceId: WS, missionId: "demo-mission", planHash: plan.planHash, maxCredits: { ...plan.estimatedCredits }, approvedBy: "demo-owner", approvedAt: FIXED_NOW().toISOString() }
    : null;

  const f = mockFetch({
    "POST /v1/search": [{ body: loPage(MARKET.map(loPerson)) }],
    "POST /api/v1/mixed_people/api_search": [{ body: { total_entries: 3, people: [
      apPerson("ap-1", "Avery", "Founder & CEO", { name: "Stonebridge Fabrication", primary_domain: "stonebridgefab.example" }),
      // Apollo applied the US / size filters itself; this row's site says it is a software shop.
      apPerson("ap-2", "Drew", "CEO", { name: "Patel Software", primary_domain: "patelsoftware.example" }),
      apPerson("ap-3", "Quinn", "Founder", { name: "Rivers Staffing", primary_domain: "riversstaffing.example" }),
    ] } }],
  });
  const sites: Record<string, string> = {
    "stonebridgefab.example": "Stonebridge Fabrication — precision metal manufacturing and CNC machining.",
    "patelsoftware.example": "Patel Software builds scheduling apps for clinics.",
    "riversstaffing.example": "Rivers Staffing is a staffing agency placing industrial workers.",
  };
  const invoke: ActorInvoker = async (_actor, input) => {
    const url = ((input.startUrls as { url: string }[] | undefined)?.[0]?.url ?? "").replace("https://", "");
    return { items: sites[url] ? [{ text: sites[url] }] : [], runId: `run-${url}` };
  };
  const ledger = memoryLedger();
  const run = await runDiscovery({
    workspaceId: WS, missionId: "demo-mission", requirements: req, plan, approval, ledger, now: FIXED_NOW,
    adapters: {
      leadocean: leadOceanAdapter({ apiKey: "offline-demo-key", fetch: f.fetch, sleep: noSleep, now: FIXED_NOW }),
      apollo: apolloAdapter({ apiKey: "offline-demo-key", fetch: f.fetch, sleep: noSleep, now: FIXED_NOW }),
    },
    verifier: apifyAdapter(invoke, { idempotencyPrefix: "demo-mission", now: FIXED_NOW }),
  });
  log(`SEARCH    ${f.calls.map((c) => `${c.method} ${new URL(c.url).host}${new URL(c.url).pathname}`).join(", ") || "(none)"}  [mocked]`);
  for (const s of run.steps) log(`  ${s.provider.padEnd(9)} ${s.status} pages=${s.pages} rows=${s.rows} credits=${s.credits}${s.reason ? ` — ${s.reason}` : ""}`);
  if (run.verification) log(`  verify   ${run.verification.provider} checked=${run.verification.checked}`);
  log(`RESULT    ${run.status}: qualified=${run.counts.qualified} needs-verification=${run.counts.needsVerification} rejected=${run.counts.rejected}  merged ${run.merge?.companiesMerged ?? 0} duplicate(s)`);
  for (const l of run.leads) {
    const contact = l.contacts.find((c) => c.status === "qualified")?.person;
    const who = contact ? `${contact.fullName[0]?.value ?? contact.firstName[0]?.value} (${contact.title[0]?.value})` : "—";
    const why = l.status === "qualified" ? (l.verification ?? "") : l.reasons[0] ?? "";
    log(`  ${l.status.padEnd(18)} ${String(l.company.name[0]?.value).padEnd(24)} via ${[...new Set(l.company.sources.map((s) => s.provider))].join("+").padEnd(17)} ${who.padEnd(34)} ${why}`);
  }
  const rows = run.leads.map((l) => projectLead(l, { workspaceId: WS, missionId: "demo-mission", run })).filter((r) => r !== null);
  log(`LEADS     ${rows.length} account row(s) for the Leads dashboard (rejected leads not written; no contact values stored)`);
  return { compiled, req, plan, run, rows, calls: f.calls };
}

if (import.meta.main) {
  const sel = Deno.args[0] ? (Deno.args[0] === "auto" ? "auto" : Deno.args[0].split(",")) as Selection : "auto";
  await runOfflineDemo(sel, console.log);
}
