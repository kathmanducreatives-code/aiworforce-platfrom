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
  confidence: number;
  source: string | null;
}

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
  const name = (r.name ?? r.fullName ?? r.full_name ?? r.author?.name ?? "").toString().trim();
  if (!name) return null; // no-invent rule
  return {
    name,
    title: (r.title ?? r.headline ?? r.position ?? r.jobTitle ?? null) || null,
    linkedin_url: (r.linkedin_url ?? r.linkedinUrl ?? r.profileUrl ?? r.url ?? null) || null,
    email: (r.email ?? null) || null,
    company: (r.company ?? r.companyName ?? r.currentCompany ?? null) || null,
    confidence: typeof r.confidence === "number" ? r.confidence : 0.6,
    source: (r.source ?? r.via ?? "apify_people_search") || null,
  };
}

function normCompany(s: string | null | undefined): string {
  return (s ?? "").toLowerCase().replace(/\b(inc|llc|ltd|corp|co|company|gmbh|technologies|labs)\b/g, "").replace(/[^a-z0-9]+/g, "").trim();
}

/** Match a discovered contact to one of the account opportunities by company name.
 *  Returns the account's lead_candidate_id, or null when no confident match. */
export function matchContactToAccount(contact: DiscoveredContact, accounts: AccountForContacts[]): string | null {
  const cc = normCompany(contact.company);
  if (!cc) return null;
  // exact normalized match first, then containment.
  const exact = accounts.find((a) => normCompany(a.company) === cc);
  if (exact) return exact.lead_candidate_id;
  const partial = accounts.find((a) => {
    const ac = normCompany(a.company);
    return ac.length >= 3 && (ac.includes(cc) || cc.includes(ac));
  });
  return partial ? partial.lead_candidate_id : null;
}

/** Attach discovered contacts to accounts (1 best contact per account, capped,
 *  no duplicates, no invented contacts). Returns the attach plan for the caller
 *  to persist (update lead_candidate.contact_id + create contact rows). */
export interface ContactAttachment { lead_candidate_id: string; contact: DiscoveredContact; }
export function planContactAttachments(rawContacts: unknown[], accounts: AccountForContacts[]): ContactAttachment[] {
  const taken = new Set<string>();
  const out: ContactAttachment[] = [];
  for (const raw of rawContacts ?? []) {
    const c = normalizeDiscoveredContact(raw);
    if (!c) continue;
    const leadId = matchContactToAccount(c, accounts);
    if (!leadId || taken.has(leadId)) continue; // one decision-maker per account
    taken.add(leadId);
    out.push({ lead_candidate_id: leadId, contact: c });
  }
  return out;
}

export function contactDiscoveryFallback(): string {
  return "Profile/people search isn't configured, so I can't pull decision-maker profiles directly. I can instead search LinkedIn posts/company pages for people engaging from these companies, or you can enable the people-search actor (APIFY_ENABLE_PEOPLE_SEARCH). I won't invent contacts.";
}
