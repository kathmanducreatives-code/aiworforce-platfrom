// LISA V2 — EXTRACTION: one search hit → zero or more Observations.
//
// Deterministic. A claim is extracted only when the text itself states it:
// a funding verb with a round or an amount; an opening verb with a facility
// and a place; a launch verb with something launched; hiring language with
// enough scale to be a business development (not one job ad). Nothing is
// inferred, filled in or paraphrased — `excerpt` is the source's own sentence.
//
// PURE.

import type { DropReason, LisaCategory, Observation, SearchHit, WatchSubject } from "./types.ts";

const JOB_BOARDS = ["linkedin.com", "indeed.com", "glassdoor.com", "greenhouse.io", "lever.co", "ashbyhq.com", "workable.com", "wellfound.com"];
const MONTHS: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5, jun: 6, june: 6,
  jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9, oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
};

export const NEGATION_RE = /\b(denies|denied|deny|not raising|no plans to|has no plans|cancell?ed|cancels|postpone[sd]?|scrapped|retracts?|retracted|false report|withdrawn|withdraws|unfounded|rumou?rs?)\b/i;

export function domainOf(url: string | null | undefined): string | null {
  try {
    const u = new URL(String(url ?? ""));
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return u.hostname.toLowerCase().replace(/^www\./, "");
  } catch { return null; }
}

export function slug(s: string): string {
  return s.normalize("NFKD").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "x";
}

/** A date stated in the text (ISO yyyy-mm-dd), or null. Month-only dates resolve to the 1st. */
export function dateInText(text: string): string | null {
  const iso = text.match(/\b(20\d\d)-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])\b/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const mdy = text.match(/\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?\s+(\d{1,2}),?\s+(20\d\d)\b/i);
  if (mdy) return `${mdy[3]}-${String(MONTHS[mdy[1].toLowerCase().replace(".", "")]).padStart(2, "0")}-${mdy[2].padStart(2, "0")}`;
  const my = text.match(/\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+(20\d\d)\b/i);
  if (my) return `${my[2]}-${String(MONTHS[my[1].toLowerCase()]).padStart(2, "0")}-01`;
  return null;
}

