// Lead opportunity model — turns raw sourcing results into a two-layer
// account/contact lead workflow. Pure / import-free (Deno + Node testable).
//
// Headline rules:
//   - hiring/company signals are ACCOUNT opportunities (not contact-ready leads),
//   - never label results "lead leads",
//   - draft outreach is gated on a real contact,
//   - domains are guessed honestly (labelled "probable"), never invented as fact.

export type SourceType =
  | "hiring_signal" | "linkedin_intent" | "linkedin_posts"
  | "competitor_engagement" | "company_search" | "profile_search" | "people_profiles" | "lead";

export type OpportunityStatus =
  | "account_found" | "needs_contact" | "contact_found" | "enriched" | "drafted" | "saved";

export type NextActionKey =
  | "find_contacts" | "research_company" | "draft_outreach" | "broaden_search" | "fix_integration" | "rank_fit";

// ---- Contact persona inference from the hiring/intent signal ----

export interface PersonaRecommendation {
  personas: string[];
  primary: string;
  reason: string;
}

export function inferContactPersona(signalRole: string | null | undefined): PersonaRecommendation {
  const r = (signalRole ?? "").toLowerCase();
  if (/(account exec|\bae\b|\bsdr\b|\bbdr\b|\bsales\b|\bgtm\b|go-to-market|\brevenue\b|business development|\bquota\b|\bgrowth\b|\bmarketing\b)/.test(r)) {
    return { personas: ["Founder", "Co-Founder", "CEO", "VP Sales", "Head of Sales", "Head of Growth", "Revenue Lead"], primary: "VP Sales", reason: "They own GTM, sales, and growth decisions." };
  }
  if (/(recruit\w*|talent|people|hr|human resources)/.test(r)) {
    return { personas: ["Founder", "CEO", "Head of People", "Talent Lead", "Recruiting Lead"], primary: "Head of People", reason: "They own talent and recruiting decisions." };
  }
  if (/(engineer|developer|product|design|data|cto|engineering)/.test(r)) {
    return { personas: ["Founder", "CEO", "CTO", "Head of Engineering"], primary: "CTO", reason: "They own technical and engineering decisions." };
  }
  return { personas: ["Founder", "Co-Founder", "CEO", "Owner"], primary: "Founder", reason: "Early-stage decision makers are the safest entry point." };
}

// ---- Opportunity status ----

const ACCOUNT_SOURCES: ReadonlySet<SourceType> = new Set<SourceType>(["hiring_signal", "company_search", "lead"]);
const PEOPLE_SOURCES: ReadonlySet<SourceType> = new Set<SourceType>(["profile_search", "people_profiles"]);

export interface OpportunitySignals {
  source_type: SourceType;
  has_contact: boolean;
  enriched?: boolean;
  drafted?: boolean;
}

export function deriveOpportunityStatus(s: OpportunitySignals): OpportunityStatus {
  if (s.drafted) return "drafted";
  if (s.enriched) return "enriched";
  if (s.has_contact) return "contact_found";
  // No contact yet. Account-style sources start as account opportunities needing a contact.
  if (ACCOUNT_SOURCES.has(s.source_type)) return "needs_contact";
  if (PEOPLE_SOURCES.has(s.source_type)) return "needs_contact"; // people source but no profile data
  // linkedin/competitor with no profile data → still needs a contact.
  return "needs_contact";
}

/** People/profile and competitor/linkedin sources can be contact-ready; hiring/company are accounts. */
export function isContactReadySource(source_type: SourceType): boolean {
  return !ACCOUNT_SOURCES.has(source_type);
}

// ---- Header label (fixes "4 lead leads") ----

export function buildLeadResultsHeader(counts: { accounts: number; contacts: number }): string {
  const a = Math.max(0, counts.accounts | 0);
  const c = Math.max(0, counts.contacts | 0);
  if (c > 0 && c >= a) return `${c} contact-ready lead${c === 1 ? "" : "s"} found`;
  if (c > 0 && a > c) return `${a} opportunit${a === 1 ? "y" : "ies"} · ${c} contact${c === 1 ? "" : "s"} found`;
  return `${a} account opportunit${a === 1 ? "y" : "ies"} found`;
}

