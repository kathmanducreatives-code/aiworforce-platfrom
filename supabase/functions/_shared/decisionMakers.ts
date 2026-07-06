// Decision-maker discovery — evidence-first, multi-source, per company. Pure /
// import-free so it is fully unit-testable in Deno.
//
// Ranks a single company's likely buyer from the strongest available evidence,
// in priority order:
//   1. Job poster, if founder / CEO / growth / revenue / sales leader
//   2. Founder / CEO from Firecrawl website/team-page evidence
//   3. Founder / growth / revenue leader from LinkedIn people search
//   4. Sales/revenue leader when a founder is unavailable
//   5. needs_manual_review when no confident person is found
//
// It NEVER invents names, LinkedIn URLs, or emails. Emails are only attached to a
// person when a public business email's local-part clearly matches that person's
// name; generic company inboxes stay company-level contact evidence.

import type { Confidence, PersonHint, ContactEvidence } from "./companyEnrichment.ts";

/** Parse a bare host from a URL/domain (lowercased, www-stripped). Local to keep
 *  this module import-free of provider helpers. */
function domainOf(url: string | null | undefined): string | null {
  if (!url || typeof url !== "string") return null;
  try {
    const withProto = /^https?:\/\//i.test(url) ? url : `https://${url}`;
    const host = new URL(withProto).hostname.replace(/^www\./i, "").toLowerCase();
    return host && host.includes(".") ? host : null;
  } catch {
    return null;
  }
}

export type DMSource = "job_poster" | "firecrawl_team_page" | "linkedin_people_search" | "website_contact_page";
export type DMContactStatus = "profile_only" | "public_email_found" | "needs_contact_enrichment";

export type CompanyMatchStatus = "verified" | "likely" | "weak" | "no_match";
export interface CompanyMatch {
  status: CompanyMatchStatus;
  reason: string;
  matched_on: string[];
}

/** The selected lead's company identity — the ground truth a candidate must match. */
export interface CompanyRef {
  name?: string | null;
  domain?: string | null;
  website?: string | null;
  companyLinkedinUrl?: string | null;
}

export interface DecisionMaker {
  name: string;
  title: string | null;
  linkedinUrl: string | null;
  source: DMSource;
  confidence: Confidence;
  why_this_person: string;
  evidence_url: string | null;
  contact_status: DMContactStatus;
  email: string | null;
  email_source_url: string | null;
  // How we know this person belongs to the selected company. Poster/Firecrawl
  // sources are verified by construction; people-search must earn it.
  company_match: CompanyMatch;
}

// ---- Company matching (Bug #1 fix) ----

/** Extract the linkedin.com/company/<slug> identifier, ignoring query/tracking. */
export function linkedinCompanySlug(url: string | null | undefined): string | null {
  if (!url || typeof url !== "string") return null;
  const m = url.toLowerCase().match(/linkedin\.com\/company\/([a-z0-9\-_.%]+)/i);
  return m ? m[1].replace(/\/+$/, "") : null;
}

const COMPANY_NOISE_RE = /\b(inc|llc|ltd|limited|corp|corporation|co|company|gmbh|ai|technologies|technology|tech|labs|lab|group|solutions|software|systems|holdings|ventures|partners|llp|plc|sa|bv)\b/g;
/** Normalize a company name for comparison (drop suffixes/punct/spacing). */
export function normCompanyName(s: string | null | undefined): string {
  return (s ?? "").toLowerCase().replace(COMPANY_NOISE_RE, "").replace(/[^a-z0-9]+/g, "").trim();
}

export interface CandidateCompany {
  company?: string | null;      // candidate's current company name
  company_url?: string | null;  // candidate's current company LinkedIn URL
  headline?: string | null;     // fallback text signal
}

/**
 * Verify a people-search candidate actually belongs to the selected company.
 * Strongest evidence wins: company LinkedIn URL > company domain > company name >
 * headline mention > no match. Never claims membership without evidence.
 */
