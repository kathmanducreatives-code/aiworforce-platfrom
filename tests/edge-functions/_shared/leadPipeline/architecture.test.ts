// The standard discovery architecture, pinned:
//   LeadOcean discovers → screen → Apify verifies → the shared engine decides →
//   optional founder check / signals → ATLAS review queue; phones are separate.

import { assert, assertEquals, assertFalse } from "https://deno.land/std@0.224.0/assert/mod.ts";
import type { ActorInvoker } from "../../../../supabase/functions/_shared/discoveryProviders/adapters/apify.ts";
import { memoryLedger, type DiscoveryApproval } from "../../../../supabase/functions/_shared/discoveryProviders/budget.ts";
import { readFlags } from "../../../../supabase/functions/_shared/discoveryProviders/flags.ts";
import { memoryCheckpointStore } from "../../../../supabase/functions/_shared/leadPipeline/checkpoint.ts";
import { ExclusionIndex } from "../../../../supabase/functions/_shared/leadPipeline/exclusions.ts";
import { enrichQueuedPhones, runLeadPipeline, type PipelineApprovals, type PipelineInput } from "../../../../supabase/functions/_shared/leadPipeline/pipeline.ts";
import { verificationBatch, type ScreenResult } from "../../../../supabase/functions/_shared/leadPipeline/screen.ts";
import { checkFounders } from "../../../../supabase/functions/_shared/leadPipeline/founderCheck.ts";
import { enrichPhones } from "../../../../supabase/functions/_shared/leadPipeline/phones.ts";
import { handleLeadPipeline, parsePipelineRequest, readPipelineFlags } from "../../../../supabase/functions/_shared/leadPipeline/service.ts";
import type { Synthetic } from "../discoveryProviders/fixtures.ts";
import { companyRecord, CONNECTIONS, ICP, leadOceanMock, LIMITS, NOW, WS } from "./fixtures.ts";

const P = (id: string, company: string, domain: string, o: Partial<Synthetic> = {}): Synthetic =>
  ({ id, name: `Person ${id}`, title: "Founder & CEO", company, domain, industry: "Software Development", employees: 60, phone: "+1 512 555 0" + id.slice(-3), ...o });

/** An Apify invoker over a fixed record set; records every call. */
function apify(records: Record<string, unknown>, opts: { posts?: "none" | "fail"; jobs?: "none" | "fail"; employees?: unknown[] } = {}) {
  const calls: { actor: string; input: Record<string, unknown> }[] = [];
  const invoke: ActorInvoker = (actor, input) => {
    calls.push({ actor, input });
    if (actor === "apify_linkedin_company_details") {
      const items = (input.companies as string[]).map((u) => records[/company\/([^/]+)/.exec(u)![1]]).filter(Boolean);
      return Promise.resolve({ items, chargedUsd: 0.00005 + 0.004 * items.length });
    }
    if (actor === "apify_linkedin_company_posts") return opts.posts === "fail" ? Promise.reject(new Error("posts down")) : Promise.resolve({ items: [], chargedUsd: 0.001 });
    if (actor === "apify_linkedin_job_search") return opts.jobs === "fail" ? Promise.reject(new Error("jobs down")) : Promise.resolve({ items: [], chargedUsd: 0.001 });
    if (actor === "apify_linkedin_company_employees") return Promise.resolve({ items: opts.employees ?? [], chargedUsd: 0.02 });
    return Promise.resolve({ items: [] });
  };
  return { invoke, calls, companyItems: () => calls.filter((c) => c.actor === "apify_linkedin_company_details").flatMap((c) => c.input.companies as string[]) };
}
const US = (slug: string, band: [number, number] = [51, 200]) => companyRecord(slug, { name: slug, website: `https://${slug}.example`, hqCountry: "US", city: "Austin", band });

async function run(people: Synthetic[], records: Record<string, unknown>, approvals: Partial<PipelineApprovals> = {}, over: Partial<PipelineInput> & { apifyOpts?: Parameters<typeof apify>[1] } = {}) {
  const lo = leadOceanMock(people);
  const ap = apify(records, over.apifyOpts);
  const base: PipelineInput = {
    workspaceId: WS, walkId: "arch", icp: ICP, connections: CONNECTIONS, limits: LIMITS,
    approvals: { discovery: null, canonicalMaxUsd: 0.05, signals: { collect: { companyPosts: true, jobs: true }, maxPostsPerSubject: 3, maxJobsPerCompany: 5, windowDays: 60, maxUsd: 0.1 }, phoneLookups: { maxLookups: 5, approvedBy: "t", approvedAt: "t" }, ...approvals },
    leadocean: lo.adapter, leadoceanDeps: lo.deps, apify: ap.invoke, ledger: memoryLedger(), checkpoints: memoryCheckpointStore(), existing: new ExclusionIndex([], NOW), now: NOW, ...over,
  };
  const dry = await runLeadPipeline({ ...base, dryRun: true });
  const discovery: DiscoveryApproval = { kind: "discovery", workspaceId: WS, missionId: "lp:arch:r0", planHash: dry.plan.planHash, maxCredits: { ...dry.plan.estimatedCredits }, approvedBy: "t", approvedAt: "t" };
  const input = { ...base, approvals: { ...base.approvals, discovery } };
  const r = await runLeadPipeline(input);
  const all = [...r.queue, ...r.review, ...r.excluded];
  return { r, ap, lo, input, by: Object.fromEntries(all.map((l) => [l.company.domain, l])) };
}

