// COMPANY BRAIN V2 — LIVE PRODUCT ACCEPTANCE (B2.0–B2.4), against a REAL project.
//
//   BRAIN_TEST_URL=https://<brain-test-ref>.supabase.co \
//   BRAIN_TEST_ANON_KEY=… BRAIN_TEST_SERVICE_ROLE_KEY=… \
//   deno run --allow-net --allow-env --allow-read --allow-write \
//     scripts/test-project/brain-test/acceptance.ts --confirm <brain-test-ref> \
//       [--allow-orion-chat --max-usd <approved limit>] [--report out.json]
//
// What it does, through the project's own Auth, REST and Edge Functions only:
//   seeds two FICTIONAL workspaces (owner/editor/viewer + an outsider) through
//   the Auth admin API and service-role REST, then proves, as real signed-in
//   users calling the deployed functions:
//     A1 business profile completion        A5 Teach Agentory (+ conflict confirmation)
//     A2 ICP conflict resolution            A6 ORION conversation → memory → new conversation
//     A3 research suggestion approval       A7 shared context across ORION, LISA, LYRA
//     A4 knowledge provenance               A8 workspace isolation and role permissions
//
// SAFETY
//   · Refuses production (ohsdatpvfdjdemstoiuj), the ATLAS TEST project
//     (tlvnfrxzjhsjgdofwehb) and the paused AgriDrone project, before any request.
//   · --confirm must repeat the project ref found in BRAIN_TEST_URL.
//   · No paid provider is called: no research run, no Apify, no Firecrawl. The
//     stored "research" is a fictional row. ORION's offer path is exercised
//     exactly as pilot-chat runs it server-side (offerMemoryFromTurn → the
//     proposal RPC) with NO model call. --allow-orion-chat additionally sends
//     exactly TWO real ORION chat turns (OpenAI tokens, a few cents) — off by
//     default, and only with --max-usd: the spend recorded in lead_model_calls
//     for this run's workspace must be priced, non-zero and <= that limit, or the
//     run FAILS. The hard stop is server-side: set MODEL_SPEND_CEILING_USD on the
//     project (deploy-brain-test.sh --spend-ceiling-usd), which pilot-chat checks
//     before every turn, per workspace; each run uses a fresh workspace.
//   · Keys are read from the environment and never printed. Fixture passwords
//     are random per run and never written anywhere.
import { assessIcpConsistency } from "../../../supabase/functions/_shared/companyBrainIcpConsistency.ts";
import { acceptSuggestionPatch, buildCompletionSuggestions, type StoredResearchRun } from "../../../supabase/functions/_shared/companyBrainCompletion.ts";
import { offerMemoryFromTurn } from "../../../supabase/functions/_shared/orionMemoryOfferRuntime.ts";

type Raw = Record<string, unknown>;
export interface AcceptanceConfig {
  /** Base URL exposing /auth/v1, /rest/v1 and /functions/v1 (a Supabase project, or the local gateway). */
  url: string;
  anonKey: string;
  serviceKey: string;
  allowOrionChat?: boolean;
  /** Required with allowOrionChat: the approved limit, in USD, for this run's model spend. */
  maxUsd?: number;
  log?: (line: string) => void;
}
export interface Check { id: string; area: string; ok: boolean; detail: string }
export interface AcceptanceReport { run_id: string; started_at: string; finished_at: string; passed: number; failed: number; checks: Check[]; notes: string[] }

export const REFUSED_REFS = ["ohsdatpvfdjdemstoiuj", "tlvnfrxzjhsjgdofwehb", "luvostyizefajbltukkc"];

// ── fixture data (fictional) ─────────────────────────────────────────────────
const RUN_PAGES = ["https://northwind-clinics.example/", "https://northwind-clinics.example/pricing"];
export const FIXTURE_PROFILE: Raw = {
  schema_version: 2,
  company: { name: "Northwind Clinics (fictional)", description: "Scheduling software for physiotherapy clinics", category: "Healthcare SaaS" },
  // A recorded contradiction (size label vs bounds) for A2, and an empty promise for A3.
  target_customer: { industries: ["Healthcare"], geography: ["Portugal"], company_size: { min: 5, max: 50, label: "200-500" }, disqualifiers: {} },
  buyer_personas: ["Clinic owner", "Practice manager"],
  positioning: { promise: "", differentiators: [] },
  competitors: ["Rivalco (fictional)"],
  brand_voice: { tone: "warm" },
};
const RESEARCH_OUTPUT: Raw = {
  description: "Scheduling software for physiotherapy clinics",
  understanding: { main_promise: "Fill every appointment slot automatically" },
  positioning_claims: ["Fill every appointment slot automatically", "Two-way calendar sync"],
  source_pages: RUN_PAGES,
};

