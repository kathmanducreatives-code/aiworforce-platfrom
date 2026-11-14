// R1.1 · AUTHORITATIVE WORKSPACE TOTALS AND NAMED-ACCOUNT LOOKUP FOR ORION.
//
// ── WHAT THE LIVE TESTS SHOWED ─────────────────────────────────────────────
//
// ORION was handed at most eight evidence items and no counts. It then said
// "the supplied workspace records identify eight lead candidates" in a
// workspace holding 145 accounts and 61 leads, and "Laminar: no record
// provided" about a company sitting in `accounts`. The model was not wrong
// about what it was shown; it was shown a sample and no census.
//
// This module counts, for the ONE authenticated workspace, what the Lead
// Library and LISA hold — accounts, lead candidates (by status, scored,
// qualified), saved contacts, signals (by type, hiring, age) and monitoring
// subjects — and looks up any company the question NAMES in `accounts`, not
// only in `lead_candidates`.
//
// ── ZERO, MISSING AND FAILED ARE THREE DIFFERENT ANSWERS ───────────────────
//
// A count that was read and is 0 is "0". A count whose query failed is
// "could not be read" — never 0. A field that exists on no record ("no fit
// score is stored") is a gap in the data, not a zero result. Each total
// carries its status so the prompt can say which is which.
//
// ── ISOLATION ──────────────────────────────────────────────────────────────
//
// The caller passes a workspace whose membership has ALREADY been verified for
// the authenticated user (orionEvidenceContext → evidence/retrieve.ts). Every
// query filters `workspace_id`, and every returned row is checked against it
// again, so a misconfigured client or join can never contribute another
// workspace's row. Reads only; $0; no provider is reachable from here.

import { workspaceFact, type GroundedFact } from "./groundedFacts.ts";

export const ORION_WORKSPACE_FACTS_VERSION = "orion-workspace-facts-v1" as const;

// deno-lint-ignore no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type FactsDb = { from(table: string): any };
type Row = Record<string, unknown>;

/** A count that was read, or a statement that it could not be. Never a silent 0. */
export type Count = { status: "ok"; value: number; truncated?: boolean } | { status: "failed" };

export interface WorkspaceTotals {
  accounts: Count;
  accounts_qualified: Count;
  leads: Count;
  lead_statuses: Record<string, number> | null;
  leads_scored: Count;
  leads_qualified: Count;
  leads_with_contact: Count;
  contacts: Count;
  signals: Count;
  signal_types: Record<string, number> | null;
  hiring_signals: Count;
  hiring_signals_older_than_30d: Count;
  signals_without_event_date: Count;
  newest_signal_observed: string | null;
  oldest_signal_observed: string | null;
  monitoring_subjects: Count;
  monitoring_enabled: Count;
}

export interface NamedAccount {
  name: string;
  domain: string | null;
  stage: string | null;
  industry: string | null;
  location: string | null;
  employee_count: string | null;
  indexed_on: string | null;
  is_lead: boolean;
  lead_status: string | null;
  fit_score: number | null;
  next_action: string | null;
  contacts: number | null;
  signals: number | null;
}

export interface WorkspaceFacts {
  version: typeof ORION_WORKSPACE_FACTS_VERSION;
  totals: WorkspaceTotals;
  named: NamedAccount[];
  facts: GroundedFact[];
}

