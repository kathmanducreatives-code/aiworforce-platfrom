// The multi-provider discovery engine, offline. No network: LeadOcean is a mocked
// fetch, Apify a mocked actor invoker, GPT a fixture model.

import { assert, assertEquals, assertFalse } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { interpretQuery, validateSpec, type DiscoverySpec } from "../../../../supabase/functions/_shared/discoveryEngine/spec.ts";
import { planExecution, type PlannerContext } from "../../../../supabase/functions/_shared/discoveryEngine/planner.ts";
import { executeDiscovery, type EngineApproval } from "../../../../supabase/functions/_shared/discoveryEngine/engine.ts";
import { apolloSource } from "../../../../supabase/functions/_shared/discoveryEngine/sources/apollo.ts";
import { SOURCE_REGISTRY } from "../../../../supabase/functions/_shared/discoveryEngine/sources.ts";
import { memoryEvidenceCache } from "../../../../supabase/functions/_shared/discoveryEngine/cache.ts";
import { memoryLedger } from "../../../../supabase/functions/_shared/discoveryProviders/budget.ts";
import { ALL_ON, apifyMock, CA_RECORD, employeeRow, fixtureModel, founder, jobRow, loReply, NOW, postRow, US_RECORD, world, WS, WS_OTHER, type ApifyScript } from "./fixtures.ts";
import type { MockReply } from "../discoveryProviders/fixtures.ts";

const Q = {
  structured: "Find 10 founders of US SaaS companies with 10-100 employees.",
  hiring: "Find US companies hiring Account Executives in the past 30 days.",
  combined: "Find US SaaS founders at companies hiring salespeople.",
  posts: "Find US marketing agencies posting about AI automation.",
  funded: "Find founders at recently funded US companies with 10-200 employees.",
};

async function spec(q: string, mutate: (s: DiscoverySpec) => void = () => {}): Promise<DiscoverySpec> {
  const r = await interpretQuery(q, fixtureModel);
  assert(r.spec, r.error ?? "no spec");
  mutate(r.spec!);
  return r.spec!;
}
const approve = (planHash: string, caps = { leadoceanRecords: 100, apifyUsd: 2 }, workspaceId = WS): EngineApproval => ({ workspaceId, planHash, caps, approvedBy: "owner", approvedAt: NOW().toISOString() });

async function run(q: string, lo: MockReply[], ap: ApifyScript, o: { ctx?: PlannerContext; mutate?: (s: DiscoverySpec) => void; caps?: { leadoceanRecords: number; apifyUsd: number }; w?: ReturnType<typeof world>; runId?: string; workspaceId?: string; timeoutMs?: number } = {}) {
  const s = await spec(q, o.mutate);
  const plan = planExecution(s, o.ctx ?? ALL_ON());
  const w = o.w ?? world(lo, ap);
  const r = await executeDiscovery({ workspaceId: o.workspaceId ?? WS, runId: o.runId ?? "run-1", spec: s, plan, approval: approve(plan.planHash, o.caps, o.workspaceId ?? WS),
    sources: w.sources, apify: w.a.invoke, ledger: w.ledger, cache: w.cache, existing: w.existing, now: NOW, stepTimeoutMs: o.timeoutMs ?? 2000 });
  const all = [...r.queue, ...r.review, ...r.rejected];
  return { s, plan, r, w, by: Object.fromEntries(all.map((x) => [x.company.linkedinUrl?.split("/").pop() ?? x.key, x])) };
}

// ── the interpreter: intent preserved, no invented gates ────────────────────
Deno.test("spec: hard constraints must quote the request; invented ones become preferences", () => {
  const r = validateSpec({ target: "people", quantity: 500, roles: ["Founder"], company: { employees: { min: 10, max: 100 } }, geography: { hq: ["United States"] },
    hard: ["geography_hq", "employee_range", "industry"], grounding: { geography_hq: "US", employee_range: "10-100 employees", industry: "fintech" } }, Q.structured);
  assertEquals(r.spec!.hard, ["geography_hq", "employee_range"]);
  assert(r.spec!.preferences.includes("industry"));
  assert(r.repairs.some((x) => x.includes("industry") && x.includes("not grounded")));
  assertEquals(r.spec!.quantity, 100);
  assertEquals(r.spec!.contact.phone, "none");
});
Deno.test("spec: a required signal without grounding is only preferred", () => {
  const r = validateSpec({ target: "companies", signals: [{ kind: "hiring", roles: ["AE"], withinDays: 30, required: true }], hard: [], grounding: {} }, "Find US companies.");
  assertEquals(r.spec!.signals[0].required, false);
});

