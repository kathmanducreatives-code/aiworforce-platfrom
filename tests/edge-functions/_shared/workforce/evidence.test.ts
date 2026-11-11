// WORKFORCE V2 · PHASES 3–5 — evidence retrieval, structured answers, and the
// ORION→ATLAS→ORION loop. In-memory tables with FICTIONAL, clearly recorded
// fixtures; the real loader, retrieval, composer and link code. No network.
import { assert, assertEquals, assertFalse, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  applyFreshness, classFromLisa, dedupeEvidence, type EvidenceItem,
} from "../../../../supabase/functions/_shared/evidence/model.ts";
import { retrieveEvidence } from "../../../../supabase/functions/_shared/evidence/retrieve.ts";
import {
  composeStructuredAnswer, evidenceQuestionKind, evidenceSubjectFromMessage, renderStructuredAnswer,
} from "../../../../supabase/functions/_shared/evidence/answer.ts";
import { launchPacketFor, resultFromSavedLead, type LinkableHandoff } from "../../../../supabase/functions/_shared/collab/atlasMissionLink.ts";
import { handoffStatusFor } from "../../../../supabase/functions/_shared/collab/atlasToOrion.ts";

const WS = "aaaaaaaa-0000-4000-8000-00000000e001";
const OTHER_WS = "aaaaaaaa-0000-4000-8000-00000000e999";
const USER = "11111111-0000-4000-8000-00000000e002";
const STRANGER = "11111111-0000-4000-8000-00000000e003";
const NOW = new Date("2026-11-10T12:00:00Z");
type Row = Record<string, unknown>;

function db(tables: Record<string, Row[]>, reads: string[] = [], broken: string[] = []) {
  const make = (t: string) => {
    reads.push(t);
    let rows = [...(tables[t] ?? [])];
    // deno-lint-ignore no-explicit-any
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const q: any = {
      select() { return q; }, order() { return q; },
      eq(c: string, v: unknown) { rows = rows.filter((r) => r[c] === v); return q; },
      in(c: string, vs: unknown[]) { rows = rows.filter((r) => vs.includes(r[c])); return q; },
      limit(n: number) { rows = rows.slice(0, n); return q; },
      maybeSingle() { return Promise.resolve({ data: rows[0] ?? null }); },
      then(res: (v: unknown) => unknown) {
        return Promise.resolve(broken.includes(t) ? { data: null, error: { message: "relation missing" } } : { data: rows, error: null }).then(res);
      },
    };
    return q;
  };
  return { from: make };
}

const lisaRow = (id: string, name: string, domain: string, title: string, level: string, date: string, extra: Row = {}): Row => ({
  id, workspace_id: WS, signal_type: "expansion", lifecycle_status: "active",
  verification_status: level === "corroborated" ? "provider_verified" : "unverified", confidence: level === "corroborated" ? "high" : "low",
  occurred_at: date, observed_at: "2026-11-08T09:00:00Z", source_url: `https://news.example/${id}`, subject_key: domain,
  normalized_value: { lisa: { company: { name, domain }, title, description: `${name} — ${title}`, event_date: date,
    verification: { level, confidence: level === "corroborated" ? "high" : "low" } } }, ...extra,
});