const PAGE = 5000;
const DAY = 86_400_000;
const s = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
export const HIRING_RE = /\bhir(?:e|es|ing)\b|_hiring\b|\bjob (?:post|opening)|\bopen roles?\b|\brecruit/i;
const norm = (x: string | null | undefined) => String(x ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

async function readAll(db: FactsDb, table: string, columns: string, workspaceId: string):
  Promise<{ ok: true; rows: Row[]; count: number } | { ok: false }> {
  try {
    const { data, error, count } = await db.from(table).select(columns, { count: "exact" })
      .eq("workspace_id", workspaceId).limit(PAGE);
    if (error) return { ok: false };
    const rows = ((data ?? []) as Row[]).filter((r) => r.workspace_id === undefined || r.workspace_id === workspaceId);
    return { ok: true, rows, count: typeof count === "number" ? count : rows.length };
  } catch {
    return { ok: false };
  }
}

const ok = (value: number, truncated = false): Count => (truncated ? { status: "ok", value, truncated } : { status: "ok", value });
const FAILED: Count = { status: "failed" };

/** Pure: totals from rows already read (or failures). Exported for tests. */
export function computeTotals(i: {
  accounts: { ok: true; rows: Row[]; count: number } | { ok: false };
  leads: { ok: true; rows: Row[]; count: number } | { ok: false };
  contacts: { ok: true; rows: Row[]; count: number } | { ok: false };
  signals: { ok: true; rows: Row[]; count: number } | { ok: false };
  monitoring: { ok: true; rows: Row[]; count: number } | { ok: false };
  now: Date;
}): WorkspaceTotals {
  const t = (r: { ok: true; rows: Row[]; count: number }) => r.count > r.rows.length;
  let lead_statuses: Record<string, number> | null = null, signal_types: Record<string, number> | null = null;
  let newest: string | null = null, oldest: string | null = null;
  const out: WorkspaceTotals = {
    accounts: FAILED, accounts_qualified: FAILED, leads: FAILED, lead_statuses: null, leads_scored: FAILED,
    leads_qualified: FAILED, leads_with_contact: FAILED, contacts: FAILED, signals: FAILED, signal_types: null,
    hiring_signals: FAILED, hiring_signals_older_than_30d: FAILED, signals_without_event_date: FAILED,
    newest_signal_observed: null, oldest_signal_observed: null, monitoring_subjects: FAILED, monitoring_enabled: FAILED,
  };
  if (i.accounts.ok) {
    const a = i.accounts;
    out.accounts = ok(a.count);
    out.accounts_qualified = ok(a.rows.filter((r) => norm(s(r.stage)) === "qualified").length, t(a));
  }
  if (i.leads.ok) {
    const l = i.leads;
    out.leads = ok(l.count);
    lead_statuses = {};
    for (const r of l.rows) { const k = s(r.status) ?? "unknown"; lead_statuses[k] = (lead_statuses[k] ?? 0) + 1; }
    out.lead_statuses = lead_statuses;
    out.leads_scored = ok(l.rows.filter((r) => typeof r.fit_score === "number").length, t(l));
    out.leads_qualified = ok(l.rows.filter((r) => s(r.status) === "qualified").length, t(l));
    out.leads_with_contact = ok(l.rows.filter((r) => !!s(r.contact_id)).length, t(l));
  }
  if (i.contacts.ok) out.contacts = ok(i.contacts.count);
  if (i.signals.ok) {
    const g = i.signals;
    out.signals = ok(g.count);
    signal_types = {};
    let hiring = 0, oldHiring = 0, noEvent = 0;
    for (const r of g.rows) {
      const type = s(r.signal_type) ?? "unknown";
      signal_types[type] = (signal_types[type] ?? 0) + 1;
      const observed = s(r.observed_at);
      const when = s(r.occurred_at) ?? observed;
      if (!s(r.occurred_at)) noEvent++;
      if (observed) {
        if (!newest || observed > newest) newest = observed;
        if (!oldest || observed < oldest) oldest = observed;
      }
      if (HIRING_RE.test(type)) {
        hiring++;
        const at = when ? Date.parse(when) : NaN;
        if (Number.isFinite(at) && i.now.getTime() - at > 30 * DAY) oldHiring++;
      }
    }
    out.signal_types = signal_types;
    out.hiring_signals = ok(hiring, t(g));
    out.hiring_signals_older_than_30d = ok(oldHiring, t(g));
    out.signals_without_event_date = ok(noEvent, t(g));
    out.newest_signal_observed = newest;
    out.oldest_signal_observed = oldest;
  }
  if (i.monitoring.ok) {
    out.monitoring_subjects = ok(i.monitoring.count);
    out.monitoring_enabled = ok(i.monitoring.rows.filter((r) => r.enabled === true).length, t(i.monitoring));
  }
  return out;
}

/** Pure: which accounts the question names. Whole-word name match, or the domain's first label. */
export function matchNamedAccounts(accounts: readonly Row[], message: string): Row[] {
  const m = ` ${norm(message)} `;
  const seen = new Set<string>();
  const out: Row[] = [];
  for (const a of accounts) {
    const name = norm(s(a.name));
    const stem = norm((s(a.domain) ?? "").replace(/^www\./, "").split(".")[0]);
    const hit = (name.length >= 3 && m.includes(` ${name} `)) || (stem.length >= 4 && m.includes(` ${stem} `));
    const key = name || stem;
    if (hit && key && !seen.has(key)) { seen.add(key); out.push(a); }
  }
  return out.slice(0, 12);
}

const fmtCount = (c: Count, what: string): string =>
  c.status === "failed" ? `${what}: COULD NOT BE READ (retrieval failed — this is not zero)`
    : `${what}: ${c.value}${c.truncated ? " (counted from the rows one read returns — the full total may be higher)" : ""}`;
const dist = (d: Record<string, number> | null) =>
  d ? Object.entries(d).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(", ") : "unavailable";

/** Pure: the facts block. Exported for tests. */
export function renderWorkspaceFacts(totals: WorkspaceTotals, named: readonly NamedAccount[], askedAboutNames: boolean): GroundedFact[] {
  const t = totals;
  const lines = [
    "WORKSPACE TOTALS — counted from the database for this workspace just now. These are authoritative: use them for every count, and never present the number of [E#] evidence items as a total.",
    `  - ${fmtCount(t.accounts, "Accounts indexed (company records; the Lead Library's \"accounts indexed\")")}`,
    `  - ${fmtCount(t.leads, "Lead candidates (accounts ATLAS proposed as leads)")}; by status: ${dist(t.lead_statuses)}`,
    t.accounts.status === "ok" && t.leads.status === "ok"
      ? `  - An account is a company record; a lead candidate is an account ATLAS proposed as a lead. ${Math.max(0, t.accounts.value - t.leads.value)} indexed accounts have no lead candidate.`
      : "  - Accounts vs leads: cannot be compared (one of the counts could not be read).",
    `  - ${fmtCount(t.leads_scored, "Leads with a stored fit score")}`,
    `  - ${fmtCount(t.leads_qualified, "Leads with status qualified")}; ${fmtCount(t.accounts_qualified, "accounts with stage qualified")}`,
    `  - ${fmtCount(t.contacts, "Saved decision-maker contacts")}; ${fmtCount(t.leads_with_contact, "leads linked to a contact")}`,
    `  - ${fmtCount(t.signals, "Stored LISA signals")}; by type: ${dist(t.signal_types)}`,
    `  - ${fmtCount(t.hiring_signals, "Hiring signals")}; ${fmtCount(t.hiring_signals_older_than_30d, "of which older than 30 days (HISTORICAL — not proof of an open role today)")}`,
    `  - ${fmtCount(t.signals_without_event_date, "Signals with no event date recorded (their observed date is when Agentory stored them)")}` +
      (t.newest_signal_observed ? `; signals observed between ${t.oldest_signal_observed?.slice(0, 10)} and ${t.newest_signal_observed.slice(0, 10)}` : ""),
    `  - ${fmtCount(t.monitoring_subjects, "Monitoring subjects")}; ${fmtCount(t.monitoring_enabled, "currently enabled")}`,
  ];
  const facts: GroundedFact[] = [workspaceFact(lines.join("\n"), "orion_workspace_facts.totals")];
  if (named.length) {
    const rows = named.map((a) => {
      const bits = [
        `indexed in accounts${a.indexed_on ? ` on ${a.indexed_on.slice(0, 10)}` : ""}`,
        a.stage ? `stage ${a.stage}` : null, a.industry ? `industry ${a.industry}` : null,
        a.location ? `location ${a.location}` : null, a.employee_count ? `employees ${a.employee_count}` : null,
        a.is_lead ? `lead candidate (status ${a.lead_status ?? "unknown"}${a.fit_score == null ? ", no fit score" : `, fit ${a.fit_score}`}${a.next_action ? `, next action: ${a.next_action}` : ""})`
          : "NOT a lead candidate",
        a.contacts == null ? "saved contacts: could not be read" : `saved contacts: ${a.contacts}`,
        a.signals == null ? "stored signals about it: could not be read" : `stored signals about it: ${a.signals}`,
      ].filter(Boolean);
      return `  - ${a.name}${a.domain ? ` (${a.domain})` : ""}: ${bits.join("; ")}.`;
    });
    facts.push(workspaceFact(
      ["COMPANIES NAMED IN THE QUESTION, looked up in accounts (every account name in this workspace was checked):", ...rows,
        "  A named company not listed here was not found among this workspace's account names."].join("\n"),
      "orion_workspace_facts.named_accounts"));
  } else if (askedAboutNames) {
    facts.push(workspaceFact("No company named in the question matched an account in this workspace (every account name was checked).",
      "orion_workspace_facts.named_accounts"));
  }
  return facts;
}

const PROPER_NAME_RE = /\b[A-Z][a-zA-Z0-9]{2,}(?:\s+[A-Z][a-zA-Z0-9]+)?\b/g;
const COMMON = new Set(["Company", "Brain", "ORION", "ATLAS", "LISA", "LYRA", "TEAM", "Lead", "Library", "Use", "List", "For", "The",
  "Compare", "Rank", "Draft", "Explain", "Tell", "Identify", "Produce", "Assume", "Should", "Remember", "Break", "From", "Using",
  "Which", "What", "Create", "Keep", "Include", "Answer", "Then", "LinkedIn", "Do", "Act", "Book", "Before", "If", "Recommend"]);

/**
 * Load totals and named accounts for ONE workspace whose membership the caller
 * has already verified. Never throws: a failed table becomes a "could not be
 * read" count.
 */
export async function loadWorkspaceFacts(db: FactsDb, i: { workspaceId: string; message: string; now?: Date }): Promise<WorkspaceFacts> {
  const now = i.now ?? new Date();
  const ws = i.workspaceId;
  const [accounts, leads, contacts, signals, monitoring] = await Promise.all([
    readAll(db, "accounts", "id, workspace_id, name, domain, stage, industry, location, employee_count, created_at", ws),
    readAll(db, "lead_candidates", "id, workspace_id, account_id, contact_id, status, fit_score, next_action", ws),
    readAll(db, "contacts", "id, workspace_id, account_id", ws),
    readAll(db, "signal_events", "id, workspace_id, signal_type, observed_at, occurred_at, subject_key", ws),
    readAll(db, "monitoring_subjects", "id, workspace_id, enabled", ws),
  ]);
  const totals = computeTotals({ accounts, leads, contacts, signals, monitoring, now });

  const named: NamedAccount[] = [];
  if (accounts.ok) {
    for (const a of matchNamedAccounts(accounts.rows, i.message)) {
      const lead = leads.ok ? leads.rows.find((l) => l.account_id === a.id) ?? null : null;
      const domain = s(a.domain)?.toLowerCase().replace(/^www\./, "") ?? null;
      named.push({
        name: s(a.name) ?? domain ?? "unnamed account", domain,
        stage: s(a.stage), industry: s(a.industry), location: s(a.location),
        employee_count: a.employee_count == null ? null : String(a.employee_count),
        indexed_on: s(a.created_at),
        is_lead: !!lead, lead_status: lead ? s(lead.status) : null,
        fit_score: lead && typeof lead.fit_score === "number" ? lead.fit_score : null,
        next_action: lead ? s(lead.next_action) : null,
        contacts: contacts.ok ? contacts.rows.filter((c) => c.account_id === a.id).length : null,
        signals: signals.ok
          ? (domain ? signals.rows.filter((g) => String(g.subject_key ?? "").toLowerCase().includes(domain)).length : 0)
          : null,
      });
    }
  }
  const askedAboutNames = (i.message.match(PROPER_NAME_RE) ?? []).some((w) => !COMMON.has(w.split(/\s+/)[0]));
  return { version: ORION_WORKSPACE_FACTS_VERSION, totals, named, facts: renderWorkspaceFacts(totals, named, askedAboutNames) };
}

// ── COMPANY BRAIN DATA CHECKS ──────────────────────────────────────────────
//
// Live test 1 quoted "2–2 employees" as the ICP — a stored range of exactly two
// whose label says "5". The model repeated it because nothing said it was odd.
// These checks are deterministic and only FLAG values; the Brain is never
// changed from here (corrections need the owner's approval).
const obj = (v: unknown): Row => (v && typeof v === "object" && !Array.isArray(v) ? v as Row : {});
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && /^\d+$/.test(v.trim()) ? Number(v) : null);

