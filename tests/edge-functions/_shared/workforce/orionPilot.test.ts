// ORION EVIDENCE PILOT — offline verification of everything decided before a
// model: each of the 15 questions' deterministic route, follow-up resolution,
// evidence selection on the pilot seed (isolation canary never selected), and the
// acceptance scorer itself. Fictional data; mocked tables; no network.
import { assert, assertEquals, assertFalse } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { PILOT_QUESTIONS } from "../../../../scripts/orion-pilot/questions.ts";
import { ACCEPTANCE, scoreRun, type Turn } from "../../../../scripts/orion-pilot/score.ts";
import { classifyWorkspaceQuestion } from "../../../../supabase/functions/_shared/workspaceQuestions.ts";
import { isPronounReference, orionConverseTask, ordinalReference, PRIORITY_QUESTION_RE, resolvePronounCompany } from "../../../../supabase/functions/_shared/departmentRouting.ts";
import { buildPresentedReferents } from "../../../../supabase/functions/_shared/referentPersistence.ts";
import { retrieveEvidence } from "../../../../supabase/functions/_shared/evidence/retrieve.ts";
import { buildOrionEvidenceDigest, selectEvidenceForQuestion } from "../../../../supabase/functions/_shared/orionEvidenceContext.ts";

Deno.test("pilot: exactly 15 questions covering leads, priorities, signals, rejections, follow-ups, recommendations", () => {
  assertEquals(PILOT_QUESTIONS.length, 15);
  const cats = new Set(PILOT_QUESTIONS.map((q) => q.category));
  for (const c of ["leads", "priorities", "signals", "rejections", "follow_up", "recommendations"]) assert(cats.has(c as never), c);
  assertEquals(new Set(PILOT_QUESTIONS.map((q) => q.id)).size, 15);
});

Deno.test("pilot: every question's deterministic route is what the code actually decides", () => {
  for (const q of PILOT_QUESTIONS) {
    const wq = classifyWorkspaceQuestion(q.question);
    if (q.deterministic.workspace_question) assertEquals(wq?.kind, q.deterministic.workspace_question, q.id);
    else assertEquals(wq, null, `${q.id} must not be taken by the workspace-question reader`);
    assertEquals(PRIORITY_QUESTION_RE.test(q.question), !!q.deterministic.executive_promotion, `${q.id} executive promotion`);
    if (q.deterministic.converse_task) assertEquals(orionConverseTask(q.question), q.deterministic.converse_task, q.id);
  }
});

Deno.test("follow-ups: 'why did we reject the second one' resolves by DISPLAY position; out of range asks", () => {
  const wq = classifyWorkspaceQuestion("Why did we reject the second one?");
  assertEquals(wq?.kind, "why_company");
  const phrase = (wq as { company: string }).company;
  assert(isPronounReference(phrase));
  assertEquals(ordinalReference(phrase), 2);
  const shown = buildPresentedReferents([{ name: "Kestrel Fabrication" }, { name: "Harbor Valve Works" }, { name: "Pinecrest Tooling" }], "orion_evidence");
  assertEquals(resolvePronounCompany([shown], phrase), { kind: "one", name: "Harbor Valve Works", domain: null });
  assertEquals(resolvePronounCompany([shown], "the last one"), { kind: "one", name: "Pinecrest Tooling", domain: null });
  assertEquals(resolvePronounCompany([shown], "the fifth one").kind, "none", "never the nearest guess");
  assertEquals(resolvePronounCompany([shown], "this lead").kind, "many", "a plain pronoun over several still asks");
  // The active phrasing with a name is taken too.
  assertEquals(classifyWorkspaceQuestion("Why did we reject Cloudnova Software?"), { kind: "why_company", company: "cloudnova software", asked: "rejected" });
});

// The pilot seed, as the retrieval layer reads it (same companies, states and ages).
const WS = "a71a0000-0000-4000-8000-0000000011a1", OTHER = "a71a0000-0000-4000-8000-0000000011a2", USER = "11111111-0000-4000-8000-0000000011f1";
const NOW = new Date("2026-11-11T12:00:00Z");
const ago = (d: number) => new Date(NOW.getTime() - d * 86_400_000).toISOString();
const sig = (ws: string, id: string, name: string, domain: string, title: string, level: string, d: number, lifecycle = "active") => ({
  id, workspace_id: ws, signal_type: "geographic_expansion", lifecycle_status: lifecycle,
  verification_status: level === "corroborated" ? "provider_verified" : "unverified", confidence: "medium",
  occurred_at: ago(d), observed_at: ago(d - 1), source_url: `https://news.example/${id}`, subject_key: id,
  normalized_value: { lisa: { company: { name, domain }, title, verification: { level } } } });
