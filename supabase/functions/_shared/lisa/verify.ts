// LISA V2 — DEDUPLICATION and VERIFICATION (pure, deterministic).
//
// DEDUPE IS BY EVENT, NOT BY COMPANY + CATEGORY. The previous canonical key
// (subject · type) made a competitor's Series B a "duplicate" of its Series A
// and silently dropped it. Here the key also carries the event's own identity:
//   funding        the round (series-b), else the amount + month
//   hiring         role family + location + quarter
//   expansion      facility + place
//   product_launch the product
// The same Series B reported by three outlets → ONE event with three evidence
// rows; Series A and Series B → two events. The key is a pure function of the
// observation, so retries and concurrent passes compute the same key and the
// database's unique (workspace_id, dedupe_key) does the rest.
//
// VERIFICATION NEVER COMES FROM A MODEL OR A PROVIDER LABEL. It is counted:
//   corroborated   ≥ 2 independent publishers (domains), no contradiction
//   self_reported  only the company's own site
//   single_source  one independent publisher
//   contradicted   any denial/retraction language, or sources disagree
// A provider returning a claim is "single_source" at best.
// Retraction language (retracts, cancelled, scrapped, false report) additionally
// marks the event `retracted`: it is never treated as current again.

import { slug } from "./extract.ts";
import type { LisaCategory, Observation, Verification } from "./types.ts";

export const SIGNAL_TYPE: Record<LisaCategory, { type: (o: Observation) => string; category: string }> = {
  funding: { type: () => "recent_funding", category: "growth" },
  hiring: { type: () => "growth_hiring", category: "growth" },
  expansion: { type: (o) => (o.attributes.location ? "geographic_expansion" : "market_expansion"), category: "growth" },
  product_launch: { type: () => "product_launch", category: "product" },
};

/** Days after the event date that a signal stays current. Older → lifecycle 'stale'. */
export const FRESH_DAYS: Record<LisaCategory, number> = { funding: 120, hiring: 60, expansion: 180, product_launch: 90 };

function monthOf(iso: string | null, fallback: string): string {
  return (iso ?? fallback).slice(0, 7);
}
function quarterOf(iso: string | null, fallback: string): string {
  const d = (iso ?? fallback).slice(0, 7);
  const q = Math.floor((Number(d.slice(5, 7)) - 1) / 3) + 1;
  return `${d.slice(0, 4)}q${q}`;
}

/**
 * A place as event identity: the first named segment only, so "Columbus, Ohio"
 * and "Columbus" are the same plant. (Two same-named cities in one category for
 * one company within one event window is accepted as a rare false merge; the
 * evidence rows keep both texts.)
 */
export function placeKey(loc: unknown, fallback: string): string {
  const s = typeof loc === "string" ? loc.split(",")[0].trim() : "";
  return slug(s || fallback);
}

/** The real-world event this observation describes, as a stable slug. */
export function eventInstance(o: Observation, discoveredAt: string): string {
  const a = o.attributes;
  switch (o.category) {
    case "funding":
      if (a.round) return String(a.round);
      if (typeof a.amount_usd_m === "number") return `usd-${Math.round(a.amount_usd_m)}m-${monthOf(o.event_date, discoveredAt)}`;
      return `undated-${monthOf(o.event_date, discoveredAt)}`;
    case "hiring":
      return `${a.role_family ?? "general"}-${placeKey(a.location, "any")}-${quarterOf(o.event_date, discoveredAt)}`;
    case "expansion":
      return `${slug(String(a.facility ?? "site"))}-${placeKey(a.location, "unspecified")}`;
    case "product_launch":
      return slug(String(a.product ?? "product"));
  }
}

export function subjectKeyFor(o: Observation): string {
  return slug(o.company_domain ?? o.company_name);
}

export function dedupeKeyFor(subjectType: string, subjectKey: string, signalType: string, instance: string): string {
  return `${subjectType}|${subjectKey}|${signalType}|${instance}`;
}

/** Stable per-source evidence identity (one row per source URL per event). */
export async function evidenceFingerprint(url: string): Promise<string> {
  const norm = url.trim().toLowerCase().replace(/[#?].*$/, "").replace(/\/+$/, "");
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(norm));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 40);
}

/** Verify one event from every observation of it (this pass + any stored evidence). */
export const RETRACTION_RE = /\b(retracts?|retracted|cancell?ed|cancels|scrapped|false report|withdrawn|withdraws)\b/i;

export function verify(observations: Array<Pick<Observation, "source_domain" | "source_type" | "negation" | "attributes" | "category">>): Verification {
  const independent = [...new Set(observations.filter((o) => o.source_type === "news" || o.source_type === "other").map((o) => o.source_domain))];
  const selfReported = observations.some((o) => o.source_type === "company_site");
  const contradictions: string[] = [];
  for (const o of observations) if (o.negation) contradictions.push(`${o.source_domain} says "${o.negation}"`);
  if (observations[0]?.category === "funding") {
    const amounts = observations.map((o) => o.attributes.amount_usd_m).filter((x): x is number => typeof x === "number");
    if (amounts.length >= 2) {
      const lo = Math.min(...amounts), hi = Math.max(...amounts);
      if (lo > 0 && (hi - lo) / lo > 0.25) contradictions.push(`sources disagree on the amount ($${lo}M vs $${hi}M)`);
    }
  }
  const sources = [...new Set(observations.map((o) => o.source_domain))].sort();
  const retracted = observations.some((o) => !!o.negation && RETRACTION_RE.test(o.negation));
  const n = independent.length;
  if (contradictions.length) {
    return { level: "contradicted", independent_sources: n, sources, contradictions, retracted, column_status: "unverified", confidence: "low" };
  }
  if (n >= 2) {
    return { level: "corroborated", independent_sources: n, sources, contradictions, retracted, column_status: "provider_verified", confidence: "high" };
  }
  if (selfReported) {
    return { level: "self_reported", independent_sources: n, sources, contradictions, retracted, column_status: "self_reported", confidence: n ? "high" : "medium" };
  }
  return { level: "single_source", independent_sources: n, sources, contradictions, retracted, column_status: "unverified", confidence: "low" };
}

/** Is an event dated `eventDate` still current at `now`? Undated events are current but not "fresh". */
export function isStale(category: LisaCategory, eventDate: string | null, now: Date): boolean {
  if (!eventDate) return false;
  const t = Date.parse(eventDate);
  return Number.isFinite(t) && (now.getTime() - t) / 86_400_000 > FRESH_DAYS[category];
}
