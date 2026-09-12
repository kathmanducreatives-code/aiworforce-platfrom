// THE BRIEF SCRIBE IS GIVEN.
//
// The one place Content still produces an English sentence — and the difference
// from what it replaced matters: this is a PROMPT built from typed fields and
// stored on the row, not a chat command dispatched at Pilot and forgotten. A
// regeneration reads exactly this back, so the second draft answers the same
// question as the first.
//
// Company Brain is NOT pasted in here. `run-agent` already loads the workspace
// brain and renders it into Scribe's system prompt, so repeating it would both
// duplicate context and let this file drift from the real one.
//
// ── WHO IS WRITING, AND WHO IT HAPPENED TO ──────────────────────────────────
//
// Production, 2026-09-11: a draft made from the signal "Outreach February 2026
// Product Release: AI That Executes" opened "We just shipped…" and "Our February
// release…". Outreach is a competitor. The brief said only `write a post about
// this signal: "<title>"`, and with Company Brain describing an AI GTM product
// in the same prompt, the model resolved the ambiguity the natural way: a
// product release in a founder's post is the founder's own.
//
// The fix is not a phrase filter on the output. It is that the brief no longer
// leaves ownership to inference. Two roles, stated from typed fields:
//
//   AUTHOR    always us — the company the Company Brain describes.
//   SUBJECT   who the signal happened to, from the source row's own
//             relationship (`signal_events.subject_type`: competitor | company |
//             market). A signal is an observation of the outside world, so when
//             nothing says otherwise the subject is "someone other than us" —
//             never, by default, us.
//
// ── AND SCRIBE DECIDES WHAT TO MAKE ─────────────────────────────────────────
//
// The brief no longer asks the user to have made the creative decisions. It
// states the goal (or the signal), says what the Company Brain is for, and asks
// Scribe — as a content strategist — to decide the objective, audience,
// insight, angle, hook, FORMAT (text, carousel, meme, …), structure, visual
// direction and CTA, then return them as structured JSON (`contentFormats.ts`).
// A user's explicit choices ("Change format", an angle) arrive as OVERRIDES
// and are honoured; everything else is Scribe's call.
//
// PURE. No network, no React.

import {
  ARTIFACT_SHAPES, FORMAT_SPECS, formatPrior, formatsForSurface,
  type ContentFormatKind, type SourceRelationship,
} from "./contentFormats.ts";

export type InstructionFormat = "linkedin_post" | "linkedin_comment";
export type InstructionSource = "idea" | "signal";

/** How the thing the signal is about relates to us. */
export type SignalRelationship =
  /** A rival. Their launch is their launch. */
  | "competitor"
  /** A named company that is not us — a prospect, an account, anyone. */
  | "external_company"
  /** A trend across a market; nobody's release. */
  | "market"
  /** Not known, but a signal is never about us unless it says so. */
  | "external";

export interface SignalSubject {
  relationship: SignalRelationship;
  /** Their name, when the source row carries one. Never invented. */
  name: string | null;
}

/** The Studio's creative brief. Every field optional; none is inferred. */
export interface ContentBriefFields {
  audience?: string | null;
  objective?: string | null;
  angle?: string | null;
  cta?: string | null;
}

/** A recent market signal offered as context — somebody else's news, always. */
export interface MarketContextSignal {
  title: string;
  relationship: SignalRelationship;
  name: string | null;
}

export interface InstructionInput {
  /** The SURFACE: a post or a reply. The shape within it is Scribe's decision. */
  format: InstructionFormat;
  sourceType: InstructionSource;
  /** The user's own words. Required for an idea, optional angle for a signal. */
  idea: string;
  signalTitle: string | null;
  /** Who a signal happened to. Absent on a signal means `external`, never us. */
  signalSubject?: SignalSubject | null;
  /** The user's explicit creative choices. Overrides; never required. */
  fields?: ContentBriefFields | null;
  /** "Change format": the one shape to produce. Absent or `auto` ⇒ Scribe decides. */
  contentFormat?: ContentFormatKind | "auto" | null;
  /** "Use current market signals": recent signals Scribe may draw on. */
  marketSignals?: MarketContextSignal[] | null;
  /** "Use Company Brain". Absent ⇒ on. Off ⇒ only who is writing is used. */
  useCompanyBrain?: boolean | null;
}

const WHAT: Record<InstructionFormat, string> = {
  linkedin_post: "a LinkedIn post",
  linkedin_comment: "a LinkedIn comment",
};

/** The signal types that are, by what they record, about a competitor. */
const COMPETITOR_SIGNAL_TYPES: ReadonlySet<string> = new Set([
  "competitor", "competitor_activity", "competitor_engagement",
]);

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