type Row = Record<string, unknown>;
const TABLES: Record<string, Row[]> = {
  workspace_members: [{ workspace_id: WS, user_id: USER }],
  company_brain: [],
  signal_events: [
    sig(WS, "s1", "Kestrel Fabrication", "kestrel-fab.example", "opens a second plant in Dayton, Ohio", "corroborated", 6),
    sig(WS, "s2", "Harbor Valve Works", "harborvalve.example", "is hiring 12 machinists", "single_source", 9),
    sig(WS, "s3", "Pinecrest Tooling", "pinecrest.example", "adds a CNC line (forum post)", "single_source", 130),
    sig(WS, "s4", "Ridgeway Castings", "ridgeway.example", "expansion denied by the company", "contradicted", 8, "contradicted"),
    sig(OTHER, "s9", "Zephyr Industries", "zephyr.example", "ISOLATION CANARY — opens a plant", "corroborated", 3),
  ],
  lead_candidates: [
    { id: "l1", workspace_id: WS, status: "qualified", fit_score: 86, reason: "US manufacturer, 140 employees — inside ICP", created_at: ago(5), account_id: "a1", accounts: { name: "Kestrel Fabrication", domain: "kestrel-fab.example" } },
    { id: "l2", workspace_id: WS, status: "rejected", fit_score: 18, reason: "Software company — outside the manufacturing ICP", created_at: ago(10), account_id: "a3", accounts: { name: "Cloudnova Software", domain: "cloudnova.example" } },
    { id: "l3", workspace_id: WS, status: "rejected", fit_score: 35, reason: "400 employees — above the 20–200 size band", created_at: ago(6), account_id: "a4", accounts: { name: "Summit Robotics", domain: "summit-robotics.example" } },
    { id: "l9", workspace_id: OTHER, status: "qualified", fit_score: 90, reason: "ISOLATION CANARY", created_at: ago(2), account_id: "a9", accounts: { name: "Zephyr Industries", domain: "zephyr.example" } },
  ],
};
function db() {
  return { from(t: string) {
    let rows = [...(TABLES[t] ?? [])];
    // deno-lint-ignore no-explicit-any
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const q: any = { select() { return q; }, order() { return q; }, in() { return q; },
      eq(c: string, v: unknown) { rows = rows.filter((r) => r[c] === v); return q; },
      limit(n: number) { rows = rows.slice(0, n); return q; },
      maybeSingle() { return Promise.resolve({ data: rows[0] ?? null }); },
      then(res: (v: unknown) => unknown) { return Promise.resolve({ data: rows, error: null }).then(res); } };
    return q;
  } };
}

Deno.test("pilot evidence: every converse question gets pilot-only, dated, labelled evidence; the canary never appears", async () => {
  const r = await retrieveEvidence(db(), { workspaceId: WS, userId: USER, now: NOW, limit: 40 });
  assert(r.ok);
  for (const q of PILOT_QUESTIONS.filter((x) => x.deterministic.converse_task && x.deterministic.converse_task !== "simple_chat")) {
    const d = buildOrionEvidenceDigest({ items: selectEvidenceForQuestion(r.items, q.question), brain: r.brain, sources: r.sources, now: NOW });
    const text = d.facts.map((f) => f.text).join("\n");
    assertFalse(/Zephyr|ISOLATION CANARY/.test(text), `${q.id}: canary leaked`);
    if (/Pinecrest/.test(text)) assert(/stale/.test(text.split("\n").find((l) => l.includes("Pinecrest"))!), `${q.id}: Pinecrest labelled stale`);
    if (/Ridgeway/.test(text)) assert(/contradicted/.test(text.split("\n").find((l) => l.includes("Ridgeway"))!), `${q.id}: Ridgeway labelled contradicted`);
  }
  // Named-company questions put that company first.
  const q11 = selectEvidenceForQuestion(r.items, PILOT_QUESTIONS.find((x) => x.id === "Q11")!.question);
  assert(["Kestrel Fabrication", "Harbor Valve Works"].includes(q11[0].subject.name!));
});

