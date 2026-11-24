// LISA V2 — RELEVANCE: why does this event matter to THIS customer?
//
// Deterministic and explainable: every point of the score is a reason a person
// can read. Inputs are the shared Company Brain context (the V1 loader — no
// second Brain parser) and the event. Exclusions are checked FIRST and end the
// evaluation. The Brain fingerprint the verdict was computed against is stored
// with it, so a later Brain change is detectable and the verdict is recomputed
// (or shown as outdated) rather than trusted forever.
//
// No model call. No business recommendation beyond a short, category-specific
// next step that never acts on its own.
//
// PURE.

import type { SharedBrainContext } from "../companyBrainContextLoader.ts";
import { matchExclusion } from "../brainMemoryModel.ts";
import type { LisaCategory, LisaSignal, Relevance, WatchSubject } from "./types.ts";

const lc = (s: string) => s.toLowerCase();
const US_STATES = ["alabama", "alaska", "arizona", "arkansas", "california", "colorado", "connecticut", "delaware", "florida", "georgia", "hawaii", "idaho", "illinois", "indiana", "iowa", "kansas", "kentucky", "louisiana", "maine", "maryland", "massachusetts", "michigan", "minnesota", "mississippi", "missouri", "montana", "nebraska", "nevada", "new hampshire", "new jersey", "new mexico", "new york", "north carolina", "north dakota", "ohio", "oklahoma", "oregon", "pennsylvania", "rhode island", "south carolina", "south dakota", "tennessee", "texas", "utah", "vermont", "virginia", "washington", "west virginia", "wisconsin", "wyoming"];
const US_ALIASES = ["united states", "usa", "u.s.", "us", "america"];

/** Does a place mentioned in the event fall inside one of the Brain's geographies? */
export function geographyMatch(place: string | null, geographies: string[]): string | null {
  if (!place || !geographies.length) return null;
  const p = lc(place);
  for (const g of geographies) {
    const gg = lc(g).trim();
    if (!gg) continue;
    if (p.includes(gg)) return g;
    if (US_ALIASES.includes(gg) && US_STATES.some((s) => new RegExp(`\\b${s}\\b`).test(p))) return g;
    if (gg === "nordics" && /\b(norway|sweden|denmark|finland|iceland|oslo|stockholm|copenhagen|helsinki)\b/.test(p)) return g;
    if (gg === "europe" && /\b(germany|france|spain|italy|netherlands|poland|ireland|uk|united kingdom|norway|sweden|denmark|finland)\b/.test(p)) return g;
  }
  return null;
}

function industryMatch(text: string, industries: string[]): string | null {
  const t = lc(text);
  for (const i of industries) {
    const root = lc(i).replace(/(ing|ers?|s)$/, "");
    if (root.length > 3 && t.includes(root)) return i;
  }
  return null;
}

const WEIGHT: Record<"competitor" | "company", Record<LisaCategory, number>> = {
  competitor: { funding: 25, product_launch: 25, expansion: 20, hiring: 10 },
  company: { expansion: 25, funding: 20, hiring: 15, product_launch: 10 },
};

function whyNow(s: LisaSignal, now: Date): string {
  const d = s.event_date;
  const age = d ? Math.round((now.getTime() - Date.parse(d)) / 86_400_000) : null;
  const when = age === null ? "recently (the source gives no date)" : age <= 1 ? "in the last day" : age <= 14 ? `${age} days ago` : `on ${d}`;
  const what: Record<LisaCategory, string> = {
    funding: "new capital usually means new hiring, spend and go-to-market pushes in the next quarters",
    expansion: "a new site means new suppliers, equipment and hiring decisions are being made now",
    product_launch: "a new offering changes how they compete and what buyers compare",
    hiring: "a hiring push shows where they are investing right now",
  };
  return `Announced ${when}: ${what[s.category]}.`;
}

function nextStep(s: LisaSignal): string {
  if (s.subject_type === "competitor") {
    return {
      funding: `Expect ${s.company_name} to push harder in your market — review your positioning against them and brief your team.`,
      product_launch: `Compare ${s.company_name}'s new offering with yours and update your talking points.`,
      expansion: `Check whether ${s.company_name}'s new location overlaps your target accounts.`,
      hiring: `Watch which teams ${s.company_name} is building; it hints at their next move.`,
    }[s.category];
  }
  return {
    expansion: `Research ${s.company_name} in Leads to see whether they fit your ICP (approval required before any spend).`,
    funding: `Consider ${s.company_name} as an account to research while budgets are being set.`,
    hiring: `Consider whether ${s.company_name}'s hiring creates a need you solve.`,
    product_launch: `Note ${s.company_name}'s launch; it may change what they buy.`,
  }[s.category];
}

