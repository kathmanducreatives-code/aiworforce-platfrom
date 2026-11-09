// COMPANY BRAIN V1 — WHAT EACH AGENT RECEIVES.
//
// One SharedBrainContext (companyBrainContextLoader.ts) → four narrow,
// deterministic views. Every value in a view comes from the effective profile
// or from a SERVABLE memory item; nothing is inferred here, nothing is filled.
// Every memory-derived line carries its provenance tag so a prompt can say
// "you said" versus "an approved LISA suggestion".
//
// ATLAS's view is the published interface contract for the lead track
// (docs/plans/company-brain/ATLAS_BRAIN_CONTRACT.md): this module produces it;
// ATLAS-owned code decides when to consume it.
//
// PURE.

import type { SharedBrainContext } from "./companyBrainContextLoader.ts";
import { decidedAgainst, provenanceTag, type MemoryItem } from "./brainMemoryModel.ts";

export type BrainAgent = "orion" | "atlas" | "lyra" | "lisa";

const textOf = (m: MemoryItem): string => {
  if (typeof m.value === "string") return m.value;
  if (Array.isArray(m.value)) return m.value.join(", ");
  if (m.value_type === "number_range") {
    const v = m.value as { min?: number | null; max?: number | null };
    return v.min != null && v.max != null ? `${v.min}–${v.max}` : v.min != null ? `${v.min}+` : `up to ${v.max}`;
  }
  const v = (m.value ?? {}) as Record<string, unknown>;
  if (typeof v.outcome === "string") {
    const subj = (v.subject ?? {}) as Record<string, unknown>;
    return `${v.outcome}${typeof subj.label === "string" ? ` — ${subj.label}` : ""}${typeof v.note === "string" ? ` (${v.note})` : ""}`;
  }
  if (typeof v.name === "string") return `${v.name}${typeof v.domain === "string" ? ` (${v.domain})` : ""}`;
  if (typeof v.value === "string") return `${typeof v.type === "string" ? `${v.type}: ` : ""}${v.value}`;
  return JSON.stringify(v);
};

// ───────────────────────────────────────────────────────────────── ATLAS ────

/** The ATLAS interface contract, v1. Additive fields only; never remove one. */
export interface AtlasBrainContract {
  contract_version: "atlas-brain-v1";
  workspace_id: string;
  status: SharedBrainContext["status"];
  fingerprint: string;
  industries: string[];
  company_size: { min: number | null; max: number | null };
  geography: string[];
  exclusions: { industries: string[]; companies: string[]; geographies: string[]; keywords: string[] };
  /** Lead / account refs a person rejected. Scoped: NOT an industry or company rule. */
  rejected_lead_refs: string[];
  rejected_account_refs: string[];
  /** When the ICP last changed (profile section or preference), ISO, or null. */
  icp_changed_at: string | null;
}

export function atlasView(ctx: SharedBrainContext, now: Date = new Date()): AtlasBrainContract {
  const t = ctx.canonical.target_customer;
  const icpChanges = ctx.recent_changes.filter((c) =>
    (c.kind === "profile" && (c.key === "target_customer" || c.key === "icp")) ||
    (c.kind === "memory" && c.key.startsWith("icp.")));
  const all = [...ctx.decisions];
  return {
    contract_version: "atlas-brain-v1",
    workspace_id: ctx.workspace_id,
    status: ctx.status,
    fingerprint: ctx.fingerprint,
    industries: t.industries,
    company_size: { min: t.company_size.min ?? null, max: t.company_size.max ?? null },
    geography: t.geography,
    exclusions: {
      industries: ctx.exclusions.industries, companies: ctx.exclusions.companies,
      geographies: ctx.exclusions.geographies, keywords: ctx.exclusions.keywords,
    },
    rejected_lead_refs: [...decidedAgainst(all, "lead", now)],
    rejected_account_refs: [...decidedAgainst(all, "account", now)],
    icp_changed_at: icpChanges[0]?.at ?? null,
  };
}

// ───────────────────────────────────────────────────────────────── ORION ────

