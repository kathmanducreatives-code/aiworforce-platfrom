// CANONICAL SIGNAL → ACTIONS and → ATLAS HANDOFF (Signals recovery, Phases 3 and 5).
//
// One reader of a canonical `signal_events` row for every consumer that acts on it: the Signals
// page's "Recommended" line, ORION, the content agent and the ATLAS discovery handoff. Whatever
// collected the row (Radar, monitoring, LISA, a fixture) — the handoff reads only the stored row,
// so it is PROVIDER-INDEPENDENT: no provider name, actor or API shape appears in it.
//
// What this module guarantees:
//   • Nothing executes. Every action is a recommendation that needs a person (`executes: false`,
//     `requires_approval: true`). There is no outreach action at all.
//   • "Verified" is earned, never asserted: only provider-verified, self-reported or corroborated
//     evidence with a source link, on an active row. AI-inferred or unverified claims are never
//     called verified, whatever their confidence.
//   • A company excluded by the Company Brain gets no discovery action.
//   • A synthetic fixture row is marked as such and can only produce a dry-run handoff.
//
// The ATLAS side (V5, developed in parallel) consumes `SignalAtlasHandoffV1` through the existing
// agent_handoffs store (collab/signalToAtlas.ts); nothing here calls or changes ATLAS.
//
// PURE and import-free, so the web app and the edge functions share it.

export const SIGNAL_ATLAS_HANDOFF_VERSION = "signal-atlas-handoff-v1" as const;

/** The canonical row as stored (signal_events) plus optional evidence rows. */
export interface CanonicalSignalRow {
  id: string;
  workspace_id: string;
  signal_type: string;
  signal_category?: string | null;
  origin?: string | null;
  subject_type?: string | null;
  subject_key?: string | null;
  account_id?: string | null;
  occurred_at?: string | null;
  occurred_at_basis?: string | null;
  observed_at?: string | null;
  verification_status?: string | null;
  confidence?: string | null;
  provider?: string | null;
  source_url?: string | null;
  lifecycle_status?: string | null;
  dedupe_key?: string | null;
  normalized_value?: Record<string, unknown> | null;
  evidence?: Array<{ url?: string | null; excerpt?: string | null; source_type?: string | null }>;
}

/** What the Company Brain says about who is out of scope (ATLAS's own view carries the same). */
export interface HandoffBrainScope {
  excluded_industries?: string[];
  excluded_company_names?: string[];
  excluded_domains?: string[];
  rejected_account_ids?: string[];
}

export type EvidenceLevel = "corroborated" | "self_reported" | "provider_verified" | "single_source" | "contradicted" | "inferred" | "unverified";
export type SignalKind = "hiring" | "expansion" | "funding" | "leadership" | "technology" | "launch" | "competitor" | "other";

const s = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
const obj = (v: unknown) => (v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {});
const lc = (v: string | null | undefined) => (v ?? "").toLowerCase();

export function isFixtureRow(r: CanonicalSignalRow): boolean {
  return lc(r.provider) === "fixture" || /\.example\.test\b/i.test(r.source_url ?? "") || obj(r.normalized_value).fixture === true;
}

export function signalKind(r: CanonicalSignalRow): SignalKind {
  const t = lc(s(obj(r.normalized_value).radar_signal_type) ?? r.signal_type);
  if (r.subject_type === "competitor" || /competitor/.test(t)) return "competitor";
  if (/hiring|job/.test(t)) return "hiring";
  if (/expansion|employee_growth|new_location/.test(t)) return "expansion";
  if (/funding/.test(t)) return "funding";
  if (/leader|role_changed|person_left/.test(t)) return "leadership";
  if (/integration|technolog|implementation/.test(t)) return "technology";
  if (/launch|release/.test(t)) return "launch";
  return "other";
}

/** The evidence level as stored. LISA's counted level wins; otherwise the row's own status. */
export function evidenceLevel(r: CanonicalSignalRow): EvidenceLevel {
  const lisa = obj(obj(r.normalized_value).lisa);
  const counted = s(obj(lisa.verification).level);
  if (counted && ["corroborated", "self_reported", "single_source", "contradicted"].includes(counted)) return counted as EvidenceLevel;
  if (/ai|inferred|llm/.test(lc(r.origin)) || obj(r.normalized_value).ai_inferred === true) return "inferred";
  const v = lc(r.verification_status);
  if (v === "provider_verified" || v === "self_reported") return v;
  return "unverified";
}

/** Verified = sourced, active, and evidenced beyond a single unconfirmed or inferred claim. */
export function isVerifiedSignal(r: CanonicalSignalRow): boolean {
  const level = evidenceLevel(r);
  const active = !r.lifecycle_status || r.lifecycle_status === "active";
  return active && !!s(r.source_url) && (level === "corroborated" || level === "self_reported" || level === "provider_verified");
}

