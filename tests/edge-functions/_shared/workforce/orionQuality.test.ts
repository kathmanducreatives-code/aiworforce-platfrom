// ORION ANSWER QUALITY (retrieval, freshness, evidence, follow-ups) and the
// remaining hybrid-routing controls. Fictional data; mocked tables; no network.
import { assert, assertEquals, assertFalse, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { buildOrionEvidenceDigest, ORION_BUSINESS_ANSWER_SHAPE, selectEvidenceForQuestion } from "../../../../supabase/functions/_shared/orionEvidenceContext.ts";
import { converseSystemPrompt } from "../../../../supabase/functions/_shared/converseSurface.ts";
import { workspaceFact } from "../../../../supabase/functions/_shared/groundedFacts.ts";
import { retrieveEvidence } from "../../../../supabase/functions/_shared/evidence/retrieve.ts";
import { buildPresentedReferents, readPresentedReferents, PRESENTED_REFERENTS_KEY } from "../../../../supabase/functions/_shared/referentPersistence.ts";
import { lyraTaskFor, orionConverseTask, resolvePronounCompany } from "../../../../supabase/functions/_shared/departmentRouting.ts";
import { maxUsdPerCall, resolveTaskRoute } from "../../../../supabase/functions/_shared/modelRoutePolicy.ts";
import { routeAttemptFor, worstCaseCallUsd } from "../../../../supabase/functions/_shared/aiProvider.ts";
import { createRouteLimiter } from "../../../../supabase/functions/_shared/terraPolicy.ts";
import { routeModel } from "../../../../supabase/functions/_shared/gptModelRouter.ts";

const WS = "aaaaaaaa-0000-4000-8000-0000000000a1";
const USER = "11111111-0000-4000-8000-0000000000a2";
const NOW = new Date("2026-11-11T12:00:00Z");
type Row = Record<string, unknown>;
function db(tables: Record<string, Row[]>) {
  return { from(t: string) {
    let rows = [...(tables[t] ?? [])];
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
const sig = (id: string, name: string, domain: string, title: string, level: string, date: string): Row => ({
  id, workspace_id: WS, signal_type: "expansion", lifecycle_status: level === "contradicted" ? "contradicted" : "active",
  verification_status: level === "corroborated" ? "provider_verified" : "unverified", confidence: "medium", occurred_at: date,
  observed_at: "2026-11-09T09:00:00Z", source_url: `https://news.example/${id}`, subject_key: domain,
  normalized_value: { lisa: { company: { name, domain }, title, event_date: date, verification: { level } } },
});
// FIXTURE (fictional): US manufacturing 20–200, software excluded by an approved memory item.
const TABLES: Record<string, Row[]> = {
  workspace_members: [{ workspace_id: WS, user_id: USER }],
  company_brain: [{ workspace_id: WS, onboarding_completed: true, updated_at: "2026-10-01T00:00:00Z",
    profile: { schema_version: 2, company: { name: "Everest Industrial (fictional)" },
      target_customer: { industries: ["Manufacturing"], geography: ["United States"], company_size: { min: 20, max: 200 } } } }],
  company_brain_memory: [{ id: "m-ex", workspace_id: WS, kind: "preference", category: "exclusions", fact_key: "exclusion.industry:software",
    scope: "workspace", scope_ref: null, value_type: "object", value: { type: "industry", value: "Software" }, version: 1,
    source_type: "user_provided", verification_status: "user_confirmed", confidence: "high", lifecycle_status: "active",
    persistence: "permanent", approval_status: "approved", created_by_kind: "user", updated_at: "2026-10-05T00:00:00Z" }],
  signal_events: [
    sig("s1", "Kestrel Fabrication", "kestrel-fab.example", "opens a second plant in Dayton", "corroborated", "2026-11-05"),
    sig("s2", "Harbor Valve Works", "harborvalve.example", "hiring 12 machinists", "single_source", "2026-11-02"),
    sig("s3", "Cloudnova Software", "cloudnova.example", "opens a new software office", "corroborated", "2026-11-04"),
    sig("s4", "Pinecrest Tooling", "pinecrest.example", "adds a CNC line (forum)", "single_source", "2026-07-01"),
  ],
  lead_candidates: [{ id: "l1", workspace_id: WS, status: "rejected", fit_score: 20, reason: "Software company — outside ICP",
    created_at: "2026-11-01T00:00:00Z", account_id: "a1", accounts: { name: "Cloudnova Software", domain: "cloudnova.example" } }],
};

async function digestFor(message: string) {
  const r = await retrieveEvidence(db(TABLES), { workspaceId: WS, userId: USER, now: NOW, limit: 40 });
  assert(r.ok);
  return buildOrionEvidenceDigest({ items: selectEvidenceForQuestion(r.items, message), brain: r.brain, sources: r.sources, now: NOW });
}

Deno.test("ORION evidence: business questions get dated, verification-labelled, citable facts with ages", async () => {
  const d = await digestFor("Which opportunities best match our ICP right now?");
  const text = d.facts.map((f) => f.text).join("\n");
  assertStringIncludes(text, "[E1] Kestrel Fabrication");
  assertStringIncludes(text, "verified");
  assertStringIncludes(text, "2026-11-05, 6 days ago");
  assertStringIncludes(text, "stale", "a July forum post is stale, not current");
  assertStringIncludes(text, "no live web search was run");
  assert(d.facts.every((f) => f.scope === "workspace"));
  assertEquals(d.cited_ids.length, d.facts.length - 1);
});

Deno.test("ORION evidence: excluded companies are marked so they are never recommended", async () => {
  const d = await digestFor("What should we prioritize?");
  const cloud = d.facts.map((f) => f.text).find((t) => t.includes("Cloudnova"))!;
  assertStringIncludes(cloud, "EXCLUDED by the Company Brain (industry Software)");
});

Deno.test("ORION evidence: named companies come first (comparisons, rejection questions)", async () => {
  const d = await digestFor("Compare Pinecrest Tooling with Harbor Valve Works");
  const first2 = d.facts.slice(0, 2).map((f) => f.text).join(" ");
  assertStringIncludes(first2, "Pinecrest");
  assertStringIncludes(first2, "Harbor Valve");
});

Deno.test("ORION evidence: empty workspace says so instead of implying emptiness or inventing", () => {
  const d = buildOrionEvidenceDigest({ items: [], brain: null, sources: { lead: "unavailable" }, now: NOW });
  assertEquals(d.facts.length, 1);
  assertStringIncludes(d.facts[0].text, "may still hold records not retrieved");
});

Deno.test("ORION prompt: default conversational prompt unchanged; business shape only when evidence is attached", () => {
  const base = converseSystemPrompt({ workspaceContext: "profile", facts: [workspaceFact("x", "y")] });
  const same = converseSystemPrompt({ workspaceContext: "profile", facts: [workspaceFact("x", "y")], answerShape: null });
  assertEquals(base, same);
  assertFalse(base.includes("ANSWER SHAPE"));
  const shaped = converseSystemPrompt({ workspaceContext: "profile", facts: [], answerShape: ORION_BUSINESS_ANSWER_SHAPE });
  for (const h of ["What happened", "Why it matters", "Evidence", "Recommended action", "EXCLUDED", "say exactly what is missing"]) assertStringIncludes(shaped, h);
  assertStringIncludes(shaped, "Use ONLY the workspace facts given below", "grounding rules preserved");
});

Deno.test("ORION follow-ups: cited companies persist as referents so 'it' / 'the second one' resolve", async () => {
  const d = await digestFor("Compare Pinecrest Tooling with Harbor Valve Works");
  const meta = { [PRESENTED_REFERENTS_KEY]: buildPresentedReferents(d.subjects, "orion_evidence") };
  const back = readPresentedReferents(meta)!;
  assertEquals(back.kind, "orion_evidence");
  assertEquals(back.entities[1].name, d.subjects[1].name);
  const one = resolvePronounCompany([buildPresentedReferents([d.subjects[0]], "orion_evidence")]);
  assertEquals(one.kind, "one");
});

Deno.test("ORION wiring: evidence context is flag-gated, skipped for small talk, and spends nothing", async () => {
  const src = await Deno.readTextFile(new URL("../../../../supabase/functions/pilot-chat/index.ts", import.meta.url));
  assertStringIncludes(src, "orionEvidenceForTurn(admin as unknown as StoredEvidenceDb, { task: converseTask, workspaceId, userId, message })");
  const { orionEvidenceForTurn } = await import("../../../../supabase/functions/_shared/orionEvidenceContext.ts");
  const args = { task: "complex_company_qa", workspaceId: WS, userId: USER, message: "Which opportunities fit?", now: NOW };
  assertEquals(await orionEvidenceForTurn(db(TABLES), args, () => undefined), null, "off by default");
  assertEquals(await orionEvidenceForTurn(db(TABLES), { ...args, task: "simple_chat" }, () => "true"), null, "never for small talk");
  assert(await orionEvidenceForTurn(db(TABLES), args, (k) => (k === "AGENTORY_ORION_EVIDENCE_CONTEXT" ? "true" : undefined)));
  const helper = await Deno.readTextFile(new URL("../../../../supabase/functions/_shared/orionEvidenceContext.ts", import.meta.url));
  assertStringIncludes(helper, "retrieveEvidence(db, { workspaceId: i.workspaceId, userId: i.userId", "membership-checked retrieval with the user");
  assertEquals(orionConverseTask("hello"), "simple_chat");
});

Deno.test("routing: pilot scope — only listed workspaces route; workspace-less pipeline calls never do", () => {
  const env = { AGENTORY_HYBRID_ROUTING_ENABLED: "true", AGENTORY_VERIFIED_MODELS: "gpt-6.1-terra",
    AGENTORY_ROUTE_COMPLEX_COMPANY_QA: "gpt-6.1-terra:low", AGENTORY_ROUTE_ATLAS_QUALIFICATION: "gpt-6.1-terra",
    AGENTORY_ROUTE_WORKSPACES: WS };
  const read = (k: string) => (env as Record<string, string>)[k];
  assert(resolveTaskRoute("complex_company_qa", read, NOW, { workspaceId: WS }).use);
  assertEquals((resolveTaskRoute("complex_company_qa", read, NOW, { workspaceId: "other" }) as { reason: string }).reason, "workspace_not_enabled");
  assertEquals(routeModel("company_qualification", {}, "gpt-5.6", read).model, "gpt-5.6-luna", "pipeline stays put during an ORION pilot");
});

Deno.test("routing: per-call worst-case spend admission", () => {
  assertEquals(maxUsdPerCall(() => undefined), 0.05);
  const small = worstCaseCallUsd("gpt-6.1-terra", "low", { systemPrompt: "x".repeat(4000), messages: [{ role: "user", content: "q" }], maxTokens: 420 });
  assert(small < 0.05, String(small));
  const env = { AGENTORY_HYBRID_ROUTING_ENABLED: "true", AGENTORY_VERIFIED_MODELS: "gpt-6.1-terra",
    AGENTORY_ROUTE_COMPLEX_COMPANY_QA: "gpt-6.1-terra:medium", AGENTORY_ROUTE_MAX_USD_PER_CALL: "0.01" };
  const read = (k: string) => (env as Record<string, string>)[k];
  const lim = createRouteLimiter(() => undefined);
  const a = routeAttemptFor({ taskType: "pilot_chat", workforceTask: "complex_company_qa", terraLimiter: lim, onModelCall: () => {},
    systemPrompt: "x".repeat(8000), messages: [{ role: "user", content: "q" }], maxTokens: 900 }, true, read);
  assertEquals(a.decision, "over_call_cap");
  assertEquals(lim.used(), 0, "a refused call does not consume a routed slot");
});

Deno.test("LYRA: strategy work is a Terra-candidate task; routine drafts stay cheap", () => {
  assertEquals(lyraTaskFor("Plan a two-week LinkedIn content calendar for our Midwest push"), "lyra_strategy");
  assertEquals(lyraTaskFor("Draft our go-to-market messaging framework"), "lyra_strategy");
  assertEquals(lyraTaskFor("Write a LinkedIn post about the Kestrel expansion"), "lyra_content");
});

Deno.test("ORION evidence: the loader refuses a non-member (nothing read) and returns a digest for a member", async () => {
  const { loadOrionEvidenceDigest } = await import("../../../../supabase/functions/_shared/orionEvidenceContext.ts");
  assertEquals(await loadOrionEvidenceDigest(db(TABLES), { workspaceId: WS, userId: "11111111-0000-4000-8000-0000000000ff", message: "q", now: NOW }), null);
  const d = await loadOrionEvidenceDigest(db(TABLES), { workspaceId: WS, userId: USER, message: "Which opportunities fit?", now: NOW });
  assert(d && d.cited_ids.length > 0);
});
