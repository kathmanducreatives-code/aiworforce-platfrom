import { assert, assertEquals, assertFalse } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { compileIcp, configureIcp, ICP_A, ICP_B } from "../../../../supabase/functions/_shared/leadPipeline/icp.ts";
import { planDiscovery } from "../../../../supabase/functions/_shared/discoveryProviders/routing.ts";
import { advance, EXCLUDE_IDS_MAX, memoryCheckpointStore, newCheckpoint, resumeHints } from "../../../../supabase/functions/_shared/leadPipeline/checkpoint.ts";
import { ExclusionIndex } from "../../../../supabase/functions/_shared/leadPipeline/exclusions.ts";
import { collectSignals, corroborate, eventDateOf, recencyOf, signalFromFunding, signalsFromPosts, SIGNAL_ACTORS, worstCaseUsd, type Signal } from "../../../../supabase/functions/_shared/leadPipeline/signals.ts";
import { readCompanyRecords } from "../../../../supabase/functions/_shared/leadPipeline/canonical.ts";
import { rankLeads, scoreLead, type RankInput } from "../../../../supabase/functions/_shared/leadPipeline/ranking.ts";
import { classifyPhone, employmentFrom, enrichPhones, maskPhone, phoneLookupGate, toE164, type PhoneTarget } from "../../../../supabase/functions/_shared/leadPipeline/phones.ts";
import { EMPTY_FUNNEL, estimateCandidates, plannedFunnel, wilsonLower } from "../../../../supabase/functions/_shared/leadPipeline/metrics.ts";
import { memoryLedger, type EnrichmentAuthorization } from "../../../../supabase/functions/_shared/discoveryProviders/budget.ts";
import { ProviderError, type ContactPoint } from "../../../../supabase/functions/_shared/discoveryProviders/types.ts";
import { COMPANY_RECORDS, CONNECTIONS, NOW } from "./fixtures.ts";

// ── ICP ─────────────────────────────────────────────────────────────────────
for (const icp of [ICP_A, ICP_B]) {
  Deno.test(`icp ${icp.id}: compiles to person target; gates are HQ, size (once), role; narrowing rides as hints`, () => {
    const c = compileIcp(icp);
    assertEquals(c.requirements.targetEntity, "person");
    assertEquals(c.requirements.hard.map((h) => h.key).sort(), ["employee_range", "geography_hq", "roles"]);
    assertFalse(c.criteria.some((x) => /industry|business_model/.test(String((x as { dimension?: string }).dimension))), "B2B SaaS / agency is never a hard criterion");
    assertEquals((c.requirements.providerHints!.leadocean as { industry: string[] }).industry, icp.leadocean.industry);
    const plan = planDiscovery({ requirements: c.requirements, connections: CONNECTIONS, selection: ["leadocean"] });
    assertEquals(plan.status, "ready");
    assertEquals(plan.steps[0].kind, "people_search");
  });
}
Deno.test("icp: configureIcp overrides without editing defaults; hints change the plan hash", () => {
  const small = configureIcp(ICP_A, { requestedCount: 3, employees: { min: 20, max: 200 } });
  assertEquals(small.employees, { min: 20, max: 200 });
  assertEquals(ICP_A.employees, { min: 11, max: 200 });
  const a = planDiscovery({ requirements: compileIcp(small).requirements, connections: CONNECTIONS, selection: ["leadocean"] });
  const b = planDiscovery({ requirements: compileIcp(small, { hasPhone: true }).requirements, connections: CONNECTIONS, selection: ["leadocean"] });
  assert(a.planHash !== b.planHash, "an approval for one narrowing never covers another");
});

