// CONTENT STUDIO — WHAT THE PAGE SHOWS ABOUT ONE DRAFT, DERIVED, NEVER STORED.
//
// Every field here is read from the canonical row — `content_item`, its
// `metadata.brief_input`, its versions and assets. Nothing is a second copy:
// the Studio is a view over the one Content object, and the actions it offers
// go through `contentService`, which is the only writer the page has.
//
// PURE and import-free apart from the shared types, so Deno tests read the same
// file the browser runs.

import {
  signalSubjectFrom, type ContentBriefFields, type SignalRelationship, type SignalSubject,
} from "../../../supabase/functions/_shared/contentInstruction.ts";

/** The minimum of a `content_item` the Studio reads. */
export interface StudioItem {
  id: string;
  status: string;
  format: string;
  title: string | null;
  body: string;
  source: string | null;
  source_type: string;
  source_signal_id: string | null;
  current_version_id: string | null;
  metadata: Record<string, unknown> | null;
}

export type StudioSourceKind = "idea" | "signal" | "legacy_signal" | "engagement_post";

export interface StudioSource {
  kind: StudioSourceKind;
  /** One line: what it came from. */
  label: string;
  /** The signal title, the idea text, or the post — whatever it was about. */
  about: string | null;
  /** Who it happened to, for anything that is not our own idea. */
  subject: SignalSubject | null;
  /** Where to verify it, when the row carries a link. */
  url: string | null;
  /** True only for a canonical signal: the one source with a real FK. */
  linked: boolean;
}

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
const obj = (v: unknown): Record<string, unknown> | null =>
  v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : null;

const RELATIONSHIP_LABEL: Record<SignalRelationship, string> = {
  competitor: "Competitor",
  external_company: "Another company",
  market: "Market trend",
  external: "External",
};

export function relationshipLabel(s: SignalSubject | null): string | null {
  if (!s) return null;
  const base = RELATIONSHIP_LABEL[s.relationship];
  return s.name ? `${base} · ${s.name}` : base;
}

/**
 * WHERE THIS DRAFT CAME FROM — truthfully, from the row.
 *
 * The four real origins, in the order the columns decide them: an engagement
 * comment carries the post it answers; a canonical signal has its FK; a legacy
 * signal has only provenance; anything else is the user's own idea.
 */
export function describeContentSource(
  item: StudioItem,
  /** The signal row itself, when the page has read it — it outranks what the row kept. */
  resolved?: { title: string | null; subject: SignalSubject } | null,
): StudioSource {
  const m = item.metadata ?? {};
  const input = obj(m.brief_input);
  const kept = resolved?.subject
    ?? (input ? obj(input.signalSubject) as unknown as SignalSubject | null : null);
  const post = obj(m.engagement_post);
  if (post) {
    const author = str(post.author);
    return {
      kind: "engagement_post",
      label: author ? `Comment on ${author}'s LinkedIn post` : "Comment on a LinkedIn post",
      about: str(input?.signalTitle) ?? null,
      subject: kept ?? { relationship: "external", name: author },
      url: str(post.post_url),
      linked: item.source_type === "signal" && !!item.source_signal_id,
    };
  }
  if (item.source_type === "signal" && item.source_signal_id) {
    return {
      kind: "signal",
      label: "Signal",
      about: resolved?.title ?? str(input?.signalTitle) ?? str(m.topic),
      subject: kept ?? { relationship: "external", name: null },
      url: null,
      linked: true,
    };
  }
  const legacy = obj(m.legacy_signal);
  if (legacy) {
    return {
      kind: "legacy_signal",
      label: "Earlier signal (not linked)",
      about: str(legacy.title),
      subject: kept ?? { relationship: "external", name: null },
      url: null,
      linked: false,
    };
  }
  return {
    kind: "idea",
    label: "Your idea",
    about: str(input?.idea) ?? str(m.topic) ?? str(item.title),
    subject: null,
    url: null,
    linked: false,
  };
}

