// WRITING SOMETHING — AND WHO IT IS FOR.
//
// ── THE DEFECT THIS FIXES ──────────────────────────────────────────────────
//
// `compose` was absent from the router's `SERVABLE` set, so every request to
// write anything returned "I understood that as a content request. Content
// generation isn't wired up yet, so I can't produce it."
//
// It IS wired up. Two working surfaces sit below that refusal: Penn drafts
// approval-gated outreach against remembered leads, and Scribe writes posts and
// reports. The refusal returns from the Chat Brain block, before either is
// reached — so making Chat Brain authoritative silently disabled two features
// that had worked for months. The same shape as the URL defect: understanding
// the request correctly is what stopped it being served.
//
// ── THE ONE DISTINCTION THIS SURFACE OWNS ──────────────────────────────────
//
// Writing a POST and writing a MESSAGE TO SOMEONE are different work with
// different safety rules. Outreach is approval-gated and must never be sent
// without a person's say-so; a blog post is not. So the split is made here,
// from the request, and it is made on WHO the writing is aimed at rather than
// on the words used:
//
//   compose + a person, or a reference to leads   -> outreach  (Penn, gated)
//   compose + content and nobody to send it to    -> content   (Scribe)
//
// `draftOutreachRe` used to make this call — /\b(draft|write|send)\s+
// (outreach|emails?|messages?)\b/ over the raw sentence — which meant "write
// something for my prospects" was content and "send messages" with no leads in
// memory was outreach. The audience decides, not the verb.
//
// Pure. No network, no database, no model.

import type { RequestV1, RequestPart } from "./requestV1.ts";

export const COMPOSE_SURFACE_VERSION = "compose-surface-v1" as const;

/** Who the writing is for. */
export type ComposeKind =
  /** A message aimed at people we hold. Approval-gated, always. */
  | "outreach"
  /** A post, brief or report. No recipient, no approval gate. */
  | "content";

export interface ComposePlan {
  version: typeof COMPOSE_SURFACE_VERSION;
  kind: ComposeKind;
  /** How many pieces or recipients the request named, or null. */
  count: number | null;
  /**
   * True when the request points at leads already produced — "these", "the top
   * 5", "my saved leads". Outreach against nothing is not a draft, it is a
   * question about who to write to.
   */
  targets_existing: boolean;
  part_id: string;
}

/** Does this part point at entities the workspace already holds? */
function pointsAtHeldEntities(part: RequestPart): boolean {
  return (part.subject.references ?? []).some(
    (r) => r.kind === "prior_result" || r.kind === "saved_set");
}

/**
 * What would this request write, and for whom?
 *
 * Pure and total. Returns null when no part asks for anything to be written,
 * which the router reads as "not a compose request" rather than as an error.
 */
export function planCompose(request: RequestV1): ComposePlan | null {
  const part: RequestPart | undefined = request.parts.find(
    (p) => p.objective === "compose");
  if (!part) return null;

  const targets_existing = pointsAtHeldEntities(part);
  // A PERSON IS A RECIPIENT. Writing aimed at people — or at leads we already
  // hold — is outreach, and outreach is approval-gated wherever it is served.
  const kind: ComposeKind =
    part.subject.entity === "person" || targets_existing ? "outreach" : "content";

  return {
    version: COMPOSE_SURFACE_VERSION,
    kind,
    count: typeof part.output.count === "number" && part.output.count > 0
      ? part.output.count : null,
    targets_existing,
    part_id: part.id,
  };
}

/**
 * What to say when outreach is asked for and there is nobody to write to.
 *
 * ONE COPY, reached from the route and from the legacy follow-up handler, so a
 * user cannot get two different explanations of the same empty memory.
 */
export const OUTREACH_WITHOUT_LEADS =
  "I don't have any leads saved in this conversation to write to yet. Source some first — for example \"find 10 companies hiring GTM roles in the US\" — and I'll keep the results so you can draft outreach against them next. Nothing is ever sent without your approval.";
