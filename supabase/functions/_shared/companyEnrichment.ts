// Company enrichment — evidence-first, Firecrawl-backed. Pure / import-free so it
// is fully unit-testable in Deno without a running server or live provider.
//
// This module owns THREE decisions, all deterministic:
//   1. isEnrichmentEligible — may we spend a Firecrawl credit on this company?
//   2. planEnrichmentCrawl  — which small, targeted pages to crawl (capped).
//   3. extractCompanyEnrichment — turn crawled page text into a structured,
//      evidence-bearing company_enrichment object.
//
// It NEVER invents founders, funding, emails, or company facts. Every extracted
// person/email carries the evidence URL it came from; anything not found on the
// crawled pages is reported under missing_evidence.

export type Confidence = "low" | "medium" | "high";

export interface PersonHint {
  name: string;
  title: string | null;
  source: string;            // e.g. "firecrawl_team_page"
  evidence_url: string | null;
  confidence: Confidence;
}

export interface ContactEvidence {
  type: "email" | "contact_page" | "linkedin_profile";
  value: string;
  source_url: string;        // required — no evidence, no contact
  confidence: Confidence;
}

export interface CompanyEnrichment {
  status: "not_started" | "enriched" | "needs_verification" | "failed";
  source: "firecrawl";
  pages_crawled: number;
  company_summary: string | null;
  category: string | null;
  target_customer: string | null;
  founders: PersonHint[];
  executives: PersonHint[];
  growth_signals: string[];
  public_contact_emails: ContactEvidence[];
  contact_page_url: string | null;
  evidence_urls: string[];
  missing_evidence: string[];
  confidence: Confidence;
}

export interface EnrichmentEligibility {
  eligible: boolean;
  reason: string;
  base_url: string | null;   // resolved https origin to crawl, when eligible
}

export interface CrawledPage {
  url: string;
  title?: string | null;
  markdown?: string | null;  // Firecrawl markdown/text for the page
  kind?: EnrichmentPageKind; // planner label, if known
}

export type EnrichmentPageKind =
  | "homepage" | "about" | "team" | "leadership" | "company"
  | "careers" | "blog" | "press" | "news" | "contact";

const JOB_BOARD_HOST = /(?:^|\.)(linkedin\.com|indeed\.com|wellfound\.com|ziprecruiter\.com|glassdoor\.com|lever\.co|greenhouse\.io|ashbyhq\.com|workable\.com|simplyhired\.com)$/i;