// ── Checkpoint ──────────────────────────────────────────────────────────────
Deno.test("checkpoint: advance accumulates; resume excludes seen ids; >1000 blocks; exhausted blocks", async () => {
  const s = memoryCheckpointStore();
  let cp = newCheckpoint("ws", "w", "icp", "t0");
  assertEquals(resumeHints(cp), { blocked: null });
  cp = advance(cp, { personIds: ["1", "2"], companyKeys: ["a"], pages: 1, records: 2, morePages: true, now: "t1" });
  cp = advance(cp, { personIds: ["2", "3"], companyKeys: ["a", "b"], pages: 1, records: 2, morePages: true, now: "t2" });
  assertEquals(cp.seenPersonIds, ["1", "2", "3"]);
  assertEquals([cp.pagesBought, cp.recordsBought], [2, 4]);
  assertEquals(resumeHints(cp).excludeIds, ["1", "2", "3"]);
  await s.save(cp);
  assertEquals((await s.load("ws", "w"))!.seenCompanyKeys, ["a", "b"]);
  assertEquals(await s.load("other-ws", "w"), null, "workspace-scoped");
  const big = { ...cp, seenPersonIds: Array.from({ length: EXCLUDE_IDS_MAX + 1 }, (_, i) => String(i)) };
  assert(resumeHints(big).blocked);
  const done = advance(cp, { personIds: [], companyKeys: [], pages: 1, records: 0, morePages: false, now: "t3" });
  assert(resumeHints(done).blocked?.includes("exhausted"));
});

// ── Exclusions ──────────────────────────────────────────────────────────────
Deno.test("exclusions: identifiers only; CRM and active holds block outreach; expired holds do not", () => {
  const idx = new ExclusionIndex([
    { leadId: "L1", kind: "account", companyDomain: "https://www.acme.example/", crmRelationship: "customer" },
    { leadId: "L2", kind: "contact", personLinkedinUrl: "https://linkedin.com/in/jo-doe/", hold: { reason: "opted_out" } },
    { leadId: "L3", kind: "contact", providerPersonId: undefined, providerPersonIds: ["77"], hold: { reason: "recently_contacted", until: "2026-01-01T00:00:00Z" } },
  ], NOW);
  const c = idx.company({ domains: ["acme.example"], linkedinUrls: [], providerIds: [] });
  assertEquals([c.existingLeadIds, c.crmRelationship, c.blocksOutreach], [["L1"], "customer", true]);
  assertEquals(idx.company({ domains: ["acme-two.example"], linkedinUrls: [], providerIds: [] }).existingLeadIds, [], "a similar name/domain is not a match");
  assert(idx.person({ linkedinUrls: ["https://www.linkedin.com/in/jo-doe"], providerIds: [] }).blocksOutreach);
  const expired = idx.person({ linkedinUrls: [], providerIds: ["77"] });
  assertEquals([expired.existingLeadIds, expired.blocksOutreach], [["L3"], false]);
});