// ── planner decision rules ──────────────────────────────────────────────────
Deno.test("5 a structured founder search selects LeadOcean for discovery, Apify only to verify", async () => {
  const p = planExecution(await spec(Q.structured), ALL_ON());
  assertEquals(p.steps.map((s) => [s.provider, s.capability]), [["leadocean", "people_by_firmographics"], ["apify", "company_record"]]);
  assertEquals(p.strategy, "apify+leadocean");
  assert(p.notSelected.some((n) => n.provider === "apollo"));
});
Deno.test("4 a hiring-focused query selects Apify alone (job discovery + verification)", async () => {
  const p = planExecution(await spec(Q.hiring), ALL_ON());
  assertEquals(p.steps.map((s) => [s.provider, s.capability]), [["apify", "companies_by_hiring"], ["apify", "company_record"]]);
  assertEquals(p.strategy, "apify");
  assert(p.notSelected.find((n) => n.provider === "leadocean")!.why.includes("not needed"));
});
Deno.test("6 a signal-plus-founder query selects both: Apify finds hiring companies, LeadOcean their founders, Apify verifies", async () => {
  const p = planExecution(await spec(Q.combined), ALL_ON());
  assertEquals(p.steps.map((s) => [s.provider, s.capability, s.dependsOn]), [["apify", "companies_by_hiring", null], ["leadocean", "people_at_companies", "s1"], ["apify", "company_record", "s2"]]);
  assert(p.explanation.some((e) => e.includes("job postings")));
});
Deno.test("posts query: Apify post search; only company-authored posts name a company", async () => {
  const p = planExecution(await spec(Q.posts), ALL_ON());
  assertEquals(p.steps[0].capability, "companies_by_posts");
  assert(p.limitations.some((l) => l.includes("headline is not employment")));
});

// ── execution ───────────────────────────────────────────────────────────────
Deno.test("1 LeadOcean-only discovery (user names LeadOcean): runs, never calls Apify, HQ stays unverified", async () => {
  const { plan, r, w } = await run(Q.structured, [loReply([founder("201", "alphasoft"), founder("202", "betasoft")])], {}, { mutate: (s) => { s.providers.requested = ["leadocean"]; } });
  assertEquals(plan.strategy, "leadocean");
  assertEquals(plan.status, "partial_capability");
  assert(plan.uncertain.some((u) => u.includes("cannot be verified")));
  assertEquals(w.a.calls.length, 0);
  assertEquals(r.queue.length, 0, "LeadOcean claims alone never qualify");
  assertEquals(r.review.length, 2);
});

Deno.test("2 Apify-only discovery: hiring companies found, verified and qualified without LeadOcean", async () => {
  const { plan, r, w, by } = await run(Q.hiring, [], { jobs: [jobRow("acmesaas"), jobRow("orbitly", { posted: "2026-10-28" })], records: { acmesaas: US_RECORD("acmesaas"), orbitly: US_RECORD("orbitly") } });
  assertEquals(plan.strategy, "apify");
  assertEquals(w.l.calls.length, 0, "no LeadOcean call");
  assertEquals(r.queue.length, 2);
  assert(by.acmesaas.requestMatch.every((m) => m.met));
  assert(by.acmesaas.discoveredBy.includes("apify:companies_by_hiring"));
});

Deno.test("3 combined discovery: Apify hiring seeds → LeadOcean founders → Apify verification → eligible founders", async () => {
  const { r, w, by } = await run(Q.combined, [loReply([founder("301", "acmesaas"), founder("302", "orbitly")])],
    { jobs: [jobRow("acmesaas", { title: "Account Executive" }), jobRow("orbitly", { title: "SDR" })], records: { acmesaas: US_RECORD("acmesaas"), orbitly: US_RECORD("orbitly") } });
  const body = w.l.calls[0].body as Record<string, unknown>;
  assertEquals((body.companyLinkedin as string[]).sort(), ["https://www.linkedin.com/company/acmesaas", "https://www.linkedin.com/company/orbitly"], "LeadOcean scoped to the seeded companies");
  assertEquals(r.queue.length, 2);
  assertEquals(by.acmesaas.person?.title, "Founder & CEO");
  assertEquals(by.acmesaas.company.providers.sort(), ["apify", "leadocean"]);
  assertEquals(by.acmesaas.outreachReadiness, "ready_for_review");
});

