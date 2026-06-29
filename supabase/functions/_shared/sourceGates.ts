// Source-specific acceptance gates for the Lead Intelligence Engine.
//
// The hiring path (filterHiringCandidates) proved the pattern: require real
// SOURCE PROOF, require a RELEVANCE match to what the user asked, reject
// generic/wrong rows, dedupe, and produce a transparent trace. This module
// applies the same standard to every other source: people, company, LinkedIn
// posts, comments/competitor mentions, and workflow trends.
//
// Pure / import-free so it is fully unit-testable. Never fabricates data.

export interface GateTrace {
  stage: string; rule: string; before_count: number; after_count: number;
  rejected_count: number; rejected_reasons: Record<string, number>;
}

export interface GateResult<T> {
  accepted: T[];
  rejected: Array<{ item: T; reason: string }>;
  trace: GateTrace[];
}

export type Tier = "A" | "B" | "C" | "rejected";
export type SourceConfidence = "high" | "medium" | "low";

function lc(s: unknown): string { return String(s ?? "").toLowerCase().trim(); }
function present(s: unknown): boolean {
  const v = lc(s);
  return !!v && v !== "proof_incomplete" && v !== "null" && v !== "undefined" && v !== "n/a";
}
function hasAny(haystack: string, needles: string[]): boolean {
  const h = lc(haystack);
  return needles.some((n) => { const t = lc(n); return !!t && h.includes(t); });
}
// Generic "AI hype" with no concrete signal — rejected for post/workflow sources.
const AI_HYPE_RE = /\b(ai is (?:changing|transforming|the future)|future of work|game[- ]?changer|excited to share|thoughts\?|🚀)\b/i;

function mkTrace(): { trace: GateTrace[]; stage: (n: string, r: string, before: number, afterArr: unknown[], reasons: Record<string, number>) => void } {
  const trace: GateTrace[] = [];
  return {
    trace,
    stage: (n, r, before, afterArr, reasons) =>
      trace.push({ stage: n, rule: r, before_count: before, after_count: afterArr.length, rejected_count: before - afterArr.length, rejected_reasons: reasons }),
  };
}

/** Map a 0-100 fit score + proof presence to a tier (no proof caps at C). */
export function tierFor(score: number, hasProof: boolean): Tier {
  if (!hasProof) return "C";
  if (score >= 75) return "A";
  if (score >= 55) return "B";
  if (score >= 35) return "C";
  return "rejected";
}

// ===================== PEOPLE =====================
export interface PeopleCandidate {
  name?: string | null; title?: string | null; profile_url?: string | null;
  company?: string | null; company_category?: string | null; location?: string | null;
}
export interface PeopleGateOpts {
  role_keywords?: string[]; company_category?: string[]; location?: string | null;
  strict_location?: boolean; requireCompany?: boolean;
}
/** People: need a name + profile URL, a role match, and (if required) a company-category match. */
export function filterPeopleCandidates(cands: PeopleCandidate[], opts: PeopleGateOpts): GateResult<PeopleCandidate> {
  const { trace, stage } = mkTrace();
  const rejected: Array<{ item: PeopleCandidate; reason: string }> = [];
  const seen = new Set<string>();
  const roles = opts.role_keywords ?? [];
  const cats = opts.company_category ?? [];
  let pool = cands ?? [];

  let r1: Record<string, number> = {};
  let kept = pool.filter((c) => {
    if (!present(c.name)) { r1["missing person name"] = (r1["missing person name"] ?? 0) + 1; rejected.push({ item: c, reason: "missing person name" }); return false; }
    if (!present(c.profile_url)) { r1["no profile URL"] = (r1["no profile URL"] ?? 0) + 1; rejected.push({ item: c, reason: "no profile URL" }); return false; }
    return true;
  });
  stage("proof", "person name + profile URL", pool.length, kept, r1); pool = kept;

  let r2: Record<string, number> = {};
  kept = pool.filter((c) => {
    const t = `${c.title ?? ""}`;
    if (/\b(student|intern)\b/i.test(t)) { r2["student/intern"] = (r2["student/intern"] ?? 0) + 1; rejected.push({ item: c, reason: "student/intern" }); return false; }
    if (roles.length && !hasAny(t, roles)) { r2["wrong role"] = (r2["wrong role"] ?? 0) + 1; rejected.push({ item: c, reason: "wrong role" }); return false; }
    if (opts.requireCompany && !present(c.company)) { r2["no current company"] = (r2["no current company"] ?? 0) + 1; rejected.push({ item: c, reason: "no current company" }); return false; }
    if (cats.length && !hasAny(`${c.company ?? ""} ${c.company_category ?? ""}`, cats)) { r2["wrong company category"] = (r2["wrong company category"] ?? 0) + 1; rejected.push({ item: c, reason: "wrong company category" }); return false; }
    if (opts.strict_location && opts.location && present(c.location) && !hasAny(`${c.location}`, [opts.location])) { r2["wrong location"] = (r2["wrong location"] ?? 0) + 1; rejected.push({ item: c, reason: "wrong location" }); return false; }
    return true;
  });
  stage("relevance", "role + company-category match", pool.length, kept, r2); pool = kept;

  let r3: Record<string, number> = {};
  kept = pool.filter((c) => { const k = lc(c.profile_url); if (seen.has(k)) { r3["duplicate"] = (r3["duplicate"] ?? 0) + 1; rejected.push({ item: c, reason: "duplicate" }); return false; } seen.add(k); return true; });
  stage("dedupe", "by profile URL", pool.length, kept, r3);
  return { accepted: kept, rejected, trace };
}