/** The Studio's creative brief, as last saved. Never guessed from the copy. */
export function briefFieldsOf(item: StudioItem): Required<{ [K in keyof ContentBriefFields]: string }> {
  const f = obj(obj(item.metadata?.brief_input)?.fields) ?? {};
  return {
    audience: str(f.audience) ?? "",
    objective: str(f.objective) ?? "",
    angle: str(f.angle) ?? "",
    cta: str(f.cta) ?? "",
  };
}

/** The hook IS the draft's opening line — shown, not stored separately. */
export function deriveHook(body: string): string | null {
  const first = body.split("\n").map((l) => l.trim()).find((l) => l.length > 0);
  return first ? first.replace(/^[#>*\-\s]+/, "").slice(0, 220) : null;
}

export const CONTENT_TYPE_LABEL: Record<string, string> = {
  linkedin_post: "LinkedIn post",
  linkedin_comment: "LinkedIn comment",
};

export const STATUS_LABEL: Record<string, string> = {
  draft: "Draft",
  approved: "Approved",
  archived: "Archived",
};

/** What each version says produced it. */
export const GENERATION_LABEL: Record<string, string> = {
  manual_edit: "Edited by you",
  scribe_generation: "Written by Scribe",
  scribe_regeneration: "Rewritten by Scribe",
};

/**
 * WHICH ACTIONS ARE OFFERED, and why not when they are not.
 *
 * Regeneration is withheld while there is an unsaved edit: Scribe would write a
 * new version over text the user has not kept, and the edit would be lost
 * without ever becoming a version. An image needs copy to illustrate — the
 * server refuses an empty draft — so it is not offered on one.
 */
export function studioActions(i: {
  status: string; body: string; dirtyBody: boolean; dirtyBrief: boolean; assetCount: number; busy: boolean;
}) {
  const hasCopy = i.body.trim().length > 0;
  const archived = i.status === "archived";
  return {
    save: { enabled: !i.busy && (i.dirtyBody || i.dirtyBrief), reason: null as string | null },
    writeText: {
      label: hasCopy ? "Regenerate text" : "Draft with Scribe",
      enabled: !i.busy && !i.dirtyBody && !i.dirtyBrief && !archived,
      reason: i.dirtyBody
        ? "Save or discard your edit first — regenerating would replace it."
        : i.dirtyBrief ? "Save the brief first — Scribe writes from the saved brief." : null,
    },
    image: {
      label: i.assetCount > 0 ? "Regenerate image" : "Generate image",
      enabled: !i.busy && hasCopy && !archived,
      reason: hasCopy ? null : "Write the copy first — an image illustrates the draft.",
    },
    approve: { enabled: !i.busy && hasCopy && i.status === "draft" && !i.dirtyBody },
    archive: { enabled: !i.busy && !archived },
    restore: { enabled: !i.busy && archived },
  };
}

/** Re-exported so the page does not need a second import for the subject rule. */
export { signalSubjectFrom };

// ── SCRIBE, IN CONTEXT ──────────────────────────────────────────────────────
//
// The Scribe panel's actions are about THIS draft. Each text action is a typed
// revision request on the one generation path (`reviseContentText`): Scribe
// rewrites from the draft's stored brief plus the request, a new version is
// written, and the request is recorded on it. "Generate visual" is the image
// operation. None of them is a chat message thrown at Pilot.

export type ScribeActionId = "improve_hook" | "concise" | "change_angle" | "alternatives" | "visual";

export const SCRIBE_ACTIONS: ReadonlyArray<{ id: ScribeActionId; label: string; revision: string | null }> = [
  { id: "improve_hook", label: "Improve hook",
    revision: "Rewrite only the opening line into a sharper hook. Keep the rest of the draft as it is." },
  { id: "concise", label: "Make more concise",
    revision: "Make the draft more concise — cut roughly a third while keeping the point and the voice." },
  { id: "change_angle", label: "Change angle",
    revision: "Rewrite the draft from a clearly different angle than the current one, same facts." },
  { id: "alternatives", label: "Give 3 alternatives",
    revision: "Start with three alternative hooks labelled A, B and C, then the full draft using option A." },
  { id: "visual", label: "Generate visual", revision: null },
];

/** How a version reads in history — with what was asked, when it was a revision. */
export function versionLabel(v: { generation_source: string; prompt_context?: Record<string, unknown> | null }): string {
  const base = GENERATION_LABEL[v.generation_source] ?? v.generation_source;
  const ask = str(v.prompt_context?.revision);
  if (!ask) return base;
  const known = SCRIBE_ACTIONS.find((a) => a.revision === ask);
  return `${base} · ${known ? known.label : `“${ask.slice(0, 60)}${ask.length > 60 ? "…" : ""}”`}`;
}

// ── SOURCES ─────────────────────────────────────────────────────────────────
//
// A source card says what a person needs to decide — what it is, whose it is,
// why it matters, what angle to take, how relevant — and nothing else. Which
// agent found or ranked it is real provenance but not a decision input, so it
// lives behind "Why this?" instead of on every card.

export interface SourceSignalLike {
  id: string;
  title: string | null;
  signal_type?: string | null;
  signal_label?: string | null;
  description?: string | null;
  why_text?: string | null;
  reason?: string | null;
  next_action?: string | null;
  fit_score?: number | null;
  account_name?: string | null;
  competitor_name?: string | null;
  source?: string | null;
  source_url?: string | null;
  created_at?: string | null;
  quality_badge?: string | null;
  store?: "signal_events" | "signals";
  raw?: Record<string, unknown> | null;
}

export interface SourceCard {
  id: string;
  title: string;
  /** Whose it is — the company or competitor, when the row names one. */
  company: string | null;
  context: string | null;
  angle: string | null;
  /** 0–99, from the ranking. Null when nothing ranked it. */
  relevance: number | null;
  /** Relationship to us, from the row's own fields. */
  about: string | null;
  /** Provenance for "Why this?" — who found it, how it was ranked, where from. */
  why: string[];
}

export function sourceCardOf(s: SourceSignalLike): SourceCard {
  const raw = s.raw ?? {};
  const subject = signalSubjectFrom({
    subject_type: str(raw.subject_type), subject_key: str(raw.subject_key),
    signal_type: s.signal_type ?? null, company_name: str(raw.company_name),
    competitor_name: s.competitor_name ?? null, account_name: s.account_name ?? null,
  });
  const context = str(s.description) ?? str(s.why_text);
  const angle = str(s.reason) ?? str(s.next_action);
  const score = typeof s.fit_score === "number" && s.fit_score > 0 ? Math.min(99, Math.round(s.fit_score)) : null;
  const why = [
    str(raw.origin) ? `Collected by ${str(raw.origin)}` : null,
    str(s.signal_type) ? `Type: ${String(s.signal_type).replace(/_/g, " ")}` : null,
    score !== null ? `Ranked ${score}/99 against your ICP` : null,
    str(s.quality_badge),
    str(s.source) ? `Source: ${str(s.source)}` : null,
    s.store === "signals" ? "Earlier signal — drafted as an idea, not linked" : null,
    str(s.why_text) && str(s.why_text) !== context ? str(s.why_text) : null,
  ].filter((x): x is string => !!x);
  return {
    id: s.id,
    title: str(s.title) ?? "Untitled signal",
    company: subject.name,
    context: context && context !== angle ? context : context,
    angle: angle && angle !== context ? angle : null,
    relevance: score,
    about: relationshipLabel(subject),
    why,
  };
}

/** For You: the strongest few, by relevance, then recency. */
export function forYou<T extends SourceSignalLike>(signals: readonly T[], n = 5): T[] {
  return [...signals]
    .sort((a, b) => (b.fit_score ?? 0) - (a.fit_score ?? 0) || String(b.created_at ?? "").localeCompare(String(a.created_at ?? "")))
    .slice(0, n);
}

/**
 * The instruction for a Scribe revision: the draft's own brief first — so who
 * is writing and whose news it is never change — then the request, then the
 * draft it applies to. One generation path; this only composes its input.
 */
export function revisionInstruction(brief: string, revision: string, currentDraft: string): string {
  return [
    brief,
    "",
    "REVISION REQUEST — apply it to the current draft below. Keep who is writing and whose news it is exactly as stated above.",
    revision.trim(),
    "",
    "CURRENT DRAFT:",
    currentDraft.trim(),
  ].join("\n");
}
