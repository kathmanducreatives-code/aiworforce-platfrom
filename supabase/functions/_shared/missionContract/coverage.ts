// EXPLICIT-CONSTRAINT COVERAGE — a stated restriction can never silently disappear.
//
// TEST dry run 2026-11-06 ("Find 5 US B2B companies actively hiring Account Executives,
// excluding SDRs."): across two live readings of the same sentence, "B2B" was once
// omitted outright and once filed as `unsupported` (disclosed, never checked) — and both
// plans were "ready". The interpreter validates what the model SAID; nothing checked what
// it LEFT OUT.
//
// This module finds, deterministically, the restrictions a request states explicitly:
//   * an AUDIENCE word (B2B / B2C / D2C / consumer…), read by the existing
//     `audienceIntent` (an exclusion, requirement, preference or description — a
//     permissive mention restricts nothing);
//   * a NEGATIVE constraint ("excluding X", "but not X", "no X", "without X", "except X",
//     "other than X", "not based in X"…), whatever X is;
//   * a BOUND written negatively ("no more than 200 employees").
// Each must be answered by an EXECUTABLE requirement of the right polarity (an exclusion
// by an exclusion or an excluded role; a role abbreviation through the title registry:
// "SDRs" is answered by "Sales Development Representative"). One that is not becomes a
// blocking question — the contract is not approvable until the user answers.
//
// It never ADDS a requirement from the sentence (the contract's rule): it only asks.
// Pure: no I/O.

import { audienceIntent, namesAudience } from "../missionCriteria.ts";
import { spanInRequest } from "../missionUnderstanding.ts";
import { canonicalTitleOf } from "../roleFamilies.ts";
import { isExecutable, type MissionContract, type Requirement } from "./contract.ts";

export interface ExplicitCue {
  kind: "audience" | "exclusion" | "bound";
  /** The user's words that state it. */
  span: string;
  /** For an exclusion or bound: the words that say what is restricted. */
  object: string;
  audience?: "b2b" | "consumer";
  polarity: "include" | "exclude";
  /** The user's own words make it hard ("must operate as B2B", "only B2B"): a preference does not answer it. */
  strength?: "required";
}

const NEGATION_RE = /\b(excluding|exclude[sd]?|except(?:\s+for)?|other\s+than|apart\s+from|but\s+not|not|no|without|minus|avoid(?:ing)?|never)\s+([^.,;:!?()\n]+)/gi;
/** Words after a negation that make it a bound on a number, not an exclusion. */
const BOUND_RE = /^(?:more|less|fewer|larger|bigger|smaller|older|younger|later|earlier|longer|over|under|above|below|than)\b/i;
/** Words after a negation that state no restriction ("not sure", "no preference", "not just…"). */
const FILLER_RE = /^(?:just|only|necessarily|sure|matter|need(?:ed)?|necessary|required?|requirement|preference|limit|restrictions?|problem|worries|idea|rush|exceptions?|one|exactly|too)\b/i;
/** A new clause begins: the restriction's object ends before it. */
const CLAUSE_RE = /\s(?:hiring|recruiting|looking|seeking|that|which|who|whose|where|while|because|since|if|so|please|thanks|find|give|get|show|list|in\s+the\s+(?:last|past))\b.*$/i;
const STOP = new Set([
  "a", "an", "the", "any", "of", "in", "at", "for", "to", "from", "on", "and", "or", "nor", "be", "is", "are", "as", "by",
  "companies", "company", "firms", "firm", "businesses", "business", "orgs", "organizations", "organisations", "ones",
  "roles", "role", "positions", "position", "jobs", "job", "openings", "opening", "people", "hires", "titles", "title",
  "based", "headquartered", "located", "hq", "hqd", "include", "including", "want", "interested", "please", "even", "also", "those", "these", "them",
  "do", "does", "dont", "i", "we", "me", "our", "my",
]);
const tokens = (s: string) => s.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim().split(" ").filter(Boolean);

