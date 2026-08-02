import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  leadRecordFromRow, mapFirecrawlResult, normalizePeopleSearchRows, peopleSearchQuery,
  executeLeadAction, validateLeadActionRequest, type ExecCtx, type ToolResultLike,
} from "../../supabase/functions/_shared/leadActionExecutor.ts";

// Backend guard (Issue 2): a lead action requires lead_candidate_ids and refuses
// to fall through to Scout sourcing when none are supplied.
Deno.test("validateLeadActionRequest: no ids → refuse with clear message", () => {
  const r = validateLeadActionRequest("research_company", []);
  assert(!r.ok);
  if (r.ok) return;
  assertEquals(r.error, "lead_action_requires_lead_candidate_ids");
  assert(/Select one or more Workbench rows/i.test(r.message));
  assert(!validateLeadActionRequest("find_decision_makers", undefined).ok);
  assert(!validateLeadActionRequest("generate_outreach", [null, "", 5]).ok); // no valid string ids
});
Deno.test("validateLeadActionRequest: real ids → ok, deduped", () => {
  const r = validateLeadActionRequest("research_company", ["a", "a", "b"]);
  assert(r.ok);
  if (!r.ok) return;
  assertEquals(r.ids, ["a", "b"]);
});

// ---- Pure helpers ----

Deno.test("leadRecordFromRow maps raw jsonb + joined account", () => {
  const row = {
    id: "lead-1", contact_id: null,
    accounts: { name: "Acme", domain: "acme.com", linkedin_url: "https://linkedin.com/company/acme" },
    raw: { company_website: "https://acme.com", job_title: "RevOps Lead", gate_decision: "accept", source_quality: "verified",
      poster_contact_hint: { name: "Jane Doe", profile_url: "https://linkedin.com/in/janedoe", title: "CEO" } },
  };
  const lead = leadRecordFromRow(row);
  assertEquals(lead.company_name, "Acme");
  assertEquals(lead.website, "https://acme.com");
  assertEquals(lead.company_linkedin_url, "https://linkedin.com/company/acme");
  assertEquals(lead.poster_contact_hint?.name, "Jane Doe");
});

Deno.test("mapFirecrawlResult reads markdown/content/text, else null", () => {
  assertEquals(mapFirecrawlResult({ ok: true, data: { markdown: "hi", title: "T" } })?.markdown, "hi");
  assertEquals(mapFirecrawlResult({ ok: true, data: { content: "body" } })?.markdown, "body");
  assertEquals(mapFirecrawlResult({ ok: false, error: "x" }), null);
  assertEquals(mapFirecrawlResult({ ok: true, data: { markdown: "" } }), null);
});

Deno.test("normalizePeopleSearchRows requires name + profile url; never fabricates", () => {
  const rows = normalizePeopleSearchRows({ items: [
    { name: "Jane Doe", title: "Head of Growth", linkedinUrl: "https://linkedin.com/in/janedoe" },
    { name: "No Url", title: "CEO" },
    { firstName: "Bob", lastName: "Ray", profileUrl: "https://linkedin.com/in/bobray" },
  ] });
  assertEquals(rows.length, 2);
  assertEquals(rows[0].name, "Jane Doe");
  assertEquals(rows[1].name, "Bob Ray");
});

Deno.test("peopleSearchQuery is a single-company constrained string", () => {
  const q = peopleSearchQuery({ company: "Acme", company_linkedin_url: null, domain: "acme.com", titles: ["Founder", "CEO"], max_results: 5, one_company: true });
  assertEquals(q, "Founder OR CEO at Acme");
  assert(!q.includes(";") && (q.match(/ at /g) ?? []).length === 1); // one company only
});

// ---- Fake supabase + runTool for full-flow tests ----