function sentences(text: string): string[] {
  return text.replace(/\s+/g, " ").split(/(?<=[.!?])\s+(?=[A-Z"“])/).map((s) => s.trim()).filter(Boolean);
}

// ── category rules ──────────────────────────────────────────────────────────

const FUNDING_VERB = /\b(raises?|raised|raising|secures?|secured|closes?|closed|lands?|landed|announces?|announced|completes?|completed)\b/i;
const ROUND = /\b(pre[- ]seed|seed|series\s+[a-h])\b(?:\s+(?:round|funding|extension))?/i;
const AMOUNT = /(?:\$|€|£|usd\s?|eur\s?)\s?(\d+(?:\.\d+)?)\s?(million|mn|m|billion|bn|b)\b/i;

const HIRING_WORDS = /\b(is hiring|are hiring|hiring spree|plans? to hire|will hire|to hire|job openings|open roles|new jobs|recruiting|hiring)\b/i;
const HIRING_SCALE = /\b(\d{2,5})\s+(?:new\s+)?(?:jobs|roles|positions|employees|people|engineers|hires|workers)\b|\bhire\s+(\d{2,5})\b/i;
const HIRING_STRUCTURE = /\b(new (?:team|department|office|hub|headquarters|plant|facility)|first (?:sales|engineering|marketing) hire|head of [a-z]+|build(?:ing)? out (?:its|a|their) [a-z]+ team)\b/i;
const ROLE_FAMILIES: Array<[string, RegExp]> = [
  ["sales", /\b(sales|account executives?|sdrs?|bdrs?|revenue)\b/i],
  ["engineering", /\b(engineer(?:s|ing)?|developers?|software)\b/i],
  ["manufacturing", /\b(manufacturing|production|assembly|plant workers?|technicians?)\b/i],
  ["operations", /\b(operations|logistics|warehouse|supply chain)\b/i],
  ["marketing", /\b(marketing|growth)\b/i],
  ["customer", /\b(customer success|support|service)\b/i],
];

const EXPANSION_VERB = /\b(opens?|opened|opening|will open|to open|plans to open|breaks? ground|broke ground|expands?|expanded|expanding|expansion|invests?|investing|relocat(?:es|ing))\b/i;
const FACILITY = /\b(manufacturing (?:plant|facility)|production (?:plant|facility|line)|factory|plant|facility|office|headquarters|hq|warehouse|distribution (?:center|centre|hub)|fulfil?lment (?:center|centre)|campus|site|hub|r&d (?:center|centre)|store)\b/i;
const PLACE = /\bin\s+((?:[A-Z][a-zA-Z.'-]+)(?:[ ,]+(?:[A-Z][a-zA-Z.'-]+)){0,3})/;

const LAUNCH_VERB = /\b(launch(?:es|ed|ing)?|unveil(?:s|ed|ing)?|introduc(?:es|ed|ing)|debut(?:s|ed)?|rolls? out|rolled out|releas(?:es|ed)|announc(?:es|ed) (?:the )?(?:launch|release|availability|general availability)|now available|generally available)\b/i;
const GENERIC_PAGE = /^(products?|our products|solutions|features|pricing|platform|about us|home)\b/i;

const MARKET_SUBJECT = new RegExp(
  String.raw`^(?:["“]?)([A-Z][A-Za-z0-9&.'\-]+(?:\s+[A-Z][A-Za-z0-9&.'\-]+){0,4})\s+(?:to open|opens|is opening|will open|plans to open|breaks ground|raises|raised|secures|closes|lands|launches|unveils|introduces|expands|announces|invests)\b`,
);

/**
 * The company's own site? For a named subject, its domain. For a market-wide
 * hit the domain is not known up front, so the registrable label must spell the
 * company's name (brightforge.example for "Brightforge Robotics"); otherwise a
 * press release on the company's own site would count as independent press.
 */
function sourceType(domain: string, subject: WatchSubject, companyName: string): Observation["source_type"] {
  if (subject.domain && (domain === subject.domain || domain.endsWith(`.${subject.domain}`))) return "company_site";
  if (!subject.domain) {
    const label = domain.split(".").slice(-2, -1)[0] ?? "";
    const compact = companyName.toLowerCase().replace(/[^a-z0-9]/g, "");
    const firstWord = companyName.toLowerCase().split(/\s+/)[0].replace(/[^a-z0-9]/g, "");
    if (label.length >= 4 && (label === compact || label === firstWord || compact.startsWith(label))) return "company_site";
  }
  if (JOB_BOARDS.some((j) => domain === j || domain.endsWith(`.${j}`))) return "job_board";
  return "news";
}

function mentionsSubject(text: string, subject: WatchSubject): boolean {
  const t = text.toLowerCase();
  if (subject.domain && t.includes(subject.domain)) return true;
  const n = subject.name.trim().toLowerCase();
  return n.length > 1 && new RegExp(`\\b${n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(t);
}

/** The company a market-wide hit is about: the subject of the headline verb. */
export function companyFromHeadline(title: string): string | null {
  const m = title.trim().match(MARKET_SUBJECT);
  if (!m) return null;
  const name = m[1].replace(/\s+(Inc|Ltd|LLC|Corp|Co|GmbH|AB|AS|plc)\.?$/i, "").trim();
  return /^(The|A|An|New|Report|Breaking|Update)$/i.test(name) ? null : name;
}

export interface Extraction {
  observations: Observation[];
  dropped: Array<{ reason: DropReason; url: string | null; category: LisaCategory }>;
}

/** Extract the claims of `category` from one hit for one watched subject. */
export function extract(hit: SearchHit, subject: WatchSubject, category: LisaCategory): Extraction {
  const out: Extraction = { observations: [], dropped: [] };
  const url = typeof hit?.url === "string" ? hit.url.trim() : "";
  const drop = (reason: DropReason) => { out.dropped.push({ reason, url: url || null, category }); return out; };
  if (!hit || typeof hit !== "object") return drop("invalid_hit");
  const domain = domainOf(url);
  if (!url || !domain) return drop("missing_source");
  const title = String(hit.title ?? "").trim();
  const description = String(hit.description ?? "").trim();
  const body = String(hit.markdown ?? "").slice(0, 4000);
  const text = `${title}. ${description}. ${body}`;
  if (!title && !description && !body) return drop("invalid_hit");

  // Who is it about?
  let company_name: string;
  let company_domain: string | null = null;
  if (subject.kind === "market") {
    const c = companyFromHeadline(title) ?? companyFromHeadline(description);
    if (!c) return drop("no_company");
    company_name = c;
  } else {
    if (!mentionsSubject(text, subject)) return drop("no_company");
    company_name = subject.name;
    company_domain = subject.domain;
  }

  const sents = sentences(text);
  const find = (re: RegExp) => sents.find((s) => re.test(s)) ?? null;
  const event_date = (typeof hit.published_at === "string" && /^\d{4}-\d{2}-\d{2}/.test(hit.published_at))
    ? hit.published_at.slice(0, 10) : dateInText(text);
  const negationSentence = find(NEGATION_RE);
  const negation = negationSentence ? (negationSentence.match(NEGATION_RE)?.[0] ?? null) : null;
  const base = {
    category, company_name, company_domain, source_url: url, source_domain: domain,
    source_type: sourceType(domain, subject, company_name), event_date, negation,
  };

  if (category === "funding") {
    const s = sents.find((x) => FUNDING_VERB.test(x) && (ROUND.test(x) || AMOUNT.test(x))) ?? null;
    if (!s) return drop("not_an_event");
    const round = s.match(ROUND)?.[1]?.toLowerCase().replace(/\s+/g, "-").replace("pre-seed", "pre-seed") ?? null;
    const amt = s.match(AMOUNT);
    const amount_usd_m = amt ? Number(amt[1]) * (/^b/i.test(amt[2]) ? 1000 : 1) : null;
    out.observations.push({ ...base, title: title || s.slice(0, 140), description: description || s,
      attributes: { round, amount_usd_m }, excerpt: s.slice(0, 400) });
    return out;
  }

  if (category === "hiring") {
    const s = find(HIRING_WORDS);
    if (!s) return drop("not_an_event");
    const scale = (s.match(HIRING_SCALE) ?? text.match(HIRING_SCALE));
    const count = scale ? Number(scale[1] ?? scale[2]) : null;
    const structure = s.match(HIRING_STRUCTURE)?.[0] ?? text.match(HIRING_STRUCTURE)?.[0] ?? null;
    // ONE job ad is not a business development: need scale (≥ 10 roles) or a structural change.
    if (!(count !== null && count >= 10) && !structure) return drop("below_significance");
    const role_family = ROLE_FAMILIES.find(([, re]) => re.test(s))?.[0] ?? "general";
    const place = s.match(PLACE)?.[1] ?? null;
    out.observations.push({ ...base, title: title || s.slice(0, 140), description: description || s,
      attributes: { role_family, count, structure: structure?.toLowerCase() ?? null, location: place }, excerpt: s.slice(0, 400) });
    return out;
  }

  if (category === "expansion") {
    const s = sents.find((x) => EXPANSION_VERB.test(x) && FACILITY.test(x)) ?? null;
    if (!s) return drop("not_an_event");
    const place = s.match(PLACE)?.[1]?.replace(/[,.]+$/, "") ?? null;
    if (!place) return drop("below_significance");
    const facility = (s.match(FACILITY)?.[1] ?? "site").toLowerCase();
    const inv = s.match(AMOUNT);
    out.observations.push({ ...base, title: title || s.slice(0, 140), description: description || s,
      attributes: { facility, location: place, investment_usd_m: inv ? Number(inv[1]) * (/^b/i.test(inv[2]) ? 1000 : 1) : null },
      excerpt: s.slice(0, 400) });
    return out;
  }

  // product_launch
  if (GENERIC_PAGE.test(title)) return drop("generic_page");
  const s = find(LAUNCH_VERB);
  if (!s) return drop(/\b(product|feature|platform)s?\b/i.test(text) ? "generic_page" : "not_an_event");
  const after = s.slice((s.match(LAUNCH_VERB)?.index ?? 0) + (s.match(LAUNCH_VERB)?.[0].length ?? 0));
  const product = after.match(/["“]([^"”]{2,60})["”]/)?.[1]
    ?? after.match(/\b(?:its\s+|the\s+|a\s+|new\s+)*([A-Z][A-Za-z0-9+]*(?:\s+[A-Z0-9][A-Za-z0-9+]*){0,4})/)?.[1]
    ?? null;
  if (!product) return drop("not_an_event");
  out.observations.push({ ...base, title: title || s.slice(0, 140), description: description || s,
    attributes: { product: product.trim() }, excerpt: s.slice(0, 400) });
  return out;
}
