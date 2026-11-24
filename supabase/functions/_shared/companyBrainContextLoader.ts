// COMPANY BRAIN V1 — THE SHARED CONTEXT LOADER.
//
// The ONE way an agent obtains the Company Brain *with its memory*:
//
//   membership (unless the caller already authorized) → company_brain row
//   → servable memory items → recent revisions → pending proposal count
//   → EFFECTIVE PROFILE (profile + approved memory, newest-wins)
//   → the existing canonical compiler → one SharedBrainContext
//
// ── WHY AN "EFFECTIVE PROFILE" ──────────────────────────────────────────────
//
// Every existing reader (renderCompanyBrainBlock, the compiler, the content
// block, the lead compiler) already understands `company_brain.profile`. Rather
// than teach each of them a second source, the loader folds approved memory
// INTO a copy of the profile, and hands that copy to the same code. So an
// approved competitor, an explicit exclusion or a changed ICP preference
// reaches every agent the same way, through code that is already tested.
//
// THE FOLD RULES (deterministic, documented, tested):
//   * exclusions only NARROW: always unioned into target_customer.disqualifiers;
//   * approved competitor facts are ADDED to the competitor list, and a
//     retraction newer than the profile's competitor section REMOVES that name;
//   * a scalar/list preference (ICP size, industries, geography, content tone)
//     REPLACES the profile value only when it is newer than the last change to
//     the profile section that holds it — whichever a person changed last wins;
//   * nothing that is not servable (stale, disputed, retracted, expired,
//     redacted, unapproved) is ever folded in.
//
// ── MISSING DATA ────────────────────────────────────────────────────────────
//
// No Brain row → status 'missing', an empty canonical Brain with
// setup_required, and NO invented context. Memory tables absent (the held
// migration is not applied on that project) → the profile alone, with a
// 'memory_unavailable' warning. Never an exception for either.
//
// PURE except for the injected DB client. No provider, model or network call.

import { buildCanonicalCompanyBrain, type CanonicalCompanyBrain } from "./getCompiledCompanyBrainForWorkspace.ts";
import { normalizeCompanyBrain } from "./normalizeCompanyBrain.ts";
import {
  activeDecisions, canonicalDomain, deriveExclusions, effectiveStatus, isServable, needsReview,
  provenanceTag, type Exclusions, type MemoryItem,
} from "./brainMemoryModel.ts";

// ───────────────────────────────────────────────────────────── DB surface ────

/** The PostgREST builder slice the loader uses. supabase-js and the test fakes both satisfy it. */
export interface LoaderQuery extends PromiseLike<{ data: unknown; error: unknown }> {
  select(columns: string): LoaderQuery;
  eq(column: string, value: unknown): LoaderQuery;
  in(column: string, values: unknown[]): LoaderQuery;
  order(column: string, opts: { ascending: boolean }): LoaderQuery;
  limit(n: number): LoaderQuery;
}
export type LoaderDb = { from(table: string): LoaderQuery };

export const LOADER_LIMITS = { memory: 500, revisions: 50, proposals: 100 } as const;

// ─────────────────────────────────────────────────────────────── output ────

export type BrainStatus = "missing" | "incomplete" | "ready";

export interface RecentChange {
  kind: "profile" | "memory";
  /** A profile section ('target_customer') or a memory key ('icp.company_size'). */
  key: string;
  at: string;
  actor_kind: string;
  /** 'updated', 'retracted', … for memory; 'changed' for profile sections. */
  change: string;
}

export interface SharedBrainContext {
  workspace_id: string;
  status: BrainStatus;
  /** Changes whenever the profile or any memory item changes: cache key + staleness check. */
  fingerprint: string;
  onboarding_completed: boolean;
  /** The stored profile, untouched. */
  profile: Record<string, unknown>;
  /** The profile with servable memory folded in. Feed THIS to profile-shaped readers. */
  effective_profile: Record<string, unknown>;
  canonical: CanonicalCompanyBrain;

  goals: Array<{ text: string; source: string }>;
  preferences: MemoryItem[];
  facts: MemoryItem[];
  decisions: MemoryItem[];
  exclusions: Exclusions;
  /** Approved competitors with their domains (profile names + approved facts). */
  competitors: Array<{ name: string; domain: string | null; source: string }>;
  /** Competitor names a person retracted after the profile last listed them: never serve these. */
  retracted_competitors: string[];
  /** Stale or disputed: shown to people, never served to agents as fact. */
  needs_review: MemoryItem[];
  pending_proposals: number;
  recent_changes: RecentChange[];
  /** Which memory items changed the effective profile, for "how memory was used". */
  applied: Array<{ memory_id: string; fact_key: string; effect: string }>;
  warnings: string[];
}