// ── a thin client over the project's real endpoints ──────────────────────────
function client(cfg: AcceptanceConfig) {
  const base = cfg.url.replace(/\/$/, "");
  const svc = { apikey: cfg.serviceKey, Authorization: `Bearer ${cfg.serviceKey}`, "Content-Type": "application/json" };
  const as = (token: string) => ({ apikey: cfg.anonKey, Authorization: `Bearer ${token}`, "Content-Type": "application/json" });
  const j = async (r: Response) => { const t = await r.text(); try { return { status: r.status, body: t ? JSON.parse(t) : null }; } catch { return { status: r.status, body: t }; } };
  return {
    base,
    async adminCreateUser(email: string, password: string) {
      return j(await fetch(`${base}/auth/v1/admin/users`, { method: "POST", headers: svc, body: JSON.stringify({ email, password, email_confirm: true }) }));
    },
    async signIn(email: string, password: string): Promise<{ token: string; id: string }> {
      const r = await j(await fetch(`${base}/auth/v1/token?grant_type=password`, { method: "POST", headers: { apikey: cfg.anonKey, "Content-Type": "application/json" }, body: JSON.stringify({ email, password }) }));
      if (r.status !== 200) throw new Error(`sign-in failed (${r.status})`);
      return { token: String(r.body.access_token), id: String(r.body.user?.id) };
    },
    async svcInsert(table: string, row: Raw) {
      return j(await fetch(`${base}/rest/v1/${table}`, { method: "POST", headers: { ...svc, Prefer: "return=representation" }, body: JSON.stringify(row) }));
    },
    async svcRpc(fn: string, args: Raw) {
      return j(await fetch(`${base}/rest/v1/rpc/${fn}`, { method: "POST", headers: svc, body: JSON.stringify(args) }));
    },
    async svcSelect(path: string) {
      return j(await fetch(`${base}/rest/v1/${path}`, { headers: svc }));
    },
    async select(token: string, path: string) {
      return j(await fetch(`${base}/rest/v1/${path}`, { headers: as(token) }));
    },
    async insertAs(token: string, table: string, row: Raw) {
      return j(await fetch(`${base}/rest/v1/${table}`, { method: "POST", headers: { ...as(token), Prefer: "return=minimal" }, body: JSON.stringify(row) }));
    },
    async fn(token: string, name: string, body: Raw) {
      return j(await fetch(`${base}/functions/v1/${name}`, { method: "POST", headers: as(token), body: JSON.stringify(body) }));
    },
  };
}