Deno.test("7 unsupported capabilities: LeadOcean alone cannot satisfy a hiring requirement; Apify alone cannot search companies by firmographics", async () => {
  const p = planExecution(await spec(Q.hiring, (s) => { s.providers.requested = ["leadocean"]; }), ALL_ON());
  assertEquals(p.status, "partial_capability");
  assert(p.uncertain.some((u) => u.includes("discover by hiring")));
  const companies = await spec(Q.hiring, (s) => { s.signals = []; s.hard = ["geography_hq"]; });
  const q = planExecution(companies, ALL_ON({ leadocean: { enabled: false, permitted: true, reason: "LeadOcean disabled" } }));
  assertEquals(q.status, "blocked");
  assert(q.uncertain.some((u) => u.includes("structured companies search")));
});

Deno.test("8 provider disagreement is explicit: a provider's size and HQ claims contradicted by the verified record", async () => {
  // The job row (Apify) claims 51-200 and a US HQ; the company record says Canada.
  const { by } = await run(Q.hiring, [], { jobs: [jobRow("northco")], records: { northco: CA_RECORD("northco") } });
  const n = by.northco;
  assertEquals([n.classification, n.rejectionBasis], ["rejected", "verified"]);
  const hq = n.conflicts.find((c) => c.field === "hq_country")!;
  assert(hq.values.some((v) => v.status === "contradicted") && hq.values.some((v) => v.status === "verified"));
  assert(n.facts.some((f) => f.fact === "hq_country" && f.status === "contradicted"));
});

Deno.test("8b two providers disagree on headcount: kept as a conflict; the shared engine reads verified evidence only", async () => {
  const { by } = await run(Q.combined, [loReply([founder("303", "acmesaas", { employees: 4000 })])], { jobs: [jobRow("acmesaas")], records: { acmesaas: US_RECORD("acmesaas") } });
  const c = by.acmesaas;
  assert(c.conflicts.some((x) => x.field === "employees" || x.field === "employeeCount" || x.field === "employeeRange"));
});

Deno.test("9 missing evidence: no company record → needs_verification, with the unverified dimensions named", async () => {
  const { by, r } = await run(Q.hiring, [], { jobs: [jobRow("ghostco")], records: {} });
  assertEquals(by.ghostco.classification, "needs_verification");
  assertEquals(by.ghostco.verification.companyRecord, "not_found");
  assert(by.ghostco.reasons.some((x) => x.startsWith("unverified")));
  assertEquals(r.queue.length, 0);
});

Deno.test("10 deduplication across providers: one company from both providers → one canonical record, one paid verification item", async () => {
  const { w, by, r } = await run(Q.combined, [loReply([founder("304", "acmesaas")])], { jobs: [jobRow("acmesaas"), jobRow("acmesaas", { title: "SDR" })], records: { acmesaas: US_RECORD("acmesaas") } });
  const verify = w.a.actorCalls("apify_linkedin_company_details");
  assertEquals(verify.length, 1);
  assertEquals(verify[0].input.companies, ["https://www.linkedin.com/company/acmesaas"]);
  assertEquals((w.l.calls[0].body as { companyLinkedin: string[] }).companyLinkedin.length, 1, "seeds deduplicated before the paid people step");
  assertEquals([...r.queue, ...r.review, ...r.rejected].filter((x) => x.company.linkedinUrl?.endsWith("acmesaas")).length, 1);
  assertEquals(by.acmesaas.discoveredBy.sort(), ["apify:companies_by_hiring", "leadocean:people_at_companies"]);
});