// FIXTURE (fictional, recorded): US manufacturing ICP 20–200, software excluded.
const TABLES: Record<string, Row[]> = {
  workspace_members: [{ workspace_id: WS, user_id: USER }],
  company_brain: [{ workspace_id: WS, onboarding_completed: true, updated_at: "2026-10-01T00:00:00Z",
    profile: { schema_version: 2, company: { name: "Everest Industrial Automation (fictional)" },
      target_customer: { industries: ["Manufacturing"], geography: ["United States"], company_size: { min: 20, max: 200 } } } }],
  company_brain_memory: [{ id: "m-ex", workspace_id: WS, kind: "preference", category: "exclusions", fact_key: "exclusion.industry:software",
    scope: "workspace", scope_ref: null, value_type: "object", value: { type: "industry", value: "Software" }, version: 1,
    source_type: "user_provided", verification_status: "user_confirmed", confidence: "high", lifecycle_status: "active",
    persistence: "permanent", approval_status: "approved", created_by_kind: "user", updated_at: "2026-10-05T00:00:00Z" }],
  signal_events: [
    lisaRow("s1", "Kestrel Fabrication", "kestrel-fab.example", "opens a second plant in Dayton, Ohio", "corroborated", "2026-11-05"),
    lisaRow("s2", "Harbor Valve Works", "harborvalve.example", "hiring 12 machinists for a new line", "single_source", "2026-11-02"),
    lisaRow("s3", "Cloudnova Software", "cloudnova.example", "opens a new software office in Austin", "corroborated", "2026-11-04"),
    lisaRow("s4", "Pinecrest Tooling", "pinecrest.example", "adds a CNC line (forum post)", "single_source", "2026-08-01"),
    lisaRow("s5", "Ridgeway Castings", "ridgeway.example", "expansion denied by the company", "contradicted", "2026-11-03", { lifecycle_status: "contradicted" }),
    { ...lisaRow("x1", "Leak Corp", "leak.example", "other workspace", "corroborated", "2026-11-05"), workspace_id: OTHER_WS },
  ],
  lead_candidates: [
    { id: "l1", workspace_id: WS, status: "rejected", fit_score: 20, reason: "Software company — outside the manufacturing ICP",
      created_at: "2026-11-01T00:00:00Z", account_id: "a1", accounts: { name: "Cloudnova Software", domain: "cloudnova.example", linkedin_url: null } },
  ],
  company_web_evidence: [
    { workspace_id: WS, domain: "kestrel-fab.example", source_url: "https://kestrel-fab.example/news", page_intent: "news",
      source_text: "We are opening our second plant in Dayton.", fetched_at: "2026-11-06T00:00:00Z", status: "ok" },
  ],
};

Deno.test("evidence model: classes, freshness windows and dedupe", () => {
  assertEquals(classFromLisa("corroborated", "active"), "verified");
  assertEquals(classFromLisa("self_reported", "active"), "single_source");
  assertEquals(classFromLisa("corroborated", "retracted"), "contradicted");
  assertEquals(classFromLisa(null, null, null), "unknown");
  assertEquals(applyFreshness("verified", "lisa_signal", { published_at: "2026-08-01", retrieved_at: "2026-08-01" }, NOW), "stale");
  assertEquals(applyFreshness("contradicted", "lisa_signal", { published_at: "2020-01-01", retrieved_at: "2020-01-01" }, NOW), "contradicted");
  assertEquals(applyFreshness("verified", "company_brain", { published_at: null, retrieved_at: "2020-01-01" }, NOW), "verified");
  const base: EvidenceItem = { id: "a", workspace_id: WS, source_type: "lisa_signal", source_url: "https://x.example/a?utm=1",
    published_at: null, retrieved_at: "2026-11-01", subject: { name: "X", domain: null }, content: "c", verification: "single_source",
    confidence: "low", permissions: { scope: "workspace", workspace_id: WS }, provenance: { table: "t", record_id: "a" } };
  const out = dedupeEvidence([base, { ...base, id: "b", source_url: "https://www.x.example/a", verification: "verified" }]);
  assertEquals(out.length, 1);
  assertEquals(out[0].verification, "verified");
});

Deno.test("retrieval: a non-member gets nothing — no evidence table is read", async () => {
  const reads: string[] = [];
  const r = await retrieveEvidence(db(TABLES, reads), { workspaceId: WS, userId: STRANGER, now: NOW });
  assertFalse(r.ok);
  assertEquals(r.refused, "forbidden");
  assertEquals(r.items.length, 0);
  assertFalse(reads.includes("signal_events") || reads.includes("lead_candidates"));
});

Deno.test("retrieval: member reads every source, workspace-isolated, $0, with verification and freshness", async () => {
  const r = await retrieveEvidence(db(TABLES), { workspaceId: WS, userId: USER, now: NOW, limit: 50 });
  assert(r.ok);
  assertEquals(r.cost, { usd: 0, paid_calls: 0 });
  assertEquals(r.sources.lisa_signal, "ok");
  assertEquals(r.sources.lead, "ok");
  assertFalse(r.items.some((x) => x.subject.name === "Leak Corp"), "another workspace's row is never served");
  const by = (n: string) => r.items.find((x) => x.subject.name === n)!;
  assertEquals(by("Kestrel Fabrication").verification, "verified");
  assertEquals(by("Harbor Valve Works").verification, "single_source");
  assertEquals(by("Pinecrest Tooling").verification, "stale");
  assertEquals(by("Ridgeway Castings").verification, "contradicted");
  for (const x of r.items) {
    assertEquals(x.permissions.workspace_id, WS);
    assert(x.retrieved_at && x.provenance.table);
  }
});