export interface OrionBrainView {
  goals: Array<{ text: string; source: string }>;
  exclusions: SharedBrainContext["exclusions"];
  competitors: SharedBrainContext["competitors"];
  rejected_lead_refs: Set<string>;
  dismissed_signal_refs: Set<string>;
  rejected_recommendation_refs: Set<string>;
  recent_changes: SharedBrainContext["recent_changes"];
  /** Preferences ORION may cite ("sales priority: Nordic logistics — you"). */
  cited_preferences: Array<{ memory_id: string; text: string; source: string }>;
  needs_review: number;
  pending_proposals: number;
}

export function orionView(ctx: SharedBrainContext, now: Date = new Date()): OrionBrainView {
  const all = [...ctx.decisions];
  return {
    goals: ctx.goals,
    exclusions: ctx.exclusions,
    competitors: ctx.competitors,
    rejected_lead_refs: decidedAgainst(all, "lead", now),
    dismissed_signal_refs: decidedAgainst(all, "signal", now),
    rejected_recommendation_refs: decidedAgainst(all, "recommendation", now),
    recent_changes: ctx.recent_changes,
    cited_preferences: ctx.preferences.filter((p) => p.category !== "exclusions").map((p) => ({
      memory_id: p.id, text: `${p.fact_key}: ${textOf(p)}`, source: provenanceTag(p),
    })),
    needs_review: ctx.needs_review.length,
    pending_proposals: ctx.pending_proposals,
  };
}

// ────────────────────────────────────────────────────────────────── LYRA ────

export interface LyraBrainView {
  products: Array<{ text: string; source: string }>;
  positioning: SharedBrainContext["canonical"]["positioning"];
  audiences: string[];
  brand_voice: { tone: string | null; voice_notes: string[]; avoid: string[] };
  content_preferences: Array<{ text: string; source: string }>;
  /** The ONLY company claims content may make beyond the profile text. */
  claimable_facts: Array<{ text: string; source: string }>;
  competitors_not_us: string[];
}

export function lyraView(ctx: SharedBrainContext): LyraBrainView {
  const n = ctx.canonical.normalized;
  return {
    products: ctx.facts.filter((f) => f.category === "products").map((f) => ({ text: textOf(f), source: provenanceTag(f) })),
    positioning: ctx.canonical.positioning,
    audiences: [...ctx.canonical.target_customer.segments, ...ctx.canonical.buyer_personas.titles ?? []].filter(Boolean),
    brand_voice: { tone: n.brand_voice.tone || null, voice_notes: ctx.canonical.brand_voice.voice_notes, avoid: n.brand_voice.avoid },
    content_preferences: ctx.preferences.filter((p) => p.category === "content" || p.category === "brand_voice")
      .map((p) => ({ text: `${p.fact_key.replace(/^content\./, "")}: ${textOf(p)}`, source: provenanceTag(p) })),
    claimable_facts: ctx.facts.filter((f) => f.category !== "competitors")
      .map((f) => ({ text: `${f.fact_key}: ${textOf(f)}`, source: provenanceTag(f) })),
    competitors_not_us: ctx.competitors.map((c) => c.name),
  };
}

// ────────────────────────────────────────────────────────────────── LISA ────

export interface LisaBrainView {
  industries: string[];
  geography: string[];
  competitors: SharedBrainContext["competitors"];
  /** Domains a person asked to watch (monitoring_subjects), passed in by the caller. */
  monitored_accounts: string[];
  priorities: string[];
  exclusions: SharedBrainContext["exclusions"];
  dismissed_signal_refs: string[];
}

export function lisaView(ctx: SharedBrainContext, monitored: string[] = [], now: Date = new Date()): LisaBrainView {
  return {
    industries: ctx.canonical.target_customer.industries,
    geography: ctx.canonical.target_customer.geography,
    competitors: ctx.competitors,
    monitored_accounts: monitored,
    priorities: ctx.goals.map((g) => g.text),
    exclusions: ctx.exclusions,
    dismissed_signal_refs: [...decidedAgainst([...ctx.decisions], "signal", now)],
  };
}