export function brainDataWarnings(profile: Record<string, unknown> | null | undefined): string[] {
  const p = obj(profile);
  const out: string[] = [];
  const size = obj(obj(p.target_customer).company_size);
  const min = num(size.min), max = num(size.max), label = s(size.label);
  if (min != null && max != null) {
    if (min === max) out.push(`target company size is stored as exactly ${min}–${max} employees`);
    if (min > max) out.push(`target company size has min ${min} above max ${max}`);
    const labelNums = (label ?? "").match(/\d+/g)?.map(Number) ?? [];
    if (labelNums.length && !labelNums.every((n) => n >= min && n <= max)) out.push(`the size label "${label}" disagrees with the stored range ${min}–${max}`);
  }
  const icpSize = s(obj(p.icp).company_size);
  if (icpSize && min != null && max != null && /^\d+$/.test(icpSize) && (Number(icpSize) < min || Number(icpSize) > max)) {
    out.push(`the ICP block's company size "${icpSize}" disagrees with the target range ${min}–${max}`);
  }
  const positioning = obj(p.positioning);
  const emptyPos = ["offer", "promise", "proof_points", "differentiators"].filter((k) => {
    const v = positioning[k];
    return v == null || (typeof v === "string" && !v.trim()) || (Array.isArray(v) && v.length === 0);
  });
  if (emptyPos.length === 4) out.push("positioning (offer, promise, proof points, differentiators) is empty");
  return out;
}

/** The warnings as one fact, or none. */
export function brainWarningFact(profile: Record<string, unknown> | null | undefined): GroundedFact[] {
  const w = brainDataWarnings(profile);
  return w.length
    ? [workspaceFact(`COMPANY BRAIN DATA CHECK (flag these when you rely on them; do not present them as reliable, and do not change them): ${w.join("; ")}.`,
      "orion_workspace_facts.brain_checks")]
    : [];
}
