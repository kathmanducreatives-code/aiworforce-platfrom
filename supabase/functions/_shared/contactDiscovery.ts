// Contact discovery — turns account opportunities into decision-maker searches
// and attaches discovered contacts back to the right account. Pure / import-free
// except the (pure) persona helper. Never invents contacts.

import { inferContactPersona, type PersonaRecommendation } from "./leadOpportunity.ts";

export interface AccountForContacts {
  lead_candidate_id: string;
  company: string;
  signal_role?: string | null; // the hiring role / signal that drives persona
  linkedin_company_url?: string | null;
  website_url?: string | null;
  domain?: string | null;
}

export interface CompanyContactTarget {
  account_id: string;
  company_name: string;
  domain?: string;
  website_url?: string;
  linkedin_company_url?: string;
  source_url?: string;
  signal_title?: string;
  industry?: string;
  category?: string;
  location?: string;
  recommended_personas: string[];
  confidence_notes: string[];
  needs_company_resolution?: boolean;
}

export function resolveCompanyContactTarget(accountRow: any): CompanyContactTarget {
  const account = accountRow.account || {};
  const signal = accountRow.signal || {};
  
  const account_id = account.id || accountRow.account_id || accountRow.lead_candidate_id || "";
  const company_name = account.name || accountRow.company || "";
  
  let website_url = account.website_url || undefined;
  let domain = account.domain || undefined;
  const linkedin_company_url = account.linkedin_url || undefined;
  const source_url = signal.source_url || accountRow.source_url || undefined;
  const signal_title = accountRow.lead_type || accountRow.signal_role || "";
  const industry = account.industry || undefined;
  const location = account.location || undefined;
  
  const confidence_notes: string[] = [];
  
  const isJobBoard = (url: string) => {
    if (!url) return false;
    const l = url.toLowerCase();
    return l.includes("linkedin.com/jobs") || l.includes("indeed.com") || l.includes("ziprecruiter.com") || l.includes("glassdoor.com") || l.includes("simplyhired.com");
  };
  
  if (website_url && isJobBoard(website_url)) {
    website_url = undefined;
    confidence_notes.push("website_url is a job board link");
  }
  
  if (domain && (domain.includes("linkedin.com") || domain.includes("indeed.com") || domain.includes("ziprecruiter.com"))) {
    domain = undefined;
    confidence_notes.push("domain is a job board/social link");
  }
  
  const personaRec = inferContactPersona(signal_title || "");
  const recommended_personas = personaRec.personas;
  
  let needs_company_resolution = false;
  if (!linkedin_company_url && !website_url && !domain) {
    needs_company_resolution = true;
    confidence_notes.push("needs_company_resolution");
  }
  
  if (domain && !website_url) {
    confidence_notes.push("probable_domain");
  }
  
  return {
    account_id,
    company_name,
    domain,
    website_url,
    linkedin_company_url,
    source_url,
    signal_title,
    industry,
    location,
    recommended_personas,
    confidence_notes,
    needs_company_resolution,
  };
}

export interface DiscoveredContact {
  name: string;
  title: string | null;
  linkedin_url: string | null;
  profile_url?: string | null;
  email: string | null;
  company: string | null;
  headline: string | null; // fallback company signal (e.g. "Founder at Acme AI")
  confidence: number;
  source: string | null;
  location?: string | null;
  source_url?: string | null;
  company_url?: string | null;
  confidence_signals?: string[];
}

export type ContactMatch = {
  matched: boolean;
  confidence: "high" | "medium" | "low";
  reasons: string[];
  lead_candidate_id: string | null;
};

const FIND_CONTACTS_RE =
  /\bfind\s+(decision[-\s]?makers?|contacts?|the\s+right\s+(?:person|people)|people\s+to\s+contact|who\s+to\s+contact)\b/i;

/** True for "find decision-makers / find contacts" style asks. */
export function isFindContactsRequest(message: string): boolean {
  return FIND_CONTACTS_RE.test(message ?? "");
}

/** Pick the persona to target from the accounts' signal roles (most common role). */
export function personaForAccounts(accounts: AccountForContacts[]): PersonaRecommendation {
  const role = accounts.map((a) => a.signal_role).find((r) => r && r.trim());
  return inferContactPersona(role ?? "");
}

/**
 * Build capped, clean LinkedIn/people search queries: the primary persona at each
 * company. Never a raw description; one query per (persona × company), capped.
 */