function fakeAdmin(seedRows: any[]) {
  const state = { updates: [] as any[], inserts: [] as any[], rows: seedRows };
  const api: any = {
    from(table: string) {
      const ctx: any = { table, _in: null as string[] | null };
      const chain: any = {
        select: () => chain,
        in: (_col: string, ids: string[]) => { ctx._in = ids; return chain; },
        eq: () => chain,
        update: (patch: any) => { state.updates.push({ table, patch }); return { eq: () => Promise.resolve({ data: null }) }; },
        insert: (vals: any) => { state.inserts.push({ table, vals }); return { select: () => ({ maybeSingle: () => Promise.resolve({ data: { id: `${table}-new` } }) }) }; },
        upsert: (vals: any) => { state.inserts.push({ table, vals, upsert: true }); return { select: () => ({ maybeSingle: () => Promise.resolve({ data: { id: `${table}-up` } }) }) }; },
        // terminal for select().in()
        then: undefined,
      };
      // make select().in() awaitable by returning rows
      chain.in = (_col: string, ids: string[]) => {
        const filtered = state.rows.filter((r) => ids.includes(r.id));
        return Promise.resolve({ data: filtered });
      };
      return chain;
    },
  };
  return { api, state };
}

const seedLead = {
  id: "lead-1", contact_id: null, workspace_id: "ws",
  accounts: { name: "Acme Robotics", domain: "acme.com", website_url: "https://acme.com", linkedin_url: "https://linkedin.com/company/acme" },
  raw: {
    company_website: "https://acme.com", domain: "acme.com", company_linkedin_url: "https://linkedin.com/company/acme",
    job_title: "Founding AE", job_url: "https://linkedin.com/jobs/view/1", job_description: "Founded by Jane Doe. Building our first sales team.",
    company_description: "Acme builds warehouse automation.", gate_decision: "accept", source_quality: "verified",
    why_now: "Hiring first AE.", poster_contact_hint: { name: "Jane Doe", profile_url: "https://linkedin.com/in/janedoe", title: "Co-Founder & CEO" },
  },
};

function mkCtx(admin: any, runTool: any): ExecCtx {
  return { admin, workspace_id: "ws", plan_id: "plan", task_id: "task", agent_slug: "hawk", runTool, toolCtx: {} };
}

Deno.test("executeLeadAction research_company: crawls capped, persists company_enrichment", async () => {
  const { api, state } = fakeAdmin([seedLead]);
  const visited: string[] = [];
  const runTool = async (name: string, input: any): Promise<ToolResultLike> => {
    if (name !== "scrape_url") return { ok: false };
    visited.push(input.url);
    if (input.url.endsWith("/about")) return { ok: true, data: { markdown: "Acme was founded by Jane Doe. We raised a seed round." } };
    if (input.url.endsWith("/team")) return { ok: true, data: { markdown: "Jane Doe — CEO & Co-Founder" } };
    return { ok: true, data: { markdown: "Acme builds warehouse robots for fast-growing 3PLs and helps scale." } };
  };
  const out = await executeLeadAction("research_company", ["lead-1"], mkCtx(api, runTool));
  assert(visited.length > 0 && visited.length <= 6);            // capped
  const persisted = state.updates.find((u) => u.patch?.raw?.company_enrichment);
  assert(persisted, "company_enrichment persisted to raw");
  assert(persisted.patch.raw.company_enrichment.founders.some((f: any) => f.name === "Jane Doe"));
  assert(/Researched 1 company/.test(out.summary));
});

Deno.test("executeLeadAction research_company: rejected lead → blocked, no crawl, no persist", async () => {
  const rejected = { ...seedLead, raw: { ...seedLead.raw, gate_decision: "reject" } };
  const { api, state } = fakeAdmin([rejected]);
  let calls = 0;
  const runTool = async (): Promise<ToolResultLike> => { calls++; return { ok: true, data: { markdown: "x" } }; };
  const out = await executeLeadAction("research_company", ["lead-1"], mkCtx(api, runTool));
  assertEquals(calls, 0);
  assert(!state.updates.some((u) => u.patch?.raw?.company_enrichment));
  assertEquals((out.per_lead[0] as any).status, "blocked");
});