// ── Signals ─────────────────────────────────────────────────────────────────
Deno.test("signals: only ISO dates are dates; future and missing are undated; never recent", () => {
  assertEquals(eventDateOf("2 weeks ago"), null);
  assertEquals(eventDateOf("2026-10-01"), "2026-10-01T00:00:00.000Z");
  assertEquals(recencyOf(null, 30, NOW()), "undated");
  assertEquals(recencyOf("2027-01-01T00:00:00Z", 30, NOW()), "undated");
  assertEquals(recencyOf("2026-10-15T00:00:00Z", 30, NOW()), "recent");
  assertEquals(recencyOf("2026-06-01T00:00:00Z", 30, NOW()), "stale");
});
Deno.test("signals: post cues are low confidence; funding year alone is undated; corroboration needs a second source", () => {
  const s = signalsFromPosts([{ content: "Welcome our new VP of Sales! We're hiring SDRs.", linkedinUrl: "u", postedAt: { date: "2026-10-25T00:00:00Z" } }],
    { kind: "company", key: "c" }, SIGNAL_ACTORS.companyPosts, { chargedUsd: 0.002 }, NOW(), 30);
  assertEquals(s.map((x) => x.type).sort(), ["hiring", "leadership_change", "linkedin_post"]);
  assert(s.filter((x) => x.type !== "linkedin_post").every((x) => x.confidence === "low"));
  const yearOnly = signalFromFunding({ lastRoundType: "Seed", lastRoundYear: 2026 } as never, { kind: "company", key: "c" }, "r", NOW(), 90)!;
  assertEquals([yearOnly.eventDate, yearOnly.recency], [null, "undated"]);
  const f = signalFromFunding({ lastRoundType: "Seed", roundDate: "2026-10-20" } as never, { kind: "company", key: "c" }, "r", NOW(), 90)!;
  const post: Signal = { ...f, signalId: "x", provider: "apify", actor: "harvestapi/linkedin-company-posts", eventDate: "2026-10-22T00:00:00.000Z" };
  assertEquals(corroborate([f, post]).map((x) => x.corroboration), ["corroborated", "corroborated"]);
  assertEquals(corroborate([f]).map((x) => x.corroboration), ["single_source"]);
});
Deno.test("signals: worst case reserved before a run; over-ceiling runs skipped; failure stops further spend without retry", async () => {
  assertEquals(worstCaseUsd(SIGNAL_ACTORS.jobs, 5), 0.006);
  const subjects = ["a", "b", "c"].map((k) => ({ companyKey: k, companyLinkedinUrl: `https://www.linkedin.com/company/${k}`, companyName: k, personKey: null, personLinkedinUrl: null, funding: null, fundingRecordId: null }));
  let calls = 0;
  const r = await collectSignals(subjects, { collect: { jobs: true }, maxPostsPerSubject: 0, maxJobsPerCompany: 5, windowDays: 30, maxUsd: 0.012, relevantRoles: /sdr/i },
    () => { calls++; return Promise.resolve({ items: [], chargedUsd: 0.001 }); }, NOW(), "p");
  assertEquals(calls, 2);
  assert(r.statuses.some((s) => s.subject === "c" && s.state === "skipped_budget"));
  let fails = 0;
  const f = await collectSignals(subjects, { collect: { jobs: true }, maxPostsPerSubject: 0, maxJobsPerCompany: 5, windowDays: 30, maxUsd: 1, relevantRoles: /sdr/i },
    () => { fails++; return Promise.reject(new Error("x")); }, NOW(), "p");
  assertEquals(fails, 1, "no retry, no further runs");
  assertEquals(f.spentUsd, 0.006);
  assert(f.stopped);
  const none = await collectSignals(subjects, { collect: { jobs: true }, maxPostsPerSubject: 0, maxJobsPerCompany: 5, windowDays: 30, maxUsd: 1, relevantRoles: /sdr/i }, null, NOW(), "p");
  assert(none.statuses.filter((s) => s.type === "hiring").every((s) => s.state === "unavailable"));
});

// ── Canonical ───────────────────────────────────────────────────────────────
Deno.test("canonical: one batched run inside the ceiling; whole batch must fit; failure counts worst case", async () => {
  const targets = [{ companyKey: "domain:acmesaas.example", linkedinUrl: "https://www.linkedin.com/company/acmesaas" }, { companyKey: "x", linkedinUrl: "" }];
  let n = 0;
  const ok = await readCompanyRecords(targets, (_k, input) => { n++; assertEquals(input.companies, ["https://www.linkedin.com/company/acmesaas"]); return Promise.resolve({ items: [COMPANY_RECORDS.acmesaas], chargedUsd: 0.00405 }); }, { maxUsd: 0.01, now: NOW(), idPrefix: "p" });
  assertEquals(n, 1);
  assertEquals(ok.statuses.map((s) => s.state).sort(), ["no_linkedin", "read"]);
  assert(ok.evidence.get("domain:acmesaas.example")!.some((e) => e.dimension === "identity"));
  const over = await readCompanyRecords(targets, () => { throw new Error("must not run"); }, { maxUsd: 0.001, now: NOW(), idPrefix: "p" });
  assertEquals(over.stopped, "budget");
  const bad = await readCompanyRecords(targets, () => Promise.reject(new Error("x")), { maxUsd: 1, now: NOW(), idPrefix: "p" });
  assertEquals([bad.stopped, bad.spentUsd], ["charge_uncertain", 0.00405]);
});

