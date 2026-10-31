// The standard discovery architecture, offline, on ten synthetic companies:
//
//   LeadOcean discovers → Agentory dedupes and screens → Apify verifies identity,
//   HQ and size → the shared engine decides → optional signals for eligible,
//   unblocked leads only → ATLAS rows (accounts / contacts / lead_candidates).
//
// No network: globalThis.fetch throws; every provider is a mock that records its
// calls. No row is written: projection is pure and the test only inspects it.
// Synthetic companies and people only.

import { assert, assertEquals, assertFalse } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { leadOceanAdapter } from "../../../../supabase/functions/_shared/discoveryProviders/adapters/leadocean.ts";
import type { ActorInvoker } from "../../../../supabase/functions/_shared/discoveryProviders/adapters/apify.ts";
import { memoryLedger, type DiscoveryApproval } from "../../../../supabase/functions/_shared/discoveryProviders/budget.ts";
import { memoryCheckpointStore } from "../../../../supabase/functions/_shared/leadPipeline/checkpoint.ts";
import { ExclusionIndex } from "../../../../supabase/functions/_shared/leadPipeline/exclusions.ts";
import { configureIcp, ICP_A, type IcpConfig } from "../../../../supabase/functions/_shared/leadPipeline/icp.ts";
import { runLeadPipeline, type PipelineInput, type PipelineLead, type PipelineRun } from "../../../../supabase/functions/_shared/leadPipeline/pipeline.ts";
import { projectPipelineLead } from "../../../../supabase/functions/_shared/leadPipeline/projection.ts";
import { loPage, loPerson, mockFetch, noSleep, type Synthetic } from "../discoveryProviders/fixtures.ts";
import { companyRecord, CONNECTIONS, LIMITS, NOW, WS } from "./fixtures.ts";

const SW = "Software Development";
// Ten companies (eleven people rows: Echo appears twice).
const PEOPLE: Synthetic[] = [
  { id: "2001", name: "Alma Ash", title: "CEO", company: "Alpha", domain: "alpha.example", industry: SW, employees: 60, phone: "+1 512 555 2001" },
  // LeadOcean: 80 employees (in range). Apify's declared band: 201–500.
  { id: "2002", name: "Bea Birch", title: "CEO", company: "Bravo", domain: "bravo.example", industry: SW, employees: 80 },
  // Found by LeadOcean's US-HQ filter. Apify's HQ-flagged location: Toronto, Canada.
  { id: "2003", name: "Cal Cedar", title: "CEO", company: "Charlie", domain: "charlie.example", industry: SW, employees: 60 },
  // Apify has no record for it.
  { id: "2004", name: "Dee Dogwood", title: "CEO", company: "Delta", domain: "delta.example", industry: SW, employees: 60 },
  // Two people at one company: one company, one paid read.
  { id: "2005", name: "Eli Elm", title: "CEO", company: "Echo", domain: "echo.example", industry: SW, employees: 60 },
  { id: "2006", name: "Eve Elder", title: "Chief Revenue Officer", company: "Echo", domain: "echo.example", industry: SW, employees: 60 },
  { id: "2007", name: "Fay Fir", title: "Founder", company: "Foxtrot", domain: "foxtrot.example", industry: SW, employees: 45 },
  // An existing Lead under a do-not-contact hold.
  { id: "2008", name: "Gus Gum", title: "Founder", company: "Golf", domain: "golf.example", industry: SW, employees: 30, phone: "+1 512 555 2008" },
  // LeadOcean itself says 900 employees: an obvious mismatch, screened before any Apify spend.
  { id: "2009", name: "Hal Hazel", title: "CEO", company: "Hotel", domain: "hotel.example", industry: SW, employees: 900 },
  // No LinkedIn company URL: nothing to verify it by.
  { id: "2010", name: "Ivy Ilex", title: "CEO", company: "India", domain: "india.example", industry: SW, employees: 60 },
  // Eligible, and the signal actors find nothing for it.
  { id: "2011", name: "Jo Juniper", title: "CEO", company: "Juliet", domain: "juliet.example", industry: SW, employees: 60 },
];

const rec = (slug: string, hqCountry: string, band: [number, number], city = "Austin") =>
  companyRecord(slug, { name: slug[0].toUpperCase() + slug.slice(1), website: `https://${slug}.example`, hqCountry, city, band });
const RECORDS: Record<string, unknown> = {
  alpha: rec("alpha", "US", [51, 200]), bravo: rec("bravo", "US", [201, 500]), charlie: rec("charlie", "CA", [51, 200], "Toronto"),
  echo: rec("echo", "US", [51, 200]), foxtrot: rec("foxtrot", "US", [11, 50]), golf: rec("golf", "US", [11, 50]),
  hotel: rec("hotel", "US", [51, 200]), kilo: rec("kilo", "US", [51, 200]), india: rec("india", "US", [51, 200]), juliet: rec("juliet", "US", [51, 200]),
};