Deno.test("1 LeadOcean-only evidence cannot qualify a company (no Apify → needs verification)", async () => {
  const { r, by } = await run([P("101", "Alpha", "alpha.example")], {}, {}, { apify: null });
  assertEquals(r.queue.length, 0);
  assertEquals([by["alpha.example"].classification, by["alpha.example"].statuses.qualification], ["needs_verification", "pending"]);
  assertEquals(by["alpha.example"].company.hq.source, null, "a people row carries no HQ; nothing claims it was verified");
  // Even with company records off by approval: still pending.
  const off = await run([P("102", "Beta", "beta.example")], { beta: US("beta") }, { canonicalMaxUsd: null });
  assertEquals(off.by["beta.example"].classification, "needs_verification");
  assertEquals(off.ap.calls.length, 0);
});

Deno.test("2 a wrong LeadOcean HQ is caught by the Apify record (rejected, verified basis)", async () => {
  const ca = companyRecord("north", { name: "North", website: "https://north.example", hqCountry: "CA", city: "Toronto", band: [51, 200] });
  const { by } = await run([P("103", "North", "north.example")], { north: ca });
  assertEquals([by["north.example"].classification, by["north.example"].rejectionBasis], ["rejected", "verified"]);
  assertEquals(by["north.example"].company.hq.source, "apify_linkedin_company_details");
});

Deno.test("3 a wrong LeadOcean headcount cannot silently pass (provider 60, Apify 1001–5000 → rejected)", async () => {
  const { by } = await run([P("104", "Big", "big.example", { employees: 60 })], { big: US("big", [1001, 5000]) });
  assertEquals([by["big.example"].classification, by["big.example"].rejectionBasis], ["rejected", "verified"]);
});

Deno.test("4 missing verification leaves a candidate pending: no record returned, or over the budget", async () => {
  const missing = await run([P("105", "Ghost", "ghost.example")], {});
  assertEquals([missing.by["ghost.example"].classification, missing.by["ghost.example"].canonicalRecord], ["needs_verification", "not_found"]);
  const budget = await run([P("106", "One", "one.example"), P("107", "Two", "two.example")], { one: US("one"), two: US("two") }, { canonicalMaxUsd: 0.0045 });
  assertEquals(budget.ap.companyItems().length, 1, "only what fits the ceiling is bought");
  assertEquals(budget.r.canonical?.overBudget, 1);
  assert(Object.values(budget.by).some((l) => l.classification === "needs_verification" && l.canonicalRecord === "skipped_budget"));
});

Deno.test("5 rejected companies trigger no further spend: screened rows get no company record; ineligible ones no signals, founder check or phone", async () => {
  const people = [
    P("108", "Okco", "okco.example"),
    P("109", "Engco", "engco.example", { title: "Software Engineer" }),           // screened: not a decision-maker
    P("110", "Hugeco", "hugeco.example", { employees: 5000 }),                     // screened: headcount far out (provider claim)
    P("111", "Canco", "canco.example"),                                            // verified-rejected: non-US HQ
  ];
  const ca = companyRecord("canco", { name: "Canco", website: "https://canco.example", hqCountry: "CA", city: "Toronto", band: [51, 200] });
  const { r, ap, by, input } = await run(people, { okco: US("okco"), engco: US("engco"), hugeco: US("hugeco"), canco: ca }, { founderCheck: { maxUsd: 0.05, perCompany: 2 } });
  assertEquals(ap.companyItems().map((u) => u.split("/").pop()).sort(), ["canco", "okco"], "screened rows are never verified");
  assertEquals([by["engco.example"].rejectionBasis, by["hugeco.example"].rejectionBasis, by["canco.example"].rejectionBasis], ["screened", "screened", "verified"]);
  const nonVerify = ap.calls.filter((c) => c.actor !== "apify_linkedin_company_details");
  assert(nonVerify.length > 0);
  assertFalse(nonVerify.some((c) => /canco|engco|hugeco/.test(JSON.stringify(c.input))), "signals and founder check: eligible only");
  let lookups = 0;
  await enrichQueuedPhones(r, { workspaceId: WS, approval: { maxLookups: 5, approvedBy: "t", approvedAt: "t" }, deps: input.leadoceanDeps!, ledger: input.ledger,
    call: (_d, i) => { lookups++; assertEquals(i.personId, "108"); return Promise.resolve({ found: false, points: [], credits: 1, recordId: "108" }); } });
  assertEquals(lookups, 1, "phones only for the queued (eligible) person");
});