// ── Ranking ─────────────────────────────────────────────────────────────────
const ri = (o: Partial<RankInput>): RankInput => ({ leadKey: "k", eligibility: "eligible", title: "Founder", companyText: [], industryLabels: [], employeeCount: null, hasPhone: null, signals: [], ...o });
Deno.test("ranking: eligibility decides the lane, never the score; missing data scores 0 with a reason", () => {
  const hiPending = scoreLead(ri({ eligibility: "pending", companyText: ["b2b saas platform api for teams"], hasPhone: true }), ICP_A);
  const loEligible = scoreLead(ri({ title: "Head of Sales" }), ICP_A);
  assert(hiPending.score > loEligible.score);
  const order = rankLeads([{ ...ri({ eligibility: "pending", companyText: ["b2b saas"], hasPhone: true }), leadKey: "p" }, { ...ri({ title: "Head of Sales" }), leadKey: "e" }, { ...ri({ eligibility: "ineligible" }), leadKey: "x" }], ICP_A);
  assertEquals(order.map((r) => [r.leadKey, r.lane]), [["e", "queue"], ["p", "review"], ["x", "excluded"]]);
  const unknown = scoreLead(ri({ title: null }), ICP_A);
  assert(unknown.factors.every((f) => f.points >= 0));
  assert(unknown.factors.filter((f) => f.points === 0).every((f) => f.why.length > 0));
  assert(unknown.factors.some((f) => f.why.startsWith("unknown")));
});
Deno.test("ranking: undated and stale signals score 0; corroborated recent scores more", () => {
  const base: Signal = { signalId: "s", subject: { kind: "company", key: "k" }, type: "funding", sourceUrl: null, eventDate: "2026-10-20T00:00:00Z", collectedAt: "", recency: "recent",
    evidence: { excerpt: null, fields: {} }, confidence: "medium", provider: "leadocean", actor: null, cost: { usd: 0, basis: "included" }, corroboration: "single_source" };
  const pts = (s: Signal) => scoreLead(ri({ signals: [s] }), ICP_A).factors.find((f) => f.factor === "signal:funding")!.points;
  assertEquals(pts({ ...base, eventDate: null, recency: "undated" }), 0);
  assertEquals(pts({ ...base, recency: "stale" }), 0);
  assert(pts({ ...base, corroboration: "corroborated" }) > pts(base));
});