type Call = { actor: string; input: Record<string, unknown>; key: string };
function apify(mode: "ok" | "fail" = "ok") {
  const calls: Call[] = [];
  const invoke: ActorInvoker = (actor, input, o) => {
    calls.push({ actor, input, key: o.idempotencyKey });
    if (mode === "fail") return Promise.reject(new Error("actor run failed"));
    if (actor === "apify_linkedin_company_details") {
      const items = (input.companies as string[]).map((u) => RECORDS[/company\/([^/]+)/.exec(u)![1]]).filter(Boolean);
      return Promise.resolve({ items, runId: "run-company", chargedUsd: 0.00005 + 0.004 * items.length });
    }
    if (actor === "apify_linkedin_job_search" && JSON.stringify(input).includes("alpha")) {
      return Promise.resolve({ items: [{ id: "j1", linkedinUrl: "https://www.linkedin.com/jobs/view/j1", title: "Account Executive", postedDate: "2026-10-25", company: { name: "Alpha", linkedinUrl: "https://www.linkedin.com/company/alpha" }, location: { linkedinText: "Austin, TX" } }], runId: "run-jobs", chargedUsd: 0.002 });
    }
    return Promise.resolve({ items: [], runId: `run-${actor}`, chargedUsd: 0.001 });
  };
  return { invoke, calls };
}

function leadOcean(people: Synthetic[], opts: { status?: number; dropLinkedin?: string[]; linkedinOf?: Record<string, string> } = {}) {
  const rows = people.map((p) => {
    const r = loPerson(p);
    const exp = r.contact_data.contact_current_experiences[0] as Record<string, unknown>;
    if (opts.dropLinkedin?.includes(p.domain)) exp.company_social_links = {};
    if (opts.linkedinOf?.[p.id]) exp.company_social_links = { linkedin: { url: opts.linkedinOf[p.id] } };
    return r;
  });
  const f = mockFetch({ "POST /v1/search": [opts.status ? { status: opts.status, body: { error: { message: "upstream failure" } } } : { body: loPage(rows) }] });
  const deps = { apiKey: "offline-test-key", fetch: f.fetch, sleep: noSleep, now: NOW };
  return { adapter: leadOceanAdapter(deps), deps, calls: f.calls };
}

const SIGNALS = { collect: { companyPosts: true, jobs: true }, maxPostsPerSubject: 3, maxJobsPerCompany: 5, windowDays: 30, maxUsd: 0.05 };
const HOLD = new ExclusionIndex([{ leadId: "lead-golf-1", kind: "account", companyDomain: "golf.example", hold: { reason: "do_not_contact" } }], NOW);

async function run(o: { icp?: IcpConfig; people?: Synthetic[]; lo?: Parameters<typeof leadOcean>[1]; apifyMode?: "ok" | "fail"; canonicalMaxUsd?: number; signals?: typeof SIGNALS | null } = {}) {
  const lo = leadOcean(o.people ?? PEOPLE, o.lo ?? { dropLinkedin: ["india.example"] });
  const ap = apify(o.apifyMode);
  const icp = o.icp ?? configureIcp(ICP_A, { requestedCount: 10 });
  const base: PipelineInput = {
    workspaceId: WS, walkId: "walk-10", icp, connections: CONNECTIONS, limits: LIMITS,
    approvals: { discovery: null, canonicalMaxUsd: null, signals: null, phoneLookups: null },
    leadocean: lo.adapter, leadoceanDeps: lo.deps, apify: ap.invoke, ledger: memoryLedger(), checkpoints: memoryCheckpointStore(), existing: HOLD, now: NOW,
  };
  const dry = await runLeadPipeline({ ...base, dryRun: true });
  const approval: DiscoveryApproval = { kind: "discovery", workspaceId: WS, missionId: "lp:walk-10:r0", planHash: dry.plan.planHash,
    maxCredits: { ...dry.plan.estimatedCredits }, approvedBy: "test-owner", approvedAt: NOW().toISOString() };
  const realFetch = globalThis.fetch;
  globalThis.fetch = () => { throw new Error("no network in offline tests"); };
  try {
    const r = await runLeadPipeline({ ...base, approvals: { discovery: approval, canonicalMaxUsd: o.canonicalMaxUsd ?? 0.05, signals: o.signals === undefined ? SIGNALS : o.signals, phoneLookups: null } });
    return { r, lo, ap, dry };
  } finally { globalThis.fetch = realFetch; }
}

