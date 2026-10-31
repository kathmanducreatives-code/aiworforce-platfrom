// The contract every provider adapter implements.
//
// An adapter builds requests and normalizes rows; it owns no budget, no
// approval and no persistence. The orchestrator calls it only inside an
// approved, budgeted step.

import type { PlanStep } from "./routing.ts";
import type { DiscoveryRequirements, FilterKey, ProviderCompany, ProviderId, ProviderPerson } from "./types.ts";

export interface SearchPage {
  companies: ProviderCompany[];
  people: ProviderPerson[];
  nextCursor: string | null;
  /** Credits the provider says this page cost (or the documented rule, when it does not say). */
  creditsCharged: number;
  /** Hard filters the provider reported it ignored for this query. */
  ignoredFilters: FilterKey[];
  total: number | null;
}

export interface UsageInfo {
  plan: string | null;
  used: number | null;
  limit: number | null;
  remaining: number | null;
  resetsAt: string | null;
  checkedAt: string;
  /** Capabilities the key or plan cannot use, found by free calls (e.g. "people_search: plan"). */
  restrictions?: string[];
  /** Key scopes the provider reports (LeadOcean: search, enrich). */
  scopes?: string[] | null;
}

export interface DiscoveryAdapter {
  provider: ProviderId;
  search(step: PlanStep, req: DiscoveryRequirements, cursor: string | null, limit: number): Promise<SearchPage>;
  /** A call that costs nothing and proves the key works. */
  verifyKey(): Promise<UsageInfo>;
}

export interface AdapterDeps {
  apiKey: string;
  fetch: import("./http.ts").FetchLike;
  sleep?: import("./http.ts").Sleep;
  now?: () => Date;
  baseUrl?: string;
}

/** First non-empty value at any of the dotted paths. */
export function pick(obj: unknown, paths: readonly string[]): unknown {
  for (const p of paths) {
    let cur: unknown = obj;
    for (const part of p.split(".")) {
      if (cur && typeof cur === "object") cur = (cur as Record<string, unknown>)[/^\d+$/.test(part) ? Number(part) : part];
      else { cur = undefined; break; }
    }
    if (cur !== undefined && cur !== null && cur !== "") return cur;
  }
  return null;
}

export const pickStr = (obj: unknown, paths: readonly string[]): string | null => {
  const v = pick(obj, paths);
  return typeof v === "string" && v.trim() ? v.trim() : typeof v === "number" ? String(v) : null;
};

export const pickNum = (obj: unknown, paths: readonly string[]): number | null => {
  const v = pick(obj, paths);
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v.replace(/[, ]/g, "")) : NaN;
  return Number.isFinite(n) ? n : null;
};

export const pickList = (obj: unknown, paths: readonly string[]): string[] | null => {
  const v = pick(obj, paths);
  if (Array.isArray(v)) { const l = v.filter((x): x is string => typeof x === "string" && !!x.trim()); return l.length ? l : null; }
  return typeof v === "string" && v.trim() ? [v.trim()] : null;
};

/** "51-200", "51 - 200", "10001+" → a range. */
export function parseRange(v: unknown): { min: number | null; max: number | null } | null {
  if (typeof v !== "string") return null;
  const m = v.replace(/,/g, "").match(/^\s*(\d+)\s*(?:-|–|to)\s*(\d+)\s*$/);
  if (m) return { min: Number(m[1]), max: Number(m[2]) };
  const plus = v.replace(/,/g, "").match(/^\s*(\d+)\s*\+\s*$/);
  return plus ? { min: Number(plus[1]), max: null } : null;
}

// ── Geography ───────────────────────────────────────────────────────────────

const COUNTRY_ALIASES: Record<string, string> = {
  "us": "united states", "usa": "united states", "u.s.": "united states", "u.s.a.": "united states",
  "united states of america": "united states", "america": "united states",
  "uk": "united kingdom", "u.k.": "united kingdom", "great britain": "united kingdom", "england": "united kingdom",
  "uae": "united arab emirates",
};
const COUNTRIES = new Set([
  "united states", "canada", "mexico", "united kingdom", "ireland", "germany", "france", "spain", "italy",
  "netherlands", "belgium", "switzerland", "austria", "sweden", "norway", "denmark", "finland", "poland",
  "portugal", "australia", "new zealand", "india", "nepal", "singapore", "japan", "china", "brazil",
  "argentina", "israel", "united arab emirates", "south africa",
]);
const US_STATES = new Set([
  "alabama", "alaska", "arizona", "arkansas", "california", "colorado", "connecticut", "delaware", "florida",
  "georgia", "hawaii", "idaho", "illinois", "indiana", "iowa", "kansas", "kentucky", "louisiana", "maine",
  "maryland", "massachusetts", "michigan", "minnesota", "mississippi", "missouri", "montana", "nebraska",
  "nevada", "new hampshire", "new jersey", "new mexico", "new york", "north carolina", "north dakota", "ohio",
  "oklahoma", "oregon", "pennsylvania", "rhode island", "south carolina", "south dakota", "tennessee", "texas",
  "utah", "vermont", "virginia", "washington", "west virginia", "wisconsin", "wyoming",
]);

export function normCountry(v: string | null | undefined): string | null {
  if (!v) return null;
  const t = v.trim().toLowerCase();
  return COUNTRY_ALIASES[t] ?? t;
}

export type GeoLevel = "country" | "us_state" | "place";
export function geoLevel(v: string): GeoLevel {
  const t = normCountry(v)!;
  if (COUNTRIES.has(t)) return "country";
  if (US_STATES.has(t)) return "us_state";
  return "place";
}