function str(v: unknown): string | null {
  if (typeof v === "number") return String(v);
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

/** Resolve a crawlable https origin from a website/domain. Rejects job boards. */
export function resolveBaseUrl(website?: string | null, domain?: string | null): string | null {
  const raw = str(website) ?? str(domain);
  if (!raw) return null;
  try {
    const withProto = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
    const u = new URL(withProto);
    const host = u.hostname.replace(/^www\./i, "").toLowerCase();
    if (!host || !host.includes(".")) return null;
    if (JOB_BOARD_HOST.test(host)) return null;
    return `https://${host}`;
  } catch {
    return null;
  }
}

/**
 * Enrichment may run only for a selected company that (a) was NOT hard-rejected,
 * (b) has real source proof, and (c) resolves to a real (non-job-board) website
 * or domain. Firecrawl on unverified/rejected companies is forbidden.
 */
export function isEnrichmentEligible(lead: {
  gate_decision?: string | null;
  source_quality?: string | null;
  source_proof?: unknown;
  website?: string | null;
  company_website?: string | null;
  domain?: string | null;
}): EnrichmentEligibility {
  const gate = (lead.gate_decision ?? "").toLowerCase();
  if (gate === "reject" || gate === "rejected") {
    return { eligible: false, reason: "company was hard-rejected by the proof gate", base_url: null };
  }
  const quality = (lead.source_quality ?? "").toLowerCase();
  const proofArr = Array.isArray(lead.source_proof) ? lead.source_proof : [];
  const hasProof = proofArr.length > 0 || quality === "verified" || quality === "partial";
  if (!hasProof) {
    return { eligible: false, reason: "no real source proof — refuse to spend crawl credits", base_url: null };
  }
  const base = resolveBaseUrl(lead.website ?? lead.company_website, lead.domain);
  if (!base) {
    return { eligible: false, reason: "no company website/domain (only a job-board link) — enrichment blocked", base_url: null };
  }
  return { eligible: true, reason: "accept/needs_verification + proof + real website", base_url: base };
}

// The small, targeted page set. Order = crawl priority; homepage first, then the
// people/company pages that carry founder/exec evidence, then softer signal pages.
const PAGE_PATHS: Array<{ kind: EnrichmentPageKind; paths: string[] }> = [
  { kind: "homepage", paths: [""] },
  { kind: "about", paths: ["/about", "/about-us"] },
  { kind: "team", paths: ["/team", "/our-team"] },
  { kind: "leadership", paths: ["/leadership", "/management"] },
  { kind: "company", paths: ["/company"] },
  { kind: "contact", paths: ["/contact", "/contact-us"] },
  { kind: "careers", paths: ["/careers", "/jobs"] },
  { kind: "blog", paths: ["/blog"] },
  { kind: "press", paths: ["/press"] },
  { kind: "news", paths: ["/news"] },
];

export interface CrawlPlan {
  base_url: string;
  pages: Array<{ url: string; kind: EnrichmentPageKind }>;
  max_pages: number;
  estimated_credits: number;
}

/**
 * Plan a SMALL, capped crawl. Never crawls the whole site: one candidate URL per
 * page kind, in priority order, truncated to max_pages (default 6). One credit
 * per page.
 */
export function planEnrichmentCrawl(
  input: { website?: string | null; company_website?: string | null; domain?: string | null },
  opts: { maxPages?: number } = {},
): CrawlPlan | null {
  const base = resolveBaseUrl(input.website ?? input.company_website, input.domain);
  if (!base) return null;
  const maxPages = Math.max(1, Math.min(10, opts.maxPages ?? 6));
  const pages: Array<{ url: string; kind: EnrichmentPageKind }> = [];
  for (const entry of PAGE_PATHS) {
    // one URL per kind (first path variant) — keeps the crawl small + predictable
    pages.push({ url: `${base}${entry.paths[0]}`, kind: entry.kind });
    if (pages.length >= maxPages) break;
  }
  return { base_url: base, pages, max_pages: maxPages, estimated_credits: pages.length };
}

// ---- Extraction (deterministic, evidence-bearing) ----

const EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;
const ROLE_RE = /\b(founder|co-?founder|ceo|chief executive|cto|coo|cmo|cfo|chief \w+ officer|head of [a-z ]+|vp of [a-z ]+|vice president|president|managing director|owner)\b/i;
const PERSONAL_EMAIL_HOST = /@(gmail|yahoo|hotmail|outlook|icloud|proton(mail)?|aol)\./i;

function titleCaseName(s: string): string {
  return s.trim().replace(/\s+/g, " ");
}

/** Extract "Founded by X (and Y)" / "co-founded by X" style founder mentions. */
export function extractFoundersFromText(text: string, evidenceUrl: string): PersonHint[] {
  const out: PersonHint[] = [];
  const seen = new Set<string>();
  const re = /\b(?:co-?)?founded by\s+([A-Z][a-zA-Z'-]+(?:\s+[A-Z][a-zA-Z'-]+){0,2})(?:\s+and\s+([A-Z][a-zA-Z'-]+(?:\s+[A-Z][a-zA-Z'-]+){0,2}))?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    for (const name of [m[1], m[2]]) {
      const n = name && titleCaseName(name);
      if (n && !seen.has(n.toLowerCase())) {
        seen.add(n.toLowerCase());
        out.push({ name: n, title: "Founder", source: "firecrawl_about_page", evidence_url: evidenceUrl, confidence: "medium" });
      }
    }
  }
  return out;
}

/**
 * Extract "Name — Title" / "Name, CEO" people from a team/leadership page. Only
 * lines that pair a proper name with a leadership title become PersonHints.
 */