export interface LoadOptions {
  /** Checked against workspace_members unless skipMembershipCheck. */
  userId?: string;
  /** Only for callers that already authorized the request (daily-brief, a scheduler). */
  skipMembershipCheck?: boolean;
  now?: Date;
  /** Tighter row limits for a caller with its own read budget (ORION). Never larger than LOADER_LIMITS. */
  limits?: Partial<Record<keyof typeof LOADER_LIMITS, number>>;
}

export type LoadResult =
  | { ok: true; context: SharedBrainContext }
  | { ok: false; error: "forbidden" | "not_found"; context: null };

// ───────────────────────────────────────────────────────────── helpers ────

type Row = Record<string, unknown>;
const obj = (v: unknown): Row => (v && typeof v === "object" && !Array.isArray(v) ? v as Row : {});
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
const strs = (v: unknown): string[] => Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && !!x.trim()) : [];
const lc = (s: string) => s.trim().toLowerCase();
const unionCI = (...lists: string[][]) => [...new Map(lists.flat().filter(Boolean).map((x) => [lc(x), x.trim()])).values()];
const ms = (iso: string | null | undefined) => { const t = iso ? Date.parse(iso) : NaN; return Number.isFinite(t) ? t : 0; };

async function rows(q: PromiseLike<{ data: unknown; error: unknown }>): Promise<{ data: Row[]; failed: boolean }> {
  try {
    const { data, error } = await q;
    if (error) return { data: [], failed: true };
    return { data: Array.isArray(data) ? data as Row[] : [], failed: false };
  } catch {
    return { data: [], failed: true };
  }
}

/** Which profile sections hold which memory keys (for newest-wins). */
const SECTIONS_FOR: Record<string, string[]> = {
  "icp.company_size": ["target_customer", "icp"],
  "icp.industries": ["target_customer", "icp"],
  "icp.geography": ["target_customer", "icp"],
  "content.tone": ["brand_voice"],
  competitors: ["competitors", "competitors_v2"],
};

// ─────────────────────────────────────────────────────────── the fold ────

/**
 * Fold servable memory into a copy of the profile. Pure and exported for tests.
 * `sectionChangedAt(section)` answers when a person last changed that profile
 * section (epoch ms; 0 when unknown).
 */