// ── Phones ──────────────────────────────────────────────────────────────────
const cp = (o: Partial<ContactPoint>): ContactPoint => ({ kind: "phone", value: "+1 512 555 0101", type: "mobile", provider: "leadocean", recordId: "1", verification: "provider_supplied_unverified", retrievedAt: "", ...o });
const pc = { status: "provider_consistent" as const, sources: ["leadocean"], checkedAt: null };
Deno.test("phones: five classes; a provider number is never verified; do-not-call is a flag", () => {
  assertEquals(toE164("(512) 555-0101"), "+15125550101");
  assertEquals(toE164("555-0101"), null);
  assertEquals(maskPhone("+15125550101"), "+1•••••0101");
  assertEquals(classifyPhone(null, { employment: pc }).class, "no_number");
  assertEquals(classifyPhone(cp({ value: "12" }), { employment: pc }).class, "invalid_or_mismatched");
  assertEquals(classifyPhone(cp({}), { employment: { ...pc, status: "mismatch" } }).class, "invalid_or_mismatched");
  assertEquals(classifyPhone(cp({ type: "office" }), { employment: pc }).class, "company_switchboard");
  assertEquals(classifyPhone(cp({}), { employment: pc, companyNumbers: ["512-555-0101"] }).class, "company_switchboard");
  assertEquals(classifyPhone(cp({}), { employment: pc }).class, "unverified_person_associated");
  // Provider claims "verified" with only its own evidence: still unverified.
  assertEquals(classifyPhone(cp({ verification: "independently_verified", evidence: [{ kind: "leadocean", ref: "x", at: "t" }] }), { employment: { ...pc, status: "independent_current" } }).class, "unverified_person_associated");
  // Independent number evidence but provider-only employment: still unverified.
  assertEquals(classifyPhone(cp({ verification: "independently_verified", evidence: [{ kind: "carrier_lookup", ref: "x", at: "t" }] }), { employment: pc }).class, "unverified_person_associated");
  assertEquals(classifyPhone(cp({ verification: "independently_verified", evidence: [{ kind: "carrier_lookup", ref: "x", at: "t" }] }), { employment: { status: "independent_current", sources: ["apify_profile"], checkedAt: "t" } }).class, "verified_person_direct");
});
Deno.test("phones: employment from LeadOcean alone is provider_consistent; a different employer domain is a mismatch", () => {
  assertEquals(employmentFrom({ providerSaysCurrent: true, providerEmployerDomain: "a.example", companyDomains: ["a.example"] }).status, "provider_consistent");
  assertEquals(employmentFrom({ providerSaysCurrent: true, providerEmployerDomain: "b.example", companyDomains: ["a.example"] }).status, "mismatch");
  assertEquals(employmentFrom({ providerSaysCurrent: null, providerEmployerDomain: null, companyDomains: [] }).status, "unknown");
});
const tgt = (o: Partial<PhoneTarget>): PhoneTarget => ({ personKey: "p1", leadId: null, providerPersonId: "1", linkedinUrl: null, eligibility: "eligible", hasPhone: true, outreachBlocked: false, employment: pc, ...o });
const auth = (o: Partial<EnrichmentAuthorization> = {}): EnrichmentAuthorization => ({ kind: "enrichment", workspaceId: "ws", missionId: "m", personKeys: ["p1", "p2"], revealEmail: false, phones: true, maxCredits: 2, approvedBy: "x", approvedAt: "x", ...o });
Deno.test("phones: the lookup gate", () => {
  assertEquals(phoneLookupGate(tgt({}), auth()), null);
  assert(phoneLookupGate(tgt({}), null));
  assert(phoneLookupGate(tgt({}), auth({ phones: false })));
  assert(phoneLookupGate(tgt({ eligibility: "pending" }), auth()));
  assert(phoneLookupGate(tgt({ outreachBlocked: true }), auth()));
  assert(phoneLookupGate(tgt({ hasPhone: false }), auth()));
  assert(phoneLookupGate(tgt({ hasPhone: null }), auth()));
  assert(phoneLookupGate(tgt({ personKey: "zz" }), auth()));
});
Deno.test("phones: idempotent replay, cap, charge_uncertain stops without retry, ledger never holds the number", async () => {
  const ledger = memoryLedger();
  let n = 0;
  const call = () => { n++; return Promise.resolve({ found: true, points: [cp({})], credits: 1, recordId: "1" }); };
  const deps = { apiKey: "k", fetch: () => Promise.reject(new Error("no")) } as never;
  const a = await enrichPhones({ workspaceId: "ws", missionId: "m", authorization: auth(), targets: [tgt({})], deps, ledger, call });
  assertEquals([n, a.recordsCharged, a.records[0].class], [1, 1, "unverified_person_associated"]);
  assert([...ledger.entries.values()].every((e) => !JSON.stringify(e.result ?? {}).includes("555")));
  const b = await enrichPhones({ workspaceId: "ws", missionId: "m", authorization: auth(), targets: [tgt({})], deps, ledger, call });
  assertEquals([n, b.records[0].cost.basis], [1, "replayed"]);
  let u = 0;
  const unc = () => { u++; return Promise.reject(new ProviderError("leadocean", "charge_uncertain", "t")); };
  const c = await enrichPhones({ workspaceId: "ws", missionId: "m2", authorization: auth({ missionId: "m2" }), targets: [tgt({}), tgt({ personKey: "p2" })], deps, ledger, call: unc });
  assertEquals([u, c.stopped, c.recordsCharged], [1, "charge_uncertain", 1]);
  const d = await enrichPhones({ workspaceId: "ws", missionId: "m2", authorization: auth({ missionId: "m2" }), targets: [tgt({})], deps, ledger, call: unc });
  assertEquals(u, 1, "an uncertain charge is never retried");
  assert(d.skipped[0].reason.includes("charge_uncertain"));
  const e = await enrichPhones({ workspaceId: "ws", missionId: "m3", authorization: auth({ missionId: "m3", maxCredits: 1 }), targets: [tgt({}), tgt({ personKey: "p2" })], deps, ledger, call });
  assertEquals(e.records.length, 1, "the cap stops the second lookup");
});
Deno.test("phones: leadOceanFindPhone posts linkedin_url or person_id to /v1/people/phone with no retries", async () => {
  const { leadOceanFindPhone } = await import("../../../../supabase/functions/_shared/leadPipeline/phones.ts");
  const seen: { url: string; body: unknown }[] = [];
  const fetch = (url: string, init: { body?: string }) => { seen.push({ url, body: JSON.parse(init.body!) }); return Promise.resolve(new Response(JSON.stringify({ data: { has_phone: true, phones: [{ phone: "+1 303 555 0199", type: "office", priority: 2 }, { phone: "+1 512 555 0101", type: "mobile", priority: 1 }] }, meta: { credits: 1 } }), { status: 200 })); };
  const r = await leadOceanFindPhone({ apiKey: "k", fetch: fetch as never }, { personId: "42" });
  assertEquals(seen[0].url, "https://api.leadocean.io/v1/people/phone", "v1: the path the workspace Network Secret covers (test E: v2 → 401)");
  assertEquals(seen[0].body, { person_id: "42" });
  assertEquals(r.points.map((p) => p.type), ["mobile", "office"], "priority order");
  assert(r.points.every((p) => p.verification === "provider_supplied_unverified"));
  let calls = 0;
  const err = () => { calls++; return Promise.resolve(new Response("{}", { status: 502 })); };
  await leadOceanFindPhone({ apiKey: "k", fetch: err as never }, { personId: "42" }).catch(() => {});
  assertEquals(calls, 1);
  await assertThrowsAsync(() => leadOceanFindPhone({ apiKey: "k", fetch: fetch as never }, {}));
});
async function assertThrowsAsync(fn: () => Promise<unknown>) { let threw = false; try { await fn(); } catch { threw = true; } assert(threw); }