export function extractPeopleFromTeamPage(text: string, evidenceUrl: string): PersonHint[] {
  const out: PersonHint[] = [];
  const seen = new Set<string>();
  const lines = text.split(/\r?\n/);
  const nameThenTitle = /^\s*[#*\-\s]*([A-Z][a-zA-Z.'-]+(?:\s+[A-Z][a-zA-Z.'-]+){1,2})\s*[,–—\-|:]\s*(.+?)\s*$/;
  for (const line of lines) {
    const m = line.match(nameThenTitle);
    if (!m) continue;
    const name = titleCaseName(m[1]);
    const title = m[2].trim().replace(/\s+/g, " ").slice(0, 80);
    if (!ROLE_RE.test(title)) continue;             // must be a leadership title
    if (seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    const isFounder = /founder/i.test(title);
    out.push({
      name,
      title,
      source: "firecrawl_team_page",
      evidence_url: evidenceUrl,
      confidence: isFounder ? "high" : "medium",
    });
  }
  return out;
}

const GROWTH_RE = /\b(raised|raising|series [a-e]\b|seed round|funding|backed by|hiring|we're hiring|growing team|new customers|expanding|scaling|record (?:revenue|growth)|doubled)\b/i;

/**
 * Clean Firecrawl markdown/text for human-readable evidence fields (summary,
 * growth signals). Strips markdown link/image syntax and bare URLs, collapses
 * markdown-render artifacts like duplicated words ("reliablereliable"),
 * normalizes whitespace, and trims stray punctuation. Purely cosmetic — it never
 * adds, upgrades, or fabricates any claim, and evidence_urls are kept separately.
 */
export function cleanEvidenceText(text: string | null | undefined): string {
  let s = String(text ?? "");
  s = s.replace(/!?\[([^\]]*?)\]\([^)]*\)/g, "$1");   // [label](url) / ![alt](url) → label
  s = s.replace(/\bhttps?:\/\/[^\s)]+/gi, "");          // strip bare URLs from prose
  s = s.replace(/[*_`#>|]+/g, " ");                     // drop markdown marks
  s = s.replace(/\b(\w{4,}?)\1\b/gi, "$1");             // reliablereliable → reliable
  s = s.replace(/\b(\w+)(?:\s+\1\b)+/gi, "$1");         // "the the" → "the"
  s = s.replace(/\s+/g, " ").trim();
  s = s.replace(/^[\s\-–—•,.:]+/, "").replace(/[\s|]+$/, "").trim();
  return s;
}

/** Pull short evidence phrases (never asserted as fact) that hint at growth/funding. */
export function extractGrowthSignals(text: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const sentence of text.split(/(?<=[.!?])\s+|\n+/)) {
    const s = cleanEvidenceText(sentence);
    if (s.length < 8 || s.length > 200) continue;
    if (GROWTH_RE.test(s) && !seen.has(s.toLowerCase())) {
      seen.add(s.toLowerCase());
      out.push(s);
      if (out.length >= 6) break;
    }
  }
  return out;
}

/**
 * Turn crawled pages into a structured, evidence-first company_enrichment. Only
 * extracts what is literally present; missing signals are reported honestly.
 */
export function extractCompanyEnrichment(pages: CrawledPage[], opts: { category?: string | null } = {}): CompanyEnrichment {
  const crawled = (pages ?? []).filter((p) => p && typeof p.url === "string" && p.url);
  const withText = crawled.filter((p) => str(p.markdown));
  const evidenceUrls = new Set<string>();
  const founders: PersonHint[] = [];
  const executives: PersonHint[] = [];
  const growth: string[] = [];
  const emails: ContactEvidence[] = [];
  const seenEmail = new Set<string>();
  let contactPageUrl: string | null = null;
  let summary: string | null = null;

  for (const p of withText) {
    const text = str(p.markdown) ?? "";
    const kind = p.kind ?? inferKind(p.url);

    if (kind === "homepage" && !summary) {
      // First substantial paragraph as a company summary (verbatim, never invented).
      const para = text.split(/\n{2,}/).map((s) => cleanEvidenceText(s)).find((s) => s.length >= 40);
      summary = para ? para.slice(0, 300) : null;
    }

    if (kind === "about" || kind === "company" || kind === "homepage") {
      for (const f of extractFoundersFromText(text, p.url)) {
        if (!founders.some((x) => x.name.toLowerCase() === f.name.toLowerCase())) { founders.push(f); evidenceUrls.add(p.url); }
      }
    }

    if (kind === "team" || kind === "leadership") {
      for (const person of extractPeopleFromTeamPage(text, p.url)) {
        const bucket = /founder/i.test(person.title ?? "") ? founders : executives;
        if (!bucket.some((x) => x.name.toLowerCase() === person.name.toLowerCase())) { bucket.push(person); evidenceUrls.add(p.url); }
      }
    }

    for (const g of extractGrowthSignals(text)) {
      if (!growth.includes(g)) { growth.push(g); evidenceUrls.add(p.url); }
    }

    // Public business emails only — skip obvious personal inboxes.
    const found = text.match(EMAIL_RE) ?? [];
    for (const raw of found) {
      const email = raw.toLowerCase();
      if (seenEmail.has(email) || PERSONAL_EMAIL_HOST.test(email)) continue;
      seenEmail.add(email);
      emails.push({ type: "email", value: email, source_url: p.url, confidence: kind === "contact" ? "high" : "medium" });
      evidenceUrls.add(p.url);
    }

    if (kind === "contact" && !contactPageUrl) { contactPageUrl = p.url; evidenceUrls.add(p.url); }
  }

  const missing: string[] = [];
  if (founders.length === 0) missing.push("founders");
  if (executives.length === 0 && founders.length === 0) missing.push("leadership");
  if (emails.length === 0) missing.push("public_contact_email");
  if (!crawled.some((p) => (p.kind ?? inferKind(p.url)) === "team" || (p.kind ?? inferKind(p.url)) === "leadership")) missing.push("team_page");
  if (!summary) missing.push("company_summary");

  const signalCount = founders.length + executives.length + emails.length;
  const confidence: Confidence =
    founders.length > 0 && emails.length > 0 && evidenceUrls.size >= 2 ? "high"
    : signalCount > 0 ? "medium"
    : "low";

  const status: CompanyEnrichment["status"] =
    withText.length === 0 ? "failed"
    : signalCount > 0 || summary ? "enriched"
    : "needs_verification";

  return {
    status,
    source: "firecrawl",
    pages_crawled: withText.length,
    company_summary: summary,
    category: opts.category ?? null,
    target_customer: null,          // only set by an evidence-bearing extractor; never guessed
    founders,
    executives,
    growth_signals: growth,
    public_contact_emails: emails,
    contact_page_url: contactPageUrl,
    evidence_urls: [...evidenceUrls],
    missing_evidence: missing,
    confidence,
  };
}

function inferKind(url: string): EnrichmentPageKind {
  const p = url.toLowerCase();
  if (/\/(team|our-team)\b/.test(p)) return "team";
  if (/\/(leadership|management)\b/.test(p)) return "leadership";
  if (/\/about/.test(p)) return "about";
  if (/\/contact/.test(p)) return "contact";
  if (/\/careers|\/jobs/.test(p)) return "careers";
  if (/\/company/.test(p)) return "company";
  if (/\/blog/.test(p)) return "blog";
  if (/\/press/.test(p)) return "press";
  if (/\/news/.test(p)) return "news";
  // bare origin / unknown → homepage
  try { return new URL(url).pathname.replace(/\/+$/, "") === "" ? "homepage" : "homepage"; } catch { return "homepage"; }
}

export function emptyEnrichment(reason: string): CompanyEnrichment {
  return {
    status: "not_started", source: "firecrawl", pages_crawled: 0,
    company_summary: null, category: null, target_customer: null,
    founders: [], executives: [], growth_signals: [], public_contact_emails: [],
    contact_page_url: null, evidence_urls: [], missing_evidence: [reason], confidence: "low",
  };
}