// BEHAVIOUR CHANGE (decision-maker integration): a job poster is a HINT, not
// proof of employment. The poster record carries only name/title/profile URL, so
// it cannot verify a current employer and no longer short-circuits the search.
// Previously it was accepted on trust and persisted as the decision-maker.
Deno.test("find_decision_makers: an unverifiable poster hint no longer short-circuits the search", async () => {
  const { api, state } = fakeAdmin([seedLead]);
  let searched = 0;
  const runTool = async (name: string): Promise<ToolResultLike> => { if (name === "source_with_apify") searched++; return { ok: true, data: { items: [] } }; };
  const out = await executeLeadAction("find_decision_makers", ["lead-1"], mkCtx(api, runTool));
  assert(searched > 0, "the bounded search runs because the poster could not be verified");
  // Nothing is persisted on an unverified poster + empty provider result.
  assertEquals(state.inserts.filter((i) => i.table === "contacts").length, 0);
  assertEquals((out.per_lead[0] as any).status, "no_match");
});

// A lead with NO poster hint → forces the per-company people search to run.
const noPosterLead = {
  ...seedLead, id: "lead-2", workspace_id: "ws",
  raw: { ...seedLead.raw, poster_contact_hint: { name: null, profile_url: null, title: null }, job_description: "Join us." },
};

Deno.test("Bug2 #8/#9: people search sets defer_persistence + attach_to_accounts:false; contacts not auto-created", async () => {
  const { api, state } = fakeAdmin([noPosterLead]);
  let peopleInput: any = null;
  const runTool = async (name: string, input: any): Promise<ToolResultLike> => {
    if (name === "source_with_apify") { peopleInput = input; return { ok: true, data: { items: [
      { name: "Real Founder", title: "CEO", linkedinUrl: "https://linkedin.com/in/real", companyLinkedinUrl: "https://linkedin.com/company/acme" },
      { name: "Off Founder", title: "Founder", linkedinUrl: "https://linkedin.com/in/off", company: "Other Co" },
    ] } }; }
    return { ok: true, data: {} };
  };
  await executeLeadAction("find_decision_makers", ["lead-2"], mkCtx(api, runTool));
  assertEquals(peopleInput.defer_persistence, true);
  assertEquals(peopleInput.attach_to_accounts, false);
  // Only the verified person is written to contacts — NOT all raw people.
  const contactInserts = state.inserts.filter((i) => i.table === "contacts");
  assertEquals(contactInserts.length, 1);
  assertEquals(contactInserts[0].vals.full_name, "Real Founder");
});

Deno.test("Bug2 #10/#12: only verified DM persisted + linked; off-company rejected", async () => {
  const { api, state } = fakeAdmin([noPosterLead]);
  const runTool = async (name: string): Promise<ToolResultLike> => name === "source_with_apify"
    ? { ok: true, data: { items: [
        { name: "Real Founder", title: "CEO", linkedinUrl: "https://linkedin.com/in/real", companyLinkedinUrl: "https://linkedin.com/company/acme" },
        { name: "Off Founder", title: "Founder", linkedinUrl: "https://linkedin.com/in/off", company: "Other Co" },
      ] } }
    : { ok: true, data: {} };
  const out = await executeLeadAction("find_decision_makers", ["lead-2"], mkCtx(api, runTool));
  const dmUpdate = state.updates.find((u) => u.patch?.raw?.decision_makers);
  assertEquals(dmUpdate.patch.raw.decision_makers.map((d: any) => d.name), ["Real Founder"]);
  assertEquals(dmUpdate.patch.raw.decision_makers[0].verification_status, "verified");
  assertEquals(dmUpdate.patch.raw.decision_makers_rejected.map((r: any) => r.name), ["Off Founder"]);
  // contact_id linked to the verified contact
  assert(state.updates.some((u) => u.table === "lead_candidates" && u.patch?.contact_id));
  assertEquals((out.per_lead[0] as any).rejected_count, 1);
});

Deno.test("Bug2/C #11: persistence is idempotent (upsert, no duplicate contacts)", async () => {
  const { api, state } = fakeAdmin([noPosterLead]);
  const runTool = async (name: string): Promise<ToolResultLike> => name === "source_with_apify"
    ? { ok: true, data: { items: [{ name: "Real Founder", title: "CEO", linkedinUrl: "https://linkedin.com/in/real", companyLinkedinUrl: "https://linkedin.com/company/acme" }] } }
    : { ok: true, data: {} };
  await executeLeadAction("find_decision_makers", ["lead-2"], mkCtx(api, runTool));
  await executeLeadAction("find_decision_makers", ["lead-2"], mkCtx(api, runTool));
  const contactWrites = state.inserts.filter((i) => i.table === "contacts");
  assertEquals(contactWrites.length, 2);
  assert(contactWrites.every((c) => c.upsert === true)); // upsert, never plain insert → no dupes
});