export function foldMemoryIntoProfile(
  profile: Row,
  memory: MemoryItem[],
  sectionChangedAt: (section: string) => number,
  now: Date,
): { effective: Row; applied: SharedBrainContext["applied"]; competitors: SharedBrainContext["competitors"]; retracted: string[] } {
  const effective: Row = structuredClone(profile ?? {});
  const applied: SharedBrainContext["applied"] = [];
  const normalized = normalizeCompanyBrain(profile);
  const servable = memory.filter((m) => isServable(m, now));
  const newestFor = (key: string) => Math.max(0, ...(SECTIONS_FOR[key] ?? []).map(sectionChangedAt));

  const tc: Row = { ...obj(effective.target_customer) };
  let tcTouched = false;

  // 1. Scalar/list ICP preferences — newest wins.
  const pref = (key: string) => servable.find((m) => m.kind === "preference" && m.fact_key === key && m.scope === "workspace");
  const size = pref("icp.company_size");
  if (size && ms(size.updated_at) > newestFor("icp.company_size")) {
    const v = obj(size.value);
    tc.company_size = {
      min: typeof v.min === "number" ? v.min : null,
      max: typeof v.max === "number" ? v.max : null,
      label: typeof v.min === "number" && typeof v.max === "number" ? `${v.min}-${v.max}` : "",
    };
    tcTouched = true;
    applied.push({ memory_id: size.id, fact_key: size.fact_key, effect: "target company size" });
  }
  for (const [key, field] of [["icp.industries", "industries"], ["icp.geography", "geography"]] as const) {
    const p = pref(key);
    if (p && Array.isArray(p.value) && ms(p.updated_at) > newestFor(key)) {
      tc[field] = strs(p.value);
      tcTouched = true;
      applied.push({ memory_id: p.id, fact_key: p.fact_key, effect: `target ${field}` });
    }
  }

  // 2. Exclusions — always narrow, never widen.
  const ex = deriveExclusions(memory, now);
  if (ex.items.length) {
    const d = normalized.target_customer.disqualifiers;
    tc.disqualifiers = {
      industries: unionCI(d.industries, ex.industries),
      company_types: d.company_types,
      domains: unionCI(d.domains, ex.companies.map((c) => canonicalDomain(c) ?? c)),
      keywords: unionCI(d.keywords, ex.keywords, ex.geographies),
      titles: d.titles,
    };
    tcTouched = true;
    for (const i of ex.items) applied.push({ memory_id: i.id, fact_key: i.fact_key, effect: "exclusion" });
  }
  if (tcTouched) {
    // Carry the parts the normalizer would otherwise fall back to legacy icp.* for.
    if (!("industries" in tc)) tc.industries = normalized.target_customer.industries;
    if (!("geography" in tc)) tc.geography = normalized.target_customer.geography;
    if (!("company_size" in tc)) tc.company_size = normalized.target_customer.company_size;
    effective.target_customer = tc;
  }

  // 3. Competitors — profile names + approved facts, minus newer retractions.
  const compSectionAt = newestFor("competitors");
  const retractedNames = new Set(memory
    .filter((m) => m.category === "competitors" && ["retracted", "redacted"].includes(effectiveStatus(m, now)) &&
      ms(m.updated_at) > compSectionAt)
    .map((m) => lc(String(obj(m.value).name ?? m.fact_key.replace(/^competitor:/, "")))));
  const competitors: SharedBrainContext["competitors"] = [];
  for (const name of normalized.competitors) {
    if (retractedNames.has(lc(name))) continue;
    competitors.push({ name, domain: canonicalDomain(name), source: "profile" });
  }
  for (const m of servable.filter((m) => m.kind === "fact" && m.category === "competitors")) {
    const v = obj(m.value);
    const name = str(v.name) ?? m.fact_key.replace(/^competitor:/, "");
    const domain = canonicalDomain(str(v.domain) ?? m.fact_key.replace(/^competitor:/, ""));
    const dup = competitors.find((c) => lc(c.name) === lc(name) || (domain && c.domain === domain));
    if (dup) { if (!dup.domain && domain) dup.domain = domain; continue; }
    competitors.push({ name, domain, source: provenanceTag(m) });
    applied.push({ memory_id: m.id, fact_key: m.fact_key, effect: "competitor" });
  }
  if (competitors.length !== normalized.competitors.length ||
      competitors.some((c, i) => c.name !== normalized.competitors[i])) {
    effective.competitors_v2 = competitors.map((c) => c.name);
  }

  // 4. Content preferences — tone newest-wins; avoid/restrictions only add.
  const tone = pref("content.tone");
  const avoid = servable.filter((m) => m.kind === "preference" && /^content\.(avoid|restrictions)(:|$)/.test(m.fact_key));
  if ((tone && ms(tone.updated_at) > newestFor("content.tone")) || avoid.length) {
    const bv: Row = { ...obj(effective.brand_voice) };
    if (tone && typeof tone.value === "string" && ms(tone.updated_at) > newestFor("content.tone")) {
      bv.tone = tone.value;
      applied.push({ memory_id: tone.id, fact_key: tone.fact_key, effect: "content tone" });
    }
    if (avoid.length) {
      bv.avoid = unionCI(normalized.brand_voice.avoid, ...avoid.map((m) => strs(m.value)));
      for (const m of avoid) applied.push({ memory_id: m.id, fact_key: m.fact_key, effect: "content restriction" });
    }
    effective.brand_voice = bv;
  }

  return { effective, applied, competitors, retracted: [...retractedNames] };
}

// ─────────────────────────────────────────────────────────── the loader ────