// ===================== COMPANY =====================
export interface CompanyCandidate {
  company?: string | null; website?: string | null; source_url?: string | null;
  category?: string | null; industry?: string | null; location?: string | null;
  profile_url?: string | null;
}
export interface CompanyGateOpts {
  category?: string[]; industry?: string[]; geography?: string | null; strict_geo?: boolean;
}
/** Company: need a company name + website/source URL, a category/industry match, and must not be a person. */
export function filterCompanyCandidates(cands: CompanyCandidate[], opts: CompanyGateOpts): GateResult<CompanyCandidate> {
  const { trace, stage } = mkTrace();
  const rejected: Array<{ item: CompanyCandidate; reason: string }> = [];
  const seen = new Set<string>();
  const cats = [...(opts.category ?? []), ...(opts.industry ?? [])];
  let pool = cands ?? [];

  let r1: Record<string, number> = {};
  let kept = pool.filter((c) => {
    if (!present(c.company)) { r1["missing company name"] = (r1["missing company name"] ?? 0) + 1; rejected.push({ item: c, reason: "missing company name" }); return false; }
    if (!present(c.website) && !present(c.source_url)) { r1["no website/source"] = (r1["no website/source"] ?? 0) + 1; rejected.push({ item: c, reason: "no website/source proof" }); return false; }
    // A row that is only a person profile (has profile_url, no company site) isn't a company.
    if (present(c.profile_url) && !present(c.website)) { r1["personal profile"] = (r1["personal profile"] ?? 0) + 1; rejected.push({ item: c, reason: "personal profile, not a company" }); return false; }
    return true;
  });
  stage("proof", "company name + website/source URL", pool.length, kept, r1); pool = kept;

  let r2: Record<string, number> = {};
  kept = pool.filter((c) => {
    if (cats.length && !hasAny(`${c.company ?? ""} ${c.category ?? ""} ${c.industry ?? ""}`, cats)) { r2["category mismatch"] = (r2["category mismatch"] ?? 0) + 1; rejected.push({ item: c, reason: "category/industry mismatch" }); return false; }
    if (opts.strict_geo && opts.geography && present(c.location) && !hasAny(`${c.location}`, [opts.geography])) { r2["wrong geography"] = (r2["wrong geography"] ?? 0) + 1; rejected.push({ item: c, reason: "wrong geography" }); return false; }
    return true;
  });
  stage("relevance", "category/industry match", pool.length, kept, r2); pool = kept;

  let r3: Record<string, number> = {};
  kept = pool.filter((c) => { const k = lc(c.company); if (seen.has(k)) { r3["duplicate"] = (r3["duplicate"] ?? 0) + 1; rejected.push({ item: c, reason: "duplicate" }); return false; } seen.add(k); return true; });
  stage("dedupe", "by company name", pool.length, kept, r3);
  return { accepted: kept, rejected, trace };
}

