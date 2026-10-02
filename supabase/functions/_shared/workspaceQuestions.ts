// QUESTIONS ABOUT THE WORKSPACE, ANSWERED FROM WHAT IT HOLDS.
//
// ── WHAT THIS REPLACES (local evaluation, 2026-10-01) ──────────────────────
//
// "Show me my latest qualified leads", "which leads are missing company
// research?" and "why was MintMCP rejected?" reached the generic read surface,
// which knows four tables and one filter (recency). Every one of them got the
// same unfiltered "N leads saved" list — so every saved lead read as qualified,
// "today" meant nothing, and a question shaped like a search could still be
// routed to a sourcing card. A question about stored state must never become a
// purchase or a Start card, and must never be answered with a list that ignores
// the filter the user stated.
//
// ── WHERE THE TRUTH COMES FROM ─────────────────────────────────────────────
//
// Nothing here decides anything. Every state is READ:
//
//   qualification, claims, evidence  tasks.result.workbench_mission_view — the
//                                    backend's canonical P5 decision per
//                                    company (bucket, hard_check_details with
//                                    provenance, missing_evidence) — and, for a
//                                    saved lead, lead_candidates.raw
//                                    .canonical_decision / quota_eligible
//   company research                 lead_enrichments
//   outreach drafts                  outreach_drafts
//   approvals waiting on a person    approvals (status pending), then legacy
//                                    tasks.status = 'awaiting_approval'
//   workflows                        task_plans (completed_at is set only when
//                                    a plan completes) and tasks
//
// A company is QUALIFIED only on an explicit acceptance: a canonical label
// bucket, `canonical_decision.qualified === true`, or `quota_eligible === true`.
// A saved lead with none of those is "not evaluated", never qualified — the
// Workbench's own rule (`resolveQualification`: absence of a rejection is not
// a pass).
//
// ── THE GUARANTEE ──────────────────────────────────────────────────────────
//
// Like `readSurface`, this module imports no tool registry, capability engine,
// provider surface or credit path. It reads; it cannot spend.

export const WORKSPACE_QUESTIONS_VERSION = "workspace-questions-v1" as const;

// ══ 1. RECOGNISING THE QUESTION ════════════════════════════════════════════

export type ClaimDimension =
  | "funding" | "company_size" | "hiring" | "business_model" | "geography" | "industry";

export type WorkspaceQuestion =
  | { kind: "pending_for_me" }
  | { kind: "agent_activity_today"; agent: PublicAgent }
  | { kind: "workforce_today" }
  | { kind: "qualified_leads" }
  | { kind: "in_review_count" }
  | { kind: "last_completed_workflow" }
  | { kind: "researched_not_qualified" }
  | { kind: "missing_research" }
  | { kind: "qualified_without_draft" }
  | { kind: "claim_failed"; dimension: ClaimDimension }
  | { kind: "why_company"; company: string; asked: "qualified" | "rejected" | "pending" };

export type WorkspaceQuestionKind = WorkspaceQuestion["kind"];

/** The public agents and the backend slugs that resolve to each (src/config/agentRegistry.ts). */
export const PUBLIC_AGENT_SLUGS = {
  pilot: ["pilot"],
  lyra: ["scout"],
  atlas: ["aria", "hawk"],
  mira: ["penn"],
  orion: ["scribe"],
} as const;
export type PublicAgent = keyof typeof PUBLIC_AGENT_SLUGS;
const AGENT_NAME: Record<PublicAgent, string> = {
  pilot: "Pilot", lyra: "Lyra", atlas: "Atlas", mira: "Mira", orion: "Orion",
};
/** A backend slug or a public name, as the public agent. */
export function publicAgentOf(slugOrName: string | null | undefined): PublicAgent | null {
  const s = String(slugOrName ?? "").trim().toLowerCase();
  if (!s) return null;
  if (s in PUBLIC_AGENT_SLUGS) return s as PublicAgent;
  for (const [id, slugs] of Object.entries(PUBLIC_AGENT_SLUGS)) {
    if ((slugs as readonly string[]).includes(s)) return id as PublicAgent;
  }
  return null;
}

/**
 * A request to DO something, not a question about what was done. Recognised
 * first, so "find companies we haven't qualified" or "research Wordware" is
 * never answered from storage — those belong to the sourcing path and its
 * Start card.
 */
const ACTION_REQUEST_RE =
  /^(?:please\s+)?(?:find|source|search|look\s+for|look\s+up|get\s+me\s+(?:new|more)|research|run|start|launch|monitor|watch|draft|write|send|enrich|qualify|verify|check|re-?run|retry|continue|resume)\b/;

const CLAIM_WORDS: Array<[RegExp, ClaimDimension]> = [
  [/\bfunding|funded|raise[ds]?\b/, "funding"],
  [/\b(?:company\s+)?size|headcount|employee/, "company_size"],
  [/\bhiring|open\s+roles?\b/, "hiring"],
  [/\bbusiness\s+model\b/, "business_model"],
  [/\bgeograph|location|country|region\b/, "geography"],
  [/\bindustry|vertical\b/, "industry"],
];