Deno.test("6 duplicate candidates do not generate duplicate paid calls (same LinkedIn company; re-run replays)", async () => {
  // Two domains, one LinkedIn company (fixtures derive the company URL from the domain's first label).
  const people = [P("112", "Dup Co", "dupco.example"), P("113", "Dup Co", "dupco.io", { name: "Second Person" })];
  const { r, ap, input } = await run(people, { dupco: US("dupco") });
  assertEquals(ap.companyItems(), ["https://www.linkedin.com/company/dupco"]);
  assertEquals(r.screening.duplicate, 1);
  // The same run again (same mission, same ledger): every paid call replays, none is re-sent.
  const before = ap.calls.length;
  await runLeadPipeline({ ...input, checkpoints: memoryCheckpointStore() });
  assertEquals(ap.calls.length, before, "the durable ledger replays settled Apify runs");
});

Deno.test("7 missing or failing posts / hiring signals do not block a valid qualification", async () => {
  const none = await run([P("114", "Quiet", "quiet.example")], { quiet: US("quiet") }, {}, { apifyOpts: { posts: "none", jobs: "none" } });
  assertEquals(none.by["quiet.example"].classification, "eligible");
  const down = await run([P("115", "Down", "down.example")], { down: US("down") }, {}, { apifyOpts: { posts: "fail", jobs: "fail" } });
  assertEquals(down.by["down.example"].classification, "eligible");
  assertEquals(down.r.status, "partial");
  assert(down.by["down.example"].rank.factors.every((f) => f.points >= 0));
});

Deno.test("8 a phone is never independently verified founder-direct without number evidence — even with a confirmed founder", async () => {
  const employees = [{ firstName: "Person", lastName: "116", currentPositions: [{ title: "Co-Founder & CEO", companyLinkedinUrl: "https://www.linkedin.com/company/conf", current: true }] }];
  const { r, by, input } = await run([P("116", "Conf", "conf.example")], { conf: US("conf") }, { founderCheck: { maxUsd: 0.05, perCompany: 2 } }, { apifyOpts: { employees } });
  assertEquals(by["conf.example"].founderCheck?.state, "confirmed");
  const ph = await enrichQueuedPhones(r, { workspaceId: WS, approval: { maxLookups: 1, approvedBy: "t", approvedAt: "t" }, deps: input.leadoceanDeps!, ledger: input.ledger,
    call: () => Promise.resolve({ found: true, points: [{ kind: "phone", value: "+1 512 555 0116", type: "mobile", provider: "leadocean", recordId: "116", verification: "provider_supplied_unverified", retrievedAt: "t" }], credits: 1, recordId: "116" }) });
  assertEquals([ph.records[0].employment.status, ph.records[0].class], ["independent_current", "unverified_person_associated"]);
});