/** The explicit restrictions a request states (see the header). Deterministic. */
export function explicitCues(query: string): ExplicitCue[] {
  const q = String(query ?? "");
  const out: ExplicitCue[] = [];
  for (const audience of ["b2b", "consumer"] as const) {
    const intent = audienceIntent(q, audience);
    if (intent === "absent" || intent === "permit") continue;
    const m = (audience === "b2b" ? /\b(?:b2b|business[\s-]+to[\s-]+business)\b/i : /\b(?:b2c|d2c|dtc|direct[\s-]+to[\s-]+consumers?|business[\s-]+to[\s-]+consumers?|consumers?)\b/i).exec(q);
    out.push({ kind: "audience", span: m?.[0] ?? audience, object: m?.[0] ?? audience, audience, polarity: intent === "exclude" ? "exclude" : "include",
      ...(intent === "require" ? { strength: "required" as const } : {}) });
  }
  for (const m of q.matchAll(NEGATION_RE)) {
    const cut = m[2].replace(CLAUSE_RE, "").trim();
    // When the words before the clause break say nothing ("exclude companies whose hiring
    // evidence is only for SDR/BDR roles"), the roles named in the rest of the clause are
    // what it restricts. Otherwise the cut stands ("no more than 200 employees hiring AEs").
    const whole = m[2].trim();
    const named = !contentTokens(cut).length ? titlesIn(whole) : new Set<string>();
    const rest = named.size ? whole : cut;
    if (!rest || FILLER_RE.test(rest)) continue;
    const object = named.size ? rest : rest.split(/\s+/).slice(0, 6).join(" ");
    if (!contentTokens(object).length) continue;
    const kind = BOUND_RE.test(object) ? "bound" : "exclusion";
    // An audience exclusion ("no B2C") is already an audience cue.
    if (kind === "exclusion" && (namesAudience(object, "b2b") || namesAudience(object, "consumer")) && contentTokens(object).length === 1) continue;
    out.push({ kind, span: `${m[1]} ${object}`, object, polarity: kind === "bound" ? "include" : "exclude" });
  }
  return out;
}

const contentTokens = (s: string) => tokens(s).filter((t) => !STOP.has(t));

/** The words, titles and values through which a requirement answers a cue. */
function answers(r: Requirement): { text: string[]; titles: Set<string>; polarity: "include" | "exclude" } {
  const span = r.origin.span ?? "";
  switch (r.dimension) {
    case "exclusion":
      return { text: [span, ...[r.values].flat().map(String)], titles: new Set(), polarity: "exclude" };
    case "geography":
      return { text: [span, r.place], titles: new Set(), polarity: r.polarity };
    case "industry":
      return { text: [span, r.value], titles: new Set(), polarity: r.polarity };
    case "signal": {
      // A hiring signal answers an INCLUDE through its span and roles, and an EXCLUDE only
      // through its excluded roles (a required role is never an exclusion).
      return { text: [span, ...(r.roleTerms ?? []), ...(r.roleFamilies ?? []), ...r.topics], titles: new Set((r.roleTerms ?? []).map(canonicalTitleOf).filter((x): x is string => !!x)), polarity: "include" };
    }
    case "unsupported":
      return { text: [span, String(r.value ?? "")], titles: new Set(), polarity: r.polarity };
    default:
      return { text: [span], titles: new Set(), polarity: "include" };
  }
}

const mentions = (texts: string[], token: string) => texts.some((t) => !!t && spanInRequest(t, token));
/** Titles a phrase names, through the registry ("SDRs", "account execs"), word runs of 1–4. */
function titlesIn(object: string): Set<string> {
  const w = object.split(/[\s/,&+]+/).filter(Boolean);
  const out = new Set<string>();
  for (let n = 1; n <= Math.min(4, w.length); n++) for (let i = 0; i + n <= w.length; i++) {
    const t = canonicalTitleOf(w.slice(i, i + n).join(" "));
    if (t) out.add(t);
  }
  return out;
}