Deno.test("11 partial budget exhaustion: never exceeds the cap; unverified remainder stays needs_verification", async () => {
  const jobs = ["one", "two", "three", "four"].map((s) => jobRow(s));
  const records = Object.fromEntries(["one", "two", "three", "four"].map((s) => [s, US_RECORD(s)]));
  const { r } = await run(Q.hiring, [], { jobs, records }, { caps: { leadoceanRecords: 0, apifyUsd: 0.018 } });
  assert(r.spend.apifyUsd <= 0.018 + 1e-9, `spent ${r.spend.apifyUsd}`);
  assertEquals(r.status, "partial");
  assert(r.budgetExhausted);
  assert(r.review.some((x) => x.verification.companyRecord === "skipped_budget"));
});

Deno.test("12 cached evidence is reused: a second request needs no new company-record purchase", async () => {
  const w = world([], { jobs: [jobRow("acmesaas")], records: { acmesaas: US_RECORD("acmesaas") } });
  const first = await run(Q.hiring, [], {}, { w, runId: "run-a" });
  assertEquals(first.r.cache, { hits: 0, purchased: 1 });
  const second = await run(Q.hiring, [], {}, { w, runId: "run-b" });
  assertEquals(second.r.cache, { hits: 1, purchased: 0 });
  assertEquals(w.a.actorCalls("apify_linkedin_company_details").length, 1);
  assertEquals(second.r.queue.length, 1);
});

Deno.test("13 no automatic phone enrichment, even when the user asks for phones", async () => {
  const { plan, r, w } = await run(Q.structured, [loReply([founder("205", "gammasoft")])], { records: { gammasoft: US_RECORD("gammasoft", [11, 50]) } }, { mutate: (s) => { s.contact.phone = "wanted"; } });
  assert(plan.limitations.some((l) => l.includes("phone numbers are a separate")));
  assertFalse(plan.steps.some((s) => s.capability === "phone_lookup"));
  assertFalse(w.l.calls.some((c) => c.url.includes("/phone")));
  assertEquals(r.phonesRequested, 0);
});

Deno.test("14 workspace isolation: another workspace's approval is refused; cached evidence never crosses workspaces", async () => {
  const s = await spec(Q.hiring);
  const plan = planExecution(s, ALL_ON());
  const w = world([], { jobs: [jobRow("acmesaas")], records: { acmesaas: US_RECORD("acmesaas") } });
  const refused = await executeDiscovery({ workspaceId: WS, runId: "x", spec: s, plan, approval: approve(plan.planHash, undefined, WS_OTHER), sources: w.sources, apify: w.a.invoke, ledger: w.ledger, cache: w.cache, existing: w.existing, now: NOW });
  assertEquals(refused.status, "blocked");
  assertEquals(w.a.calls.length, 0);
  await run(Q.hiring, [], {}, { w, runId: "ws-a" });
  const b = await run(Q.hiring, [], {}, { w, runId: "ws-b", workspaceId: WS_OTHER });
  assertEquals(b.r.cache.hits, 0, "workspace B buys its own evidence");
});

Deno.test("15 disabled or unpermitted providers are never selected, and say why", async () => {
  const p = planExecution(await spec(Q.structured), ALL_ON({ leadocean: { enabled: true, permitted: false, reason: "workspace not permitted to use LeadOcean" } }));
  assertEquals(p.steps[0].provider, "apify", "falls back to Apify people search");
  assert(p.notSelected.find((n) => n.provider === "leadocean")!.why.includes("not permitted"));
  const none = planExecution(await spec(Q.combined), ALL_ON({ apify: { enabled: false, permitted: true, reason: "Apify disabled" } }));
  assert(none.uncertain.some((u) => u.includes("discover by hiring")));
  assertFalse(none.steps.some((s) => s.provider === "apify"));
});

Deno.test("16 provider timeouts and partial failures: the step is marked, its worst case counted, the run continues", async () => {
  const { r } = await run(Q.combined, [loReply([founder("306", "acmesaas")])], { hang: ["apify_linkedin_job_search"] }, { timeoutMs: 50 });
  const s1 = r.steps.find((s) => s.id === "s1")!;
  assertEquals(s1.status, "timeout");
  assert(r.spend.apifyUsd > 0, "worst case counted");
  assertEquals(r.status, "partial");
  const failed = await run(Q.hiring, [], { jobs: [jobRow("acmesaas")], fail: ["apify_linkedin_company_details"] });
  assertEquals(failed.by.acmesaas.classification, "needs_verification");
  assertEquals(failed.r.status, "partial");
});