// ── the suite ────────────────────────────────────────────────────────────────
export async function runBrainAcceptance(cfg: AcceptanceConfig): Promise<AcceptanceReport> {
  const log = cfg.log ?? ((l: string) => console.log(l));
  const c = client(cfg);
  const run = crypto.randomUUID().slice(0, 8);
  const checks: Check[] = [];
  const notes: string[] = [];
  const started_at = new Date().toISOString();
  const check = (id: string, area: string, ok: boolean, detail: string) => {
    checks.push({ id, area, ok, detail });
    log(`${ok ? "PASS" : "FAIL"}  ${id}  ${detail}`);
  };
  const pw = () => `Fx-${crypto.randomUUID()}!`;

  // ── seed: fictional people, workspaces, Brain, stored research ─────────────
  const people: Record<string, { email: string; password: string; token: string; id: string }> = {};
  for (const role of ["owner", "editor", "viewer", "outsider"]) {
    const email = `brain-acceptance+${run}-${role}@example.test`;
    const password = pw();
    const made = await c.adminCreateUser(email, password);
    if (made.status >= 300) throw new Error(`could not create fixture user ${role} (${made.status})`);
    const s = await c.signIn(email, password);
    people[role] = { email, password, ...s };
  }
  const wsA = crypto.randomUUID(); const wsB = crypto.randomUUID();
  for (const [id, name] of [[wsA, `Fictional Northwind Clinics ${run}`], [wsB, `Fictional Harbor Logistics ${run}`]]) {
    const r = await c.svcInsert("workspaces", { id, name });
    if (r.status >= 300) throw new Error(`could not create fixture workspace (${r.status}: ${JSON.stringify(r.body).slice(0, 200)})`);
  }
  for (const [ws, who, role] of [[wsA, "owner", "owner"], [wsA, "editor", "editor"], [wsA, "viewer", "viewer"], [wsB, "outsider", "owner"]] as const) {
    const r = await c.svcInsert("workspace_members", { workspace_id: ws, user_id: people[who].id, role });
    if (r.status >= 300) throw new Error(`could not add fixture member (${r.status})`);
  }
  await c.svcInsert("company_brain", { workspace_id: wsA, profile: FIXTURE_PROFILE, onboarding_completed: true });
  await c.svcInsert("company_brain", { workspace_id: wsB, profile: { schema_version: 2, company: { name: "Harbor Logistics (fictional)" } }, onboarding_completed: true });
  const runRow = await c.svcInsert("company_brain_research_runs", {
    workspace_id: wsA, source_type: "company_website", provider: "acceptance-fixture", status: "completed", output: RESEARCH_OUTPUT,
  });
  const runId = String((Array.isArray(runRow.body) ? runRow.body[0] : runRow.body)?.id ?? "");
  log(`seeded run ${run}: workspaces A=${wsA.slice(0, 8)} B=${wsB.slice(0, 8)}, research run ${runId.slice(0, 8)}`);

  const ed = people.editor.token, ow = people.owner.token, vw = people.viewer.token, out = people.outsider.token;
  const brain = async (token = ed) => {
    const r = await c.select(token, `company_brain?workspace_id=eq.${wsA}&select=profile,updated_at`);
    return (Array.isArray(r.body) ? r.body[0] : null) as { profile: Raw; updated_at: string } | null;
  };
  const update = async (patch: Raw, provenance?: Raw, token = ed) => {
    const b = await brain(token);
    return c.fn(token, "generate-company-brain-draft", { action: "update", workspace_id: wsA, patch, expected_updated_at: b?.updated_at, ...(provenance ? { provenance } : {}) });
  };
  const lastRevision = async (section: string) => {
    const r = await c.select(ed, `company_brain_revisions?workspace_id=eq.${wsA}&changed_sections=cs.{${section}}&order=revision.desc&limit=1&select=revision,source_kind,source_ref,reason,actor_id`);
    if (r.status >= 300) return { missing: true, body: r.body } as Raw;
    return (Array.isArray(r.body) ? r.body[0] : null) as Raw | null;
  };
  const mem = (token: string, body: Raw) => c.fn(token, "company-brain-memory", { workspace_id: wsA, ...body });
  const idem = () => `acc-${crypto.randomUUID()}`;

  // ── A1 business profile completion ─────────────────────────────────────────
  const goals = await update({ goals: { outreach: "50 replies a month (fictional)", gtm: "10 meetings a month (fictional)" } });
  check("A1.1", "profile completion", goals.status === 200, `editor saves goals → ${goals.status}`);
  const afterGoals = await brain();
  check("A1.2", "profile completion", (afterGoals?.profile.goals as Raw | undefined)?.outreach === "50 replies a month (fictional)", "goals persisted and read back over RLS");
  const viewerSave = await update({ goals: { outreach: "viewer edit" } }, undefined, vw);
  check("A1.3", "profile completion", viewerSave.status === 403, `viewer save refused → ${viewerSave.status}`);

  // ── A2 ICP conflict resolution ─────────────────────────────────────────────
  const conflicts = assessIcpConsistency((await brain())!.profile).conflicts;
  const size = conflicts.find((x) => x.id === "size_label_vs_bounds");
  check("A2.1", "ICP conflicts", !!size, `recorded contradiction detected (${conflicts.map((x) => x.id).join(", ") || "none"})`);
  if (size) {
    const r = size.resolutions.find((x) => x.id === "use_bounds") ?? size.resolutions[0];
    const res = await update(r.patch, { source: "resolution", conflict_id: size.id, resolution_id: r.id });
    check("A2.2", "ICP conflicts", res.status === 200, `one-click resolution → ${res.status}`);
    check("A2.3", "ICP conflicts", !assessIcpConsistency((await brain())!.profile).conflicts.some((x) => x.id === "size_label_vs_bounds"), "the contradiction is gone after resolving");
  }
  const contra = await update({ target_customer: { disqualifiers: { industries: ["Healthcare"], company_types: [], domains: [], keywords: [], titles: [] } } });
  check("A2.4", "ICP conflicts", contra.status === 400 && contra.body?.rejected_reason === "icp_contradiction", `a write that creates a contradiction is refused → ${contra.status} ${contra.body?.rejected_reason ?? ""}`);

  // ── A3 research suggestion approval ────────────────────────────────────────
  const prof = (await brain())!.profile;
  const runs: StoredResearchRun[] = [{ id: runId, source_type: "company_website", status: "completed", output: RESEARCH_OUTPUT, created_at: new Date().toISOString() }];
  const sug = buildCompletionSuggestions(prof, runs).find((s) => s.path === "positioning.promise");
  check("A3.1", "research suggestions", !!sug, "a suggestion is derived from the stored research run");
  if (sug) {
    const acc = await update(acceptSuggestionPatch(prof, sug), { source: "suggestion", suggestion_id: sug.id });
    const p = acc.body?.provenance as Raw | undefined;
    check("A3.2", "research suggestions", acc.status === 200, `accepting it → ${acc.status}`);
    if (p) check("A3.3", "research suggestions", p.kind === "research" && p.research_run_id === runId, `recorded as research, linked to the run (${p.kind}, ${String(p.research_run_id).slice(0, 8)})`);
    else notes.push("A3.3: no provenance in the update response — the B2.2 function is not deployed on this project.");
    const accRev = await lastRevision("positioning");
    if (accRev && !(accRev as Raw).missing && "source_kind" in accRev) {
      check("A4.2", "provenance", accRev.source_kind === "research" && accRev.source_ref === runId, `its revision: ${accRev.source_kind}, run ${String(accRev.source_ref).slice(0, 8)}`);
    }
    const forged = await update({ positioning: { promise: "Number one in Europe" } }, { source: "suggestion", suggestion_id: "positioning.promise:website_research" });
    if (forged.body?.provenance) check("A3.4", "research suggestions", (forged.body.provenance as Raw).downgraded === true && (forged.body.provenance as Raw).kind === "founder", "a forged research claim is recorded as the person's own edit");
    const forgedRev = await lastRevision("positioning");
    if (forgedRev && "source_kind" in forgedRev) check("A4.3", "provenance", forgedRev.source_kind === "founder" && forgedRev.source_ref == null, "the forged claim's revision cites no research run");
  }

  // ── A4 provenance ──────────────────────────────────────────────────────────
  const goalsRev = await lastRevision("goals");
  if (goalsRev && (goalsRev as Raw).missing) notes.push("A4: revisions not readable — the V1 memory migration is not applied on this project.");
  else {
    check("A4.1", "provenance", goalsRev?.source_kind === "founder" && goalsRev?.actor_id === people.editor.id, `goals revision: ${goalsRev?.source_kind} by the editor`);
    const tc = await lastRevision("target_customer");
    check("A4.6", "provenance", String(tc?.reason ?? "").includes("Resolved a conflict"), "the resolution is named in its revision's reason");
    const forgeRev = await c.insertAs(ed, "company_brain_revisions", { workspace_id: wsA, revision: 999, profile: {}, actor_kind: "user", actor_id: people.editor.id, source_kind: "research" });
    check("A4.4", "provenance", forgeRev.status >= 400, `the browser cannot write a revision → ${forgeRev.status}`);
    const forgeRun = await c.insertAs(ed, "company_brain_research_runs", { workspace_id: wsA, source_type: "company_website", provider: "forged", status: "completed", output: {} });
    check("A4.5", "provenance", forgeRun.status >= 400, `the browser cannot create a research run to cite → ${forgeRun.status}`);
  }

  // ── A5 Teach Agentory ──────────────────────────────────────────────────────
  const dec = await mem(ed, { action: "write", op: "decide", idempotency_key: idem(), payload: { category: "strategy_selected", fact_key: "decision.sell-annual-plans-only", value: { outcome: "Sell annual plans only" } } });
  check("A5.1", "Teach Agentory", dec.status === 200 && dec.body?.outcome === "ok", `record a decision → ${dec.status} ${dec.body?.outcome}`);
  const fact = await mem(ed, { action: "write", op: "set", idempotency_key: idem(), payload: { kind: "fact", category: "company_facts", fact_key: "fact.we-have-12-employees", value_type: "text", value: "We have 12 employees (fictional)" } });
  check("A5.2", "Teach Agentory", fact.status === 200, `record a fact → ${fact.status}`);
  const corr = await mem(ed, { action: "write", op: "correct", idempotency_key: idem(), payload: { kind: "fact", category: "corrections", fact_key: "correction.we-sell-to-enterprises", value_type: "object", value: { wrong: "We sell to enterprises", right: "We sell to clinics with 5-50 staff" } } });
  check("A5.3", "Teach Agentory", corr.status === 200, `correct something → ${corr.status}`);
  const exPayload = { kind: "preference", category: "exclusions", fact_key: "exclusion.industry:healthcare", value_type: "object", value: { type: "industry", value: "Healthcare" } };
  const exKey = idem();
  const unconfirmed = await mem(ed, { action: "write", op: "set", idempotency_key: exKey, payload: exPayload });
  check("A5.4", "Teach Agentory", unconfirmed.status === 409 && unconfirmed.body?.outcome === "needs_resolution", `excluding a TARGET industry needs confirmation → ${unconfirmed.status} ${unconfirmed.body?.outcome}`);
  const gamb = await mem(ed, { action: "write", op: "set", idempotency_key: idem(), payload: { kind: "preference", category: "exclusions", fact_key: "exclusion.industry:gambling", value_type: "object", value: { type: "industry", value: "Gambling" } } });
  check("A5.5", "Teach Agentory", gamb.status === 200, `a non-conflicting exclusion saves directly → ${gamb.status}`);
  const tone = await mem(ed, { action: "write", op: "set", idempotency_key: idem(), confirm_conflict: true, payload: { kind: "preference", category: "content", fact_key: "content.tone", value_type: "text", value: "plain and technical" } });
  check("A5.6", "Teach Agentory", tone.status === 200, `a tone that differs from the profile, confirmed → ${tone.status}`);

  // ── A6 ORION conversation → memory → new conversation ──────────────────────
  const said = "We've decided to focus on dental clinics in Portugal.";
  const conv = crypto.randomUUID();
  const rpcAdmin = { rpc: async (fn: string, args: Raw) => { const r = await c.svcRpc(fn, args); return { data: r.status < 300 ? r.body : null, error: r.status < 300 ? null : { message: String(r.status) } }; } };
  const offer = await offerMemoryFromTurn(rpcAdmin, { workspaceId: wsA, conversationId: conv, messageId: null, message: said, profile: (await brain())!.profile });
  check("A6.1", "ORION memory", offer?.status === "pending" && !!offer.proposal_id, `ORION's offer is a PENDING proposal (no model call) → ${offer?.status}`);
  const temp = await offerMemoryFromTurn(rpcAdmin, { workspaceId: wsA, conversationId: conv, messageId: null, message: "For this search, skip crypto companies", profile: null });
  check("A6.2", "ORION memory", temp?.status === "temporary", "a temporary request is not stored");
  const before = await mem(ed, { action: "context" });
  check("A6.3", "ORION memory", !String(before.body?.agents?.orion ?? "").includes("dental clinics"), "a pending offer is not used by ORION");
  if (offer?.proposal_id) {
    const viewerApprove = await mem(vw, { action: "review_proposal", proposal_id: offer.proposal_id, decision: "approve", idempotency_key: idem() });
    check("A6.4", "ORION memory", viewerApprove.status === 403, `a viewer cannot approve → ${viewerApprove.status}`);
    const key = idem();
    const approve = await mem(ed, { action: "review_proposal", proposal_id: offer.proposal_id, decision: "correct", corrected_value: { outcome: "Focus on dental clinics in Portugal and Spain" }, idempotency_key: key });
    check("A6.5", "ORION memory", approve.status === 200, `editor edits and approves → ${approve.status}`);
    const replay = await mem(ed, { action: "review_proposal", proposal_id: offer.proposal_id, decision: "correct", corrected_value: { outcome: "Focus on dental clinics in Portugal and Spain" }, idempotency_key: key });
    check("A6.6", "ORION memory", replay.body?.replayed === true, "a retried approval replays (one memory)");
    const second = await mem(ow, { action: "review_proposal", proposal_id: offer.proposal_id, decision: "approve", idempotency_key: idem() });
    check("A6.7", "ORION memory", second.status === 409, `a second approval changes nothing → ${second.status}`);
    const after = await mem(ow, { action: "context" });
    check("A6.8", "ORION memory", String(after.body?.agents?.orion ?? "").includes("Focus on dental clinics in Portugal and Spain"), "a NEW load (as in a new conversation) gives ORION the approved decision");
  }
  if (cfg.allowOrionChat) {
    const area = "ORION memory (real chat, opt-in)";
    const maxUsd = Number(cfg.maxUsd);
    if (!(maxUsd > 0)) throw new Error("allowOrionChat requires maxUsd (the approved spending limit)");
    const chatStart = new Date().toISOString();
    // Turn 1 (model call): a durable preference, which ORION offers to remember.
    const chat = await c.fn(ed, "pilot-chat", { workspace_id: wsA, message: "From now on, never target crypto companies." });
    check("A6.9", area, chat.status === 200, `ORION answers a real chat turn → ${chat.status}`);
    const convId = String(chat.body?.conversation_id ?? "");
    const msgs = await c.select(ed, `messages?conversation_id=eq.${convId}&select=metadata&order=created_at.asc`);
    const offer = (Array.isArray(msgs.body) ? msgs.body : [])
      .map((m: Raw) => (m.metadata as Raw | null)?.memory_offer as Raw | undefined).find(Boolean);
    check("A6.10", area, !!offer?.proposal_id, "ORION's offer appears in the conversation, as a pending proposal");
    // The editor approves it (no model call); a NEW conversation must load the Brain that holds it.
    const ctxBefore = await mem(ow, { action: "context" });
    const approved = offer?.proposal_id
      ? await mem(ed, { action: "review_proposal", proposal_id: offer.proposal_id, decision: "approve", idempotency_key: idem() })
      : { status: 0, body: null };
    check("A6.11", area, approved.status === 200, `the editor approves ORION's offer → ${approved.status}`);
    const ctxNow = await mem(ow, { action: "context" });
    // Turn 2 (model call): a NEW conversation (no conversation_id).
    const chat2 = await c.fn(ed, "pilot-chat", { workspace_id: wsA, message: "In one sentence: which industries should we avoid?" });
    const conv2 = String(chat2.body?.conversation_id ?? "");
    const msgs2 = await c.select(ed, `messages?conversation_id=eq.${conv2}&select=role,metadata&order=created_at.asc`);
    const reply2 = (Array.isArray(msgs2.body) ? msgs2.body : []).filter((m: Raw) => m.role === "assistant").pop() as Raw | undefined;
    const usedCtx = (reply2?.metadata as Raw | null)?.brain_context_id;
    check("A6.12", area,
      chat2.status === 200 && conv2 !== "" && conv2 !== convId && !!ctxNow.body?.context_id && usedCtx === ctxNow.body.context_id
        && ctxNow.body.context_id !== ctxBefore.body?.context_id,
      `a new conversation answers with the Brain that holds the approval (context ${String(usedCtx ?? "none")} = ${String(ctxNow.body?.context_id ?? "none")})`);
    // Spend: every chat model call is recorded in lead_model_calls for this workspace;
    // it must be priced, non-zero and within the approved limit.
    const ledger = await c.svcSelect(`lead_model_calls?workspace_id=eq.${wsA}&started_at=gte.${encodeURIComponent(chatStart)}&select=estimated_cost_usd,actual_cost_usd`);
    const rows = (Array.isArray(ledger.body) ? ledger.body : []) as Raw[];
    const cost = (r: Raw) => (r.actual_cost_usd ?? r.estimated_cost_usd) == null ? NaN : Number(r.actual_cost_usd ?? r.estimated_cost_usd);
    const unpriced = rows.filter((r) => !Number.isFinite(cost(r))).length;
    const spent = rows.reduce((t, r) => t + (Number.isFinite(cost(r)) ? cost(r) : 0), 0);
    check("A6.13", area, ledger.status === 200 && rows.length > 0 && unpriced === 0 && spent > 0 && spent <= maxUsd,
      `model spend recorded: ${rows.length} call(s), $${spent.toFixed(4)} (limit $${maxUsd.toFixed(2)}${unpriced ? `, ${unpriced} UNPRICED` : ""})`);
    notes.push(`model spend: ${rows.length} call(s), $${spent.toFixed(4)} of the approved $${maxUsd.toFixed(2)}`);
  } else notes.push("A6.9–A6.13 (two real ORION chat turns) skipped: pass --allow-orion-chat --max-usd <limit> to spend a few cents of OpenAI tokens.");

  // ── A7 shared context across ORION, LISA, LYRA ─────────────────────────────
  const ctx = await mem(ed, { action: "context" });
  const agents = (ctx.body?.agents ?? {}) as Record<string, string>;
  check("A7.1", "shared context", ["orion", "lyra", "lisa"].every((a) => String(agents[a] ?? "").includes("Gambling")), "the approved exclusion reaches ORION, LYRA and LISA");
  check("A7.2", "shared context", String(agents.lyra ?? "").includes("plain and technical") && !String(agents.orion ?? "").includes("plain and technical"), "the tone reaches LYRA only");
  if (ctx.body?.context_id) {
    const again = await mem(ow, { action: "context" });
    check("A7.3", "shared context", again.body?.context_id === ctx.body.context_id && /^bctx1-[a-p]{16}$/.test(String(ctx.body.context_id)), "two loads, one context id (the same Brain for every agent)");
  } else notes.push("A7.3: no context_id — the B2.4 company-brain-memory function is not deployed on this project.");

  // ── A8 isolation and roles ─────────────────────────────────────────────────
  const outsiderCtx = await mem(out, { action: "context" });
  check("A8.1", "isolation & roles", outsiderCtx.status === 403, `another workspace's owner cannot read A's memory → ${outsiderCtx.status}`);
  const bCtx = await c.fn(out, "company-brain-memory", { workspace_id: wsB, action: "context" });
  check("A8.2", "isolation & roles", bCtx.status === 200 && !String(bCtx.body?.agents?.orion ?? "").includes("Gambling"), "workspace B's agents never see A's knowledge");
  const viewerWrite = await mem(vw, { action: "write", op: "set", idempotency_key: idem(), payload: { kind: "fact", category: "company_facts", fact_key: "fact.viewer", value_type: "text", value: "viewer" } });
  check("A8.3", "isolation & roles", viewerWrite.status === 403, `a viewer cannot write memory → ${viewerWrite.status}`);
  const outsiderRead = await c.select(out, `company_brain?workspace_id=eq.${wsA}&select=profile`);
  check("A8.4", "isolation & roles", Array.isArray(outsiderRead.body) && outsiderRead.body.length === 0, "RLS hides A's Brain from an outsider");

  const failed = checks.filter((x) => !x.ok).length;
  return { run_id: run, started_at, finished_at: new Date().toISOString(), passed: checks.length - failed, failed, checks, notes };
}

