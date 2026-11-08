// MRLE Phase 0: one company → one lead; honest mission outcomes; idempotent persistence.
// Offline: synthetic leads, a fake store.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { canonicalDomain, collapseDuplicateLeads, companyIdentityKey } from "../../../../supabase/functions/_shared/leadPipeline/identity.ts";
import { missionOutcome } from "../../../../supabase/functions/_shared/leadPipeline/outcome.ts";
import { persistRows, type LeadStore } from "../../../../supabase/functions/_shared/leadPipeline/persistRows.ts";
import type { PipelineLead } from "../../../../supabase/functions/_shared/leadPipeline/pipeline.ts";
import type { PipelineRow } from "../../../../supabase/functions/_shared/leadPipeline/projection.ts";

const lead = (key: string, o: { domain?: string | null; li?: string | null; q?: "eligible" | "pending" | "ineligible"; score?: number; ids?: string[] } = {}): PipelineLead => ({
  leadKey: key, existingLeadIds: [],
  company: { key: `c:${key}`, name: key, domain: o.domain ?? null, linkedinUrl: o.li ?? null, providerCompanyIds: o.ids ?? [key], employeeCount: null, industry: [], hq: { country: null, region: null, city: null, source: null }, description: null },
  person: null,
  statuses: { qualification: o.q ?? "eligible" } as PipelineLead["statuses"],
  rank: { score: o.score ?? 50, lane: o.q === "pending" ? "review" : o.q === "ineligible" ? "excluded" : "queue" } as PipelineLead["rank"],
  provenance: { walkId: "w", planHash: "p", runAt: "t", providers: ["apify"] },
} as unknown as PipelineLead);

Deno.test("canonical identity: scheme, www, port, path and case never make two companies", () => {
  for (const v of ["https://www.Northwind.example/about", "northwind.example", "http://northwind.example:443/", "WWW.NORTHWIND.EXAMPLE."]) {
    assertEquals(canonicalDomain(v), "northwind.example", v);
  }
  assertEquals(canonicalDomain(""), null);
  assertEquals(companyIdentityKey(lead("a", { li: "https://linkedin.com/company/Northwind/" })), "li:northwind");
});

Deno.test("one company reached through two LinkedIn pages is ONE lead; the strongest verdict is kept with every alias", () => {
  const out = collapseDuplicateLeads([
    lead("nw-a", { domain: "northwind.example", li: "https://www.linkedin.com/company/northwind", q: "pending", score: 80, ids: ["li-1"] }),
    lead("nw-b", { domain: "https://www.northwind.example", li: "https://www.linkedin.com/company/northwind-ledger", q: "eligible", score: 60, ids: ["li-2"] }),
    lead("other", { domain: "harbor.example" }),
  ]);
  assertEquals(out.leads.map((l) => l.leadKey), ["nw-b", "other"], "eligible beats pending, whatever the score");
  const kept = out.leads[0];
  assertEquals(kept.company.providerCompanyIds.sort(), ["li-1", "li-2"]);
  assertEquals(kept.provenance.mergedFrom!.map((m) => m.leadKey), ["nw-a"]);
  assertEquals(out.merged[0].conflict, null);
});

Deno.test("records of one company that DISAGREE (eligible vs disproven) are held for verification, never silently resolved", () => {
  const out = collapseDuplicateLeads([
    lead("a", { domain: "maple.example", q: "eligible" }),
    lead("b", { domain: "maple.example", q: "ineligible" }),
  ]);
  assertEquals(out.leads.length, 1);
  assertEquals(out.leads[0].statuses.qualification, "pending");
  assertEquals(out.leads[0].rank.lane, "review");
  assert(out.merged[0].conflict?.includes("disproves"));
});

Deno.test("outcomes: only qualified companies count; zero rows is not success; spend keeps its basis", () => {
  const sp = { apifyUsd: 0.017, leadoceanRecords: 0, basis: "estimate" as const };
  assertEquals(missionOutcome({ requested: 5, qualified: 5, pending: 2, rejected: 1, runStatus: "completed", spend: sp }).status, "completed");
  const short = missionOutcome({ requested: 5, qualified: 3, pending: 2, rejected: 0, runStatus: "completed", openRequirements: ["business model"], spend: sp });
  assertEquals([short.status, short.shortfall], ["completed_with_shortfall", 2]);
  assert(short.summary.startsWith("Only 3 companies qualified of 5 requested") && short.summary.includes("business model"), short.summary);
  assertEquals(missionOutcome({ requested: 5, qualified: 0, pending: 3, rejected: 0, runStatus: "completed" }).status, "needs_verification");
  const empty = missionOutcome({ requested: 5, qualified: 0, pending: 0, rejected: 0, runStatus: "completed", spend: { apifyUsd: 0.001, leadoceanRecords: 0, basis: "estimate" } });
  assertEquals([empty.status, empty.shortfall, empty.spend.basis], ["no_results", 5, "estimate"]);
  assertEquals(missionOutcome({ requested: 5, qualified: 0, pending: 0, rejected: 0, runStatus: "blocked", reason: "a REQUIRED requirement is unchecked" }).status, "blocked");
  assertEquals(missionOutcome({ requested: 5, qualified: 0, pending: 0, rejected: 0, runStatus: "failed", reason: "job search failed" }).nextStep?.includes("Nothing is retried"), true);
  assertEquals(missionOutcome({ requested: 5, qualified: 0, pending: 0, rejected: 0, runStatus: "completed" }).spend.basis, "none");
});

