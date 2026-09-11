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