const GOOD: Record<string, string> = {
  Q01: "Focus on Kestrel Fabrication [E1]: its second plant in Dayton is verified. Recommended: ATLAS researches it (needs your approval).",
  Q02: "Your Company Brain is not set up, so I can't judge ICP fit. From recorded lead reasons, Kestrel Fabrication [E1] fits best. Next step: complete onboarding, then ATLAS can qualify.",
  Q03: "Kestrel Fabrication's second plant [E1] is verified. Harbor Valve Works hiring [E2] is single source. Recommended: LISA keeps watching Harbor.",
  Q04: "Yes — verified by two sources [E1], 6 days ago.",
  Q05: "No: the reported expansion is contradicted — the company denied it [E4].",
  Q06: "That comes from a forum post 130 days old — stale and single source [E3]. Treat it as unconfirmed.",
  Q07: "Cloudnova Software was rejected: it is a software company, outside the manufacturing ICP.",
  Q08: "Summit Robotics was rejected: 400 employees is above the 20–200 size band.",
  Q09: "Harbor Valve Works was not rejected — it is qualified (fit 71).",
  Q10: "No — it is single source [E2], so it's not confirmed yet.",
  Q11: "Kestrel first: verified expansion [E1] and higher fit; Harbor [E2] is single source. Recommended: ATLAS researches Kestrel (approval needed).",
  Q12: "LYRA could draft a post on Kestrel's verified Dayton second plant [E1] — draft only, sent after your approval.",
  Q13: "I don't have anything on Zephyr Industries in this workspace.",
  Q14: "In the last 7 days Kestrel Fabrication was qualified and Summit Robotics was rejected (size).",
  Q15: "Build on Kestrel in Dayton, Ohio [E1]: ATLAS researches similar Ohio manufacturers and LISA watches for new plants — paid research needs your approval.",
};

Deno.test("scorer: a correct transcript passes every computable criterion; leaks, bad citations and forbidden picks fail", () => {
  const meta = { orion_evidence: { cited_ids: ["a", "b", "c", "d"], retrieval_ms: 120 }, model_route: { decision: "disabled" } };
  const good: Turn[] = PILOT_QUESTIONS.map((q) => ({ question_id: q.id, answer: GOOD[q.id], metadata: meta, latency_ms: 4000 }));
  const base: Turn[] = good.map((t) => ({ ...t, latency_ms: 3600 }));
  const s = scoreRun(good, base);
  for (const [k, v] of Object.entries(s.criteria)) assert(v.pass !== false, `${k}: ${JSON.stringify(v.value)}`);
  const bad = good.map((t) => t.question_id === "Q13" ? { ...t, answer: "ISOLATION CANARY — Zephyr opens a plant." }
    : t.question_id === "Q01" ? { ...t, answer: "Prioritize Cloudnova Software [E9] — reach out now." } : t);
  const b = scoreRun(bad);
  assertEquals(b.criteria.isolation_leaks.pass, false);
  assertEquals(b.criteria.evidence_citation_integrity.pass, false);
  assertEquals(b.criteria.evidence_forbidden_recommendations.pass, false);
  assertEquals(ACCEPTANCE.terra_calls, 0);
});

Deno.test("scorer: a missing-Brain gate counts only where the question allows it, and is reported separately", () => {
  const meta = { orion_evidence: { cited_ids: ["a"], retrieval_ms: 100 } };
  const turns: Turn[] = PILOT_QUESTIONS.map((q) => ({ question_id: q.id, answer: GOOD[q.id], metadata: meta, latency_ms: 3000 }));
  const gatedQ12 = turns.map((t) => t.question_id === "Q12" ? { ...t, answer: "I need your Company Brain first.", metadata: { gated: "missing_brain" } } : t);
  const s = scoreRun(gatedQ12);
  assertEquals(s.criteria.gated_by_missing_brain.value, ["Q12"]);
  assertEquals(s.criteria.evidence_required_points.pass, true);
  const gatedQ01 = turns.map((t) => t.question_id === "Q01" ? { ...t, answer: "I need your Company Brain first.", metadata: { gated: "missing_brain" } } : t);
  assertEquals(scoreRun(gatedQ01).criteria.gated_by_missing_brain.value, [], "Q01 may not be excused by a gate");
});

import { preflight } from "../../../../scripts/model-bench/run.ts";
Deno.test("bench preflight: committed manifest matches the code; keys reported as yes/no only", async () => {
  const none = await preflight(1, () => undefined);
  assertEquals(none.manifest_matches_code, true);
  assertEquals(none.ready, false);
  assertEquals(none.hard_maximum_usd <= none.cap_usd, true);
  const both = await preflight(1, (k) => (k.endsWith("_API_KEY") ? "sk-dummy" : undefined));
  assertEquals(both.ready, true);
  assertEquals(both.candidates_skipped, []);
  assertFalse(JSON.stringify(both).includes("sk-dummy"), "key values are never echoed");
});