export function verifyCompanyMatch(lead: CompanyRef | null | undefined, cand: CandidateCompany): CompanyMatch {
  const L = lead ?? {};
  const leadSlug = linkedinCompanySlug(L.companyLinkedinUrl);
  const candSlug = linkedinCompanySlug(cand.company_url);
  if (leadSlug && candSlug && leadSlug === candSlug) {
    return { status: "verified", reason: `company LinkedIn matches (${candSlug})`, matched_on: ["company_linkedin"] };
  }
  const leadDomain = domainOf(L.website) ?? (L.domain ? String(L.domain).toLowerCase().replace(/^www\./, "") : null);
  const candDomain = domainOf(cand.company_url);
  if (leadDomain && candDomain && leadDomain === candDomain) {
    return { status: "verified", reason: `company domain matches (${candDomain})`, matched_on: ["domain"] };
  }
  const leadName = normCompanyName(L.name);
  const candName = normCompanyName(cand.company);
  if (leadName && candName && leadName === candName) {
    return { status: "likely", reason: `current company name matches "${L.name}" (verify before outreach)`, matched_on: ["company_name"] };
  }
  const headlineNorm = normCompanyName(cand.headline);
  if (leadName.length >= 3 && headlineNorm.includes(leadName)) {
    return { status: "weak", reason: `only the headline mentions ${L.name}; needs verification`, matched_on: ["headline_mention"] };
  }
  return { status: "no_match", reason: `current company does not match ${L.name ?? "the selected lead"}`, matched_on: [] };
}

const VERIFIED_MATCH: CompanyMatch = { status: "verified", reason: "from the company's own job post", matched_on: ["job_post"] };
const SITE_MATCH: CompanyMatch = { status: "verified", reason: "listed on the company's own website", matched_on: ["company_website"] };

export type RoleTier = "founder" | "revenue_growth" | "recruiter" | "unknown";

const FOUNDER_RE = /\b(founder|co-?founder|ceo|chief executive|owner|managing director|president)\b/i;
const REVENUE_GROWTH_RE = /\b(head of (growth|revenue|sales)|vp (of )?(growth|revenue|sales)|chief revenue|cro|revenue operations|revenueops|revops|sales operations|head of demand|demand generation|gtm lead|go-to-market)\b/i;
const RECRUITER_RE = /\b(recruit(er|ing)?|talent|human resources|hr\b|people ops|people operations|sourcer|ta partner|hiring manager)\b/i;

/** Classify a job title into a buyer tier. Recruiters/HR are never the buyer. */
export function classifyRole(title: string | null | undefined): { tier: RoleTier; isBuyer: boolean } {
  const t = (title ?? "").toLowerCase();
  if (!t.trim()) return { tier: "unknown", isBuyer: false };
  if (RECRUITER_RE.test(t) && !FOUNDER_RE.test(t)) return { tier: "recruiter", isBuyer: false };
  if (FOUNDER_RE.test(t)) return { tier: "founder", isBuyer: true };
  if (REVENUE_GROWTH_RE.test(t)) return { tier: "revenue_growth", isBuyer: true };
  return { tier: "unknown", isBuyer: false };
}

export interface PosterHint {
  name?: string | null;
  profile_url?: string | null;
  title?: string | null;
  photo?: string | null;
}

/**
 * Turn a job-post poster into a decision-maker hint. Requires a name + profile
 * URL (never fabricated). A founder/growth/revenue/sales poster is a high/medium
 * confidence buyer; a recruiter/HR poster is kept as a low-priority profile hint,
 * explicitly NOT the buyer.
 */
export function posterHintToDecisionMaker(poster: PosterHint | null | undefined, jobTitle?: string | null): DecisionMaker | null {
  const name = (poster?.name ?? "").trim();
  const profileUrl = (poster?.profile_url ?? "").trim();
  if (!name || !profileUrl) return null;   // no evidence → no contact
  const title = (poster?.title ?? "").trim() || null;
  const { tier, isBuyer } = classifyRole(title);

  let confidence: Confidence;
  let why: string;
  if (tier === "founder") {
    confidence = "high";
    why = `Posted the ${jobTitle ?? "role"} and holds a founder/CEO title — the person building pipeline before payroll.`;
  } else if (tier === "revenue_growth") {
    confidence = "high";
    why = `Posted the ${jobTitle ?? "role"} and owns growth/revenue — the likely buyer for pipeline help.`;
  } else if (tier === "recruiter") {
    confidence = "low";
    why = `Posted the ${jobTitle ?? "role"} but is a recruiter/HR — a low-priority hint, not the buyer.`;
  } else {
    confidence = "medium";
    why = title
      ? `Posted the ${jobTitle ?? "role"}; title "${title}" is a real person tied to this hire.`
      : `Posted the ${jobTitle ?? "role"} — a real person tied to this hire (title unknown).`;
  }

  return {
    name,
    title,
    linkedinUrl: profileUrl,
    source: "job_poster",
    confidence,
    why_this_person: why,
    evidence_url: profileUrl,
    contact_status: "profile_only",
    email: null,
    email_source_url: null,
    company_match: VERIFIED_MATCH,   // posted THIS company's job → verified
  };
}