// ─────────────────────────────────────────────────────── prompt rendering ────

/**
 * The MEMORY block an agent prompt appends after its existing COMPANY BRAIN
 * block. Deterministic: same context → same text. Bounded: lowest-priority
 * lines are dropped first until it fits `maxChars`, and the block says so.
 */
export function renderBrainMemoryBlock(ctx: SharedBrainContext, agent: BrainAgent, maxChars = 1800): string {
  if (ctx.status === "missing") {
    return "COMPANY MEMORY: none — this workspace has no Company Brain yet. Do not assume anything about the company; say what is missing.";
  }
  // [priority, line] — lower number = more important, kept longest.
  const lines: Array<[number, string]> = [];
  const ex = ctx.exclusions;
  const exParts = [
    ex.industries.length ? `industries: ${ex.industries.join(", ")}` : "",
    ex.companies.length ? `companies: ${ex.companies.join(", ")}` : "",
    ex.geographies.length ? `geographies: ${ex.geographies.join(", ")}` : "",
    ex.keywords.length ? `keywords: ${ex.keywords.join(", ")}` : "",
  ].filter(Boolean);
  if (exParts.length) lines.push([0, `- Never target or recommend (explicit exclusions, set by the team): ${exParts.join("; ")}.`]);
  for (const g of ctx.goals.slice(0, 4)) lines.push([1, `- Goal: ${g.text} [${g.source}]`]);
  const prefs = ctx.preferences.filter((p) => p.category !== "exclusions");
  for (const p of prefs) {
    const relevant = agent === "lyra" ? true : !(p.category === "content" || p.category === "brand_voice");
    if (relevant) lines.push([2, `- Preference ${p.fact_key}: ${textOf(p)} [${provenanceTag(p)}]`]);
  }
  if (agent === "lyra" || agent === "orion") {
    for (const f of ctx.facts.filter((f) => f.category !== "competitors")) {
      lines.push([3, `- Fact ${f.fact_key}: ${textOf(f)} [${provenanceTag(f)}]`]);
    }
  }
  if (ctx.competitors.length) {
    lines.push([2, `- Competitors (not us): ${ctx.competitors.map((c) => c.domain ? `${c.name} (${c.domain})` : c.name).join(", ")}`]);
  }
  const decisions = ctx.decisions.filter((d) =>
    agent === "atlas" ? d.scope === "lead" || d.scope === "account"
    : agent === "lisa" ? d.scope === "signal"
    : agent === "lyra" ? d.scope === "content" || d.category === "brand_preference"
    : true);
  for (const d of decisions.slice(0, 8)) {
    lines.push([4, `- Decision ${d.category}${d.scope_ref ? ` on ${d.scope} ${d.scope_ref}` : ""}: ${textOf(d)} — applies to that ${d.scope} only`]);
  }
  if (ctx.needs_review.length) {
    lines.push([5, `- ${ctx.needs_review.length} memory item(s) are stale or disputed and are NOT included above.`]);
  }

  const head = "COMPANY MEMORY (confirmed by the team unless tagged otherwise; anything not listed here or in the Company Brain is unknown — do not assert it):";
  if (!lines.length) return `${head}\n- (no preferences, decisions or approved facts recorded yet)`;
  const ordered = lines.map((l, i) => ({ p: l[0], i, t: l[1] }));
  let kept = [...ordered];
  const size = (xs: typeof kept) => head.length + xs.reduce((a, x) => a + x.t.length + 1, 0);
  let dropped = 0;
  while (kept.length && size(kept) > maxChars) {
    const worst = kept.reduce((w, x) => (x.p > w.p || (x.p === w.p && x.i > w.i) ? x : w));
    kept = kept.filter((x) => x !== worst);
    dropped++;
  }
  kept.sort((a, b) => a.i - b.i);
  return [head, ...kept.map((x) => x.t), ...(dropped ? [`- (${dropped} lower-priority memory line(s) omitted to fit)`] : [])].join("\n");
}
