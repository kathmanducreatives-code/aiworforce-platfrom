// COMPANY BRAIN V2 · B2.3 — ORION notices a lasting business preference or
// decision in conversation and OFFERS to remember it. It never remembers on its own.
//
//   lasting     "From now on, never target gambling companies."
//               "We've decided to focus on dental clinics."
//               → a PENDING proposal (agent 'orion'), shown in the chat and the
//                 review queue. Only a person's approval makes it memory.
//   temporary   "For this search, skip gambling."  "Just this week, only UK."
//               → nothing is stored; ORION says it applies to this request only.
//   neither     questions, hypotheticals, anything it cannot read precisely
//               → no offer. Silence beats a wrong memory.
//
// Deterministic (no model call, no spend) and conservative: only statements it
// can turn into an exact memory item are offered, built with the same shared
// builders the Brain page uses, so an offer and a hand-added preference for the
// same thing land on the same key. Pure.
import {
  companySizeItem, decisionItem, exclusionItem, restrictionItem, toneItem, type ItemPayload,
} from "./brainMemoryPayloads.ts";
import { normalizeCompanyBrain } from "./normalizeCompanyBrain.ts";

export type MemoryOffer =
  | { kind: "lasting"; item: ItemPayload; summary: string; what: "exclusion" | "company_size" | "tone" | "restriction" | "decision" }
  | { kind: "temporary"; summary: string };