// ── CLI ──────────────────────────────────────────────────────────────────────
if (import.meta.main) {
  const args = Deno.args;
  const arg = (k: string) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
  const url = Deno.env.get("BRAIN_TEST_URL") ?? "";
  const ref = url.match(/^https:\/\/([a-z0-9]{20})\.supabase\.co\/?$/)?.[1] ?? "";
  const refuse = (m: string) => { console.error(`refusing: ${m}`); Deno.exit(2); };
  if (!ref) refuse("BRAIN_TEST_URL must be https://<ref>.supabase.co");
  if (REFUSED_REFS.includes(ref)) refuse(`${ref} is production, the ATLAS TEST project or the AgriDrone project — never a Brain acceptance target`);
  if (arg("--confirm") !== ref) refuse("--confirm must repeat the project ref exactly");
  const anonKey = Deno.env.get("BRAIN_TEST_ANON_KEY") ?? "", serviceKey = Deno.env.get("BRAIN_TEST_SERVICE_ROLE_KEY") ?? "";
  if (!anonKey || !serviceKey) refuse("BRAIN_TEST_ANON_KEY and BRAIN_TEST_SERVICE_ROLE_KEY are required (never printed)");
  const allowOrionChat = args.includes("--allow-orion-chat");
  const maxUsd = arg("--max-usd") === undefined ? undefined : Number(arg("--max-usd"));
  if (allowOrionChat && !(maxUsd! > 0 && maxUsd! <= 1)) refuse("--allow-orion-chat needs --max-usd <limit>, a positive amount no larger than 1.00 USD");
  if (!allowOrionChat && maxUsd !== undefined) refuse("--max-usd only applies with --allow-orion-chat");
  const report = await runBrainAcceptance({ url, anonKey, serviceKey, allowOrionChat, maxUsd });
  console.log(`\n${report.passed} passed, ${report.failed} failed${report.notes.length ? `\nnotes:\n- ${report.notes.join("\n- ")}` : ""}`);
  const out = arg("--report");
  if (out) await Deno.writeTextFile(out, JSON.stringify(report, null, 2));
  Deno.exit(report.failed ? 1 : 0);
}