export interface SignalCompany { name: string | null; domain: string | null; domain_verified: boolean; account_id: string | null }

export function signalCompany(r: CanonicalSignalRow): SignalCompany {
  const nv = obj(r.normalized_value);
  const lc_ = obj(obj(nv.lisa).company);
  const name = s(lc_.name) ?? s(nv.company_name) ?? (r.subject_type === "competitor" ? s(r.subject_key) : null);
  const domain = s(lc_.domain) ?? s(nv.company_domain)
    ?? (/^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(r.subject_key ?? "") ? s(r.subject_key)!.toLowerCase() : null);
  // A domain counts as verified only when the source IS that company's own site, or it is a stored account.
  let host: string | null = null;
  try { host = r.source_url ? new URL(r.source_url).hostname.replace(/^www\./, "").toLowerCase() : null; } catch { host = null; }
  const domain_verified = !!domain && (!!r.account_id || (!!host && (host === domain || host.endsWith(`.${domain}`))));
  return { name: name ?? (domain ?? null), domain, domain_verified, account_id: r.account_id ?? null };
}

export function exclusionMatch(r: CanonicalSignalRow, scope: HandoffBrainScope | null): string | null {
  if (!scope) return null;
  const c = signalCompany(r);
  const nv = obj(r.normalized_value);
  const industry = lc(s(nv.company_industry) ?? s(nv.industry));
  if (c.domain && (scope.excluded_domains ?? []).map(lc).includes(lc(c.domain))) return `excluded domain ${c.domain}`;
  if (c.name && (scope.excluded_company_names ?? []).map(lc).includes(lc(c.name))) return `excluded company ${c.name}`;
  if (c.account_id && (scope.rejected_account_ids ?? []).includes(c.account_id)) return "an account you rejected";
  const ind = (scope.excluded_industries ?? []).find((x) => industry && (industry.includes(lc(x)) || lc(x).includes(industry)));
  if (ind) return `excluded industry ${ind}`;
  return null;
}

export interface IcpRelevance { band: string | null; score: number | null; reasons: string[] }
export function icpRelevance(r: CanonicalSignalRow): IcpRelevance {
  const nv = obj(r.normalized_value);
  const rel = obj(obj(nv.lisa).relevance);
  const reasons = Array.isArray(rel.reasons) ? (rel.reasons as unknown[]).filter((x): x is string => typeof x === "string")
    : Array.isArray(nv.matched_icp) ? (nv.matched_icp as unknown[]).filter((x): x is string => typeof x === "string") : [];
  const score = typeof rel.score === "number" ? rel.score : typeof nv.icp_score === "number" ? nv.icp_score as number : null;
  return { band: s(rel.band), score, reasons };
}

// ── recommended actions (never executed here) ────────────────────────────────────────────────
export type SignalActionKind = "atlas_discovery" | "competitor_review" | "content_topic" | "orion_brief";
export interface SignalAction {
  kind: SignalActionKind;
  agent: "atlas" | "orion" | "lyra";
  label: string;
  why: string;
  requires_approval: true;
  executes: false;
}

const act = (kind: SignalActionKind, agent: SignalAction["agent"], label: string, why: string): SignalAction =>
  ({ kind, agent, label, why, requires_approval: true, executes: false });

export function recommendedSignalActions(r: CanonicalSignalRow, scope: HandoffBrainScope | null = null): { actions: SignalAction[]; held: string[] } {
  const held: string[] = [];
  const actions: SignalAction[] = [];
  const kind = signalKind(r);
  const verified = isVerifiedSignal(r);
  const c = signalCompany(r);
  const excluded = exclusionMatch(r, scope);
  const fixture = isFixtureRow(r);
  if (fixture) held.push("test fixture — actions are dry-run only");
  if (r.lifecycle_status && r.lifecycle_status !== "active") { held.push(`signal is ${r.lifecycle_status}`); return { actions, held }; }
  if (!verified) held.push("not verified — confirm the source before acting on it");
  if (excluded) held.push(`no discovery: ${excluded}`);

  if (kind === "competitor") {
    actions.push(act("competitor_review", "orion", `Review ${c.name ?? "the competitor"}'s move`, "A competitor changed something; check positioning before it reaches deals."));
  } else if (verified && !excluded && c.name && kind !== "other") {
    actions.push(act("atlas_discovery", "atlas", `Ask ATLAS to qualify ${c.name}`,
      `${c.name} shows a ${kind} signal that matches what your Company Brain watches for. ATLAS checks fit before anyone is contacted.`));
  }
  if (verified) {
    actions.push(act("orion_brief", "orion", "Include in ORION's next brief", "Verified, current and sourced — worth an executive look."));
    if (kind !== "other") actions.push(act("content_topic", "lyra", `Content topic: what ${kind} moves like this mean for buyers`,
      "A sourced market event; content cites it and never adds facts it does not contain."));
  }
  return { actions, held };
}