// "from now on" and friends make a statement standing policy even next to a time word.
const STRONG = /\b(from now on|going forward|moving forward|permanently|as a (rule|policy)|our (policy|rule) is|we(?:'ve| have)? decided|from today on|we(?:'re| are) (?:now )?(?:focusing|going to focus|concentrating) on)\b/i;
const LASTING = /\b(always|never|no longer|stop (targeting|contacting|prospecting|including|recommending)|don'?t ever|do not ever|in (the )?future)\b/i;
const TEMPORARY = /\b(for (this|that|the) (search|list|run|campaign|request|one|batch|week|month|time|call|report)|this (time|week|month|search|run|list|campaign|once)|just (this|for (now|today|this))|for now|for today|today only|right now|temporarily|one[- ]off|only (today|this week|this time))\b/i;
const DIRECTIVE = /\b(exclude|skip|avoid|never|don'?t|do not|only|stop|focus|leave out|ignore|remove)\b/i;
const QUESTION = /\?\s*$|^\s*(what|should|could|can|would|do|does|did|is|are|why|how|when|which|who|if)\b/i;

const REGIONS = new Set([
  "europe", "eu", "asia", "africa", "north america", "south america", "latin america", "latam", "emea", "apac", "middle east", "oceania",
  "usa", "us", "united states", "uk", "united kingdom", "canada", "mexico", "brazil", "argentina", "germany", "france", "spain", "italy",
  "portugal", "netherlands", "belgium", "switzerland", "austria", "ireland", "poland", "sweden", "norway", "denmark", "finland", "russia",
  "ukraine", "turkey", "india", "china", "japan", "south korea", "korea", "singapore", "australia", "new zealand", "israel", "uae",
  "saudi arabia", "nigeria", "south africa", "egypt", "kenya", "indonesia", "vietnam", "thailand", "philippines", "malaysia", "pakistan",
  "nepal", "bangladesh", "sri lanka", "iran", "north korea", "belarus", "cuba", "syria", "venezuela",
]);
const VAGUE = /^(them|it|that|this|those|these|him|her|anyone|anybody|everyone|people|companies|leads|anything|stuff|things?)$/i;

const tidy = (s: string) => s.replace(/\s+/g, " ").replace(/^["'“”‘’]+|["'“”‘’.,;:!]+$/g, "").trim();
const title = (s: string) => s.replace(/\b([a-z])/g, (m) => m.toUpperCase());
const sentence = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);

function classifyExclusion(raw: string): ItemPayload | null {
  let x = tidy(raw)
    .replace(/^(any|all|the)\s+/i, "")
    .replace(/^(companies|businesses|firms|leads|prospects|accounts|anyone|people)\s+(in|from|based in|located in)\s+(the\s+)?/i, "")
    .replace(/\s+(companies|businesses|firms|industry|sector|space|vertical|market|leads|prospects|accounts)$/i, "")
    .replace(/\s+(again|anymore|any more|ever)$/i, "");
  x = tidy(x);
  if (!x || x.length > 60 || x.split(" ").length > 5 || VAGUE.test(x)) return null;
  if (/^(?:https?:\/\/)?(?:www\.)?[a-z0-9-]+(\.[a-z0-9-]+)+\/?$/i.test(x)) return exclusionItem("company", x.toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/$/, ""));
  if (REGIONS.has(x.toLowerCase())) return exclusionItem("geography", x.length <= 3 ? x.toUpperCase() : title(x));
  return exclusionItem("industry", title(x));
}

/** What, if anything, ORION should offer to remember from one user message. */
export function detectMemoryOffer(message: string): MemoryOffer | null {
  const text = (message ?? "").trim();
  if (!text || text.length > 600 || QUESTION.test(text)) return null;
  const strong = STRONG.test(text);
  const lasting = strong || LASTING.test(text);
  if (TEMPORARY.test(text) && !strong) {
    return DIRECTIVE.test(text)
      ? { kind: "temporary", summary: "Applied to this request only. It is not saved to your Company Brain. Say “from now on…” if it should always apply." }
      : null;
  }
  if (!lasting) return null;

  // 1. Company size: "only target companies with 10-50 employees".
  const size = text.match(/(\d[\d,]*)\s*(?:-|–|to)\s*(\d[\d,]*)\s*(?:employees|people|staff|person|headcount)/i)
    ?? text.match(/(\d[\d,]*)\s*\+\s*(?:employees|people|staff)/i);
  if (size && /\b(only|target|focus|companies|businesses|between)\b/i.test(text)) {
    const min = Number(size[1].replace(/,/g, "")); const max = size[2] ? Number(size[2].replace(/,/g, "")) : null;
    if (Number.isFinite(min) && (max === null || max >= min)) {
      return { kind: "lasting", what: "company_size", item: companySizeItem(min, max),
        summary: `Target companies with ${max === null ? `${min}+` : `${min}–${max}`} employees` };
    }
  }
  // 2. Content restriction: "never mention pricing" (before exclusions: "never …" is generic).
  const restrict = text.match(/\b(?:never|don'?t ever|do not ever|don'?t|do not|stop)\s+(?:mention|say|talk about|reference|bring up|promise|claim)\s+((?:[^.;!\n]|\.(?=\w))+)/i);
  if (restrict) {
    const what = tidy(restrict[1]);
    if (what && what.length <= 120 && !VAGUE.test(what)) {
      const rule = `Never mention ${what}`;
      return { kind: "lasting", what: "restriction", item: restrictionItem(rule), summary: rule };
    }
  }
  // 3. Tone: "our tone should always be plain and technical".
  const tone = text.match(/\b(?:our|the|your)\s+(?:tone|voice|writing style)\s+(?:should|must|will|has to)\s+(?:always\s+)?(?:be|sound)\s+((?:[^.;!\n]|\.(?=\w))+)/i)
    ?? text.match(/\balways\s+(?:write|sound)\s+((?:[^.;!\n]|\.(?=\w))+)/i);
  if (tone) {
    const t = tidy(tone[1]);
    if (t && t.length <= 120) return { kind: "lasting", what: "tone", item: toneItem(t), summary: `Content tone: ${t}` };
  }
  // 4. Exclusions: "never target gambling companies", "stop contacting companies in Russia".
  const ex = text.match(/\b(?:never|don'?t ever|do not ever|don'?t|do not|stop|no longer|exclude|avoid)\s+(?:ever\s+)?(?:target(?:ing)?|contact(?:ing)?|prospect(?:ing)?|includ(?:e|ing)|reach(?:ing)? out to|go(?:ing)? after|recommend(?:ing)?|sell(?:ing)? to|work(?:ing)? with|exclud(?:e|ing)|avoid(?:ing)?)?\s*((?:[^.;!\n]|\.(?=\w))+)/i);
  if (ex) {
    const item = classifyExclusion(ex[1]);
    if (item) {
      const v = item.value as { type: string; value: string };
      const summary = v.type === "industry" ? `Never target the ${v.value} industry`
        : v.type === "geography" ? `Never target companies in ${v.value}`
        : `Never target ${v.value}`;
      return { kind: "lasting", what: "exclusion", item, summary };
    }
  }
  // 5. A standing business decision: "we've decided to focus on dental clinics",
  //    "we're now focusing on dental clinics".
  const decided = text.match(/\bwe(?:'ve| have)?\s+decided\s+(?:to\s+|that\s+(?:we(?:'ll| will)\s+)?)?((?:[^.;!\n]|\.(?=\w))+)/i);
  const focusing = text.match(/\bwe(?:'re| are)\s+(?:now\s+)?(?:going to\s+)?(?:focus(?:ing)?|concentrat(?:e|ing))\s+on\s+((?:[^.;!\n]|\.(?=\w))+)/i);
  const outcome = decided ? sentence(tidy(decided[1])) : focusing ? `Focus on ${tidy(focusing[1])}` : "";
  if (outcome.length >= 4 && outcome.length <= 300) {
    return { kind: "lasting", what: "decision", item: decisionItem(outcome, "strategy_selected"), summary: outcome };
  }
  return null;
}

/**
 * Where an offered item disagrees with the business profile, in words a person
 * reads before approving. Remembering it changes what agents read, so the
 * disagreement must be resolved on purpose, never silently.
 */
export function profileConflictForItem(profile: Record<string, unknown> | null | undefined, item: Pick<ItemPayload, "fact_key" | "value">): string | null {
  if (!profile) return null;
  const b = normalizeCompanyBrain(profile);
  const lc = (s: string) => s.trim().toLowerCase();
  const v = item.value as Record<string, unknown> | string | null;
  if (item.fact_key.startsWith("exclusion.industry:") && v && typeof v === "object") {
    const name = String(v.value ?? "");
    if (b.target_customer.industries.some((i) => lc(i) === lc(name))) return `${name} is one of your target industries. Excluding it removes it from what agents target.`;
  }
  if (item.fact_key.startsWith("exclusion.geography:") && v && typeof v === "object") {
    const name = String(v.value ?? "");
    if (b.target_customer.geography.some((g) => lc(g) === lc(name))) return `${name} is in your target geography. Excluding it removes it from what agents target.`;
  }
  if (item.fact_key === "icp.company_size" && v && typeof v === "object") {
    const cur = b.target_customer.company_size;
    const min = v.min as number | null, max = v.max as number | null;
    if ((cur.min != null || cur.max != null) && (cur.min !== min || cur.max !== max)) {
      return `Your Company Brain targets ${cur.min ?? "…"}–${cur.max ?? "…"} employees. Remembering ${min ?? "…"}–${max ?? "…"} replaces it for agents.`;
    }
  }
  if (item.fact_key === "content.tone" && typeof v === "string") {
    const cur = b.brand_voice.tone;
    if (cur && lc(cur) !== lc(v)) return `Your brand voice says “${cur}”. Remembering “${v}” replaces it for content.`;
  }
  return null;
}