// ── Metrics ─────────────────────────────────────────────────────────────────
Deno.test("metrics: Wilson lower bound; estimates conservative; unknown stages reported, never guessed", () => {
  assertEquals(wilsonLower(0, 0), null);
  assert(wilsonLower(5, 10)! < 0.5 && wilsonLower(5, 10)! > 0.2);
  assertEquals(estimateCandidates(EMPTY_FUNNEL, 50).expected, null);
  const f = plannedFunnel(1000, { unique: 0.95, newToAgentory: 0.9, eligible: 0.4, decisionMaker: 0.9, hasPhoneFlag: 0.5, lookedUp: 1, personAssociated: 0.7, outreachReady: 0.9 });
  const e = estimateCandidates(f, 50);
  assert(e.expected! < e.conservative!);
  assert(e.lookupsConservative! > 0);
  assertEquals(estimateCandidates(f, 50, "verified_direct").unknownStages, ["verifiedDirect"]);
});

// ── Regression: test E phone 401 (2026-10-31) ───────────────────────────────
const resp = (status: number, body: unknown) => Promise.resolve(new Response(JSON.stringify(body), { status }));
Deno.test("phones auth probe: 400 on an empty body = key accepted; 401/403/other = no lookup; never a paid body", async () => {
  const { leadOceanPhoneAuthProbe } = await import("../../../../supabase/functions/_shared/leadPipeline/phones.ts");
  const sent: { url: string; body?: string }[] = [];
  const mk = (status: number, body: unknown) => ({ apiKey: "k", fetch: ((url: string, i: { body?: string }) => { sent.push({ url, body: i.body }); return resp(status, body); }) as never });
  assertEquals((await leadOceanPhoneAuthProbe(mk(400, { error: { message: "Validation failed" } }))).ok, true);
  const r401 = await leadOceanPhoneAuthProbe(mk(401, { error: { message: "Missing or malformed x-api-key" } }));
  assertEquals([r401.ok, r401.status], [false, 401]);
  assert(r401.reason.includes("Missing or malformed x-api-key"));
  assertEquals((await leadOceanPhoneAuthProbe(mk(403, {}))).ok, false);
  assertEquals((await leadOceanPhoneAuthProbe(mk(200, { data: {} }))).ok, false, "a 200 to an empty body is unexpected: refuse");
  assert(sent.every((x) => x.url === "https://api.leadocean.io/v1/people/phone" && x.body === "{}"), "the probe carries no identifier, so it can never be a lookup");
});
Deno.test("phones: a failed auth probe stops every lookup before the first paid call", async () => {
  let calls = 0;
  const r = await enrichPhones({ workspaceId: "ws", missionId: "mp", authorization: auth({ missionId: "mp" }), targets: [tgt({}), tgt({ personKey: "p2" })],
    deps: { apiKey: "k", fetch: (() => resp(401, {})) as never }, ledger: memoryLedger(),
    call: () => { calls++; return Promise.resolve({ found: true, points: [], credits: 1, recordId: "1" }); },
    probe: () => Promise.resolve({ ok: false, reason: "key not accepted" }) });
  assertEquals([calls, r.recordsCharged, r.records.length], [0, 0, 0]);
  assert(r.stopped?.startsWith("auth_probe"));
  assertEquals(r.skipped.length, 2);
});
Deno.test("phones: the real v1 response shape; dnc null is unknown (never clearance), dnc true is flagged", async () => {
  const { leadOceanFindPhone } = await import("../../../../supabase/functions/_shared/leadPipeline/phones.ts");
  const body = { success: true, data: { key: "person/1", has_phone: true, contact_phones: [
    { phone: "+1 303 555 0199", type: "office", ddi: null, dnc: null, carrier: null, priority: 2, score: 0.4 },
    { phone: "+1 512 555 0101", type: "mobile", ddi: null, dnc: null, carrier: null, priority: 1, score: 0.8 }] }, meta: { credits: 1 } };
  const r = await leadOceanFindPhone({ apiKey: "k", fetch: (() => resp(200, body)) as never }, { personId: "1" });
  assertEquals(r.points.map((p) => [p.type, p.verification]), [["mobile", "provider_supplied_unverified"], ["office", "provider_supplied_unverified"]]);
  const ledger = memoryLedger();
  const e = await enrichPhones({ workspaceId: "ws", missionId: "md", authorization: auth({ missionId: "md" }), targets: [tgt({})], deps: { apiKey: "k", fetch: (() => resp(200, body)) as never }, ledger, probe: null });
  assertEquals([e.records[0].class, e.records[0].dnc, e.records[0].doNotCall, e.records[0].endpoint], ["unverified_person_associated", "unknown", false, "/v1/people/phone"]);
  const flagged = { ...body, data: { ...body.data, contact_phones: [{ ...body.data.contact_phones[1], dnc: true }] } };
  const f = await enrichPhones({ workspaceId: "ws", missionId: "mf", authorization: auth({ missionId: "mf" }), targets: [tgt({})], deps: { apiKey: "k", fetch: (() => resp(200, flagged)) as never }, ledger, probe: null });
  assertEquals([f.records[0].dnc, f.records[0].doNotCall], ["flagged", true]);
  const none = await leadOceanFindPhone({ apiKey: "k", fetch: (() => resp(200, { success: true, data: { key: "p", has_phone: false, contact_phones: [] } })) as never }, { personId: "2" });
  assertEquals([none.found, none.points.length, none.credits], [false, 0, 1], "found:false still costs one record");
});