// ── the ATLAS handoff ─────────────────────────────────────────────────────────────────────────
export interface SignalAtlasHandoffV1 {
  version: typeof SIGNAL_ATLAS_HANDOFF_VERSION;
  workspace_id: string;
  idempotency_key: string;
  is_fixture: boolean;
  signal: {
    id: string; store: "signal_events"; type: string; kind: SignalKind;
    event_date: string | null; event_date_basis: string | null; detected_at: string | null; dedupe_key: string | null;
  };
  company: SignalCompany & { name: string };
  evidence: Array<{ url: string; excerpt: string | null; source_type: string | null }>;
  verification: { level: EvidenceLevel; verified: boolean; confidence: string | null };
  icp_relevance: IcpRelevance;
  exclusion_check: { checked: boolean; matched: null };
  recommended_discovery_action: {
    kind: "qualify_company";
    mode: "proposal" | "dry_run_only";
    query: string;
    requested_count: 1;
    company_domain: string | null;
    requires_approval: true;
    paid_discovery: "requires_mission_approval";
  };
  guardrails: { contact_enrichment: false; outreach: false; note: string };
}

export type HandoffRefusal = "wrong_workspace" | "not_active" | "not_verified" | "no_company" | "excluded" | "not_a_discovery_signal";

export function buildSignalAtlasHandoff(r: CanonicalSignalRow, workspace_id: string, scope: HandoffBrainScope | null):
  { ok: true; handoff: SignalAtlasHandoffV1 } | { ok: false; reason: HandoffRefusal; detail: string } {
  if (r.workspace_id !== workspace_id) return { ok: false, reason: "wrong_workspace", detail: "The signal belongs to another workspace." };
  if (r.lifecycle_status && r.lifecycle_status !== "active") return { ok: false, reason: "not_active", detail: `The signal is ${r.lifecycle_status}.` };
  if (!isVerifiedSignal(r)) return { ok: false, reason: "not_verified", detail: "Only a verified, sourced signal can start discovery." };
  const kind = signalKind(r);
  if (kind === "competitor" || kind === "other") return { ok: false, reason: "not_a_discovery_signal", detail: "Competitor and unclassified signals go to review, not discovery." };
  const company = signalCompany(r);
  if (!company.name) return { ok: false, reason: "no_company", detail: "The signal does not identify a company." };
  const ex = exclusionMatch(r, scope);
  if (ex) return { ok: false, reason: "excluded", detail: `Excluded by your Company Brain (${ex}).` };
  const nv = obj(r.normalized_value);
  const lisaEv = Array.isArray(obj(nv.lisa).evidence) ? obj(nv.lisa).evidence as Array<Record<string, unknown>> : [];
  const evRows = (r.evidence ?? []).length ? r.evidence! : lisaEv.map((e) => ({ url: s(e.url), excerpt: s(e.excerpt), source_type: s(e.source_type) }));
  const evidence = evRows.filter((e) => s(e.url)).map((e) => ({ url: s(e.url)!, excerpt: s(e.excerpt), source_type: s(e.source_type) }));
  if (!evidence.length) evidence.push({ url: r.source_url!, excerpt: s(nv.excerpt) ?? s(nv.description), source_type: s(nv.source_type) });
  const basis = s(r.occurred_at_basis);
  const fixture = isFixtureRow(r);
  return { ok: true, handoff: {
    version: SIGNAL_ATLAS_HANDOFF_VERSION,
    workspace_id,
    idempotency_key: `signal_atlas:${workspace_id}:${r.id}`,
    is_fixture: fixture,
    signal: { id: r.id, store: "signal_events", type: r.signal_type, kind,
      event_date: basis === "unknown" ? null : (s(obj(nv.lisa).event_date) ?? s(r.occurred_at)), event_date_basis: basis,
      detected_at: s(r.observed_at), dedupe_key: s(r.dedupe_key) },
    company: { ...company, name: company.name },
    evidence,
    verification: { level: evidenceLevel(r), verified: true, confidence: s(r.confidence) },
    icp_relevance: icpRelevance(r),
    exclusion_check: { checked: !!scope, matched: null },
    recommended_discovery_action: {
      kind: "qualify_company", mode: fixture ? "dry_run_only" : "proposal",
      query: `Qualify ${company.name}${company.domain ? ` (${company.domain})` : ""} against our ICP after its ${kind} signal`,
      requested_count: 1, company_domain: company.domain_verified ? company.domain : null,
      requires_approval: true, paid_discovery: "requires_mission_approval",
    },
    guardrails: { contact_enrichment: false, outreach: false,
      note: "A signal is a reason to research a company, not permission to contact anyone." },
  } };
}
