import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  leadRecordFromRow, mapFirecrawlResult, normalizePeopleSearchRows, peopleSearchQuery,
  executeLeadAction, type ExecCtx, type ToolResultLike,
} from "./leadActionExecutor.ts";

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
  id: "lead-1", contact_id: null,
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

Deno.test("executeLeadAction find_decision_makers: poster founder resolved, persisted, no people search", async () => {
  const { api, state } = fakeAdmin([seedLead]);
  let searched = 0;
  const runTool = async (name: string): Promise<ToolResultLike> => { if (name === "source_with_apify") searched++; return { ok: true, data: { items: [] } }; };
  const out = await executeLeadAction("find_decision_makers", ["lead-1"], mkCtx(api, runTool));
  assertEquals(searched, 0);
  const dmUpdate = state.updates.find((u) => u.patch?.raw?.decision_makers);
  assert(dmUpdate);
  assertEquals(dmUpdate.patch.raw.decision_makers[0].name, "Jane Doe");
  assert(state.inserts.some((i) => i.table === "contacts" && i.vals.full_name === "Jane Doe"));
  assertEquals((out.per_lead[0] as any).needs_manual_review, false);
});

Deno.test("executeLeadAction generate_outreach: persists draft_needs_approval, never sends", async () => {
  const { api, state } = fakeAdmin([seedLead]);
  const runTool = async (): Promise<ToolResultLike> => ({ ok: true, data: {} });
  const out = await executeLeadAction("generate_outreach", ["lead-1"], mkCtx(api, runTool));
  const draft = state.inserts.find((i) => i.table === "outreach_drafts");
  assert(draft, "draft persisted");
  assertEquals(draft.vals.status, "draft");
  assert(draft.vals.raw.status === "draft_needs_approval");
  assertEquals(out.needs_approval, true);
  // Draft is only ever "draft" status — never a sent/delivered state.
  assertEquals(draft.vals.status, "draft");
  assert(!state.inserts.some((i) => i.table === "messages" || /sent|delivered/i.test(String(i.vals?.status ?? ""))));
});