export function evaluateRelevance(
  s: LisaSignal, brain: SharedBrainContext | null, watch: Pick<WatchSubject, "kind" | "origin">, now: Date,
): Relevance {
  const base = { why_now: whyNow(s, now), suggested_action: nextStep(s), brain_fingerprint: brain?.fingerprint ?? null, computed_at: now.toISOString() };
  const text = `${s.title} ${s.description} ${s.evidence.map((e) => e.excerpt).join(" ")}`;
  const place = typeof (s as unknown as { location?: string }).location === "string" ? (s as unknown as { location: string }).location : null;
  const location = place ?? (text.match(/\bin\s+([A-Z][A-Za-z.'-]+(?:[ ,]+[A-Z][A-Za-z.'-]+){0,3})/)?.[1] ?? null);

  // 1. Exclusions end the evaluation.
  if (brain) {
    const hit = matchExclusion(brain.exclusions, { name: s.company_name, domain: s.company_domain, industry: text, location });
    if (hit) {
      return { ...base, score: 0, band: "excluded", reasons: [`Excluded by your Company Brain (${hit})`], excluded_by: hit,
        why_it_matters: `You asked LISA to skip ${hit}.` };
    }
  }

  const reasons: string[] = [];
  let score = WEIGHT[s.subject_type][s.category];
  reasons.push(`${s.subject_type === "competitor" ? "Competitor" : "Company"} ${s.category.replace("_", " ")} (+${score})`);
  const matters: string[] = [];

  if (s.subject_type === "competitor" || watch.origin === "brain_competitor") {
    score += 20; reasons.push("A competitor in your Company Brain (+20)");
    matters.push(`${s.company_name} is a competitor you track`);
  }
  if (brain && brain.status !== "missing") {
    const ind = industryMatch(text, brain.canonical.target_customer.industries);
    if (ind) { score += 20; reasons.push(`Matches your target industry: ${ind} (+20)`); matters.push(`it is in ${ind}, an industry you sell to`); }
    const geo = geographyMatch(location, brain.canonical.target_customer.geography);
    if (geo) { score += 15; reasons.push(`In your target geography: ${geo} (+15)`); matters.push(`it is in ${geo}, where you sell`); }
    const goal = brain.goals.find((g) => g.text.split(/[^a-z0-9]+/i).some((w) => w.length >= 5 && lc(text).includes(lc(w))));
    if (goal) { score += 10; reasons.push(`Relates to your goal: ${goal.text.slice(0, 60)} (+10)`); matters.push(`it relates to your goal "${goal.text.slice(0, 60)}"`); }
  } else {
    reasons.push("No Company Brain: relevance to your business is not known");
  }

  if (s.event_date) {
    const age = (now.getTime() - Date.parse(s.event_date)) / 86_400_000;
    if (age <= 14) { score += 10; reasons.push("Happened in the last two weeks (+10)"); }
    else if (age <= 45) { score += 5; reasons.push("Happened in the last six weeks (+5)"); }
  }
  const v = s.verification.level;
  if (v === "corroborated") { score += 10; reasons.push("Corroborated by independent sources (+10)"); }
  else if (v === "self_reported") { score += 5; reasons.push("Announced by the company itself (+5)"); }
  else if (v === "single_source") { score -= 15; reasons.push("Only one independent source (−15)"); }
  else if (v === "contradicted") { score -= 40; reasons.push("Sources contradict each other (−40)"); }

  score = Math.max(0, Math.min(100, score));
  const band: Relevance["band"] = score >= 60 ? "high" : score >= 40 ? "medium" : "low";
  const why_it_matters = matters.length
    ? `Relevant because ${matters.join(", and ")}.`
    : brain && brain.status !== "missing"
      ? "No direct link to your ICP, goals or competitors was found."
      : "LISA cannot judge relevance without a Company Brain.";
  return { ...base, score, band, reasons, excluded_by: null, why_it_matters };
}