// ===================== LINKEDIN POSTS =====================
export interface PostCandidate {
  post_url?: string | null; author_name?: string | null; author_title?: string | null;
  author_profile_url?: string | null; snippet?: string | null;
}
export interface PostGateOpts { topics?: string[]; keywords?: string[] }
/** Posts: need post URL + author + snippet, a topic match, and a concrete (non-hype) signal. */
export function filterPostCandidates(cands: PostCandidate[], opts: PostGateOpts): GateResult<PostCandidate> {
  const { trace, stage } = mkTrace();
  const rejected: Array<{ item: PostCandidate; reason: string }> = [];
  const seen = new Set<string>();
  const topics = [...(opts.topics ?? []), ...(opts.keywords ?? [])];
  let pool = cands ?? [];

  let r1: Record<string, number> = {};
  let kept = pool.filter((c) => {
    if (!present(c.post_url)) { r1["no post URL"] = (r1["no post URL"] ?? 0) + 1; rejected.push({ item: c, reason: "no post URL" }); return false; }
    if (!present(c.author_name)) { r1["no author"] = (r1["no author"] ?? 0) + 1; rejected.push({ item: c, reason: "no author" }); return false; }
    if (!present(c.snippet)) { r1["no post text"] = (r1["no post text"] ?? 0) + 1; rejected.push({ item: c, reason: "no post text" }); return false; }
    return true;
  });
  stage("proof", "post URL + author + snippet", pool.length, kept, r1); pool = kept;

  let r2: Record<string, number> = {};
  kept = pool.filter((c) => {
    const text = `${c.snippet ?? ""}`;
    if (topics.length && !hasAny(text, topics)) { r2["topic mismatch"] = (r2["topic mismatch"] ?? 0) + 1; rejected.push({ item: c, reason: "topic mismatch" }); return false; }
    if (AI_HYPE_RE.test(text) && !(topics.length && hasAny(text, topics))) { r2["generic AI hype"] = (r2["generic AI hype"] ?? 0) + 1; rejected.push({ item: c, reason: "generic AI hype, no concrete signal" }); return false; }
    return true;
  });
  stage("relevance", "topic match + concrete signal", pool.length, kept, r2); pool = kept;

  let r3: Record<string, number> = {};
  kept = pool.filter((c) => { const k = lc(c.post_url); if (seen.has(k)) { r3["duplicate"] = (r3["duplicate"] ?? 0) + 1; rejected.push({ item: c, reason: "duplicate" }); return false; } seen.add(k); return true; });
  stage("dedupe", "by post URL", pool.length, kept, r3);
  return { accepted: kept, rejected, trace };
}

// ===================== COMMENTS / COMPETITOR =====================
export interface CommentCandidate {
  source_url?: string | null; comment_text?: string | null; commenter_name?: string | null;
  commenter_profile_url?: string | null; competitor_mentioned?: string | null;
}
export interface CommentGateOpts { competitors?: string[]; topics?: string[] }
/** Comments: need source URL + comment text + commenter, and a competitor/topic match. */
export function filterCommentCandidates(cands: CommentCandidate[], opts: CommentGateOpts): GateResult<CommentCandidate> {
  const { trace, stage } = mkTrace();
  const rejected: Array<{ item: CommentCandidate; reason: string }> = [];
  const seen = new Set<string>();
  const terms = [...(opts.competitors ?? []), ...(opts.topics ?? [])];
  let pool = cands ?? [];

  let r1: Record<string, number> = {};
  let kept = pool.filter((c) => {
    if (!present(c.source_url)) { r1["no source URL"] = (r1["no source URL"] ?? 0) + 1; rejected.push({ item: c, reason: "no source/comment URL" }); return false; }
    if (!present(c.comment_text)) { r1["no comment text"] = (r1["no comment text"] ?? 0) + 1; rejected.push({ item: c, reason: "no comment text" }); return false; }
    if (!present(c.commenter_name)) { r1["no commenter"] = (r1["no commenter"] ?? 0) + 1; rejected.push({ item: c, reason: "no commenter" }); return false; }
    return true;
  });
  stage("proof", "source URL + comment text + commenter", pool.length, kept, r1); pool = kept;

  let r2: Record<string, number> = {};
  kept = pool.filter((c) => {
    const text = `${c.comment_text ?? ""} ${c.competitor_mentioned ?? ""}`;
    if (terms.length && !hasAny(text, terms)) { r2["irrelevant competitor/topic"] = (r2["irrelevant competitor/topic"] ?? 0) + 1; rejected.push({ item: c, reason: "irrelevant competitor/topic" }); return false; }
    return true;
  });
  stage("relevance", "competitor/topic match", pool.length, kept, r2); pool = kept;

  let r3: Record<string, number> = {};
  kept = pool.filter((c) => { const k = `${lc(c.commenter_profile_url)}|${lc(c.source_url)}`; if (seen.has(k)) { r3["duplicate"] = (r3["duplicate"] ?? 0) + 1; rejected.push({ item: c, reason: "duplicate" }); return false; } seen.add(k); return true; });
  stage("dedupe", "by commenter + source URL", pool.length, kept, r3);
  return { accepted: kept, rejected, trace };
}