/** Normalised text: lower case, straight quotes, single spaces, no trailing punctuation. */
function norm(message: string): string {
  return message.toLowerCase().replace(/[’‘`]/g, "'").replace(/\s+/g, " ").trim().replace(/[?.!]+$/, "").trim();
}

/**
 * Which workspace question this is, or null.
 *
 * NARROW ON PURPOSE. A null sends the message to Chat Brain exactly as before;
 * only a question this module can answer from canonical state is taken. Every
 * pattern requires both a question about held state and the state it names —
 * no single word is enough.
 */
export function classifyWorkspaceQuestion(message: string): WorkspaceQuestion | null {
  const q = norm(message);
  if (!q || q.length > 240) return null;
  if (ACTION_REQUEST_RE.test(q)) return null;

  // ── about one named company ───────────────────────────────────────────────
  const evidenceFor = q.match(
    /^(?:what|which)\s+evidence\s+(?:made|makes|got|led)\s+(.+?)\s+(?:to\s+)?(?:qualify|qualified|get qualified|pass)$/,
  ) ?? q.match(/^why\s+(?:did|does)\s+(.+?)\s+qualify$/)
    ?? q.match(/^why\s+(?:was|is)\s+(.+?)\s+qualified$/);
  if (evidenceFor) return { kind: "why_company", company: evidenceFor[1].trim(), asked: "qualified" };
  const rejected = q.match(
    /^why\s+(?:was|is|did|has)\s+(.+?)\s+(?:get\s+|been\s+)?(?:rejected|ruled\s+out|disqualified|not\s+qualified|excluded|fail(?:ed)?)$/,
  );
  if (rejected) return { kind: "why_company", company: rejected[1].trim(), asked: "rejected" };
  const pending = q.match(
    /^why\s+(?:is|was|has)\s+(.+?)\s+(?:still\s+)?(?:been\s+)?(?:pending|in\s+review|on\s+hold|waiting|unresolved|undecided|not\s+(?:yet\s+)?decided)(?:\s+still)?$/,
  );
  if (pending) return { kind: "why_company", company: pending[1].trim(), asked: "pending" };

  // ── approvals waiting on the user ─────────────────────────────────────────
  if (/\b(?:what'?s|what\s+is|what\s+are|anything|is\s+anything|is\s+there\s+anything)\s+(?:still\s+)?(?:pending|waiting)\s+(?:for|on)\s+me\b/.test(q) ||
      /\bwhat\s+(?:is|are)\s+(?:waiting\s+for|awaiting)\s+my\s+(?:approval|sign-?off|review)\b/.test(q) ||
      /\b(?:my|any)\s+pending\s+approvals?\b/.test(q)) {
    return { kind: "pending_for_me" };
  }

  // ── what an agent / the workforce did ─────────────────────────────────────
  const agent = q.match(/\b(pilot|lyra|atlas|mira|orion|scout|scribe|penn|aria|hawk)\b/);
  if (agent && /\b(?:what|anything)\b/.test(q) &&
      /\b(?:working\s+on|doing|done|did|been\s+up\s+to|worked\s+on)\b/.test(q)) {
    const id = publicAgentOf(agent[1]);
    if (id) return { kind: "agent_activity_today", agent: id };
  }
  if (/\b(?:ai\s+)?(?:workforce|agents|team)\b/.test(q) &&
      /\b(?:summari[sz]e|summary|recap|what\s+(?:has|have|did)|done|did)\b/.test(q) &&
      /\btoday|so\s+far\b/.test(q)) {
    return { kind: "workforce_today" };
  }

  // ── workflows ─────────────────────────────────────────────────────────────
  if (/\b(?:last|latest|most\s+recent(?:ly)?)\s+(?:completed|finished)\s+(?:workflow|run|mission|job|plan)\b/.test(q) ||
      /\b(?:workflow|run|mission|plan)\s+(?:that\s+)?(?:last\s+)?(?:completed|finished)\s+(?:last|most\s+recently)\b/.test(q) ||
      /^what\s+was\s+the\s+last\s+(?:workflow|run|mission)\b/.test(q)) {
    return { kind: "last_completed_workflow" };
  }

  // ── leads, filtered by canonical state ────────────────────────────────────
  //
  // ANCHORED, so a filter this module cannot apply is never dropped: "show me
  // qualified leads in fintech" does not match and goes to Chat Brain, rather
  // than being answered with every qualified lead.
  const LEADS = String.raw`(?:leads?|compan(?:y|ies)|accounts?)`;
  const WHICH = String.raw`(?:which|what|show(?:\s+me)?|list|give\s+me|tell\s+me)(?:\s+(?:are|of))?(?:\s+(?:my|our|the))?`;
  const NOW_ = String.raw`(?:\s+(?:currently|right\s+now|now|still|so\s+far|yet))*`;
  const rx = (body: string) => new RegExp(`^${body}$`);
  if (rx(String.raw`${WHICH}(?:\s+saved)?\s+qualified\s+${LEADS}${NOW_}\s+(?:still\s+)?(?:have\s+no|don'?t\s+have(?:\s+an?)?|do\s+not\s+have(?:\s+an?)?|without(?:\s+an?)?|are\s+missing(?:\s+an?)?|lack(?:ing)?(?:\s+an?)?|have\s+not\s+got(?:\s+an?)?)\s+(?:outreach\s+)?(?:drafts?|emails?|messages?)${NOW_}`).test(q)) {
    return { kind: "qualified_without_draft" };
  }
  if (rx(String.raw`${WHICH}(?:\s+saved)?\s+${LEADS}${NOW_}\s+(?:are\s+|have\s+)?(?:missing|without|lacking|with\s+no|have\s+no|don'?t\s+have)(?:\s+any)?\s+(?:company\s+)?research${NOW_}`).test(q) ||
      rx(String.raw`${WHICH}(?:\s+saved)?\s+${LEADS}\s+(?:have\s+not|haven'?t|that\s+haven'?t)\s+been\s+researched${NOW_}`).test(q)) {
    return { kind: "missing_research" };
  }
  if (rx(String.raw`${WHICH}\s+${LEADS}\s+(?:that\s+)?(?:we|i|you|lyra)(?:\s+have|'ve)?\s+researched\s+(?:but|and)\s+(?:haven'?t|have\s+not|has\s+not|hasn'?t|not)(?:\s+yet)?(?:\s+been)?\s+qualified${NOW_}`).test(q)) {
    return { kind: "researched_not_qualified" };
  }
  const failed = q.match(rx(String.raw`${WHICH}(?:\s+saved)?\s+${LEADS}\s+(?:where|whose|that|which|with)\s+(?:the\s+)?(funding|company\s+size|size|headcount|hiring|business\s+model|geography|location|industry)\s+(?:verification|check|claim|requirement)?\s*(?:has\s+|have\s+)?(?:failed|did\s+not\s+pass|didn'?t\s+pass|was\s+not\s+met)`));
  if (failed) {
    const dim = CLAIM_WORDS.find(([re]) => re.test(failed[1]))?.[1];
    if (dim) return { kind: "claim_failed", dimension: dim };
  }
  if (rx(String.raw`how\s+many(?:\s+(?:of\s+)?(?:my|our|the))?\s+${LEADS}\s+(?:are|is)${NOW_}\s+(?:in\s+review|under\s+review|pending(?:\s+review)?|awaiting\s+(?:evidence|verification)|being\s+verified)${NOW_}`).test(q)) {
    return { kind: "in_review_count" };
  }
  if (rx(String.raw`${WHICH}(?:\s+(?:latest|recent|newest|most\s+recent))?\s+qualified\s+${LEADS}${NOW_}`).test(q) ||
      rx(String.raw`what\s+are\s+my(?:\s+(?:latest|recent|newest))?\s+qualified\s+${LEADS}`).test(q)) {
    return { kind: "qualified_leads" };
  }
  return null;
}

// ══ 2. THE CANONICAL STATE ═════════════════════════════════════════════════

export type CompanyStatus = "qualified" | "pending" | "rejected" | "not_reached" | "not_evaluated";

export interface HardCheck {
  dimension: string;
  result: "pass" | "fail" | "unknown";
  reason: string;
  actor: string | null;
  url: string | null;
}

export interface CompanyState {
  name: string;
  /** True when no stored record named it and `name` was derived from its LinkedIn slug or domain. */
  name_inferred: boolean;
  domain: string | null;
  linkedin_url: string | null;
  status: CompanyStatus;
  /** The backend's bucket, verbatim, when a canonical decision exists. */
  bucket: string | null;
  label: string | null;
  hard_checks: HardCheck[];
  missing_evidence: string[];
  why_surfaced: string[];
  /** When the decision this state reports was written. */
  decided_at: string | null;
  task_id: string | null;
  lead_id: string | null;
  account_id: string | null;
  saved: boolean;
  /** Company research is held for it (`lead_enrichments`) — the Outreach "researched" fact. */
  researched: boolean;
  /** A run investigated it (collected evidence and decided, or is deciding). */
  investigated: boolean;
  has_draft: boolean;
  /**
   * WHAT A PENDING COMPANY IS WAITING ON. Two different things were both called
   * "in review": a Lead V2 company with an unresolved hard claim (evidence),
   * and an older saved lead whose company passed but no decision-maker was
   * returned for it (`pending_reason: no_decision_maker_returned`). Null when
   * the company is not pending.
   */
  waiting_on: "evidence" | "decision_maker" | null;
}

export interface RunState {
  id: string;
  agent: PublicAgent | null;
  agent_slug: string | null;
  status: string;
  description: string;
  plan_id: string | null;
  created_at: string | null;
  updated_at: string | null;
  completed_at: string | null;
  counts: { qualified: number; pending: number; rejected: number } | null;
}

export interface PlanState {
  id: string;
  status: string;
  goal: string;
  created_at: string | null;
  completed_at: string | null;
}

export interface ApprovalState {
  id: string;
  agent_slug: string | null;
  title: string;
  created_at: string | null;
  source: "approvals" | "tasks";
}

export interface WorkspaceSnapshot {
  companies: CompanyState[];
  runs: RunState[];
  plans: PlanState[];
  approvals: ApprovalState[];
  drafts_created: string[];
  leads_saved: string[];
  /** Sources that could not be read. A failed read is never reported as "nothing". */
  failed: string[];
}

/** The narrow client surface this module may use — the same one `readSurface` takes. */
export interface WorkspaceDb {
  // deno-lint-ignore no-explicit-any
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- a PostgREST builder; see `ReadDb`
  from: (table: string) => any;
}

// deno-lint-ignore no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- stored JSON, read defensively field by field
type Row = Record<string, any>;

const QUALIFIED_BUCKETS = new Set(["exact_match", "strong_opportunity", "worth_considering", "low_priority"]);
const PENDING_BUCKETS = new Set(["pending", "identity_unresolved"]);
const REJECTED_BUCKETS = new Set(["ineligible", "screened_out"]);
const DRAFT_DEAD = new Set(["discarded", "deleted", "rejected", "archived"]);

function statusOfBucket(bucket: string | null | undefined): CompanyStatus | null {
  if (!bucket) return null;
  if (QUALIFIED_BUCKETS.has(bucket)) return "qualified";
  if (PENDING_BUCKETS.has(bucket)) return "pending";
  if (REJECTED_BUCKETS.has(bucket)) return "rejected";
  if (bucket === "investigating") return "not_reached";
  return null;
}

/** Identity keys a company can be matched on: LinkedIn slug and bare domain. */
function identityKeys(i: { domain?: unknown; linkedin_url?: unknown; key?: unknown }): string[] {
  const out: string[] = [];
  for (const v of [i.linkedin_url, i.key]) {
    const m = typeof v === "string" ? v.toLowerCase().match(/linkedin\.com\/company\/([^/?#]+)/) : null;
    if (m) out.push(`li:${decodeURIComponent(m[1])}`);
  }
  for (const v of [i.domain, i.key]) {
    if (typeof v !== "string" || /linkedin\.com/i.test(v)) continue;
    const d = v.toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "");
    if (/^[a-z0-9.-]+\.[a-z]{2,}$/.test(d)) out.push(`d:${d}`);
  }
  return [...new Set(out)];
}

/**
 * A readable name from an identity when no record carries one: the LinkedIn
 * slug or the domain stem, title-cased ("wordware" → "Wordware"). Never the raw
 * URL, which is what an unnamed company used to be called in an answer.
 */
export function displayNameFromIdentity(i: { linkedin_url?: unknown; domain?: unknown; key?: unknown }): string {
  for (const v of [i.linkedin_url, i.key]) {
    const m = typeof v === "string" ? v.match(/linkedin\.com\/company\/([^/?#]+)/i) : null;
    if (m) return titleCase(decodeURIComponent(m[1]));
  }
  for (const v of [i.domain, i.key]) {
    if (typeof v !== "string" || /linkedin\.com/i.test(v)) continue;
    const stem = v.toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").split(/[./]/)[0];
    if (stem) return titleCase(stem);
  }
  return "an unnamed company";
}
const titleCase = (slug: string) =>
  slug.replace(/[-_]+/g, " ").trim().replace(/\b([a-z])/g, (c) => c.toUpperCase());

const tsOf = (...v: unknown[]): string | null => {
  for (const x of v) if (typeof x === "string" && x) return x;
  return null;
};
const str = (v: unknown): string => (typeof v === "string" ? v : "");

function hardChecksOf(lead: Row): HardCheck[] {
  const details = Array.isArray(lead.hard_check_details) ? lead.hard_check_details : [];
  if (details.length > 0) {
    return details.map((h: Row) => ({
      dimension: str(h.dimension),
      result: h.result === "pass" || h.result === "fail" ? h.result : "unknown",
      reason: str(h.reason),
      actor: str(h.provenance?.actor) || null,
      url: str(h.provenance?.url) || null,
    }));
  }
  const flat = lead.hard_checks && typeof lead.hard_checks === "object" ? lead.hard_checks as Row : {};
  return Object.entries(flat).map(([dimension, r]) => ({
    dimension, result: r === "pass" || r === "fail" ? r : "unknown", reason: "", actor: null, url: null,
  }));
}

/**
 * Read the workspace's canonical state. DATABASE ONLY, and every source is
 * bounded: a chat answer is a summary of recent work, not an export.
 */
export async function loadWorkspaceSnapshot(
  db: WorkspaceDb, workspaceId: string, need: ReadonlySet<SnapshotSource>,
): Promise<WorkspaceSnapshot> {
  const failed: string[] = [];
  const read = async (name: string, q: PromiseLike<{ data: unknown; error: unknown }>): Promise<Row[]> => {
    try {
      const { data, error } = await q;
      if (error) { failed.push(name); return []; }
      return Array.isArray(data) ? data as Row[] : [];
    } catch {
      failed.push(name);
      return [];
    }
  };
  const ws = (t: string, cols: string) => db.from(t).select(cols).eq("workspace_id", workspaceId);

  const [taskRows, planRows, leadRows, enrichRows, draftRows, approvalRows] = await Promise.all([
    need.has("runs") || need.has("companies")
      ? read("tasks", ws("tasks",
        "id, agent_slug, status, description, plan_id, created_at, updated_at, completed_at, finished_at, " +
          "query:result->>original_user_query, mission_view:result->workbench_mission_view")
        .order("created_at", { ascending: false }).limit(30))
      : Promise.resolve([]),
    need.has("plans")
      ? read("task_plans", ws("task_plans", "id, status, goal, user_instruction, created_at, completed_at")
        .order("created_at", { ascending: false }).limit(50))
      : Promise.resolve([]),
    need.has("companies")
      ? read("lead_candidates", ws("lead_candidates",
        "id, account_id, status, created_at, updated_at, canonical_decision:raw->canonical_decision, " +
          "quota_eligible:raw->quota_eligible, verdict:raw->>verdict, company_name:raw->>company_name, " +
          "pending_reason:raw->>pending_reason, " +
          "company_domain:raw->>company_domain, company_linkedin_url:raw->>company_linkedin_url, " +
          "accounts(name, domain, linkedin_url)")
        .order("created_at", { ascending: false }).limit(200))
      : Promise.resolve([]),
    need.has("companies")
      ? read("lead_enrichments", ws("lead_enrichments", "lead_candidate_id, account_id, created_at").limit(1000))
      : Promise.resolve([]),
    need.has("companies") || need.has("runs")
      ? read("outreach_drafts", ws("outreach_drafts", "lead_candidate_id, account_id, status, created_at").limit(1000))
      : Promise.resolve([]),
    need.has("approvals")
      ? read("approvals", ws("approvals", "id, agent_slug, title, summary, description, created_at")
        .eq("status", "pending").order("created_at", { ascending: false }).limit(50))
      : Promise.resolve([]),
  ]);

  // ── APPROVALS: the table first, the old shape second (as `readSurface`) ──
  let approvals: ApprovalState[] = approvalRows.map((a) => ({
    id: str(a.id), agent_slug: a.agent_slug ?? null,
    title: str(a.title) || str(a.summary) || str(a.description) || "Untitled draft",
    created_at: a.created_at ?? null, source: "approvals" as const,
  }));
  if (need.has("approvals") && approvals.length === 0 && !failed.includes("approvals")) {
    const legacy = await read("tasks_awaiting_approval", ws("tasks", "id, agent_slug, description, created_at")
      .eq("status", "awaiting_approval").order("created_at", { ascending: false }).limit(50));
    approvals = legacy.map((t) => ({
      id: str(t.id), agent_slug: t.agent_slug ?? null, title: str(t.description) || "Untitled task",
      created_at: t.created_at ?? null, source: "tasks" as const,
    }));
  }

  // ── COMPANIES: newest canonical decision wins, lead rows merged in ──────
  const companies: CompanyState[] = [];
  const byKey = new Map<string, CompanyState>();
  const attach = (c: CompanyState, keys: string[]) => {
    for (const k of keys) byKey.set(k, c);
  };
  const find = (keys: string[]) => keys.map((k) => byKey.get(k)).find((c) => !!c) ?? null;

  const runs: RunState[] = [];
  for (const t of taskRows) {
    const view = t.mission_view && typeof t.mission_view === "object" ? t.mission_view as Row : null;
    const leads: Row[] = view && Array.isArray(view.leads) ? view.leads : [];
    const decidedAt = tsOf(t.completed_at, t.finished_at, t.updated_at, t.created_at);
    let counts: RunState["counts"] = null;
    if (view) {
      counts = { qualified: 0, pending: 0, rejected: 0 };
      for (const l of leads) {
        const s = statusOfBucket(l.bucket);
        if (s === "qualified") counts.qualified++;
        else if (s === "pending") counts.pending++;
        else if (s === "rejected") counts.rejected++;
      }
    }
    runs.push({
      id: str(t.id), agent: publicAgentOf(t.agent_slug), agent_slug: t.agent_slug ?? null,
      status: str(t.status), description: str(t.query) || str(t.description),
      plan_id: t.plan_id ?? null, created_at: t.created_at ?? null, updated_at: t.updated_at ?? null,
      completed_at: tsOf(t.completed_at, t.finished_at), counts,
    });
    // Tasks arrive newest first, so the first decision seen for a company is its latest.
    for (const l of leads) {
      const co = (l.company ?? {}) as Row;
      const keys = identityKeys({ domain: co.domain, linkedin_url: co.linkedin_url, key: co.key });
      if (keys.length === 0 || find(keys)) continue;
      const status = statusOfBucket(l.bucket);
      if (!status) continue;
      const c: CompanyState = {
        name: str(co.name) || displayNameFromIdentity(co),
        name_inferred: !str(co.name),
        domain: co.domain ?? null, linkedin_url: co.linkedin_url ?? null,
        status, bucket: str(l.bucket) || null, label: l.label ?? null,
        hard_checks: hardChecksOf(l),
        missing_evidence: Array.isArray(l.missing_evidence) ? l.missing_evidence.map(String) : [],
        why_surfaced: Array.isArray(l.why_surfaced)
          ? l.why_surfaced.map((w: Row) => str(w?.text)).filter(Boolean) : [],
        decided_at: decidedAt, task_id: str(t.id) || null,
        lead_id: null, account_id: null, saved: false, researched: false,
        // Screened out by the free first pass means nothing was investigated.
        investigated: l.bucket !== "screened_out",
        has_draft: false,
        waiting_on: status === "pending" ? "evidence" : null,
      };
      companies.push(c);
      attach(c, keys);
    }
  }

  const enrichedLeads = new Set(enrichRows.map((e) => str(e.lead_candidate_id)).filter(Boolean));
  const enrichedAccounts = new Set(enrichRows.map((e) => str(e.account_id)).filter(Boolean));
  const liveDrafts = draftRows.filter((d) => !DRAFT_DEAD.has(str(d.status).toLowerCase()));
  const draftLeads = new Set(liveDrafts.map((d) => str(d.lead_candidate_id)).filter(Boolean));
  const draftAccounts = new Set(liveDrafts.map((d) => str(d.account_id)).filter(Boolean));

  for (const r of leadRows) {
    const acct = (r.accounts ?? {}) as Row;
    const domain = acct.domain ?? r.company_domain ?? null;
    const linkedin = acct.linkedin_url ?? r.company_linkedin_url ?? null;
    const name = str(acct.name) || str(r.company_name);
    if (!name) continue;
    const keys = identityKeys({ domain, linkedin_url: linkedin });
    const canonical = r.canonical_decision && typeof r.canonical_decision === "object" ? r.canonical_decision as Row : null;
    const researched = enrichedLeads.has(str(r.id)) || (!!r.account_id && enrichedAccounts.has(str(r.account_id)));
    const hasDraft = draftLeads.has(str(r.id)) || (!!r.account_id && draftAccounts.has(str(r.account_id)));
    const existing = keys.length > 0 ? find(keys) : null;
    if (existing) {
      // A saved lead's real name replaces one derived from a slug.
      if (existing.name_inferred) {
        existing.name = name;
        existing.name_inferred = false;
      }
      existing.saved = true;
      existing.lead_id ??= str(r.id) || null;
      existing.account_id ??= r.account_id ?? null;
      existing.researched ||= researched;
      existing.has_draft ||= hasDraft;
      continue;
    }
    // THE LEAD ROW'S OWN DECISION, read — never inferred from being saved.
    const status: CompanyStatus = canonical
      ? (canonical.qualified === true ? "qualified" : statusOfBucket(canonical.bucket) ?? "not_evaluated")
      : r.quota_eligible === true
      ? "qualified"
      : /^(reject|rejected|skip|skipped)$/i.test(str(r.verdict))
      ? "rejected"
      : r.quota_eligible === false
      ? "pending"
      : "not_evaluated";
    const c: CompanyState = {
      name, name_inferred: false, domain, linkedin_url: linkedin, status,
      bucket: canonical ? str(canonical.bucket) || null : null,
      label: canonical ? canonical.label ?? null : null,
      hard_checks: canonical ? hardChecksOf(canonical) : [],
      missing_evidence: [], why_surfaced: [],
      decided_at: tsOf(r.updated_at, r.created_at), task_id: null,
      lead_id: str(r.id) || null, account_id: r.account_id ?? null,
      saved: true, researched, investigated: !!canonical, has_draft: hasDraft,
      // A legacy company row pending a PERSON, not company evidence.
      waiting_on: status !== "pending"
        ? null
        : !canonical && /decision_maker|contact/i.test(str(r.pending_reason))
        ? "decision_maker"
        : "evidence",
    };
    companies.push(c);
    attach(c, keys);
  }

  companies.sort((a, b) => String(b.decided_at ?? "").localeCompare(String(a.decided_at ?? "")));

  return {
    companies, runs,
    plans: planRows.map((p) => ({
      id: str(p.id), status: str(p.status), goal: str(p.goal) || str(p.user_instruction),
      created_at: p.created_at ?? null, completed_at: p.completed_at ?? null,
    })),
    approvals,
    drafts_created: draftRows.map((d) => str(d.created_at)).filter(Boolean),
    leads_saved: leadRows.map((r) => str(r.created_at)).filter(Boolean),
    failed,
  };
}

export type SnapshotSource = "runs" | "plans" | "companies" | "approvals";

/** Which sources a question needs — so a question about approvals reads no mission views. */
export function sourcesFor(q: WorkspaceQuestion): Set<SnapshotSource> {
  switch (q.kind) {
    case "pending_for_me": return new Set(["approvals", "companies", "runs"]);
    case "agent_activity_today": return new Set(["runs", "plans"]);
    case "workforce_today": return new Set(["runs", "plans", "approvals", "companies"]);
    case "last_completed_workflow": return new Set(["plans", "runs"]);
    default: return new Set(["companies", "runs"]);
  }
}

// ══ 3. "TODAY", IN THE USER'S TIME ═════════════════════════════════════════

/** The IANA zone, if it is one this runtime knows; otherwise UTC. */
export function safeTimeZone(tz: unknown): string {
  if (typeof tz !== "string" || !tz || tz.length > 64) return "UTC";
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return tz;
  } catch {
    return "UTC";
  }
}

function zoned(d: Date, tz: string) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  }).formatToParts(d).map((p) => [p.type, p.value]));
  return { y: +parts.year, m: +parts.month, d: +parts.day, h: +parts.hour, mi: +parts.minute, s: +parts.second };
}

/** Midnight today in `tz`, as an instant. */
export function startOfToday(now: Date, tz: string): Date {
  const z = zoned(now, tz);
  const offset = Date.UTC(z.y, z.m - 1, z.d, z.h, z.mi, z.s) - Math.floor(now.getTime() / 1000) * 1000;
  return new Date(Date.UTC(z.y, z.m - 1, z.d) - offset);
}

function whenText(iso: string | null, now: Date, tz: string): string {
  if (!iso) return "at an unrecorded time";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "at an unrecorded time";
  const time = new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(d);
  if (d >= startOfToday(now, tz)) return `today at ${time}`;
  const day = new Intl.DateTimeFormat("en-GB", { timeZone: tz, day: "numeric", month: "short", year: "numeric" }).format(d);
  return `on ${day} at ${time}`;
}

// ══ 4. THE ANSWER ══════════════════════════════════════════════════════════

export interface WorkspaceAnswer {
  text: string;
  counts: Record<string, number>;
  /** Companies the answer named, in display order — so a follow-up can point at them. */
  companies: Array<{ name: string; domain: string | null; linkedin_url: string | null }>;
  /** True when part of the state could not be read. */
  degraded: boolean;
}

const LIST_LIMIT = 10;
const BUCKET_LABEL: Record<string, string> = {
  exact_match: "exact match", strong_opportunity: "strong opportunity",
  worth_considering: "worth considering", low_priority: "low priority",
};
const DIMENSION_LABEL: Record<string, string> = {
  funding: "funding", funding_stage: "funding stage", company_size: "company size", hiring: "hiring",
  business_model: "business model", geography: "location", industry: "industry",
  known_companies: "identity", company_stage: "company stage",
};
const dimLabel = (d: string) => DIMENSION_LABEL[d] ?? d.replace(/_/g, " ");
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function nameList(cs: CompanyState[], line: (c: CompanyState) => string): string {
  const shown = cs.slice(0, LIST_LIMIT).map((c) => `• ${line(c)}`).join("\n");
  const more = cs.length > LIST_LIMIT ? `\n…and ${cs.length - LIST_LIMIT} more.` : "";
  return shown + more;
}

function failedNote(s: WorkspaceSnapshot): string {
  return s.failed.length > 0
    ? `\n\n(I couldn't read part of your saved data just now — ${s.failed.join(", ")} — so this may be incomplete.)`
    : "";
}

/** Find one company by what the user called it: name, LinkedIn slug or domain. */
export function findCompany(s: WorkspaceSnapshot, asked: string): CompanyState[] {
  const n = (v: string | null | undefined) =>
    String(v ?? "").toLowerCase().replace(/\b(inc|llc|ltd|limited|corp|gmbh)\b\.?/g, "").replace(/[^a-z0-9]+/g, "");
  const want = n(asked);
  if (!want) return [];
  const exact = s.companies.filter((c) => {
    const slug = c.linkedin_url?.toLowerCase().match(/linkedin\.com\/company\/([^/?#]+)/)?.[1] ?? null;
    const stem = c.domain?.toLowerCase().replace(/^www\./, "").split(".")[0] ?? null;
    return n(c.name) === want || n(slug) === want || n(stem) === want || n(c.domain) === want;
  });
  if (exact.length > 0) return exact;
  return want.length >= 4 ? s.companies.filter((c) => n(c.name).startsWith(want)) : [];
}

function describeChecks(c: CompanyState, result: "pass" | "fail" | "unknown"): string[] {
  return c.hard_checks.filter((h) => h.result === result).map((h) => {
    const by = h.actor ? ` (source: ${h.actor}${h.url ? `, ${h.url}` : ""})` : "";
    return `• ${dimLabel(h.dimension)}: ${h.reason || (result === "pass" ? "passed" : result === "fail" ? "failed" : "not yet established")}${by}`;
  });
}

function statusPhrase(c: CompanyState): string {
  switch (c.status) {
    case "qualified": return `qualified${c.bucket && BUCKET_LABEL[c.bucket] ? ` (${BUCKET_LABEL[c.bucket]})` : ""}`;
    case "pending":
      return c.waiting_on === "decision_maker"
        ? "in review — waiting on a decision-maker, not on company evidence"
        : "pending — a required claim is not yet established";
    case "rejected": return c.bucket === "screened_out" ? "screened out by the free first pass" : "ruled out";
    case "not_reached": return "not reached yet — a continuation would investigate it";
    default: return "saved but not evaluated — no qualification decision was recorded";
  }
}

function answerWhy(s: WorkspaceSnapshot, q: Extract<WorkspaceQuestion, { kind: "why_company" }>, now: Date, tz: string): WorkspaceAnswer {
  const matches = findCompany(s, q.company);
  const base = { counts: { matches: matches.length }, degraded: s.failed.length > 0 };
  if (matches.length === 0) {
    return { ...base, companies: [],
      text: `I don't have any record of "${q.company}" in this workspace — no saved lead and no run that evaluated it. I haven't gone looking; ask me to research it if you'd like a check.${failedNote(s)}` };
  }
  const distinct = [...new Set(matches.map((c) => c.name))];
  if (distinct.length > 1) {
    return { ...base, companies: matches.map((c) => ({ name: c.name, domain: c.domain, linkedin_url: c.linkedin_url })),
      text: `"${q.company}" matches more than one company: ${distinct.join(", ")}. Which one did you mean?` };
  }
  const c = matches[0];
  const ref = [{ name: c.name, domain: c.domain, linkedin_url: c.linkedin_url }];
  const from = c.decided_at ? ` (decision recorded ${whenText(c.decided_at, now, tz)})` : "";

  // THE QUESTION'S PREMISE IS CHECKED, NOT ASSUMED. "Why was X rejected?" about a
  // company that is pending gets the truth, not an invented rejection.
  if (q.asked === "qualified" && c.status !== "qualified") {
    return { ...base, companies: ref,
      text: `${c.name} hasn't qualified — it's ${statusPhrase(c)}${from}.${whyNotBody(c)}` };
  }
  if (q.asked === "rejected" && c.status !== "rejected") {
    return { ...base, companies: ref,
      text: `${c.name} wasn't rejected — it's ${statusPhrase(c)}${from}.${whyNotBody(c)}` };
  }
  if (q.asked === "pending" && c.status !== "pending") {
    return { ...base, companies: ref,
      text: `${c.name} isn't pending — it's ${statusPhrase(c)}${from}.${whyNotBody(c)}` };
  }
  if (c.status === "qualified") {
    const passes = describeChecks(c, "pass");
    const why = c.why_surfaced.length > 0 ? `\n\nWhy it surfaced:\n${c.why_surfaced.map((w) => `• ${w}`).join("\n")}` : "";
    const body = passes.length > 0
      ? `Every hard requirement passed on recorded evidence:\n${passes.join("\n")}`
      : "The saved decision marks it qualified, but this record carries no per-claim evidence detail.";
    return { ...base, companies: ref, text: `${c.name} qualified${c.bucket && BUCKET_LABEL[c.bucket] ? ` as ${BUCKET_LABEL[c.bucket]}` : ""}${from}.\n\n${body}${why}` };
  }
  return { ...base, companies: ref, text: `${c.name} is ${statusPhrase(c)}${from}.${whyNotBody(c)}` };
}

function whyNotBody(c: CompanyState): string {
  if (c.status === "rejected") {
    const fails = describeChecks(c, "fail");
    return fails.length > 0
      ? `\n\nThe required claim${fails.length === 1 ? "" : "s"} that failed:\n${fails.join("\n")}`
      : "\n\nNo per-claim detail was recorded for the rejection.";
  }
  if (c.status === "pending" && c.waiting_on === "decision_maker") {
    return "\n\nThe company itself is not in question: no decision-maker was returned for it yet, so it stays in review until one is found.";
  }
  if (c.status === "pending") {
    const unknown = describeChecks(c, "unknown");
    const missing = c.missing_evidence.slice(0, 5).map((m) => `• ${m}`);
    const passed = describeChecks(c, "pass");
    return (unknown.length > 0 ? `\n\nStill unresolved:\n${unknown.join("\n")}` : "")
      + (missing.length > 0 ? `\n\nMissing evidence:\n${missing.join("\n")}` : "")
      + (passed.length > 0 ? `\n\nAlready established:\n${passed.join("\n")}` : "")
      + (unknown.length + missing.length === 0 ? "\n\nNo detail was recorded about what it is waiting on." : "")
      + "\n\nIt stays pending, not rejected, until that evidence is found or disproven.";
  }
  if (c.status === "qualified") {
    const passes = describeChecks(c, "pass");
    return passes.length > 0 ? `\n\nIts hard requirements passed:\n${passes.join("\n")}` : "";
  }
  return "";
}

function activityToday(s: WorkspaceSnapshot, start: Date) {
  const since = (iso: string | null) => !!iso && new Date(iso) >= start;
  return s.runs.filter((r) => since(r.created_at) || since(r.updated_at) || since(r.completed_at));
}

function runLine(r: RunState, now: Date, tz: string): string {
  const what = r.description ? `"${r.description.slice(0, 120)}"` : "a task";
  const outcome = r.counts
    ? ` — ${r.counts.qualified} qualified, ${r.counts.pending} pending, ${r.counts.rejected} ruled out`
    : "";
  return `• ${what} — ${r.status || "unknown status"}, started ${whenText(r.created_at, now, tz)}${outcome}`;
}

/**
 * Answer a workspace question from a snapshot. Pure: the same snapshot, clock
 * and zone always give the same words.
 */
export function answerWorkspaceQuestion(
  q: WorkspaceQuestion, s: WorkspaceSnapshot, now: Date, timeZone: string,
): WorkspaceAnswer {
  const tz = safeTimeZone(timeZone);
  const zoneNote = tz === "UTC" ? " (UTC)" : "";
  const degraded = s.failed.length > 0;
  const refs = (cs: CompanyState[]) =>
    cs.slice(0, LIST_LIMIT).map((c) => ({ name: c.name, domain: c.domain, linkedin_url: c.linkedin_url }));
  const by = (st: CompanyStatus) => s.companies.filter((c) => c.status === st);

  switch (q.kind) {
    case "why_company":
      return answerWhy(s, q, now, tz);

    case "pending_for_me": {
      const inReview = by("pending");
      const head = s.approvals.length === 0
        ? "Nothing is waiting on you right now — 0 pending approvals."
        : `${plural(s.approvals.length, "item")} waiting for your approval:\n${s.approvals.slice(0, LIST_LIMIT)
          .map((a) => `• ${AGENT_NAME[publicAgentOf(a.agent_slug) ?? "pilot"]}: ${a.title}`).join("\n")}\n\nOpen the Workbench to approve or edit each one.`;
      // WHAT EACH IS WAITING ON, counted separately: evidence and a missing
      // decision-maker are different waits, and neither is the user.
      const onEvidence = inReview.filter((c) => c.waiting_on !== "decision_maker").length;
      const onPerson = inReview.length - onEvidence;
      const waits = [
        onEvidence ? `${onEvidence} waiting on evidence` : "",
        onPerson ? `${onPerson} waiting on a decision-maker` : "",
      ].filter(Boolean).join(", ");
      const note = inReview.length > 0
        ? `\n\nSeparately, ${plural(inReview.length, "company is", "companies are")} in review, not waiting on you: ${waits}.`
        : "";
      return {
        text: head + note + failedNote(s),
        counts: { approvals: s.approvals.length, in_review: inReview.length, waiting_on_evidence: onEvidence, waiting_on_decision_maker: onPerson },
        companies: [], degraded,
      };
    }

    case "agent_activity_today":
    case "workforce_today": {
      const start = startOfToday(now, tz);
      const today = activityToday(s, start).filter((r) => q.kind === "workforce_today" || r.agent === q.agent);
      const who = q.kind === "agent_activity_today" ? AGENT_NAME[q.agent] : "Your AI workforce";
      const plansDone = s.plans.filter((p) => p.completed_at && new Date(p.completed_at) >= start);
      if (today.length === 0) {
        const last = s.runs.find((r) => q.kind === "workforce_today" || r.agent === q.agent);
        const lastLine = last
          ? ` The last thing ${q.kind === "agent_activity_today" ? AGENT_NAME[q.agent] : "it"} worked on was ${last.description ? `"${last.description.slice(0, 120)}"` : "a task"}, ${whenText(last.created_at, now, tz)} (${last.status}).`
          : "";
        const verb = q.kind === "agent_activity_today" ? "hasn't worked on anything" : "hasn't done anything";
        return { text: `${who} ${verb} today${zoneNote}.${lastLine}${failedNote(s)}`, counts: { today: 0 }, companies: [], degraded };
      }
      const lines: string[] = [];
      if (q.kind === "workforce_today") {
        const byAgent = new Map<string, RunState[]>();
        for (const r of today) {
          const name = r.agent ? AGENT_NAME[r.agent] : (r.agent_slug ?? "Unknown agent");
          byAgent.set(name, [...(byAgent.get(name) ?? []), r]);
        }
        for (const [name, rs] of byAgent) {
          lines.push(`${name}: ${plural(rs.length, "task")}`);
          lines.push(...rs.slice(0, 5).map((r) => runLine(r, now, tz)));
        }
        const approvalsToday = s.approvals.filter((a) => a.created_at && new Date(a.created_at) >= start).length;
        const draftsToday = s.drafts_created.filter((d) => new Date(d) >= start).length;
        const leadsToday = s.leads_saved.filter((d) => new Date(d) >= start).length;
        const extras = [
          plansDone.length ? `${plural(plansDone.length, "workflow")} completed` : "",
          leadsToday ? `${plural(leadsToday, "lead")} saved` : "",
          draftsToday ? `${plural(draftsToday, "outreach draft")} written` : "",
          approvalsToday ? `${plural(approvalsToday, "approval")} waiting on you` : "",
        ].filter(Boolean);
        if (extras.length) lines.push(`\nToday also: ${extras.join(", ")}.`);
      } else {
        lines.push(...today.slice(0, LIST_LIMIT).map((r) => runLine(r, now, tz)));
      }
      const totals = today.reduce((a, r) => ({
        qualified: a.qualified + (r.counts?.qualified ?? 0), pending: a.pending + (r.counts?.pending ?? 0),
        rejected: a.rejected + (r.counts?.rejected ?? 0),
      }), { qualified: 0, pending: 0, rejected: 0 });
      return {
        text: `${who} — ${plural(today.length, "task")} today${zoneNote}:\n${lines.join("\n")}${failedNote(s)}`,
        counts: { today: today.length, ...totals }, companies: [], degraded,
      };
    }

    case "last_completed_workflow": {
      const done = s.plans.filter((p) => p.status === "complete" && p.completed_at)
        .sort((a, b) => String(b.completed_at).localeCompare(String(a.completed_at)));
      const last = done[0];
      if (!last) {
        return { text: `No workflow has completed in this workspace yet.${failedNote(s)}`, counts: { completed: 0 }, companies: [], degraded };
      }
      const steps = s.runs.filter((r) => r.plan_id === last.id);
      const outcome = steps.find((r) => r.counts)?.counts;
      const result = outcome
        ? `\n\nResult: ${outcome.qualified} qualified, ${outcome.pending} pending, ${outcome.rejected} ruled out.`
        : "";
      // A NEWER WORKFLOW THAT DID NOT COMPLETE is mentioned, never substituted.
      const newer = s.plans.filter((p) => p.id !== last.id && p.status !== "complete" &&
        String(p.created_at ?? "") > String(last.completed_at ?? ""));
      const note = newer.length > 0
        ? `\n\nSince then, ${plural(newer.length, "workflow has", "workflows have")} started but not completed (${[...new Set(newer.map((p) => p.status))].join(", ")}).`
        : "";
      return {
        text: `The last completed workflow was "${last.goal.slice(0, 160)}", completed ${whenText(last.completed_at, now, tz)}.${result}${note}${failedNote(s)}`,
        counts: { completed: done.length }, companies: [], degraded,
      };
    }

    case "qualified_leads": {
      const qualified = by("qualified");
      // COUNTED AS COMPANIES. Two lead rows for one company are one company,
      // so "48 saved leads" beside 49 rows was a count of neither.
      const saved = s.companies.filter((c) => c.saved).length;
      const savedNotQualified = s.companies.filter((c) => c.saved && c.status !== "qualified").length;
      if (qualified.length === 0) {
        return { text: `None of your companies have qualified yet${saved ? ` — you have ${plural(saved, "saved company", "saved companies")}, and none carries a qualifying decision` : ""}.${failedNote(s)}`,
          counts: { qualified: 0, saved }, companies: [], degraded };
      }
      return {
        text: `${plural(qualified.length, "qualified lead")}, newest first:\n${nameList(qualified, (c) =>
          `${c.name}${c.bucket && BUCKET_LABEL[c.bucket] ? ` — ${BUCKET_LABEL[c.bucket]}` : ""}${c.decided_at ? `, ${whenText(c.decided_at, now, tz)}` : ""}`)}` +
          (savedNotQualified > 0
            ? `\n\nOf your ${plural(saved, "saved company", "saved companies")}, ${savedNotQualified} ${savedNotQualified === 1 ? "has" : "have"} not qualified.`
            : "") + failedNote(s),
        counts: { qualified: qualified.length, saved }, companies: refs(qualified), degraded,
      };
    }

    case "in_review_count": {
      const pending = by("pending");
      return {
        text: pending.length === 0
          ? `No leads are in review right now.${failedNote(s)}`
          : `${plural(pending.length, "lead is", "leads are")} in review:\n${nameList(pending, (c) =>
            `${c.name} — waiting on ${c.waiting_on === "decision_maker" ? "a decision-maker" : c.hard_checks.filter((h) => h.result === "unknown").map((h) => dimLabel(h.dimension)).join(", ") || c.missing_evidence[0] || "evidence"}`)}${failedNote(s)}`,
        counts: { in_review: pending.length }, companies: refs(pending), degraded,
      };
    }

    case "researched_not_qualified": {
      const researched = (c: CompanyState) => c.researched || c.investigated;
      const open = s.companies.filter((c) => researched(c) && (c.status === "pending" || c.status === "not_evaluated" || c.status === "not_reached"));
      const ruledOut = s.companies.filter((c) => researched(c) && c.status === "rejected").length;
      const tail = ruledOut ? `\n\n${plural(ruledOut, "other researched company was", "other researched companies were")} ruled out, so ${ruledOut === 1 ? "it isn't" : "they aren't"} listed.` : "";
      return {
        text: open.length === 0
          ? `Every company we researched has a decision — none is waiting to qualify.${tail}${failedNote(s)}`
          : `${plural(open.length, "researched company has", "researched companies have")} not qualified yet:\n${nameList(open, (c) => `${c.name} — ${statusPhrase(c)}`)}${tail}${failedNote(s)}`,
        counts: { researched_not_qualified: open.length, ruled_out: ruledOut }, companies: refs(open), degraded,
      };
    }

    case "missing_research": {
      const saved = s.companies.filter((c) => c.saved);
      const missing = saved.filter((c) => !c.researched);
      return {
        text: saved.length === 0
          ? `You don't have any saved leads yet.${failedNote(s)}`
          : missing.length === 0
          ? `Every one of your ${plural(saved.length, "saved company", "saved companies")} has company research.${failedNote(s)}`
          : `${plural(missing.length, "saved company has", "saved companies have")} no company research yet:\n${nameList(missing, (c) => `${c.name} — ${statusPhrase(c)}`)}${failedNote(s)}`,
        counts: { saved: saved.length, missing_research: missing.length }, companies: refs(missing), degraded,
      };
    }

    case "qualified_without_draft": {
      const qualified = by("qualified");
      const without = qualified.filter((c) => !c.has_draft);
      return {
        text: qualified.length === 0
          ? `None of your companies have qualified yet, so none needs an outreach draft.${failedNote(s)}`
          : without.length === 0
          ? `Every qualified lead (${qualified.length}) already has an outreach draft.${failedNote(s)}`
          : `${plural(without.length, "qualified lead has", "qualified leads have")} no outreach draft yet:\n${nameList(without, (c) => c.name)}${failedNote(s)}`,
        counts: { qualified: qualified.length, without_draft: without.length }, companies: refs(without), degraded,
      };
    }

    case "claim_failed": {
      const dims = q.dimension === "funding" ? ["funding", "funding_stage"] : [q.dimension];
      const failing = s.companies.filter((c) => c.hard_checks.some((h) => dims.includes(h.dimension) && h.result === "fail"));
      const unresolved = s.companies.filter((c) => c.status === "pending" &&
        c.hard_checks.some((h) => dims.includes(h.dimension) && h.result === "unknown")).length;
      const label = dimLabel(q.dimension);
      const tail = unresolved ? `\n\n${plural(unresolved, "other company is", "other companies are")} still unverified on ${label} — pending, not failed.` : "";
      return {
        text: failing.length === 0
          ? `No company has failed ${label} verification.${tail}${failedNote(s)}`
          : `${plural(failing.length, "company", "companies")} failed ${label} verification:\n${nameList(failing, (c) =>
            `${c.name} — ${c.hard_checks.filter((h) => dims.includes(h.dimension) && h.result === "fail").map((h) => h.reason).filter(Boolean).join("; ") || "failed"}`)}${tail}${failedNote(s)}`,
        counts: { failed: failing.length, unresolved }, companies: refs(failing), degraded,
      };
    }
  }
}
