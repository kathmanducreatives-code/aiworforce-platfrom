// Adaptive multi-attempt sourcing loop. Pure / import-free except the adaptive
// primitives (also pure). The actor call is INJECTED (runAttempt) so the whole
// loop is unit-testable without network. Broaden safely, validate, dedupe,
// cap at requested, stop at limits — never fake "complete".

import { roleAliases, industrySynonyms, dedupeByKey } from "./broaden.ts";
import { evaluateWorkflowStatus, type WorkflowStatus, type WorkflowAttempt } from "./adaptiveWorkflow.ts";

export interface SourcingCriteria {
  requested: number;
  role?: string | null;
  industry?: string | null;
  location?: string | null;
  stage?: string | null;
  category?: string | null;
  source_type?: string | null; // hiring_signal | linkedin_posts | competitor_engagement | people_profiles | company_search
}

export interface StrictConstraints {
  location: boolean;
  industry: boolean;
  stage: boolean;
  count_exact: boolean;
}

export interface SourcedItem {
  name?: string | null;
  title?: string | null;
  company?: string | null;
  source_url?: string | null;
  location?: string | null;
  raw?: unknown;
}

export interface AttemptStrategy {
  attempt_number: number;
  strategy_label: string;
  role_keywords: string[];
  relax_stage: boolean;
  relax_location: boolean;
  terminal: boolean; // nothing left to broaden after this attempt
}

export interface AttemptRecord extends WorkflowAttempt {
  result_count: number;
  accepted_count: number;
  total_accepted: number;
}

export interface AdaptiveSourcingResult {
  accepted: SourcedItem[];
  attempts: AttemptRecord[];
  status: WorkflowStatus;
  reason: string;
  requested: number;
  found: number;
  needs_permission_to_broaden?: boolean;
}

const LOCATION_TOKENS = /\b(london|uk|usa|u\.s\.a?\.?|united states|us|new york|nyc|san francisco|sf|bay area|remote|global|europe|emea|apac|canada|india|berlin|paris)\b/i;

/** Detect strict constraints the loop must NOT broaden. Role aliasing is always
 *  allowed (same role, different words); strictness gates location/industry/stage. */