// ===================== WORKFLOW TRENDS =====================
export interface WorkflowCandidate {
  workflow_title?: string | null; source_url?: string | null; source_author?: string | null;
  tools_mentioned?: string[] | string | null; workflow_steps?: string[] | string | null; snippet?: string | null;
}
export interface WorkflowGateOpts { topics?: string[]; tools?: string[] }
function nonEmptyList(v: unknown): boolean {
  if (Array.isArray(v)) return v.filter(Boolean).length > 0;
  return present(v);
}
/** Workflow trends: need source URL + extractable steps/tools, a topic match, not generic AI fluff. */
export function filterWorkflowCandidates(cands: WorkflowCandidate[], opts: WorkflowGateOpts): GateResult<WorkflowCandidate> {
  const { trace, stage } = mkTrace();
  const rejected: Array<{ item: WorkflowCandidate; reason: string }> = [];
  const seen = new Set<string>();
  const terms = [...(opts.topics ?? []), ...(opts.tools ?? [])];
  let pool = cands ?? [];

  let r1: Record<string, number> = {};
  let kept = pool.filter((c) => {
    if (!present(c.source_url)) { r1["no source URL"] = (r1["no source URL"] ?? 0) + 1; rejected.push({ item: c, reason: "no source URL" }); return false; }
    if (!nonEmptyList(c.workflow_steps) && !nonEmptyList(c.tools_mentioned)) { r1["no workflow steps/tools"] = (r1["no workflow steps/tools"] ?? 0) + 1; rejected.push({ item: c, reason: "no extractable workflow steps/tools" }); return false; }
    return true;
  });
  stage("proof", "source URL + workflow steps/tools", pool.length, kept, r1); pool = kept;

  let r2: Record<string, number> = {};
  kept = pool.filter((c) => {
    const text = `${c.workflow_title ?? ""} ${c.snippet ?? ""} ${Array.isArray(c.tools_mentioned) ? c.tools_mentioned.join(" ") : (c.tools_mentioned ?? "")}`;
    if (terms.length && !hasAny(text, terms)) { r2["topic/tool mismatch"] = (r2["topic/tool mismatch"] ?? 0) + 1; rejected.push({ item: c, reason: "topic/tool mismatch" }); return false; }
    if (AI_HYPE_RE.test(text) && !(terms.length && hasAny(text, terms))) { r2["generic AI content"] = (r2["generic AI content"] ?? 0) + 1; rejected.push({ item: c, reason: "generic AI content, not actionable" }); return false; }
    return true;
  });
  stage("relevance", "topic/tool match + actionable", pool.length, kept, r2); pool = kept;

  let r3: Record<string, number> = {};
  kept = pool.filter((c) => { const k = `${lc(c.workflow_title)}|${lc(c.source_url)}`; if (seen.has(k)) { r3["duplicate"] = (r3["duplicate"] ?? 0) + 1; rejected.push({ item: c, reason: "duplicate" }); return false; } seen.add(k); return true; });
  stage("dedupe", "by title + source URL", pool.length, kept, r3);
  return { accepted: kept, rejected, trace };
}