export type BuyerClueKind = "founder_mention" | "reports_to" | "first_sales_team" | "work_with_leadership";
export interface BuyerClue {
  kind: BuyerClueKind;
  text: string;                 // the verbatim phrase (evidence)
  person_name: string | null;   // only when the phrase names a person
  role: string | null;          // only when the phrase names a role (e.g. "Head of Demand Generation")
}

/**
 * Extract buyer/founder clues from a job's descriptionText. These inform
 * why_now and people-search targeting — a named founder here is a clue, NOT a
 * fabricated contact (no profile/email is invented).
 */
export function extractBuyerCluesFromDescription(text: string | null | undefined): BuyerClue[] {
  const t = (text ?? "").replace(/\s+/g, " ").trim();
  if (!t) return [];
  const out: BuyerClue[] = [];
  const push = (c: BuyerClue) => { if (!out.some((x) => x.kind === c.kind && x.text === c.text && x.person_name === c.person_name)) out.push(c); };

  const founderRe = /\b(?:co-?)?founded by\s+([A-Z][a-zA-Z'-]+(?:\s+[A-Z][a-zA-Z'-]+){0,2})(?:\s+and\s+([A-Z][a-zA-Z'-]+(?:\s+[A-Z][a-zA-Z'-]+){0,2}))?/g;
  let m: RegExpExecArray | null;
  while ((m = founderRe.exec(t)) !== null) {
    for (const nm of [m[1], m[2]]) {
      if (nm) push({ kind: "founder_mention", text: m[0].trim(), person_name: nm.trim(), role: "Founder" });
    }
  }
  // Capture the full role phrase (e.g. "Head of Demand Generation"), stopping at a
  // natural boundary word rather than the first space.
  const reportsDeptRe = /\breport(?:ing|s)?\s+(?:directly\s+)?to\s+the\s+((?:Head of|VP of|Vice President of|Chief|Director of)\s+[A-Za-z ]+?)(?=\s+(?:while|and|to|for|as|who|that|in|on)\b|[,.]|$)/i;
  const reportsBareRe = /\breport(?:ing|s)?\s+(?:directly\s+)?to\s+the\s+(CEO|Founder|CTO|COO|CRO|CMO)\b/i;
  const rm = t.match(reportsDeptRe) ?? t.match(reportsBareRe);
  if (rm) push({ kind: "reports_to", text: rm[0].trim(), person_name: null, role: rm[1].trim() });

  if (/\b(building|build)\s+(?:out\s+)?(?:our|the|its|their)\s+first\s+(?:sales|revenue|gtm|go-to-market)\s+(?:team|hire|function|motion)\b/i.test(t)
      || /\bfirst\s+(?:sales|revenue|gtm)\s+hire\b/i.test(t)) {
    const mm = t.match(/[^.]*first[^.]*\b(?:sales|revenue|gtm|go-to-market)\b[^.]*/i);
    push({ kind: "first_sales_team", text: (mm?.[0] ?? "building our first sales team").trim().slice(0, 160), person_name: null, role: null });
  }
  if (/\bwork(?:ing)?\s+(?:directly\s+)?with\s+(?:the\s+)?(leadership|founders?|ceo|executive team)\b/i.test(t)) {
    const mm = t.match(/[^.]*work[^.]*\bwith\b[^.]*\b(?:leadership|founders?|ceo|executive team)\b[^.]*/i);
    push({ kind: "work_with_leadership", text: (mm?.[0] ?? "work directly with leadership").trim().slice(0, 160), person_name: null, role: null });
  }
  return out;
}

