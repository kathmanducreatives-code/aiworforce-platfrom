// NEGATED REQUIREMENTS ARE ASKED ABOUT, NOT COMPILED (RC01, quality run 2026-10-06).
//
// RequestV1 can mark a FILTER as negated (`op: "not"`) but a REQUIREMENT has no
// polarity, and the projection dropped the filter's op. So the sentence was
// compiled as its opposite:
//
//   "outside the United States"          → a HARD United States requirement
//   "not currently hiring sales"         → a HARD hiring requirement
//   "have NOT raised venture funding"    → a funding target that ranked funded companies higher
//   "hiring sales roles but not engineering roles" → the exclusion dropped silently
//
// Carrying the exclusion instead is not yet possible: no evidence dimension
// answers an `exclusion` criterion (`checkCriterion` → unknown), so every
// company would stay PENDING forever, and the absence of a hiring posting or a
// funding round is not something any route proves. Until exclusions can be
// checked, a negated requirement is a QUESTION for the user — never a run that
// answers the opposite question.
//
// Pure. Reads the user's own sentence and the request's structure; no model.

import type { RequestV1 } from "./requestV1.ts";

export type NegatedKind = "geography" | "hiring" | "funding" | "filter";

export interface NegatedRequirement {
  kind: NegatedKind;
  /** The user's words that negate it. */
  phrase: string;
}

const W = String.raw`(?:[\w'’-]+\s+)`;
/** "not only …, but also" and "not just" are emphasis, never a negation. */
const NOT = String.raw`not\s+(?!only\b|just\b)`;
/** "outside the US", "headquartered outside the US", "not based in Germany", "excluding Canada", "except France". */
const NEGATED_LOCATION_RE =
  /\b(?:outside(?:\s+of)?|not\s+(?:based\s+|headquartered\s+|located\s+)?in|excluding|except(?:\s+for)?|other\s+than)\s+(?:the\s+)?[A-Z][\w.]*(?:\s+[A-Z][\w.]*){0,3}/;
const NEGATED_HIRING_RES = [
  // "not hiring", "NOT currently hiring sales", "aren't hiring", "no longer hiring"
  new RegExp(String.raw`\b(?:${NOT}|never\s+|no\s+longer\s+)${W}{0,2}(?:hiring|recruiting)\b|\b\w+n['’]t\s+${W}{0,2}(?:hiring|recruiting)\b`, "i"),
  // "no open sales roles", "no open jobs", "without open roles"
  new RegExp(String.raw`\b(?:no|without)\s+${W}{0,2}(?:open\s+)?${W}{0,2}(?:roles?|positions?|jobs?|openings?|job\s+postings?)\b`, "i"),
  // "…but not engineering roles"
  new RegExp(String.raw`\b${NOT}${W}{0,2}(?:roles?|positions?|jobs?|openings?)\b`, "i"),
];
const NEGATED_FUNDING_RES = [
  // "have not raised", "haven't raised", "never raised", "not funded", "not received venture funding"
  new RegExp(String.raw`\b(?:${NOT}|never\s+)${W}{0,2}(?:raised|funded|received\s+${W}{0,2}(?:funding|investment))\b|\b\w+n['’]t\s+${W}{0,2}(?:raised|been\s+funded|received\s+${W}{0,2}funding)\b`, "i"),
  // "no venture funding", "without funding", "no outside investment"
  new RegExp(String.raw`\b(?:no|without)\s+${W}{0,2}(?:funding|investment|financing|venture\s+capital)\b`, "i"),
];

/** Every requirement the request negates, from the sentence and from negated filters. */
export function negatedRequirements(request: Pick<RequestV1, "utterance" | "parts">): NegatedRequirement[] {
  const text = String(request.utterance ?? "");
  const out: NegatedRequirement[] = [];
  const add = (kind: NegatedKind, phrase: string) => {
    if (!out.some((n) => n.kind === kind)) out.push({ kind, phrase: phrase.trim().replace(/[.,;:!?]+$/, "") });
  };
  const loc = NEGATED_LOCATION_RE.exec(text);
  if (loc) add("geography", loc[0]);
  for (const re of NEGATED_HIRING_RES) { const m = re.exec(text); if (m) { add("hiring", m[0]); break; } }
  for (const re of NEGATED_FUNDING_RES) { const m = re.exec(text); if (m) { add("funding", m[0]); break; } }
  for (const part of request.parts ?? []) {
    for (const f of part.subject?.filters ?? []) {
      if (f.op !== "not") continue;
      const value = Array.isArray(f.value) ? f.value.map(String).join(", ") : String(f.value ?? "");
      add(f.field === "geography" ? "geography" : "filter", `not ${value}`);
    }
  }
  return out;
}

/** The clarifying question for a negated requirement — what can be done instead. */
export function negationQuestion(n: readonly NegatedRequirement[]): string {
  const first = n[0];
  const said = `You asked for "${first.phrase}".`;
  switch (first.kind) {
    case "geography":
      return `${said} I can require a location, but I can't exclude one yet. Which countries or regions should I search instead?`;
    case "hiring":
      return `${said} I can verify that a company has an open role, but not that it has none, so I can't filter on that yet. ` +
        `Should I drop that condition, or look for companies that are hiring instead?`;
    case "funding":
      return `${said} I can verify that a company raised a round, but not that it never did, so I can't filter on that yet. ` +
        `Should I drop that condition, or look for companies that did raise?`;
    default:
      return `${said} I can't exclude values yet, only require them. Which values should I search for instead?`;
  }
}