Deno.test("retrieval: an unavailable source is named, not silently empty", async () => {
  const r = await retrieveEvidence(db(TABLES, [], ["lead_candidates"]), { workspaceId: WS, userId: USER, now: NOW });
  assert(r.ok);
  assertEquals(r.sources.lead, "unavailable");
  const a = composeStructuredAnswer({ kind: "priority", retrieved: r });
  assert(a.uncertainty.some((u) => u.includes("ATLAS lead record")));
});

Deno.test("routing: evidence question kinds and the named subject", () => {
  assertEquals(evidenceQuestionKind("Is this announcement verified?"), "verification");
  assertEquals(evidenceQuestionKind("What should I prioritize this week?"), "priority");
  assertEquals(evidenceQuestionKind("Why did we reject this company?"), "rejection");
  assertEquals(evidenceQuestionKind("Find 50 US manufacturers"), null);
  assertEquals(evidenceQuestionKind("Write a LinkedIn post about this signal"), null);
  assertEquals(evidenceSubjectFromMessage("Is Kestrel Fabrication's expansion verified?"), "Kestrel Fabrication");
  assertEquals(evidenceSubjectFromMessage("Is this announcement verified?"), null);
});

Deno.test("answer: verification — verified, single-source, stale, and no evidence never invents", async () => {
  const ask = async (name: string) => composeStructuredAnswer({ kind: "verification", subject: { name },
    retrieved: await retrieveEvidence(db(TABLES), { workspaceId: WS, userId: USER, now: NOW, subject: { name } }) });
  const k = await ask("Kestrel Fabrication");
  assertStringIncludes(k.executive_answer, "verified by independent sources");
  assert(k.evidence.length >= 1 && k.cited_ids.every((id) => id.startsWith("lisa_signal:") || id.startsWith("web_page:")));
  const h = await ask("Harbor Valve Works");
  assertStringIncludes(h.executive_answer, "Not verified");
  assert(h.recommended_actions.some((a) => a.department === "LISA" && a.needs_approval));
  const p = await ask("Pinecrest Tooling");
  assertStringIncludes(p.executive_answer, "stale");
  const none = await ask("Nonexistent Widgets");
  assertStringIncludes(none.executive_answer, "no stored evidence");
  assertEquals(none.evidence.length, 0);
});

Deno.test("answer: priority respects the Brain — excluded software never recommended; six sections render", async () => {
  const r = await retrieveEvidence(db(TABLES), { workspaceId: WS, userId: USER, now: NOW, limit: 50 });
  const a = composeStructuredAnswer({ kind: "priority", retrieved: r });
  assertStringIncludes(a.executive_answer, "Kestrel Fabrication");
  assertFalse(a.executive_answer.includes("Cloudnova"));
  assertFalse(a.evidence.some((e) => e.line.includes("Cloudnova")));
  assertFalse(a.executive_answer.includes("Ridgeway"), "contradicted evidence is not a priority");
  assert(a.recommended_actions.some((x) => x.department === "ATLAS" && x.needs_approval), "paid ATLAS work waits for approval");
  assertStringIncludes(a.why_it_matters, "United States");
  const text = renderStructuredAnswer(a);
  for (const h of ["Executive answer", "Why it matters", "Evidence", "Recommended actions", "Agent collaboration", "Uncertainty"]) {
    assertStringIncludes(text, `**${h}**`);
  }
  assertStringIncludes(text, "no live web search was run");
});

Deno.test("answer: rejection explains the recorded decision and the Brain exclusion", async () => {
  const subject = { name: "Cloudnova Software", domain: "cloudnova.example" };
  const r = await retrieveEvidence(db(TABLES), { workspaceId: WS, userId: USER, now: NOW, subject });
  const a = composeStructuredAnswer({ kind: "rejection", subject, retrieved: r });
  assertStringIncludes(a.executive_answer, "excludes industry Software");
  assertStringIncludes(a.executive_answer, "outside the manufacturing ICP");
});

const HANDOFF: LinkableHandoff = {
  id: "h-1", kind: "atlas_research", status: "approved", signal_ids: ["s1"],
  company: { name: "Kestrel Fabrication", domain: "kestrel-fab.example" }, decided_at: "2026-11-09T00:00:00Z",
  payload: { prefilled_mission: { query: "Qualify Kestrel Fabrication (kestrel-fab.example) as a customer", requested_count: 1, company_domain: "kestrel-fab.example" } },
};