export function buildContactSearchQueries(
  accounts: AccountForContacts[],
  persona: PersonaRecommendation,
  opts: { maxQueries?: number } = {},
): string[] {
  const max = Math.max(1, Math.min(20, opts.maxQueries ?? 10));
  const titles = [persona.primary, ...persona.personas.filter((p) => p !== persona.primary)].slice(0, 2);
  const out: string[] = [];
  const seen = new Set<string>();
  for (const a of accounts) {
    const company = (a.company ?? "").trim();
    if (!company) continue;
    for (const title of titles) {
      const q = `${title} at ${company}`;
      const k = q.toLowerCase();
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(q);
      if (out.length >= max) return out;
    }
  }
  return out;
}

/** Normalize a raw actor person into a contact. Returns null when there's no real
 *  name — we never fabricate a contact from an empty/anonymous result. */
export function normalizeDiscoveredContact(raw: unknown): DiscoveredContact | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, any>;
  
  const name = (
    r.name ?? r.fullName ?? r.full_name ?? r.author?.name ??
    [r.firstName, r.lastName].filter(Boolean).join(" ")
  ).toString().trim();
  if (!name) return null; // reject missing name
  
  const linkedin_url = (r.linkedin_url ?? r.linkedinUrl ?? r.profileUrl ?? r.publicProfileUrl ?? r.url ?? null) || null;
  if (!linkedin_url) return null; // reject missing profile URL
  
  const headline = (r.headline ?? r.occupation ?? null) || null;
  
  const title = (r.title ?? r.position ?? r.jobTitle ?? r.currentPosition?.title ?? (Array.isArray(r.currentPosition) ? r.currentPosition[0]?.position : undefined) ?? headline ?? null) || null;
  if (!title) return null; // reject missing title
  
  const tLower = title.toLowerCase();
  const wrongTitleKeywords = ["intern", "student", "trainee", "retired", "unemployed", "assistant", "candidate", "freelancer", "academic", "professor", "teacher"];
  if (wrongTitleKeywords.some(kw => tLower.includes(kw))) {
    return null; // reject obviously wrong title
  }
  
  const company = (
    r.company ?? r.companyName ?? r.currentCompany?.name ?? r.currentCompany ??
    r.currentPosition?.companyName ?? (Array.isArray(r.currentPosition) ? r.currentPosition[0]?.companyName : undefined) ??
    (Array.isArray(r.experience) ? (r.experience[0]?.companyName ?? r.experience[0]?.company) : undefined) ??
    r.positions?.[0]?.companyName ?? null
  );
  
  const compName = typeof company === "object" && company ? (company.name || company.companyName || null) : company;
  const companyStr = (typeof compName === "string" ? compName.trim() : null) || null;
  
  if (!companyStr && !headline) return null; // reject weak/no company signal
  
  const company_url = (r.companyUrl ?? r.companyLinkedinUrl ?? r.companyPageUrl ?? null) || null;
  const location = (r.location ?? r.locationName ?? null) || null;
  const source_url = linkedin_url;
  
  const confidence_signals: string[] = ["has_name", "has_title", "has_profile_url"];
  if (companyStr) confidence_signals.push("has_company");
  if (headline) confidence_signals.push("has_headline");
  
  return {
    name,
    title,
    linkedin_url,
    profile_url: linkedin_url,
    email: (r.email ?? (Array.isArray(r.emails) ? r.emails[0] : undefined) ?? null) || null,
    company: companyStr,
    headline,
    confidence: typeof r.confidence === "number" ? r.confidence : 0.6,
    source: (r.source ?? r.via ?? "apify_people_search") || null,
    location,
    source_url,
    company_url,
    confidence_signals,
  };
}

// Safe company normalization: lowercase, drop punctuation + common suffixes/noise
// (Inc, LLC, Ltd, GmbH, AI, Technologies, Labs, Co, Group, Solutions, …) so
// "Acme AI Inc." ≈ "Acme". Stops short of erasing the distinctive name.
const COMPANY_NOISE_RE =
  /\b(inc|llc|ltd|limited|corp|corporation|co|company|gmbh|ai|technologies|technology|tech|labs|lab|group|solutions|software|systems|holdings|ventures|partners|llp|plc|sa|bv)\b/g;
function normCompany(s: string | null | undefined): string {
  return (s ?? "").toLowerCase().replace(COMPANY_NOISE_RE, "").replace(/[^a-z0-9]+/g, "").trim();
}

/** Match a discovered contact to an account with a confidence rating. High = exact
 *  normalized company; medium = strong containment or company-in-headline (title
 *  present); low/none = no company signal. Never matches on name/title alone. */