/** `outreach` -> `Outreach`, `acme-io` -> `Acme`. Only for a key that IS a name. */
function nameFromKey(key: string | null): string | null {
  if (!key) return null;
  const base = key.replace(/-(com|io|ai|co|net|org)$/i, "").replace(/[-_]+/g, " ").trim();
  if (!base) return null;
  return base.replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * WHO THE SIGNAL HAPPENED TO, from the row's own relationship fields.
 *
 * Reads the vocabulary the stores already have — `subject_type`/`subject_key`
 * on `signal_events`, `signal_type` on either table, and the competitor/company
 * names the projections carry. It never reads the signal's prose.
 */
export function signalSubjectFrom(src: {
  subject_type?: string | null;
  subject_key?: string | null;
  signal_type?: string | null;
  company_name?: string | null;
  competitor_name?: string | null;
  account_name?: string | null;
}): SignalSubject {
  const subjectType = str(src.subject_type)?.toLowerCase() ?? null;
  const signalType = str(src.signal_type)?.toLowerCase() ?? null;
  const key = subjectType === "market" ? null : str(src.subject_key);
  // A projection may pass the subject KEY through as a name ("outreach"). A key
  // is an identifier, not how the company writes its name, so it is rendered
  // from the key; a real display name is used exactly as given.
  const display = (v: unknown): string | null => {
    const s = str(v);
    if (!s) return null;
    return key && s.toLowerCase() === key.toLowerCase() ? nameFromKey(key) : s;
  };

  if (subjectType === "competitor" || (signalType && COMPETITOR_SIGNAL_TYPES.has(signalType))
    || str(src.competitor_name)) {
    return {
      relationship: "competitor",
      name: display(src.competitor_name) ?? display(src.company_name) ?? nameFromKey(key),
    };
  }
  if (subjectType === "market") return { relationship: "market", name: null };
  if (subjectType === "company" || str(src.company_name) || str(src.account_name)) {
    return {
      relationship: "external_company",
      name: display(src.company_name) ?? display(src.account_name) ?? nameFromKey(key),
    };
  }
  return { relationship: "external", name: null };
}

/** The ownership lines for a signal. The reason the brief exists in this form. */
function sourceBlock(title: string | null, subject: SignalSubject): string[] {
  const whoLine: Record<SignalRelationship, string> = {
    competitor: `${subject.name ?? "A competitor"} — a competitor of ours, not us.`,
    external_company: `${subject.name ?? "Another company"} — not us.`,
    market: "No single company — this is a market-wide trend, and not our news.",
    external: "Someone other than us.",
  };
  const rule = subject.relationship === "market"
    ? "Do not present it as something we did or launched. Give our point of view on the trend."
    : `This is ${subject.name ? `${subject.name}'s` : "their"} news, not ours. Do not write as though we did it — ` +
      `never claim their launch, release, funding or hire as our own ("we shipped", "our release", "we launched"). ` +
      `Give our point of view on what happened to them.`;
  return [
    "THE SOURCE — what happened, and who it happened to:",
    `- What happened: ${title ? `"${title}"` : "the selected signal"}`,
    `- Who it happened to: ${whoLine[subject.relationship]}`,
    `- ${rule}`,
  ];
}

function fieldLines(f: ContentBriefFields | null | undefined, angleFromIdea: string | null): string[] {
  const out: string[] = [];
  const angle = str(f?.angle) ?? angleFromIdea;
  if (angle) out.push(`Angle: ${angle}`);
  if (str(f?.audience)) out.push(`Audience: ${str(f?.audience)}`);
  if (str(f?.objective)) out.push(`Objective: ${str(f?.objective)}`);
  if (str(f?.cta)) out.push(`Call to action: ${str(f?.cta)}`);
  return out;
}

const RELATIONSHIP_OF: Record<SignalRelationship, SourceRelationship> = {
  competitor: "competitor", external_company: "external_company", market: "market", external: "external",
};

function marketContextLines(signals: MarketContextSignal[] | null | undefined): string[] {
  const list = (signals ?? []).filter((m) => str(m.title)).slice(0, 5);
  if (!list.length) return [];
  const who: Record<SignalRelationship, (n: string | null) => string> = {
    competitor: (n) => `${n ?? "a competitor"} (competitor)`,
    external_company: (n) => n ?? "another company",
    market: () => "market-wide",
    external: () => "someone other than us",
  };
  return [
    "",
    "MARKET CONTEXT — recent signals you may draw on. Every one is somebody else's news, never ours:",
    ...list.map((m) => `- "${m.title.trim()}" — ${who[m.relationship](m.name)}`),
    "Use one only if it genuinely sharpens the point; never force it in.",
  ];
}

/**
 * THE STRATEGIST'S BRIEF, after the source: what to decide and what to return.
 * Separated from the source lines on purpose — the attribution above is the
 * part that must never change, and this is the part that will.
 */
function decisionBlock(i: InstructionInput, aboutSignal: boolean): string[] {
  const surface = i.format === "linkedin_comment" ? "linkedin_comment" : "linkedin_post";
  const allowed = formatsForSurface(surface);
  const forced = i.contentFormat && i.contentFormat !== "auto" && allowed.includes(i.contentFormat)
    ? i.contentFormat : (surface === "linkedin_comment" ? "comment" as const : null);
  const useBrain = i.useCompanyBrain !== false;
  const relationship: SourceRelationship = aboutSignal
    ? RELATIONSHIP_OF[(i.signalSubject ?? { relationship: "external" as const }).relationship]
    : "none";

  const formatLines = forced
    ? [`FORMAT: ${FORMAT_SPECS[forced].label} — fixed${surface === "linkedin_comment" ? " (this is a reply to a post)" : " by the user"}. Produce exactly this format.`]
    : (() => {
      const prior = formatPrior({ goal: i.idea, signalTitle: i.signalTitle, relationship });
      return [
        "FORMAT — choose the one that best serves the point, and say why:",
        ...allowed.map((f) => `- ${f}: ${FORMAT_SPECS[f].label}. ${FORMAT_SPECS[f].use_when}`),
        `First read: this leans toward "${prior.format}" (${prior.reason}). Choose it only if it truly serves the point.`,
      ];
    })();

  return [
    "",
    "YOU ARE THE CONTENT STRATEGIST. Decide what this should be before writing it.",
    useBrain
      ? "- COMPANY BRAIN (in your context) = who we are and what we believe: what we sell, to whom, their pains, our differentiation, our voice and the claims we can make. Use it."
      : "- The user switched the Company Brain off for this draft: use only who is writing, nothing else from it.",
    aboutSignal
      ? "- THE SOURCE (above) = what happened in the market. Keep it semantically separate from the Company Brain: combine them into our point of view on their news."
      : "- THE GOAL (above) = what we want to talk about.",
    "- Decide: objective, audience, core insight, angle, hook, format, structure, visual direction, CTA.",
    "- Only make claims the Company Brain supports. Never invent customers, numbers or results.",
    ...marketContextLines(i.marketSignals),
    "",
    ...formatLines,
    "",
    "RETURN ONLY ONE JSON OBJECT — no prose, no markdown fences:",
    `{"strategy":{"content_format":"…","format_reason":"one sentence","objective":"…","audience":"…","source":"…",` +
      `"source_owner":"…|null","relationship_to_company":"${relationship}","core_insight":"…","angle":"…","hook":"…",` +
      `"visual_direction":"…|null","cta":"…|null"},"artifact":<the artifact for that format>}`,
    "Artifact shapes:",
    ...(forced ? [forced] : allowed).map((f) => `- ${f}: ${ARTIFACT_SHAPES[f]}`),
  ];
}

/**
 * DRAFT ONLY, every time. The product is approval-first and nothing here can
 * publish, so the instruction says so rather than leaving it implied.
 */
export function buildContentInstruction(i: InstructionInput): string {
  const what = WHAT[i.format] ?? "a LinkedIn post";
  const idea = i.idea.trim();
  const author = "WHO IS WRITING: us — the company described in the Company Brain, in our founder's voice.";

  // ABOUT A SIGNAL whenever it is one — including a LEGACY signal, which is
  // stored as `source_type = 'idea'` only because it has no FK target. The FK
  // column is not what makes a competitor's launch theirs; the signal is.
  const aboutSignal = i.sourceType === "signal" || !!i.signalSubject;
  if (aboutSignal) {
    const title = i.signalTitle?.trim() || null;
    const subject = i.signalSubject ?? { relationship: "external" as const, name: null };
    return [
      `Scribe, write ${what}. Draft only.`,
      "",
      author,
      "",
      ...sourceBlock(title, subject),
      ...(() => { const l = fieldLines(i.fields, idea || null); return l.length ? ["", "YOUR CHOICES (the user's — honour them):", ...l] : []; })(),
      ...decisionBlock(i, true),
    ].join("\n");
  }
  return [
    `Scribe, write ${what} about: ${idea}. Draft only.`,
    "",
    author,
    ...(() => { const l = fieldLines(i.fields, null); return l.length ? ["", "YOUR CHOICES (the user's — honour them):", ...l] : []; })(),
    ...decisionBlock(i, false),
  ].join("\n");
}