const all = (r: PipelineRun) => [...r.queue, ...r.review, ...r.excluded];
const byDomain = (r: PipelineRun) => Object.fromEntries(all(r).map((l) => [l.company.domain, l])) as Record<string, PipelineLead>;
const slugsBought = (calls: Call[]) => calls.filter((c) => c.actor === "apify_linkedin_company_details").flatMap((c) => (c.input.companies as string[]).map((u) => /company\/([^/]+)/.exec(u)![1]));
const signalTargets = (calls: Call[]) => [...new Set(calls.filter((c) => c.actor !== "apify_linkedin_company_details").map((c) => /company\/([a-z]+)/.exec(JSON.stringify(c.input))?.[1]))].sort();

Deno.test("architecture: ten LeadOcean companies → Apify verification → shared engine → ATLAS rows", async () => {
  const { r, lo, ap } = await run();
  assertEquals(r.status, "completed");
  assertEquals(lo.calls.length, 1, "one LeadOcean page");
  const by = byDomain(r);
  assertEquals(all(r).length, 10, "eleven people rows, ten companies");

  // Final eligibility is the shared engine's, on Apify's company record.
  const q = (d: string) => by[d].statuses.qualification;
  assertEquals(["alpha", "echo", "foxtrot", "golf", "juliet"].map((d) => q(`${d}.example`)), ["eligible", "eligible", "eligible", "eligible", "eligible"]);
  assertEquals(q("bravo.example"), "ineligible", "LeadOcean's 80 employees does not survive Apify's 201–500 band");
  assertEquals(by["bravo.example"].qualification!.disproven.length, 1);
  assert(by["bravo.example"].qualification!.disproven[0].startsWith("company_size"));
  assertEquals(q("charlie.example"), "ineligible", "LeadOcean's US-HQ filter does not survive a Canadian HQ-flagged record");
  assert(by["charlie.example"].qualification!.disproven[0].startsWith("geography"));
  assertEquals([q("delta.example"), by["delta.example"].canonicalRecord], ["pending", "not_found"], "no company evidence: pending, never a pass or a fail");
  assertEquals([q("india.example"), by["india.example"].canonicalRecord], ["pending", "no_linkedin"], "LeadOcean-only evidence cannot qualify");
  assertEquals(by["india.example"].qualification!.gaps.sort(), ["company_size_band", "geography"]);

  // Screening: an obvious mismatch in LeadOcean's own row gets no paid verification, and is not called "pending review".
  assertEquals([by["hotel.example"].statuses.screening, q("hotel.example"), by["hotel.example"].rank.lane], ["screened_out", "pending", "excluded"]);
  assert(by["hotel.example"].screeningReasons[0].includes("provider-reported, unverified"));
  assertEquals(r.funnel.screenedOut, 1);
  assertEquals(r.funnel.pending, 2, "delta and india; the screened row is not counted as awaiting verification");

  // Apify: one batched company read; duplicates, the screened row and the URL-less row are not bought.
  const bought = slugsBought(ap.calls);
  assertEquals(bought.sort(), ["alpha", "bravo", "charlie", "delta", "echo", "foxtrot", "golf", "juliet"]);
  assertEquals(ap.calls.filter((c) => c.actor === "apify_linkedin_company_details").length, 1);

  // Signals: eligible AND not held. Rejected, pending, screened and held companies get none.
  assertEquals(signalTargets(ap.calls), ["alpha", "echo", "foxtrot", "juliet"]);
  assertEquals(r.signals!.skipped.map((s) => s.companyKey).length, 1);
  assert(r.signals!.skipped[0].reason.startsWith("outreach_blocked"));

  // Signals are optional: Juliet has none and is still eligible and queued.
  assertEquals([by["juliet.example"].signals.length, by["juliet.example"].rank.lane], [0, "queue"]);
  assert(by["alpha.example"].signals.length > 0, "Alpha's dated posting is collected");

  // History and holds: Golf keeps its Lead ID and stays blocked.
  assertEquals([by["golf.example"].existingLeadIds, by["golf.example"].statuses.discovery, by["golf.example"].statuses.outreachReadiness], [["lead-golf-1"], "existing", "blocked"]);

  // ATLAS: eligible → qualified; pending → new (needs verification); rejected and screened → no row.
  const rows = all(r).map((l) => ({ d: l.company.domain, row: projectPipelineLead(l, { workspaceId: WS, values: r.contactValues }) }));
  const status = Object.fromEntries(rows.map((x) => [x.d, x.row ? x.row.lead_candidate.status : null]));
  assertEquals(status, {
    "alpha.example": "qualified", "echo.example": "qualified", "foxtrot.example": "qualified", "golf.example": "qualified", "juliet.example": "qualified",
    "delta.example": "new", "india.example": "new", "bravo.example": null, "charlie.example": null, "hotel.example": null,
  });
  const golf = rows.find((x) => x.d === "golf.example")!.row!;
  assertEquals(golf.existingLeadId, "lead-golf-1", "an existing Lead is updated, never re-created");
  for (const x of rows) if (x.row) {
    assertEquals(x.row.lead_candidate.next_action, null, "no phone was approved, so nothing is ready for outreach");
    assertEquals(x.row.contact?.phone ?? null, null);
    assertEquals(x.row.contact?.email ?? null, null);
  }
  // Every row records which provider found it and what decided it.
  const alpha = rows.find((x) => x.d === "alpha.example")!.row!;
  const attr = alpha.lead_candidate.raw.agentory_pipeline as { qualification: { evidence_sources: Record<string, number> }; statuses: { screening: string } };
  assert(Object.keys(attr.qualification.evidence_sources).some((k) => k.includes("apify_linkedin_company_details")));
  assert(Object.keys(attr.qualification.evidence_sources).some((k) => k.includes("leadocean_discovery")));
  assertEquals(attr.statuses.screening, "passed");

  // Spend is accounted, and inside the approval.
  assert(r.spend.apifyUsd > 0 && r.spend.apifyUsd <= 0.1);
  assertEquals(r.spend.leadoceanRecords, 11);
});