export const LEAD_RESULTS_SUBTITLE = "Found by Scout · Ranked by Aria · Nothing sent";

// ---- Draft-outreach gating ----

export interface ContactLike {
  name?: string | null;
  title?: string | null;
  linkedin_url?: string | null;
  email?: string | null;
}

export function canDraftOutreach(contact: ContactLike | null | undefined): boolean {
  if (!contact) return false;
  return !!(contact.name || contact.linkedin_url || contact.email);
}

// ---- Next best action ----

export interface NextAction { action: NextActionKey; label: string; reason: string; }

export function recommendNextAction(state: {
  tool_failed?: boolean;
  accounts: number;
  contacts: number;
  enriched_contacts?: number;
  requested?: number;
}): NextAction {
  if (state.tool_failed) return { action: "fix_integration", label: "Fix integration or retry", reason: "Sourcing failed before producing usable results." };
  if (state.contacts > 0 && (state.enriched_contacts ?? 0) >= state.contacts) {
    return { action: "draft_outreach", label: "Generate approval-ready outreach", reason: "You have contacts with company context — draft personalized, approval-gated outreach." };
  }
  if (state.contacts > 0) {
    return { action: "research_company", label: "Research company context", reason: "Enrichment will make outreach more specific." };
  }
  if (state.accounts > 0) {
    return { action: "find_contacts", label: "Find decision-makers", reason: "You have company intent, but no one to contact yet." };
  }
  if (typeof state.requested === "number" && state.accounts + state.contacts < state.requested) {
    return { action: "broaden_search", label: "Broaden search", reason: `Found fewer than the ${state.requested} requested.` };
  }
  return { action: "rank_fit", label: "Rank by fit", reason: "Prioritize the strongest opportunities first." };
}

// ---- Domain discovery (honest, never invented as fact) ----

export interface DomainGuess { domain: string | null; confidence: "found" | "probable" | "unavailable"; }

const URL_RE = /https?:\/\/([^/\s]+)/i;
const COMPANY_SUFFIX_RE = /\b(inc|llc|ltd|corp|co|company|gmbh|technologies|labs|software|ai|io)\b/gi;

/** Try to resolve a real domain from a website/source URL; otherwise produce a
 *  clearly-labelled "probable" domain from the company name. Never asserts fact. */
export function guessDomain(opts: { website?: string | null; linkedin_url?: string | null; source_url?: string | null; company?: string | null }): DomainGuess {
  // 1) explicit website → found
  const site = (opts.website ?? "").trim();
  if (site) {
    const m = site.match(URL_RE);
    const host = (m ? m[1] : site).replace(/^www\./, "").replace(/\/.*$/, "");
    if (host.includes(".")) return { domain: host.toLowerCase(), confidence: "found" };
  }
  // 2) a non-LinkedIn source URL host → found
  const src = (opts.source_url ?? "").trim();
  if (src && !/linkedin\.com|indeed\.com|greenhouse|lever\.co|workable|ashby/i.test(src)) {
    const m = src.match(URL_RE);
    if (m) {
      const host = m[1].replace(/^www\./, "");
      if (host.includes(".")) return { domain: host.toLowerCase(), confidence: "found" };
    }
  }
  // 3) probable domain from a clean company name (labelled, not asserted)
  const name = (opts.company ?? "").trim();
  if (name) {
    const slug = name.toLowerCase().replace(COMPANY_SUFFIX_RE, "").replace(/[^a-z0-9]+/g, "");
    if (slug.length >= 2) return { domain: `${slug}.com`, confidence: "probable" };
  }
  return { domain: null, confidence: "unavailable" };
}

export type EnrichmentStatus = "enrichable" | "needs_domain" | "needs_confirmation";

export function enrichmentStatus(g: DomainGuess): EnrichmentStatus {
  if (g.confidence === "found") return "enrichable";
  if (g.confidence === "probable") return "needs_confirmation";
  return "needs_domain";
}
