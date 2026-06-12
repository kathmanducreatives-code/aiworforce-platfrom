// Phase 4 — Competitor Engagement Tracker registry.
// Pure / import-free so it is unit-testable in Node + Deno. Used by the
// classifier (intent + search-query expansion) and memoryWriter (per-item
// competitor tagging). No network, no side effects.

export type CompetitorCategory =
  | "sales_engagement"
  | "ai_sdr"
  | "gtm_data"
  | "community_intel"
  | "outbound_infra"
  | "other";

export type CompetitorEntry = {
  key: string;
  name: string;
  aliases: string[];
  category: CompetitorCategory;
  keywords: string[];
  linkedinCompanyUrls?: string[];
  // Ambiguous brand names (common English words) only match when capitalized
  // as a brand or when GTM context is present — avoids "clay pot" false positives.
  strict?: boolean;
};

export type CompetitorMatch = {
  key: string;
  name: string;
  matched_terms: string[];
  category: string;
};

const COMPETITORS: CompetitorEntry[] = [
  { key: "gojiberry", name: "GojiBerry", aliases: ["GojiBerry", "Goji Berry", "gojiberry.ai"], category: "ai_sdr", keywords: ["AI SDR", "outbound"] },
  { key: "clay", name: "Clay", aliases: ["Clay", "clay.com", "clay.run"], category: "gtm_data", keywords: ["GTM automation", "outbound", "data enrichment"], strict: true },
  { key: "artisan", name: "Artisan", aliases: ["Artisan", "Artisan AI", "artisan.co"], category: "ai_sdr", keywords: ["AI SDR", "Ava", "sales automation"] },
  { key: "unify", name: "Unify", aliases: ["Unify", "Unify GTM", "unifygtm.com"], category: "gtm_data", keywords: ["warm outbound", "intent", "GTM"], strict: true },
  { key: "apollo", name: "Apollo", aliases: ["Apollo", "Apollo.io"], category: "sales_engagement", keywords: ["outbound automation", "sales engagement", "prospecting"], strict: true },
  { key: "instantly", name: "Instantly", aliases: ["Instantly", "Instantly.ai"], category: "outbound_infra", keywords: ["cold email", "deliverability", "outbound"] },
  { key: "smartlead", name: "Smartlead", aliases: ["Smartlead", "Smartlead.ai"], category: "outbound_infra", keywords: ["cold email", "deliverability", "outbound"] },
  { key: "common_room", name: "Common Room", aliases: ["Common Room", "commonroom.io"], category: "community_intel", keywords: ["community intel", "signals", "GTM"] },
  { key: "elevenx", name: "11x", aliases: ["11x", "11x.ai", "Alice 11x"], category: "ai_sdr", keywords: ["AI SDR", "digital workers", "outbound"] },
  { key: "aisdr", name: "AiSDR", aliases: ["AiSDR", "aisdr.com"], category: "ai_sdr", keywords: ["AI SDR", "outbound", "sales automation"] },
  { key: "lavender", name: "Lavender", aliases: ["Lavender", "lavender.ai"], category: "sales_engagement", keywords: ["email coaching", "sales emails"], strict: true },
  { key: "salesforge", name: "Salesforge", aliases: ["Salesforge", "salesforge.ai"], category: "outbound_infra", keywords: ["cold email", "outbound", "deliverability"] },
  { key: "reply_io", name: "Reply.io", aliases: ["Reply.io", "Reply io"], category: "sales_engagement", keywords: ["sales engagement", "outbound", "sequences"] },
  { key: "lemlist", name: "Lemlist", aliases: ["Lemlist", "lemlist.com"], category: "outbound_infra", keywords: ["cold email", "outbound", "sequences"] },
  { key: "outreach", name: "Outreach", aliases: ["Outreach.io", "Outreach"], category: "sales_engagement", keywords: ["sales engagement", "sequences", "enterprise"], strict: true },
  { key: "salesloft", name: "Salesloft", aliases: ["Salesloft", "Sales Loft"], category: "sales_engagement", keywords: ["sales engagement", "cadence", "enterprise"] },
];

const CATEGORY_SUFFIX: Record<CompetitorCategory, string> = {
  ai_sdr: "AI SDR outbound",
  gtm_data: "GTM automation outbound",
  sales_engagement: "sales engagement outbound",
  community_intel: "community intel GTM",
  outbound_infra: "cold email deliverability outbound",
  other: "sales automation",
};

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function getCompetitors(): CompetitorEntry[] {
  return COMPETITORS.map((c) => ({ ...c, aliases: [...c.aliases], keywords: [...c.keywords] }));
}

/**
 * Find competitors mentioned in free text. Word-boundary, case-insensitive.
 * `strict` competitors (common English words) require either a capitalized
 * brand occurrence or GTM context in the text to avoid false positives.
 */
export function matchCompetitors(text: string): CompetitorMatch[] {
  if (!text || typeof text !== "string") return [];
  const out: CompetitorMatch[] = [];
  for (const c of COMPETITORS) {
    const matched: string[] = [];
    for (const alias of [c.name, ...c.aliases]) {
      const boundary = /[A-Za-z0-9]$/.test(alias) ? "\\b" : "";
      const ci = new RegExp(`\\b${escapeRe(alias)}${boundary}`, "i");
      if (!ci.test(text)) continue;
      if (c.strict) {
        // Ambiguous brand names (e.g. "Clay", "Apollo", "Outreach") match ONLY
        // when written in canonical brand case — avoids "draft outreach",
        // "clay pot", etc. (GTM context alone is NOT enough.)
        const cs = new RegExp(`\\b${escapeRe(alias)}${boundary}`); // case-sensitive
        if (cs.test(text)) matched.push(alias);
      } else {
        matched.push(alias);
      }
    }
    if (matched.length > 0) {
      out.push({ key: c.key, name: c.name, matched_terms: Array.from(new Set(matched)), category: c.category });
    }
  }
  return out;
}

/**
 * Build LinkedIn search queries for competitor tracking. One query per matched
 * competitor (name + category suffix), plus the user topic and a generic
 * comparison query. Deduped, capped.
 */
export function buildCompetitorSearchQueries(input: {
  competitors?: CompetitorMatch[] | string[] | null;
  topic?: string | null;
  query?: string | null;
  max?: number | null;
}): string[] {
  const cap = Math.max(1, Math.min(10, input.max ?? 6));
  const queries: string[] = [];
  const matches = (input.competitors ?? []) as Array<CompetitorMatch | string>;
  for (const m of matches) {
    const entry = typeof m === "string"
      ? COMPETITORS.find((c) => c.key === m || c.name.toLowerCase() === m.toLowerCase())
      : COMPETITORS.find((c) => c.key === m.key);
    if (!entry) continue;
    queries.push(`${entry.name} ${CATEGORY_SUFFIX[entry.category]}`.trim());
  }
  const topic = (input.topic ?? "").trim();
  if (topic) queries.push(topic);
  if (queries.length === 0) {
    // No specific competitor matched — generic competitor/AI-SDR tracking.
    queries.push("AI SDR tools comparison");
    if (input.query && input.query.trim()) queries.push(input.query.trim());
  }
  return Array.from(new Set(queries)).slice(0, cap);
}