export function parseStrictConstraints(message: string): StrictConstraints {
  const m = (message ?? "").toLowerCase();
  const count_exact = /\bexactly\b/.test(m);
  const noBroaden = /\bdo ?n['o]?t\s+broaden\b|\bstrictly\b|\bno broadening\b/.test(m);
  const locationOnly = /\b(only|strictly)\b[^.]*\b(london|uk|usa|us|united states|new york|nyc|san francisco|sf|remote|global|canada|india|europe)\b/.test(m)
    || /\b(london|uk|usa|us|united states|new york|nyc|san francisco|sf|remote|global|canada|india|europe)\s+only\b/.test(m)
    || /do ?n['o]?t\s+broaden[^.]*\b(outside|beyond|location)\b/.test(m)
    || /keep[^.]*\b(location|london|usa|uk)\b[^.]*\bstrict\b/.test(m);
  const industryOnly = /\bonly\b[^.]*\b(healthcare|fintech|saas|b2b|software|ai)\b/.test(m)
    || /\b(healthcare|fintech|saas|software)\s+only\b/.test(m);

  // "do not broaden" / "strictly" with no named field → lock location + industry + stage.
  const genericStrict = noBroaden && !locationOnly && !industryOnly && !LOCATION_TOKENS.test(m);

  // A geography NAMED in the prompt is a hard filter — relaxing it to a "wider
  // region" silently returns out-of-geo garbage (the exact failure this guards).
  // The user can opt out with "anywhere / global / worldwide / any location".
  const namedGeo = LOCATION_TOKENS.test(m) && !/\b(anywhere|global(ly)?|worldwide|any (location|region|geo)|location[- ]agnostic|no location)\b/.test(m);

  return {
    location: locationOnly || (noBroaden && LOCATION_TOKENS.test(m)) || genericStrict || namedGeo,
    industry: industryOnly || genericStrict,
    stage: genericStrict,
    count_exact,
  };
}

/** Allow more attempts only when the user asks for exact/high-quality fill. */
export function resolveMaxAttempts(message: string, strict: StrictConstraints): number {
  if (strict.count_exact || /\b(high.quality|exact fill|fill all|exactly)\b/i.test(message ?? "")) return 5;
  return 3;
}

/** Plan attempt N. 1=exact, 2=role aliases, 3=industry synonyms (if allowed),
 *  4=relax stage (if allowed), 5=relax location (if allowed). */
export function buildAttemptStrategy(attempt: number, c: SourcingCriteria, strict: StrictConstraints): AttemptStrategy {
  const baseRole = (c.role ?? c.category ?? "").trim();
  const exact = baseRole ? [baseRole] : [];
  const aliases = Array.from(new Set([...roleAliases(c.role), ...(c.category ? [c.category] : [])])).filter(Boolean);

  if (attempt <= 1) {
    return { attempt_number: 1, strategy_label: `Exact search — ${[baseRole, c.industry, c.location, c.stage].filter(Boolean).join(", ") || "given criteria"}`, role_keywords: exact, relax_stage: false, relax_location: false, terminal: false };
  }
  if (attempt === 2) {
    return { attempt_number: 2, strategy_label: "Broadened role aliases", role_keywords: aliases.length ? aliases : exact, relax_stage: false, relax_location: false, terminal: false };
  }
  if (attempt === 3) {
    if (c.industry && !strict.industry) {
      return { attempt_number: 3, strategy_label: `Broadened industry (${c.industry} → ${industrySynonyms(c.industry).join("/")})`, role_keywords: aliases, relax_stage: false, relax_location: false, terminal: false };
    }
    // industry strict/absent → try stage
    if (c.stage && !strict.stage) {
      return { attempt_number: 3, strategy_label: "Relaxed stage/company-size", role_keywords: aliases, relax_stage: true, relax_location: false, terminal: !c.location || strict.location };
    }
  }
  // attempt 4+ : relax location if allowed
  if (c.location && !strict.location) {
    return { attempt_number: attempt, strategy_label: `Relaxed location (${c.location} → wider region)`, role_keywords: aliases, relax_stage: !strict.stage, relax_location: true, terminal: true };
  }
  // nothing left to broaden
  return { attempt_number: attempt, strategy_label: "Kept all constraints strict — no further broadening allowed", role_keywords: aliases, relax_stage: false, relax_location: false, terminal: true };
}

const ROLE_WORDS = /\b(gtm|go-to-market|sdr|bdr|sales|growth|account executive|ae|marketing|revops|founder|ceo|cto|engineer|developer|business development)\b/i;

/** Keep only plausible results: must have a name/company; if a role is requested,
 *  the title should look role-relevant; if location is strict, it must match. */
export function validateSourcingResults(items: SourcedItem[], c: SourcingCriteria, strict: StrictConstraints): SourcedItem[] {
  const out: SourcedItem[] = [];
  for (const it of items ?? []) {
    const name = (it.name ?? it.company ?? "").toString().trim();
    if (!name) continue;
    // Strict location filter (only when we have item location data).
    if (strict.location && c.location && it.location) {
      if (!new RegExp(c.location.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i").test(String(it.location))) continue;
    }
    // Role relevance — accept if title matches a role word or the requested role; if
    // no title data is present, don't over-filter (actor results vary).
    const title = (it.title ?? "").toString();
    if (c.role && title) {
      const roleRe = new RegExp(c.role.split(/\s+/)[0].replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
      if (!roleRe.test(title) && !ROLE_WORDS.test(title)) continue;
    }
    out.push(it);
  }
  return out;
}

export function keyForItem(it: SourcedItem): string {
  return (it.source_url || it.company || it.name || "").toString().trim().toLowerCase();
}

export interface RunAttemptResult { items: SourcedItem[]; tool_failed?: boolean; error?: string; }
export type RunAttempt = (strategy: AttemptStrategy) => Promise<RunAttemptResult>;

/** The adaptive loop. Pure orchestration — `runAttempt` performs the actual
 *  (injected) actor call so this is fully unit-testable. */
export async function runAdaptiveSourcing(opts: {
  criteria: SourcingCriteria;
  strict: StrictConstraints;
  maxAttempts: number;
  runAttempt: RunAttempt;
}): Promise<AdaptiveSourcingResult> {
  const requested = Math.max(1, Math.floor(opts.criteria.requested || 5));
  const maxAttempts = Math.max(1, Math.min(5, opts.maxAttempts || 3));
  const accepted: SourcedItem[] = [];
  const attempts: AttemptRecord[] = [];

  for (let n = 1; n <= maxAttempts; n++) {
    const strat = buildAttemptStrategy(n, opts.criteria, opts.strict);
    const res = await opts.runAttempt(strat);

    if (res.tool_failed) {
      attempts.push({ n, strategy: strat.strategy_label, produced: 0, result_count: 0, accepted_count: 0, total_accepted: accepted.length, note: res.error ?? "tool failed" });
      return { accepted, attempts, status: "failed", reason: res.error ?? "required tool failed", requested, found: accepted.length };
    }

    const valid = validateSourcingResults(res.items ?? [], opts.criteria, opts.strict);
    // Dedupe within this attempt, then against everything accepted so far.
    const deduped = dedupeByKey(valid, keyForItem);
    const acceptedKeys = new Set(accepted.map(keyForItem));
    const fresh = deduped.filter((it) => !acceptedKeys.has(keyForItem(it)));
    const room = requested - accepted.length;
    const added = fresh.slice(0, Math.max(0, room)); // never exceed requested
    accepted.push(...added);

    attempts.push({ n, strategy: strat.strategy_label, produced: added.length, result_count: (res.items ?? []).length, accepted_count: added.length, total_accepted: accepted.length });

    if (accepted.length >= requested) break;
    if (strat.terminal) break; // nothing left to broaden
  }

  const ev = evaluateWorkflowStatus({ workflow_type: "lead_sourcing", requested, produced: accepted.length });
  const lastTerminalStrict = opts.strict.location || opts.strict.industry;
  return {
    accepted,
    attempts,
    status: ev.status,
    reason: ev.reason,
    requested,
    found: accepted.length,
    needs_permission_to_broaden: ev.status === "partial" && lastTerminalStrict,
  };
}
