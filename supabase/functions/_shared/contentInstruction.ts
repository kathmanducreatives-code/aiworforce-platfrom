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
// PURE. No network, no React.

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

export interface InstructionInput {
  format: InstructionFormat;
  sourceType: InstructionSource;
  /** The user's own words. Required for an idea, optional angle for a signal. */
  idea: string;
  signalTitle: string | null;
  /** Who a signal happened to. Absent on a signal means `external`, never us. */
  signalSubject?: SignalSubject | null;
  fields?: ContentBriefFields | null;
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
      ...(() => { const l = fieldLines(i.fields, idea || null); return l.length ? ["", ...l] : []; })(),
    ].join("\n");
  }
  return [
    `Scribe, write ${what} about: ${idea}. Draft only.`,
    "",
    author,
    ...(() => { const l = fieldLines(i.fields, null); return l.length ? ["", ...l] : []; })(),
  ].join("\n");
}