export async function loadCompanyBrainContext(
  db: LoaderDb,
  workspaceId: string,
  opts: LoadOptions = {},
): Promise<LoadResult> {
  if (!workspaceId) return { ok: false, error: "not_found", context: null };
  const now = opts.now ?? new Date();
  const lim = (k: keyof typeof LOADER_LIMITS) => Math.min(LOADER_LIMITS[k], Math.max(1, opts.limits?.[k] ?? LOADER_LIMITS[k]));

  if (!opts.skipMembershipCheck) {
    if (!opts.userId) return { ok: false, error: "forbidden", context: null };
    const m = await rows(db.from("workspace_members").select("workspace_id")
      .eq("workspace_id", workspaceId).eq("user_id", opts.userId).limit(1));
    if (m.failed || m.data.length === 0) return { ok: false, error: "forbidden", context: null };
  }

  // One statement per query (the db-contract schema sweep parses each on its own).
  const brainQ = db.from("company_brain").select("profile, updated_at, onboarding_completed")
    .eq("workspace_id", workspaceId).limit(1);
  const memoryQ = db.from("company_brain_memory").select("id, workspace_id, kind, category, fact_key, scope, scope_ref, value_type, value, version, source_type, source_ref, source_url, verification_status, confidence, lifecycle_status, persistence, approval_status, created_by_kind, created_by_agent, approved_by, proposal_id, observed_at, review_at, expires_at, updated_at, redacted_at, reason")
    .eq("workspace_id", workspaceId).in("lifecycle_status", ["active", "stale", "disputed", "retracted"])
    .order("updated_at", { ascending: false }).limit(lim("memory"));
  const revisionQ = db.from("company_brain_revisions").select("revision, changed_sections, written_at, actor_kind")
    .eq("workspace_id", workspaceId).order("revision", { ascending: false }).limit(lim("revisions"));
  const proposalQ = db.from("company_brain_memory_proposals").select("id")
    .eq("workspace_id", workspaceId).eq("status", "pending").limit(lim("proposals"));

  const [brainR, memoryR, revisionR, proposalR] = await Promise.all([rows(brainQ), rows(memoryQ), rows(revisionQ), rows(proposalQ)]);
  const warnings: string[] = [];
  if (brainR.failed) warnings.push("brain_unavailable");
  if (memoryR.failed || revisionR.failed || proposalR.failed) warnings.push("memory_unavailable");

  const brainRow = brainR.data[0] ?? null;
  const profile = obj(brainRow?.profile);
  const onboarding_completed = brainRow?.onboarding_completed === true;
  // Defence in depth: rows are already filtered by workspace, but never trust a row from elsewhere.
  const memory = (memoryR.data as unknown as MemoryItem[]).filter((m) => m.workspace_id === workspaceId);
  const revisions = revisionR.data;

  const sectionChangedAt = (section: string): number => {
    const hit = revisions.find((r) => strs(r.changed_sections).includes(section));
    if (hit) return ms(str(hit.written_at));
    // No revision history (memory tables absent): the whole row's time is the best we know.
    return revisions.length ? 0 : ms(str(brainRow?.updated_at));
  };

  const fold = foldMemoryIntoProfile(profile, memory, sectionChangedAt, now);
  const canonical = buildCanonicalCompanyBrain(workspaceId, fold.effective);

  const servable = memory.filter((m) => isServable(m, now));
  const goals: SharedBrainContext["goals"] = [];
  const g = obj(profile.goals);
  for (const [k, v] of Object.entries(g)) {
    if (typeof v === "string" && v.trim()) goals.push({ text: v.trim(), source: `profile goals.${k}` });
  }
  const firstHelp = str(obj(profile.founder).first_help_goal);
  if (firstHelp) goals.push({ text: firstHelp, source: "profile founder.first_help_goal" });
  for (const m of servable.filter((m) => m.category === "goals" || m.category === "sales_priority")) {
    const t = typeof m.value === "string" ? m.value : strs(m.value).join("; ");
    if (t) goals.push({ text: t, source: `${m.kind} ${m.fact_key} (${provenanceTag(m)})` });
  }

  const recent_changes: RecentChange[] = [
    ...revisions.slice(0, 10).flatMap((r) => strs(r.changed_sections).filter((s) => !s.startsWith("_"))
      .map((s) => ({ kind: "profile" as const, key: s, at: String(r.written_at ?? ""), actor_kind: String(r.actor_kind ?? "system"), change: "changed" }))),
    ...memory.slice(0, 20).map((m) => ({
      kind: "memory" as const, key: m.fact_key, at: m.updated_at, actor_kind: m.created_by_kind,
      change: effectiveStatus(m, now) === "active" ? (m.version > 1 ? "updated" : "added") : effectiveStatus(m, now),
    })),
  ].sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0)).slice(0, 15);

  const hasBrain = !!brainRow && Object.keys(profile).length > 0;
  const status: BrainStatus = !hasBrain ? "missing" : canonical.setup_required ? "incomplete" : "ready";
  if (!hasBrain) warnings.push("no_company_brain");

  const maxMem = memory.reduce((a, m) => (m.updated_at > a ? m.updated_at : a), "");
  const fingerprint = `${String(brainRow?.updated_at ?? "none")}|${maxMem || "none"}|${memory.length}`;

  return {
    ok: true,
    context: {
      workspace_id: workspaceId,
      status,
      fingerprint,
      onboarding_completed,
      profile,
      effective_profile: fold.effective,
      canonical,
      goals,
      preferences: servable.filter((m) => m.kind === "preference"),
      facts: servable.filter((m) => m.kind === "fact"),
      decisions: activeDecisions(memory, now),
      exclusions: deriveExclusions(memory, now),
      competitors: fold.competitors,
      retracted_competitors: fold.retracted,
      needs_review: memory.filter((m) => needsReview(m, now)),
      pending_proposals: proposalR.data.length,
      recent_changes,
      applied: fold.applied,
      warnings,
    },
  };
}
