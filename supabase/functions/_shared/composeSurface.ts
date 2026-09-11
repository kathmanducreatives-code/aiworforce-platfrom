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
//   compose + a person, a held company pointed
//             back at, or a saved set of leads    -> outreach  (Penn, gated)
//   compose + anything with nobody to send it to  -> content   (Scribe)
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

/**
 * WHAT TO DO TO CONTENT. The typed alternative to reading the verb.
 *
 * Derived from the request's own structure — which medium was asked for, and
 * whether the message points at something already produced — never from the
 * words. "Regenerate that post", "rewrite it", "try again" and "do another
 * version" are one objective, and a keyword list would have to keep growing to
 * agree with that.
 *
 * `reference` is the honest outcome when a message is about existing content
 * without asking for new work: "what did that post say?". It resolves, and it
 * does not spend.
 */
export type ContentObjective =
  | "create"
  | "regenerate_text"
  | "generate_image"
  | "reference";

export interface ComposePlan {
  version: typeof COMPOSE_SURFACE_VERSION;
  kind: ComposeKind;
  /**
   * Present for `content` only. Null for outreach, which Penn owns and which
   * has no versions, assets or regeneration.
   */
  content_objective: ContentObjective | null;
  /** Text or a picture. Text whenever the request did not say otherwise. */
  medium: "text" | "image";
  /**
   * True when the message points at content that already exists — a
   * `prior_result` reference, or a subject that IS content rather than a topic.
   * The id itself is resolved by the caller against the workspace; this only
   * says an existing item is meant.
   */
  targets_existing_content: boolean;
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
  // ── A BACK-REFERENCE TO A POST IS NOT A REFERENCE TO LEADS ───────────────
  //
  // `pointsAtHeldEntities` tests the reference KIND, not what it points at, so
  // every `prior_result` counted as "leads we hold". That made "regenerate that
  // post" — content, subject `content`, referring back to something we wrote —
  // route to OUTREACH: Penn's approval-gated path, for a draft with no
  // recipient. The user asked to rewrite a post and hit the send-approval
  // machinery.
  //
  // The subject settles it. A back-reference whose subject IS content points at
  // a draft, never at a person to write to.
  const subjectIsContent = part.subject.entity === "content";
  // A `saved_set` IS A COLLECTION OF ENTITIES — "my leads", "the companies I'm
  // watching". It names people to write to whatever the subject says.
  const namesHeldCollection = (part.subject.references ?? []).some(
    (r) => r.kind === "saved_set");
  const refersBack = (part.subject.references ?? []).some((r) => r.kind === "prior_result");
  // ── ONLY SOMETHING THAT CAN RECEIVE A MESSAGE ────────────────────────────
  //
  // The test used to be "does this point back at anything we hold?", which made
  // every back-reference outreach. But a `signal` cannot receive outreach, and
  // neither can a `content` draft — "turn this signal into a LinkedIn post"
  // was classified as outreach and answered with "I don't have any leads saved
  // to write to yet."
  //
  // A person can be written to. A company is written to through its people —
  // but only a company WE HOLD, pointed back at: "draft outreach to the top 5".
  // A company merely named is a topic: "write a LinkedIn post about Stripe" has
  // nobody to send it to, and routing it to Penn would put a post behind the
  // send-approval gate. Nothing else can receive a message, so nothing else is
  // outreach.
  const canReceiveOutreach = part.subject.entity === "person"
    || (part.subject.entity === "company" && refersBack);
  const kind: ComposeKind =
    canReceiveOutreach || namesHeldCollection ? "outreach" : "content";

  // ── DOES THIS MESSAGE MEAN CONTENT WE ALREADY HAVE? ──────────────────────
  //
  // Two structural signals, both from the request rather than the sentence: a
  // back-reference to something we produced, or a subject that IS content.
  // "Write a post about X" has neither; "regenerate that post" has the first;
  // "make an image for this draft" has at least one of them.
  // ONLY A BACK-REFERENCE. `entity: "content"` says the OUTPUT is content — it
  // is equally true of "write me a LinkedIn post", which creates. Treating the
  // subject as proof that a draft already exists made every fresh request a
  // regeneration of whatever happened to be newest.
  // AND THE THING REFERRED BACK TO MUST BE CONTENT. "Turn this signal into a
  // post" refers back to a SIGNAL: it creates a draft, it does not regenerate
  // one. Only a back-reference whose subject is content points at a draft.
  const targets_existing_content = kind === "content" && refersBack && subjectIsContent;

  const medium: "text" | "image" = part.output.medium === "image" ? "image" : "text";

  // An image is always FOR something; asking for one without an existing draft
  // still means "illustrate what we are writing", so the caller creates the
  // draft first and then illustrates it. That sequencing belongs to the caller,
  // which holds the workspace — this only names the objective.
  const content_objective: ContentObjective | null = kind !== "content"
    ? null
    : medium === "image"
      ? "generate_image"
      : targets_existing_content
        ? "regenerate_text"
        : "create";

  return {
    version: COMPOSE_SURFACE_VERSION,
    kind,
    content_objective,
    medium,
    targets_existing_content,
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