/** PersonHints from Firecrawl enrichment → decision-makers (team/about evidence). */
export function personHintsToDecisionMakers(hints: PersonHint[], opts: { emails?: ContactEvidence[] } = {}): DecisionMaker[] {
  return (hints ?? []).filter((h) => h && h.name).map((h) => {
    const withEmail = matchEmailToPerson(h.name, opts.emails ?? []);
    return {
      name: h.name,
      title: h.title,
      linkedinUrl: null,           // team pages rarely expose a personal LinkedIn
      source: (h.source === "firecrawl_team_page" ? "firecrawl_team_page" : "firecrawl_team_page") as DMSource,
      confidence: h.confidence,
      why_this_person: /founder/i.test(h.title ?? "")
        ? `Named as a founder on the company's own site — the decision-maker for early pipeline.`
        : `Listed as ${h.title ?? "a leader"} on the company's own site.`,
      evidence_url: h.evidence_url,
      contact_status: withEmail ? "public_email_found" : "needs_contact_enrichment",
      email: withEmail?.value ?? null,
      email_source_url: withEmail?.source_url ?? null,
      company_match: SITE_MATCH,   // from the company's own site → verified
    };
  });
}

export interface PeopleSearchContact {
  name: string;
  title: string | null;
  linkedin_url: string | null;
  company?: string | null;
  company_url?: string | null;   // candidate's CURRENT company LinkedIn URL (for matching)
  headline?: string | null;
}

/** A candidate dropped for failing company verification (kept for honest reporting). */
export interface RejectedCandidate {
  name: string;
  title: string | null;
  linkedin_url: string | null;
  reason: string;
}

/**
 * LinkedIn people-search results → decision-makers, ONLY after verifying each
 * candidate actually belongs to the selected company. Off-company profiles are
 * dropped (returned in `rejected`), never persisted or described as "at this
 * company". Confidence requires company match: high needs verified/likely + a
 * buyer title; weak match caps at medium ("needs verification").
 */
export function peopleContactsToDecisionMakers(
  contacts: PeopleSearchContact[],
  lead: CompanyRef | null | undefined,
): { accepted: DecisionMaker[]; rejected: RejectedCandidate[] } {
  const accepted: DecisionMaker[] = [];
  const rejected: RejectedCandidate[] = [];
  for (const c of contacts ?? []) {
    if (!c || !c.name || !c.linkedin_url) continue;
    const match = verifyCompanyMatch(lead, c);
    const { tier, isBuyer } = classifyRole(c.title);

    if (match.status === "no_match") {
      rejected.push({ name: c.name, title: c.title, linkedin_url: c.linkedin_url,
        reason: `Discarded: title "${c.title ?? "unknown"}" but ${match.reason}.` });
      continue;
    }

    // Confidence gated on company match. Recruiters/unknown never high.
    let confidence: Confidence;
    if (isBuyer && (match.status === "verified" || match.status === "likely")) confidence = "high";
    else if (isBuyer && match.status === "weak") confidence = "medium";
    else if (isBuyer && match.status === "likely") confidence = "medium";
    else confidence = "low";
    if (tier === "recruiter") confidence = "low";

    const leadName = lead?.name ?? "the selected company";
    const why = match.status === "verified"
      ? `Matched: profile shows ${c.title ?? "this person"} and ${match.reason} — belongs to ${leadName}.`
      : match.status === "likely"
      ? `Likely match: ${match.reason}. Verify before outreach.`
      : `Weak match: ${match.reason}.`;

    accepted.push({
      name: c.name,
      title: c.title,
      linkedinUrl: c.linkedin_url,
      source: "linkedin_people_search",
      confidence,
      why_this_person: why,
      evidence_url: c.linkedin_url,
      contact_status: "profile_only",
      email: null,
      email_source_url: null,
      company_match: match,
    });
  }
  return { accepted, rejected };
}

/**
 * Attach a public email to a person only when its local-part clearly maps to
 * their name (a full name token or a first-initial+last / first+last-initial
 * pattern that is actually present). Generic inboxes (hello@, team@) never match.
 * No email is ever guessed or constructed.
 */