Deno.test("9 every provider call respects workspace permissions and budgets", async () => {
  // Workspace: the service refuses outsiders, non-admin runs and non-allowlisted workspaces before any call.
  const env: Record<string, string> = { LEAD_PIPELINE_ENABLED: "true", LEAD_PIPELINE_WORKSPACES: WS, PROVIDER_DISCOVERY_ENABLED: "true", PROVIDER_LEADOCEAN_ENABLED: "true", LEADOCEAN_COMMERCIAL_TERMS_CONFIRMED: "true" };
  let calls = 0;
  const deps = (userId: string, e = env) => ({
    userId, flags: readPipelineFlags((k) => e[k]), discoveryFlags: readFlags((k) => e[k]),
    store: { memberRole: (u: string, w: string) => Promise.resolve(w === WS && u === "owner" ? "owner" : w === WS && u === "member" ? "member" : null), list: () => Promise.resolve([{ provider: "leadocean", status: "connected" }]), secret: () => { calls++; return Promise.resolve("k"); } } as never,
    ledger: memoryLedger(), checkpoints: memoryCheckpointStore(), loadExisting: () => Promise.resolve([]),
    leadoceanFor: () => { calls++; return leadOceanMock([]) as never; }, apify: (() => { calls++; return Promise.resolve({ items: [] }); }) as ActorInvoker,
    persist: () => Promise.resolve(), now: NOW,
  });
  const req = (a: Record<string, unknown>) => parsePipelineRequest({ workspace_id: WS, icp: "icp_a_b2b_saas", walk_id: "w", ...a })!;
  assertEquals((await handleLeadPipeline(req({ action: "run", approval: { plan_hash: "x", leadocean_records: 15 } }), deps("stranger"))).status, 403);
  assertEquals((await handleLeadPipeline(req({ action: "run", approval: { plan_hash: "x", leadocean_records: 15 } }), deps("member"))).status, 403);
  assertEquals((await handleLeadPipeline(req({ action: "plan" }), deps("owner", { ...env, LEAD_PIPELINE_WORKSPACES: "other" }))).status, 403);
  assertEquals(calls, 0, "refused before any provider call");
  // Budgets: the Apify ledger cap and the enrichment authorization's workspace.
  const capped = await run([P("117", "Cap", "cap.example")], { cap: US("cap") }, { canonicalMaxUsd: 0.001, signals: null });
  assertEquals(capped.ap.calls.length, 0, "a company-record run whose worst case exceeds the ceiling is never started");
  const foreign = await enrichPhones({ workspaceId: WS, missionId: "m", authorization: { kind: "enrichment", workspaceId: "other-ws", missionId: "m", personKeys: ["p"], revealEmail: false, phones: true, maxCredits: 1, approvedBy: "t", approvedAt: "t" },
    targets: [], deps: { apiKey: "k", fetch: () => { throw new Error("no"); } } as never, ledger: memoryLedger() });
  assertEquals(foreign.stopped, "authorization_scope");
});

Deno.test("Apify values must pass evidence authority: a record without an HQ flag does not prove HQ", async () => {
  const noFlag = { ...US("noflag"), locations: [{ city: "Austin", country: "US", parsed: { text: "Austin, United States", countryFull: "United States" } }] };
  const { by } = await run([P("118", "Noflag", "noflag.example")], { noflag: noFlag });
  assertEquals(by["noflag.example"].classification, "needs_verification");
  assert(by["noflag.example"].qualification!.gaps.includes("geography" as never));
});

Deno.test("verification budget follows the provider's funding priority (a claim used for ordering only)", () => {
  const s = (k: string, priority: number): ScreenResult => ({ companyKey: k, outcome: "verify", slug: k, reasons: [], priority });
  const { buy, overBudget } = verificationBatch([s("old", 0), s("recent", 4), s("mid", 2)], 0.00805, 0.00005, 0.004);
  assertEquals(buy.map((x) => x.companyKey), ["recent", "mid"]);
  assertEquals(overBudget.map((x) => x.companyKey), ["old"]);
});

Deno.test("founder check: name + current company slug; fuzzy titles re-classified; another decision-maker is not a confirmation", async () => {
  const items = [
    { firstName: "Ann", lastName: "Lee", currentPositions: [{ title: "Founder", companyLinkedinUrl: "https://www.linkedin.com/company/alpha-co", current: true }] },
    { firstName: "Bo", lastName: "Kim", currentPositions: [{ title: "Seed Investor", companyLinkedinUrl: "https://www.linkedin.com/company/bravo-co", current: true }] },
    { firstName: "Cy", lastName: "Ray", currentPositions: [{ title: "CEO", companyLinkedinUrl: "https://www.linkedin.com/company/charlie-co", current: true }] },
  ];
  const r = await checkFounders([
    { companyKey: "a", companyLinkedinUrl: "https://www.linkedin.com/company/alpha-co", personName: "Ann Lee" },
    { companyKey: "b", companyLinkedinUrl: "https://www.linkedin.com/company/bravo-co", personName: "Bo Kim" },
    { companyKey: "c", companyLinkedinUrl: "https://www.linkedin.com/company/charlie-co", personName: "Someone Else" },
  ], () => Promise.resolve({ items, chargedUsd: 0.029 }), { maxUsd: 0.05, perCompany: 3, jobTitles: ["Founder", "CEO"], idPrefix: "t" });
  assertEquals([r.checks.get("a")!.state, r.checks.get("b")!.state, r.checks.get("c")!.state], ["confirmed", "not_found", "other_decision_maker"]);
  const over = await checkFounders([{ companyKey: "a", companyLinkedinUrl: "https://www.linkedin.com/company/alpha-co", personName: "Ann Lee" }], () => { throw new Error("must not run"); }, { maxUsd: 0.01, perCompany: 3, jobTitles: [], idPrefix: "t" });
  assertEquals([over.stopped, over.checks.get("a")!.state], ["budget", "unavailable"]);
});