Deno.test("17 Apollo is registered but disabled: never planned; a request for Apollo alone is explained, not attempted", async () => {
  assertEquals(SOURCE_REGISTRY.apollo.status, "registered_disabled");
  assert(SOURCE_REGISTRY.apollo.offers.every((o) => o.status === "planned"));
  const p = planExecution(await spec(Q.structured, (s) => { s.providers.requested = ["apollo"]; }), ALL_ON({ apollo: { enabled: true, permitted: true } }));
  assertEquals(p.status, "blocked");
  assert(p.uncertain.some((u) => u.includes("Apollo was requested")));
  const res = await apolloSource(null).run({} as never);
  assertEquals(res.stopped, "provider_disabled");
});

Deno.test("18 repeated execution of the same approved run replays from the ledger: no duplicate charges", async () => {
  const w = world([loReply([founder("307", "acmesaas")])], { jobs: [jobRow("acmesaas")], records: { acmesaas: US_RECORD("acmesaas") } });
  const a = await run(Q.combined, [], {}, { w, runId: "same" });
  const calls = w.a.calls.length, lo = w.l.calls.length;
  w.cache.rows.clear(); // even without the cache, the ledger stops a second purchase
  const b = await run(Q.combined, [], {}, { w, runId: "same" });
  assertEquals([w.a.calls.length, w.l.calls.length], [calls, lo]);
  assertEquals(b.r.spend, { leadoceanRecords: 0, apifyUsd: 0 });
  assertEquals(b.r.queue.length, a.r.queue.length);
});

Deno.test("no approval, or a changed plan: nothing is bought", async () => {
  const s = await spec(Q.hiring);
  const plan = planExecution(s, ALL_ON());
  const ap = apifyMock({ jobs: [jobRow("acmesaas")] });
  const w = world([], {});
  const base = { workspaceId: WS, runId: "z", spec: s, plan, sources: { ...w.sources }, apify: ap.invoke, ledger: memoryLedger(), cache: memoryEvidenceCache(), existing: w.existing, now: NOW };
  assertEquals((await executeDiscovery({ ...base, approval: null })).status, "blocked");
  assertEquals((await executeDiscovery({ ...base, approval: approve("other-hash") })).status, "blocked");
  assertEquals(ap.calls.length + w.a.calls.length, 0);
});

Deno.test("posts discovery: company-authored dated posts qualify the request match; person-authored posts are skipped", async () => {
  const { r, by } = await run(Q.posts, [], { posts: [postRow("growthlab", "How we use AI automation for outbound"), postRow("jane-doe", "AI automation tips", undefined, "person")], records: { growthlab: US_RECORD("growthlab", [11, 50]) } });
  assertEquals(Object.keys(by), ["growthlab"]);
  assert(r.steps[0].notes.some((n) => n.includes("by people skipped")));
  assert(by.growthlab.requestMatch[0].met);
});

Deno.test("founder check is optional and never upgrades a phone: confirmed founders rank higher, nothing else changes", async () => {
  const { r } = await run(Q.combined, [loReply([founder("308", "acmesaas")])],
    { jobs: [jobRow("acmesaas")], records: { acmesaas: US_RECORD("acmesaas") }, employees: [employeeRow("Founder", "308", "acmesaas")] },
    { mutate: (s) => { s.verification.founderRelationship = true; } });
  const c = r.queue[0];
  assertEquals(c.founderCheck?.state, "confirmed");
  assertEquals(r.phonesRequested, 0);
});

Deno.test("a signal-only request (no hard company constraint) is planned, but the plan says candidates go to review", async () => {
  const s = await spec(Q.hiring, (x) => { x.hard = ["signal:hiring"]; x.geography.hq = []; x.verification.headquarters = false; });
  const p = planExecution(s, ALL_ON());
  assert(p.uncertain.some((u) => u.includes("nothing to qualify against")));
  const { r } = await run(Q.hiring, [], { jobs: [jobRow("acmesaas")], records: { acmesaas: US_RECORD("acmesaas") } }, { mutate: (x) => { x.hard = ["signal:hiring"]; x.geography.hq = []; x.verification.headquarters = false; } });
  assertEquals(r.queue.length, 0);
  assertEquals(r.review.length, 1);
});