export function matchEmailToPerson(name: string, emails: ContactEvidence[]): ContactEvidence | null {
  const parts = name.toLowerCase().split(/\s+/).filter(Boolean);
  const first = parts[0] ?? "";
  const last = parts[parts.length - 1] ?? "";
  for (const e of emails ?? []) {
    if (e.type !== "email") continue;
    const local = (e.value.split("@")[0] ?? "").toLowerCase();
    if (!local) continue;
    const tokens = local.split(/[._\-+]/).filter(Boolean);
    const combos = new Set<string>();
    if (first) combos.add(first);
    if (last && last !== first) combos.add(last);
    if (first && last) {
      combos.add(`${first}${last}`);
      combos.add(`${first[0]}${last}`);   // jdoe
      combos.add(`${first}${last[0]}`);   // johnd
    }
    // token-exact match OR whole-local match (jane, janedoe, jdoe, …)
    const hit = tokens.some((t) => combos.has(t)) || combos.has(local);
    if (hit) return e;
  }
  return null;
}

const TIER_RANK: Record<RoleTier, number> = { founder: 3, revenue_growth: 2, unknown: 1, recruiter: 0 };
const SOURCE_RANK: Record<DMSource, number> = { job_poster: 3, firecrawl_team_page: 2, website_contact_page: 2, linkedin_people_search: 1 };
const CONF_RANK: Record<Confidence, number> = { high: 3, medium: 2, low: 1 };

export interface DecisionMakerResult {
  decision_makers: DecisionMaker[];
  needs_manual_review: boolean;
  buyer_clues: BuyerClue[];
  rejected: RejectedCandidate[];
}

/**
 * Merge all evidence sources for ONE company into a ranked decision_makers list.
 * People-search results are company-verified first; off-company profiles are
 * dropped into `rejected`, never ranked. Dedupes by name. Flags
 * needs_manual_review when nothing confident (>= medium, buyer-tier) surfaced.
 */
export function buildDecisionMakers(input: {
  poster?: PosterHint | null;
  jobTitle?: string | null;
  descriptionText?: string | null;
  company?: CompanyRef | null;
  enrichment?: { founders?: PersonHint[]; executives?: PersonHint[]; public_contact_emails?: ContactEvidence[] } | null;
  peopleSearch?: PeopleSearchContact[] | null;
}): DecisionMakerResult {
  const buyer_clues = extractBuyerCluesFromDescription(input.descriptionText);
  const candidates: DecisionMaker[] = [];

  const posterDm = posterHintToDecisionMaker(input.poster, input.jobTitle);
  if (posterDm) candidates.push(posterDm);

  const emails = input.enrichment?.public_contact_emails ?? [];
  candidates.push(...personHintsToDecisionMakers([...(input.enrichment?.founders ?? []), ...(input.enrichment?.executives ?? [])], { emails }));
  const people = peopleContactsToDecisionMakers(input.peopleSearch ?? [], input.company ?? null);
  candidates.push(...people.accepted);
  const rejected = people.rejected;

  // Dedupe by person (per company, same normalized name = same person). Keep the
  // higher-ranked entry as the base and backfill missing LinkedIn/email/evidence
  // from the weaker duplicate so poster + firecrawl evidence for one founder merge.
  const byName = new Map<string, DecisionMaker>();
  for (const dm of candidates) {
    const key = dm.name.toLowerCase().replace(/\s+/g, " ").trim();
    const existing = byName.get(key);
    if (!existing) { byName.set(key, dm); continue; }
    const [base, other] = rankScore(dm) >= rankScore(existing) ? [dm, existing] : [existing, dm];
    const email = base.email ?? other.email;
    const emailSrc = base.email_source_url ?? other.email_source_url;
    byName.set(key, {
      ...base,
      linkedinUrl: base.linkedinUrl ?? other.linkedinUrl,
      evidence_url: base.evidence_url ?? other.evidence_url,
      email,
      email_source_url: emailSrc,
      contact_status: email ? "public_email_found" : base.contact_status,
    });
  }
  const decision_makers = [...byName.values()].sort((a, b) => rankScore(b) - rankScore(a));

  const hasConfident = decision_makers.some((dm) => {
    const { isBuyer } = classifyRole(dm.title);
    return CONF_RANK[dm.confidence] >= 2 && (isBuyer || dm.source === "job_poster");
  });

  return { decision_makers, needs_manual_review: !hasConfident, buyer_clues, rejected };
}

function rankScore(dm: DecisionMaker): number {
  const tier = classifyRole(dm.title).tier;
  return TIER_RANK[tier] * 100 + SOURCE_RANK[dm.source] * 10 + CONF_RANK[dm.confidence];
}