Deno.test("Bug1 #12b: all no-match → no contact linked, needs_manual_review", async () => {
  const { api, state } = fakeAdmin([noPosterLead]);
  const runTool = async (name: string): Promise<ToolResultLike> => name === "source_with_apify"
    ? { ok: true, data: { items: [{ name: "Off Founder", title: "Founder", linkedinUrl: "https://linkedin.com/in/off", company: "Other Co" }] } }
    : { ok: true, data: {} };
  const out = await executeLeadAction("find_decision_makers", ["lead-2"], mkCtx(api, runTool));
  assertEquals(state.inserts.filter((i) => i.table === "contacts").length, 0);
  assert(!state.updates.some((u) => u.table === "lead_candidates" && u.patch?.contact_id));
  // BEHAVIOUR CHANGE: a person at a DIFFERENT company is a rejection, not
  // something for a human to review. needs_manual_review is now reserved for
  // profiles whose employment could not be confirmed either way.
  assertEquals((out.per_lead[0] as any).status, "no_match");
  assertEquals((out.per_lead[0] as any).needs_manual_review, false);
});

// A gate-eligible lead: provider-verified (person-level), contact-ready, canonical
// decision `contact`, with a supported evidence URL — the ONLY state that may draft.
const draftEligibleLead = {
  ...seedLead, id: "lead-1",
  raw: {
    ...seedLead.raw,
    provider_provenance: { verified: true, level: "person" },
    contact_ready: true,
    canonical_final_decision: "contact",
    company: "Acme Robotics",
    evidence_url: "https://linkedin.com/jobs/view/1",
  },
};

Deno.test("generate_outreach (#16): verified contact-ready lead persists draft_needs_approval, never sends", async () => {
  const { api, state } = fakeAdmin([draftEligibleLead]);
  const runTool = async (): Promise<ToolResultLike> => ({ ok: true, data: {} });
  const out = await executeLeadAction("generate_outreach", ["lead-1"], mkCtx(api, runTool));
  const draft = state.inserts.find((i) => i.table === "outreach_drafts");
  assert(draft, "draft persisted for a gate-eligible lead");
  assertEquals(draft.vals.status, "draft");
  assert(draft.vals.raw.status === "draft_needs_approval");
  assertEquals(out.needs_approval, true);
  assert(!state.inserts.some((i) => i.table === "messages" || /sent|delivered/i.test(String(i.vals?.status ?? ""))));
});

Deno.test("generate_outreach (#15): unverified provider lead is blocked by the draft gate", async () => {
  // seedLead has no provider_provenance / contact_ready / canonical decision.
  const { api, state } = fakeAdmin([seedLead]);
  const runTool = async (): Promise<ToolResultLike> => ({ ok: true, data: {} });
  const out = await executeLeadAction("generate_outreach", ["lead-1"], mkCtx(api, runTool));
  assert(!state.inserts.some((i) => i.table === "outreach_drafts"), "no draft may persist for an unverified lead");
  assertEquals((out.per_lead[0] as any).status, "blocked_draft_gate");
  assert(Array.isArray((out.per_lead[0] as any).blocked_reasons));
});

Deno.test("generate_outreach (#18): source_and_qualify_only blocks outreach even for an eligible lead", async () => {
  const { api, state } = fakeAdmin([draftEligibleLead]);
  const runTool = async (): Promise<ToolResultLike> => ({ ok: true, data: {} });
  const ctx = { ...mkCtx(api, runTool), execution_mode: "source_and_qualify_only" };
  const out = await executeLeadAction("generate_outreach", ["lead-1"], ctx);
  assert(!state.inserts.some((i) => i.table === "outreach_drafts"), "mode forbids drafting");
  assertEquals((out.per_lead[0] as any).status, "blocked_draft_gate");
});