Deno.test("architecture: two records naming one LinkedIn company are bought once", async () => {
  const people: Synthetic[] = [
    { id: "3001", name: "Kit Kauri", title: "CEO", company: "Kilo", domain: "kilo.example", industry: SW, employees: 60 },
    { id: "3002", name: "Lou Larch", title: "Chief Revenue Officer", company: "Kilo Inc", domain: "kilo-inc.example", industry: SW, employees: 60 },
  ];
  const { r, ap } = await run({ people, lo: { linkedinOf: { "3001": "https://www.linkedin.com/company/kilo", "3002": "https://www.linkedin.com/company/kilo" } }, signals: null });
  assertEquals(r.status, "completed");
  assertEquals(all(r).length, 2, "the domains disagree, so the records stay two companies (an identity conflict)");
  assertEquals(slugsBought(ap.calls), ["kilo"], "one URL, one item, one charge");
  assertFalse(all(r).some((l) => l.statuses.qualification === "eligible" && l.company.domain === "kilo-inc.example"),
    "the record names kilo.example: it lends no facts to kilo-inc.example");
});

Deno.test("architecture: an Apify failure leaves every company pending, counts the worst case, and retries nothing", async () => {
  const { r, ap } = await run({ apifyMode: "fail" });
  assertEquals(ap.calls.length, 1, "one company read attempted; no retry, no signals");
  assertEquals(r.canonical!.stopped, "charge_uncertain");
  assertEquals(r.status, "partial");
  const q = all(r).map((l) => l.statuses.qualification);
  assertFalse(q.includes("eligible"), "nothing qualifies on LeadOcean's word");
  assertFalse(q.includes("ineligible"), "nothing is rejected on missing evidence");
  assertEquals(r.queue.length, 0);
  assert(r.spend.apifyUsd > 0, "an uncertain charge is counted at its worst case");
});

Deno.test("architecture: a budget too small for the batch buys nothing and qualifies nothing", async () => {
  const { r, ap } = await run({ canonicalMaxUsd: 0.01 });
  assertEquals(ap.calls.length, 0);
  assertEquals(r.canonical!.stopped, "budget");
  assertEquals(r.queue.length, 0);
  assertEquals(r.spend.apifyUsd, 0);
  assert(all(r).filter((l) => l.statuses.screening === "passed" && l.canonicalRecord !== "no_linkedin").every((l) => l.canonicalRecord === "skipped_budget"));
});

Deno.test("architecture: contradictory requirements are refused before any provider is called", async () => {
  const { r, lo, ap, dry } = await run({ icp: configureIcp(ICP_A, { employees: { min: 500, max: 50 } }) });
  for (const x of [dry, r]) {
    assertEquals(x.status, "blocked");
    assert(x.reason!.startsWith("contradictory_requirements: at least 500 and at most 50 employees"), x.reason!);
  }
  assertEquals(lo.calls.length + ap.calls.length, 0);
});

Deno.test("architecture: a LeadOcean failure stops the walk before any Apify spend", async () => {
  const { r, ap } = await run({ lo: { status: 500 } });
  assertEquals(r.status, "blocked");
  assertEquals(ap.calls.length, 0);
  assertEquals(r.queue.length + r.review.length, 0);
});