/** Is a cue answered by an executable requirement of the right polarity, stated by the user? */
export function cueCovered(cue: ExplicitCue, c: MissionContract): boolean {
  const own = c.requirements.filter((r) => isExecutable(r) && (r.origin.source === "user_explicit" || r.origin.source === "user_inferred"));
  if (cue.kind === "audience") {
    return own.some((r) => { const a = answers(r); return a.polarity === cue.polarity && (cue.strength !== "required" || r.necessity === "required") && a.text.some((t) => namesAudience(t, cue.audience!)); });
  }
  if (cue.kind === "bound") {
    const toks = contentTokens(cue.object).filter((t) => /\d/.test(t));
    return own.some((r) => toks.length ? toks.every((t) => mentions([r.origin.span], t)) : mentions([r.origin.span], cue.object));
  }
  // An exclusion. Roles first: every title it names must be an excluded role.
  const titles = titlesIn(cue.object);
  const excludedTitles = new Set<string>();
  const excludedText: string[] = [];
  for (const r of own) {
    if (r.dimension === "signal") for (const t of r.excludedRoleTerms ?? []) { excludedText.push(t); const k = canonicalTitleOf(t); if (k) excludedTitles.add(k); }
    const a = answers(r);
    if (a.polarity === "exclude") excludedText.push(...a.text);
  }
  if (titles.size) return [...titles].every((t) => excludedTitles.has(t));
  const toks = contentTokens(cue.object);
  return toks.some((t) => mentions(excludedText, t));
}

// ── An unsupported item that only repeats an enforced requirement ───────────
//
// TEST live attempt 2026-11-07: the reading excluded SDR and BDR from the AE hiring signal
// (enforced) AND filed the same words, "exclude companies whose hiring evidence is only for
// SDR/BDR roles", as `unsupported`. Shown as "Not checked", that duplicate blocked an
// otherwise correct plan. An unsupported item is merged ONLY when it is the very same
// restriction an executable requirement enforces — every word accounted for, same scope,
// same polarity. Anything else (a partial match, another exclusion, a hedge, an inclusion)
// stays "Not checked" and keeps blocking.

/** Words that carry no restriction of their own in an exclusion's wording. */
const STRUCTURAL = new Set([
  "whose", "which", "that", "where", "who", "with", "only", "solely", "exclusively", "purely", "just",
  "hiring", "hire", "hires", "recruiting", "evidence", "signal", "signals", "posting", "postings", "listing", "listings",
  "ad", "ads", "vacancies", "vacancy", "open", "is", "are", "was", "were", "has", "have", "for", "or", "and",
]);
/** Wording that leaves the restriction's meaning open: never merged. */
const HEDGE_RE = /\b(?:maybe|perhaps|possibly|probably|ideally|preferably|prefer\w*|mostly|mainly|largely|primarily|usually|generally|partly|partially|some|unless|depending|roughly|sort\s+of|kind\s+of|if\s+possible|or\s+so|-?ish)\b/i;
const INNER_NEGATION_RE = /\b(?:exclud\w*|except|not|no|without|never|avoid\w*|minus|nor)\b/i;
const COMPANY_RE = /\b(?:compan(?:y|ies)|firms?|businesses|business|orgs?|organi[sz]ations?|employers?|startups?)\b/i;
const SCOPE_WORDS = new Set(["headquartered", "hq", "hqd", "headquarters", "based", "located", "offices", "office", "presence", "operating", "operations", "registered", "incorporated"]);
const EVIDENCE_ONLY_RE =/\b(?:only|solely|exclusively|purely|just)\b/i;

/**
 * Is this unsupported item an exact duplicate of an enforced requirement? Returns the
 * requirement that enforces it, or null (kept as "Not checked"). Conservative: see above.
 */