export function matchContactToAccountDetailed(contact: DiscoveredContact, accounts: AccountForContacts[]): ContactMatch {
  const cc = normCompany(contact.company);
  const headlineNorm = normCompany(contact.headline);
  if (!cc && !headlineNorm && !contact.company_url) {
    return { matched: false, confidence: "low", reasons: ["contact has no company signal"], lead_candidate_id: null };
  }
  
  if (contact.company_url) {
    const contactUrlClean = contact.company_url.toLowerCase().replace(/\/$/, "");
    for (const a of accounts) {
      if (a.linkedin_company_url) {
        const aUrlClean = a.linkedin_company_url.toLowerCase().replace(/\/$/, "");
        if (contactUrlClean === aUrlClean) {
          return { matched: true, confidence: "high", reasons: ["exact company LinkedIn URL match"], lead_candidate_id: a.lead_candidate_id };
        }
      }
    }
  }
  
  // 1. exact normalized company match → high
  for (const a of accounts) {
    if (cc && normCompany(a.company) === cc) {
      return { matched: true, confidence: "high", reasons: ["exact company match"], lead_candidate_id: a.lead_candidate_id };
    }
  }
  // 2. strong containment on the company field → medium
  for (const a of accounts) {
    const ac = normCompany(a.company);
    if (ac.length >= 4 && cc && (ac.includes(cc) || cc.includes(ac))) {
      return { matched: true, confidence: "medium", reasons: ["partial company match"], lead_candidate_id: a.lead_candidate_id };
    }
  }
  // 3. account company appears in the headline AND a title is present → medium
  if (contact.title) {
    for (const a of accounts) {
      const ac = normCompany(a.company);
      if (ac.length >= 4 && headlineNorm.includes(ac)) {
        return { matched: true, confidence: "medium", reasons: ["company in headline + title present"], lead_candidate_id: a.lead_candidate_id };
      }
    }
  }
  return { matched: false, confidence: "low", reasons: ["no account name matched the contact's company"], lead_candidate_id: null };
}

/** Back-compat: returns the lead id only for high/medium confidence matches. */
export function matchContactToAccount(contact: DiscoveredContact, accounts: AccountForContacts[]): string | null {
  const m = matchContactToAccountDetailed(contact, accounts);
  return m.matched && (m.confidence === "high" || m.confidence === "medium") ? m.lead_candidate_id : null;
}

/** Attach discovered contacts to accounts (1 best contact per account, capped,
 *  no duplicates, no invented contacts). SAFE: requires name + title + profile URL
 *  + a high/medium company match. Returns the attach plan for the caller to persist. */
export interface ContactAttachment { lead_candidate_id: string; contact: DiscoveredContact; confidence: "high" | "medium"; }
export function planContactAttachments(rawContacts: unknown[], accounts: AccountForContacts[]): ContactAttachment[] {
  const taken = new Set<string>();
  const out: ContactAttachment[] = [];
  const candidates: Array<{ lead_candidate_id: string; contact: DiscoveredContact; confidence: "high" | "medium"; score: number }> = [];
  
  for (const raw of rawContacts ?? []) {
    const c = normalizeDiscoveredContact(raw);
    if (!c) continue;
    if (!c.title || !c.linkedin_url) continue;        // never attach without title + source URL
    const m = matchContactToAccountDetailed(c, accounts);
    if (!m.matched || !m.lead_candidate_id) continue; // company mismatch → reject
    if (m.confidence === "low") continue;             // low confidence → reject
    
    const acc = accounts.find(a => a.lead_candidate_id === m.lead_candidate_id);
    const personaRec = inferContactPersona(acc?.signal_role ?? "");
    
    let personaScore = 0;
    const titleLower = c.title.toLowerCase();
    
    if (titleLower.includes(personaRec.primary.toLowerCase())) {
      personaScore = 10;
    } else {
      const idx = personaRec.personas.findIndex(p => titleLower.includes(p.toLowerCase()));
      if (idx !== -1) {
        personaScore = 8 - idx;
      }
    }
    
    const confidenceScore = m.confidence === "high" ? 5 : 2;
    const totalScore = personaScore + confidenceScore;
    
    candidates.push({
      lead_candidate_id: m.lead_candidate_id,
      contact: c,
      confidence: m.confidence,
      score: totalScore
    });
  }
  
  candidates.sort((a, b) => b.score - a.score);
  
  for (const cand of candidates) {
    if (taken.has(cand.lead_candidate_id)) continue;
    taken.add(cand.lead_candidate_id);
    out.push({
      lead_candidate_id: cand.lead_candidate_id,
      contact: cand.contact,
      confidence: cand.confidence
    });
  }
  
  return out;
}

export function contactDiscoveryFallback(): string {
  return "Profile/people search isn't configured, so I can't pull decision-maker profiles directly. I can instead search LinkedIn posts/company pages for people engaging from these companies, or you can enable the people-search actor (APIFY_ENABLE_PEOPLE_SEARCH). I won't invent contacts.";
}