Deno.test("ORION→ATLAS: launch only from an approved handoff, through the Leads flow, never contacts or outreach", () => {
  const ok = launchPacketFor(HANDOFF);
  assert(ok.ok);
  assertStringIncludes(ok.packet.message, "Kestrel Fabrication");
  assertEquals(ok.packet.guardrails, { mission_approval_required: true, contact_enrichment: false, outreach: false });
  assertEquals(launchPacketFor({ ...HANDOFF, status: "awaiting_review" }), { ok: false, reason: "not_approved", status: "awaiting_review" });
  assertEquals((launchPacketFor({ ...HANDOFF, kind: "lyra_content" }) as { reason: string }).reason, "not_research");
});

Deno.test("ATLAS→ORION: the result comes from the SAVED lead row written after approval — never earlier, never invented", () => {
  const acct = { domain: "kestrel-fab.example", name: "Kestrel Fabrication" };
  assertEquals(resultFromSavedLead(HANDOFF, []), null);
  assertEquals(resultFromSavedLead(HANDOFF, [{ id: "old", status: "qualified", reason: null, fit_score: 90, created_at: "2026-10-01T00:00:00Z", account_id: "a", accounts: acct }]), null);
  assertEquals(resultFromSavedLead(HANDOFF, [{ id: "n", status: "new", reason: null, fit_score: null, created_at: "2026-11-09T05:00:00Z", account_id: "a", accounts: acct }]), null);
  const r = resultFromSavedLead(HANDOFF, [
    { id: "other", status: "qualified", reason: "x", fit_score: 90, created_at: "2026-11-09T05:00:00Z", account_id: "b", accounts: { domain: "else.example" } },
    { id: "lc-9", status: "qualified", reason: "US manufacturer, 140 employees, new plant", fit_score: 82, created_at: "2026-11-09T06:00:00Z", account_id: "a", accounts: acct },
  ])!;
  assertEquals(r.qualification, "qualified");
  assertEquals(r.lead_candidate_id, "lc-9");
  assertEquals(r.persisted, true);
  assertEquals(r.contacts.independently_verified, false);
  assertEquals(handoffStatusFor(r), "completed");
});

// ACCEPTANCE (Workforce V2 §9) — RECORDED FIXTURES, NOT LIVE PROVIDERS.
// "Find five US manufacturing companies showing recent expansion activity":
// the live path needs LISA collection (paid search) and ATLAS sourcing (paid
// Apify/Firecrawl), neither of which is approved. This replays the same
// decisions over recorded fictional records. Live validation: PENDING.
Deno.test("acceptance [recorded fixtures]: expansion → ORION brief → approved ATLAS → saved result → ORION", async () => {
  const r = await retrieveEvidence(db(TABLES), { workspaceId: WS, userId: USER, now: NOW, limit: 50 });
  // LISA: only current, non-excluded, non-contradicted expansion signals count.
  const usable = r.items.filter((x) => x.source_type === "lisa_signal" && (x.verification === "verified" || x.verification === "single_source"));
  const names = usable.map((x) => x.subject.name);
  assert(names.includes("Kestrel Fabrication") && names.includes("Harbor Valve Works"));
  // Fewer than five qualify in the fixture: the honest answer says so, it does not pad the list.
  const brief = composeStructuredAnswer({ kind: "priority", retrieved: r });
  assert(brief.evidence.length < 5);
  assertFalse(brief.executive_answer.includes("Cloudnova"));
  // ORION → ATLAS (approved) → mission via Leads → saved row → ORION.
  const launch = launchPacketFor(HANDOFF);
  assert(launch.ok);
  const result = resultFromSavedLead(HANDOFF, [{ id: "lc-9", status: "qualified", reason: "fits ICP", fit_score: 82,
    created_at: "2026-11-09T06:00:00Z", account_id: "a", accounts: { domain: "kestrel-fab.example", name: "Kestrel Fabrication" } }])!;
  assertEquals(result.qualification, "qualified");
  assertStringIncludes(result.summary.toLowerCase(), "kestrel");
});

Deno.test("wiring: chat evidence answers are flag-gated, membership-checked, and spend nothing", async () => {
  const src = await Deno.readTextFile(new URL("../../../../supabase/functions/pilot-chat/index.ts", import.meta.url));
  assertStringIncludes(src, `Deno.env.get("AGENTORY_EVIDENCE_ANSWERS_ENABLED") === "true"`);
  assertStringIncludes(src, "retrieveEvidence(admin as unknown as StoredEvidenceDb, { workspaceId, userId, subject })");
  const block = src.slice(src.indexOf("EVIDENCE ANSWERS (Workforce V2"), src.indexOf("if (workspaceQuestion) {\n    // \"TODAY\""));
  assertFalse(/generateText|generateJson|fetch\(/.test(block), "the evidence path calls no model and no provider");
});
