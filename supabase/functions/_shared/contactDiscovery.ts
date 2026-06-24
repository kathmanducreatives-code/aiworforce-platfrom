// Contact discovery — turns account opportunities into decision-maker searches
// and attaches discovered contacts back to the right account. Pure / import-free
// except the (pure) persona helper. Never invents contacts.

import { inferContactPersona, type PersonaRecommendation } from "./leadOpportunity.ts";

export interface AccountForContacts {
  lead_candidate_id: string;
  company: string;
  signal_role?: string | null; // the hiring role / signal that drives persona
}

export interface DiscoveredContact {
  name: string;
  title: string | null;
  linkedin_url: string | null;
  email: string | null;
  company: string | null;
  headline: string | null; // fallback company signal (e.g. "Founder at Acme AI")
  confidence: number;
  source: string | null;
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
  if (!name) return null; // no-invent rule
  const headline = (r.headline ?? r.occupation ?? null) || null;
  // Company can be nested in HarvestAPI profiles (currentPosition/experience),
  // not just a flat field. Pull from the common shapes.
  const company = (
    r.company ?? r.companyName ?? r.currentCompany?.name ?? r.currentCompany ??
    r.currentPosition?.companyName ?? (Array.isArray(r.currentPosition) ? r.currentPosition[0]?.companyName : undefined) ??
    (Array.isArray(r.experience) ? (r.experience[0]?.companyName ?? r.experience[0]?.company) : undefined) ??
    r.positions?.[0]?.companyName ?? null
  );
  return {
    name,
    title: (r.title ?? r.position ?? r.jobTitle ?? r.currentPosition?.title ?? headline ?? null) || null,
    linkedin_url: (r.linkedin_url ?? r.linkedinUrl ?? r.profileUrl ?? r.publicProfileUrl ?? r.url ?? null) || null,
    email: (r.email ?? (Array.isArray(r.emails) ? r.emails[0] : undefined) ?? null) || null,
    company: (typeof company === "string" ? company.trim() : null) || null,
    headline,
    confidence: typeof r.confidence === "number" ? r.confidence : 0.6,
    source: (r.source ?? r.via ?? "apify_people_search") || null,
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
  if (!cc && !headlineNorm) {
    return { matched: false, confidence: "low", reasons: ["contact has no company signal"], lead_candidate_id: null };
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
  for (const raw of rawContacts ?? []) {
    const c = normalizeDiscoveredContact(raw);
    if (!c) continue;
    if (!c.title || !c.linkedin_url) continue;        // never attach without title + source URL
    const m = matchContactToAccountDetailed(c, accounts);
    if (!m.matched || !m.lead_candidate_id) continue; // company mismatch → reject
    if (m.confidence === "low") continue;             // low confidence → reject
    if (taken.has(m.lead_candidate_id)) continue;     // one decision-maker per account
    taken.add(m.lead_candidate_id);
    out.push({ lead_candidate_id: m.lead_candidate_id, contact: c, confidence: m.confidence });
  }
  return out;
}

export function contactDiscoveryFallback(): string {
  return "Profile/people search isn't configured, so I can't pull decision-maker profiles directly. I can instead search LinkedIn posts/company pages for people engaging from these companies, or you can enable the people-search actor (APIFY_ENABLE_PEOPLE_SEARCH). I won't invent contacts.";
}