// ===================== GATE-KIND ROUTING =====================
// The runtime's normalizeApifySourceType() collapses "people"/"company"/
// "comments" all down to "jobs", so it cannot be used to pick the right gate.
// resolveGateKind looks at the un-collapsed signals (LIE workflow_type, the RAW
// requested source_type, the selected actor key, and the query) and returns the
// gate to apply. Pure + order matters: hiring → comments → posts/workflow →
// people → company, so the most specific intent wins.
export type GateKind = "hiring" | "people" | "company" | "posts" | "comments" | "workflow";
const WORKFLOW_QUERY_RE = /\bworkflow|playbook|how (?:i|we|to)\b|step[- ]?by[- ]?step|automation|recipe|tutorial|tech stack\b/i;
export function resolveGateKind(sig: {
  workflow_type?: string | null;
  raw_source_type?: string | null;
  normalized_source_type?: string | null;
  selected_actor_key?: string | null;
  has_role_family?: boolean;
  query?: string | null;
}): GateKind | null {
  const wt = lc(sig.workflow_type);
  const rs = lc(sig.raw_source_type);
  const ns = lc(sig.normalized_source_type);
  const ak = lc(sig.selected_actor_key);
  const q = String(sig.query ?? "");

  // Hiring — explicit role family (filterHiringCandidates path) or hiring intent.
  if (sig.has_role_family || wt === "company_hiring_sourcing") return "hiring";

  // Comments / competitor conversations.
  if (wt === "competitor_signal_sourcing" || wt === "comment_sourcing") return "comments";
  if (rs === "comments" || rs === "linkedin_comments" || ns === "linkedin_comments" || ak.includes("comment")) return "comments";

  // LinkedIn posts / intent. A "workflow/playbook/how-to/stack" query is a
  // workflow-trend search (steps/tools proof), otherwise a generic post search.
  if (wt === "linkedin_intent_sourcing" || rs === "linkedin_posts" || rs === "linkedin_engagement" || ns === "linkedin_engagement" || ak.includes("post")) {
    return WORKFLOW_QUERY_RE.test(q) ? "workflow" : "posts";
  }
  if (wt === "workflow_trend_sourcing" || WORKFLOW_QUERY_RE.test(q) && (rs === "serp" || rs === "search" || ns === "serp" || ns === "search_fallback")) return "workflow";

  // People — individual profiles.
  if (wt === "people_sourcing") return "people";
  if (rs === "people" || rs === "people_profiles" || rs === "profiles" || rs === "profile" || ns === "people_profiles") return "people";
  if (ak.includes("people") || ak.includes("profile") || ak.includes("employee")) return "people";

  // Company / ICP.
  if (wt === "company_icp_sourcing" || wt === "company_search") return "company";
  if (rs === "company_search" || rs === "company" || rs === "companies" || rs === "company_icp") return "company";

  return null;
}

/** Lowercased topic tokens from a free-text query, stopwords dropped (for relevance opts). */
const TOPIC_STOP = new Set(["the","and","for","with","about","find","show","people","posts","post","comment","comments","commenting","conversations","around","that","this","into","from","who","are","using","use","talk","talking","discussing","alternative","alternatives","competitor","competitors"]);
export function topicTokens(query: string | null | undefined, extra: string[] = []): string[] {
  const toks = String(query ?? "").toLowerCase().match(/[a-z0-9][a-z0-9+.\-]{2,}/g) ?? [];
  const out = new Set<string>();
  for (const t of toks) if (!TOPIC_STOP.has(t)) out.add(t);
  for (const e of extra) { const v = lc(e); if (v) out.add(v); }
  return [...out];
}

/** Aggregate the top rejection reasons across a gate result's trace (for the honest summary). */
export function topRejectReasons(trace: GateTrace[], n = 4): Array<{ reason: string; count: number }> {
  const agg: Record<string, number> = {};
  for (const t of trace) for (const [k, v] of Object.entries(t.rejected_reasons)) agg[k] = (agg[k] ?? 0) + v;
  return Object.entries(agg).sort((a, b) => b[1] - a[1]).slice(0, n).map(([reason, count]) => ({ reason, count }));
}