// ── Persistence against a fake store with the real unique keys ───────────────
function fakeStore() {
  const accounts: { id: string; workspace_id: string; name: string; domain: string | null; raw: Record<string, unknown> }[] = [];
  const contacts: { id: string; workspace_id: string; linkedin_url: string | null; raw: Record<string, unknown> }[] = [];
  const leads: { id: string; workspace_id: string; account_id: string; lead_type: string; status: string; raw: Record<string, unknown> }[] = [];
  let n = 0;
  const id = () => `id-${++n}`;
  const store: LeadStore = {
    findAccountByDomain: (ws, d) => Promise.resolve(accounts.find((a) => a.workspace_id === ws && a.domain === d) ?? null),
    findAccountByName: (ws, nm) => Promise.resolve(accounts.find((a) => a.workspace_id === ws && a.name === nm) ?? null),
    insertAccount: (r) => { if (accounts.some((a) => a.workspace_id === r.workspace_id && a.name === r.name)) return Promise.resolve({ conflict: true as const }); const x = { id: id(), ...(r as never) }; accounts.push(x); return Promise.resolve({ id: x.id }); },
    updateAccount: (i, p) => { Object.assign(accounts.find((a) => a.id === i)!, p); return Promise.resolve(); },
    findContactByLinkedin: (ws, u) => Promise.resolve(contacts.find((c) => c.workspace_id === ws && c.linkedin_url === u) ?? null),
    insertContact: (r) => { if (r.linkedin_url && contacts.some((c) => c.linkedin_url === r.linkedin_url)) return Promise.resolve({ conflict: true as const }); const x = { id: id(), ...(r as never) }; contacts.push(x); return Promise.resolve({ id: x.id }); },
    updateContact: (i, p) => { Object.assign(contacts.find((c) => c.id === i)!, p); return Promise.resolve(); },
    findLeadById: (ws, i) => Promise.resolve(leads.find((l) => l.workspace_id === ws && l.id === i) ?? null),
    findPipelineLeadForAccount: (ws, a, t) => Promise.resolve(leads.find((l) => l.workspace_id === ws && l.account_id === a && l.lead_type === t) ?? null),
    insertLead: (r) => { if (typeof r.fit_score === "string") return Promise.reject(new Error("bad row")); const x = { id: id(), ...(r as never) }; leads.push(x); return Promise.resolve({ id: x.id }); },
    updateLead: (i, p) => { Object.assign(leads.find((l) => l.id === i)!, p); return Promise.resolve(); },
  };
  return { store, accounts, contacts, leads };
}
const WS = "ws-1";
const row = (name: string, domain: string | null, run: number, contact: string | null = null): PipelineRow => ({
  existingLeadId: null,
  account: { workspace_id: WS, name, domain, website_url: null, linkedin_url: null, location: null, industry: null, employee_count: null, source: "lead_pipeline:apify", raw: { agentory_pipeline: { run } } },
  contact: contact ? { workspace_id: WS, full_name: "N", title: "CEO", linkedin_url: contact, company: name, location: null, email: null, phone: null, source: "x", raw: { agentory_pipeline: { run } } } : null,
  lead_candidate: { workspace_id: WS, lead_type: "lead_pipeline", status: "qualified", fit_score: 70, priority: null, reason: "Eligible", next_action: null, raw: { agentory_pipeline: { run } } },
} as never);

Deno.test("persistence: a second run for the same company updates the one lead (status kept); a person is reused", async () => {
  const f = fakeStore();
  const a = await persistRows(f.store, [row("Northwind", "https://www.northwind.example", 1, "https://linkedin.com/in/nia")]);
  f.leads[0].status = "contacted"; // the user moved it on
  const b = await persistRows(f.store, [row("Northwind", "northwind.example", 2, "https://linkedin.com/in/nia")]);
  assertEquals([a.written, b.written, b.updated], [1, 0, 1]);
  assertEquals([f.accounts.length, f.contacts.length, f.leads.length], [1, 1, 1]);
  assertEquals(f.leads[0].status, "contacted", "an existing Lead keeps its status");
  assertEquals((f.leads[0].raw.agentory_pipeline as { run: number }).run, 2, "attribution replaced");
  assertEquals(f.accounts[0].domain, "northwind.example");
});

Deno.test("persistence: the name is not an identity; one bad row never stops the others", async () => {
  const f = fakeStore();
  const r = await persistRows(f.store, [row("Acme", "acme.io", 1), row("Acme", "acme-industrial.example", 1), { ...row("Broken", "broken.example", 1), lead_candidate: { ...row("Broken", "broken.example", 1).lead_candidate, fit_score: "x" as never } }, row("Harbor", "harbor.example", 1)]);
  assertEquals([r.written, r.failed], [3, 1]);
  assertEquals(f.accounts.map((a) => a.name).sort(), ["Acme", "Acme (acme-industrial.example)", "Broken", "Harbor"]);
  assertEquals(r.rows.find((x) => x.action === "failed")!.name, "Broken");
});