export function redundantUnsupported(span: string, requirements: readonly Requirement[]): { coveredBy: string[]; reason: string } | null {
  const s = String(span ?? "").trim();
  if (!s || HEDGE_RE.test(s)) return null;
  const cues = explicitCues(s);
  // Exactly one negative restriction, and nothing negated inside it ("not excluding SDRs").
  if (cues.length !== 1 || cues[0].kind !== "exclusion" || cues[0].polarity !== "exclude") return null;
  const negations = [...s.matchAll(NEGATION_RE)];
  if (negations.length !== 1 || INNER_NEGATION_RE.test(negations[0][2])) return null;
  const negWords = new Set(tokens(negations[0][1]));
  const words = s.split(/[\s/,&+]+/).filter(Boolean);
  const own = requirements.filter((r) => isExecutable(r) && r.necessity === "required" && (r.origin.source === "user_explicit" || r.origin.source === "user_inferred"));

  // Every word must be the negation, structure, or the covered restriction itself.
  const residual = (consumed: Set<number>) => words.flatMap((w, i) => (consumed.has(i) ? [] : tokens(w)))
    .filter((t) => !STOP.has(t) && !STRUCTURAL.has(t) && !negWords.has(t));

  const titles = titlesIn(cues[0].object);
  if (titles.size) {
    // ROLES: answered by ONE required hiring signal that excludes every named title. The
    // signal's excluded roles never count as evidence, so a company qualifies only through a
    // non-excluded posting — the meaning of "exclude companies whose hiring is ONLY X". A
    // company-scoped exclusion WITHOUT "only" ("exclude companies hiring SDRs") would reject
    // a company that also hires AEs: a different restriction, never merged.
    if (COMPANY_RE.test(s) && !EVIDENCE_ONLY_RE.test(s)) return null;
    const signal = own.find((r) => r.dimension === "signal" && r.kind === "hiring" &&
      [...titles].every((t) => (r.excludedRoleTerms ?? []).some((x) => canonicalTitleOf(x) === t)) &&
      ![...titles].some((t) => (r.roleTerms ?? []).some((x) => canonicalTitleOf(x) === t)));
    if (!signal) return null;
    const consumed = new Set<number>();
    for (let n = 1; n <= Math.min(4, words.length); n++) for (let i = 0; i + n <= words.length; i++) {
      const t = canonicalTitleOf(words.slice(i, i + n).join(" "));
      if (t && titles.has(t)) for (let k = i; k < i + n; k++) consumed.add(k);
    }
    if (residual(consumed).length) return null;
    return { coveredBy: [signal.id], reason: `the same roles are excluded from the hiring evidence of "${signal.origin.span}": ${[...titles].join(", ")} postings never count, so a company qualifies only through the roles it must be hiring` };
  }
  // COMPANIES: answered by ONE explicit exclusion whose values hold every remaining word.
  for (const r of own) {
    if (r.dimension !== "exclusion") continue;
    const vals = new Set([r.values].flat().flatMap((v) => tokens(String(v))));
    if (!vals.size) continue;
    const consumed = new Set(words.map((w, i) => (tokens(w).length && tokens(w).every((t) => vals.has(t)) ? i : -1)).filter((i) => i >= 0));
    if (!consumed.size || residual(consumed).length) continue;
    // Same scope: a scope word in the duplicate ("headquartered") must be in the enforced quote.
    const scope = tokens(s).filter((t) => SCOPE_WORDS.has(t));
    if (scope.some((t) => !tokens(r.origin.span).includes(t))) continue;
    return { coveredBy: [r.id], reason: `the same exclusion is enforced as "${r.display.label}"` };
  }
  return null;
}

/** Questions for every explicit restriction the contract does not represent (see the header). */
export function coverageQuestions(query: string, c: MissionContract): { span: string; question: string }[] {
  return explicitCues(query).filter((cue) => !cueCovered(cue, c)).map((cue) => ({
    span: cue.span,
    question: cue.kind === "audience" && cue.strength === "required" && c.requirements.some((r) => r.dimension === "industry" && namesAudience(`${r.origin.span} ${r.value}`, cue.audience!))
      ? `Your request says companies must be ${cue.span}, but my reading kept ${cue.span} only as a preference. Should non-${cue.span} companies be rejected?`
      : cue.kind === "audience"
      ? `Your request says "${cue.span}", but my reading did not keep it as a requirement I can check. Should results be limited to ${cue.polarity === "exclude" ? "companies that are not" : ""} ${cue.span} companies?`.replace(/\s+/g, " ")
      : cue.kind === "bound"
        ? `Your request says "${cue.span}", but my reading did not keep that limit. What limit should I apply?`
        : `Your request says "${cue.span}", but my reading did not keep that exclusion as something I can check. Which companies or roles should be excluded?`,
  }));
}
