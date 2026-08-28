// THREE KINDS OF WORK THAT SHARED ONE NAME.
//
// ── WHY THIS CATEGORY NEEDED EIGHT FIELDS TO EXPLAIN ITSELF ────────────────
//
// `signal_sourcing` carried `signal_type`, `keywords`, `competitors`,
// `competitor_discovery`, `discovery_mode`, `business_website`,
// `business_description` and `extract_commenters` — a third of everything
// `WorkflowDecision` held. A category needing eight booleans and strings to say
// which of itself it means is not one category.
//
// It is three, and they differ in WHAT IS BEING SOURCED:
//
//   post_commenters       the people who commented on a post the user linked
//   competitor_discovery  the workspace's own rivals, starting from its profile
//   engagement            public activity matching topics or named competitors
//
// Each is distinguished by the request's ENTITY, which is the axis that already
// separates them: people, competitors, signals. The eight flags existed because
// the classifier had no entity to carry the distinction, so it encoded the
// answer as a spray of fields and let four `if` branches re-derive it.
//
// ── AND WHY "AND DRAFT SOMETHING" IS NOT A FLAG ────────────────────────────
//
// `needs_dm_drafts` and `needs_comment_drafts` meant "then write messages off
// the results". That is a SECOND ASK, and `RequestV1` already represents one:
// a `compose` part that depends on the sourcing part. Reading it from the parts
// rather than from a boolean means "find X and draft outreach" is one request
// with two steps, which is what the user said.
//
// Pure. No network, no database, no model.

import type { RequestV1, RequestPart } from "./requestV1.ts";

export const SIGNAL_SOURCING_VERSION = "signal-sourcing-surface-v1" as const;

export type SignalSourcingKind =
  | "post_commenters"
  | "competitor_discovery"
  | "engagement";

export interface SignalSourcingPlan {
  version: typeof SIGNAL_SOURCING_VERSION;
  kind: SignalSourcingKind;
  /** LinkedIn post URLs. Only for `post_commenters`, and required there. */
  post_urls: string[];
  /** LinkedIn profile or company pages whose posts to read. */
  target_urls: string[];
  /** Topics to search for. The user's own words. */
  keywords: string[];
  /** Competitors the user named. Seeded further from the workspace profile. */
  competitors: string[];
  location: string | null;
  count: number | null;
  /** True when a later part asks for drafts off these results. */
  wants_drafts: boolean;
  part_id: string;
}

/** A LinkedIn POST — the thing that has commenters. Not a profile or a company. */
const LINKEDIN_POST_RE =
  /^https?:\/\/(?:[a-z]{2,3}\.)?linkedin\.com\/(?:posts\/|feed\/update\/)/i;

/** A LinkedIn PROFILE or COMPANY page — the thing that has posts. */
const LINKEDIN_ENTITY_RE =
  /^https?:\/\/(?:[a-z]{2,3}\.)?linkedin\.com\/(?:in|company|school|showcase)\/[A-Za-z0-9_\-%.]+/i;

const refValues = (part: RequestPart): string[] =>
  (part.subject.references ?? [])
    // A conversational referent is a pronoun, never a URL to fetch.
    .filter((r) => r.kind !== "prior_result")
    .map((r) => (r.value ?? "").trim())
    .filter(Boolean);

/**
 * Does any later part ask for something to be written from these results?
 *
 * The replacement for `needs_dm_drafts` / `needs_comment_drafts`. Nothing here
 * grants permission to send: a compose part still routes through the approval
 * gate wherever it is served.
 */
function wantsDrafts(request: RequestV1, sourcePartId: string): boolean {
  return request.parts.some((p) =>
    p.objective === "compose" &&
    (p.depends_on ?? []).includes(sourcePartId));
}

/**
 * What would this request source?
 *
 * Pure and total. Returns null when no part asks for signal sourcing, which the
 * router reads as "not this surface" rather than as an error.
 */
export function planSignalSourcing(request: RequestV1): SignalSourcingPlan | null {
  for (const part of request.parts) {
    if (part.objective !== "source") continue;

    const values = refValues(part);
    const post_urls = values.filter((v) => LINKEDIN_POST_RE.test(v));
    const target_urls = values.filter((v) => LINKEDIN_ENTITY_RE.test(v));
    const named = values.filter(
      (v) => !LINKEDIN_POST_RE.test(v) && !LINKEDIN_ENTITY_RE.test(v));

    const base = {
      version: SIGNAL_SOURCING_VERSION,
      post_urls, target_urls,
      keywords: named,
      competitors: [] as string[],
      location: (part.subject.filters ?? [])
        .filter((f) => f.field === "geography")
        .flatMap((f) => Array.isArray(f.value) ? f.value.map(String) : [String(f.value)])[0] ?? null,
      count: typeof part.output.count === "number" && part.output.count > 0
        ? part.output.count : null,
      wants_drafts: wantsDrafts(request, part.id),
      part_id: part.id,
    };

    // A POST LINK IS ASKING WHO ENGAGED WITH IT. The strongest signal available
    // and checked first: nothing else references a specific post.
    if (post_urls.length > 0) return { ...base, kind: "post_commenters" };

    // THE WORKSPACE'S OWN RIVALS. Answering starts from its profile, not from a
    // population filter, which is why this is not `company`.
    if (part.subject.entity === "competitor") {
      return { ...base, kind: "competitor_discovery", competitors: named };
    }

    // PUBLIC ACTIVITY. `signal` and `content` are the entities that mean "what
    // is being said", as opposed to who exists.
    //
    // GUARDED ON OUTPUT SHAPE. Sourcing yields a LIST — records or events. A
    // `source` part asking for an `artifact` is asking for something to be
    // produced, which is compose-shaped and incoherent here; claiming it would
    // turn a malformed request into a paid search instead of a clarification.
    const listShaped = part.output.shape === "records" || part.output.shape === "events";
    if (listShaped &&
        (part.subject.entity === "signal" || part.subject.entity === "content")) {
      return { ...base, kind: "engagement" };
    }
  }
  return null;
}

/** Asked when a post-commenter request names no post. */
export const COMMENTERS_NEED_POST_URL =
  "Which LinkedIn post should I pull commenters from? Paste the post URL.";

/** Asked when competitor discovery has nothing about the business to start from. */
export const COMPETITORS_NEED_CONTEXT =
  "To find your competitors, share your website, LinkedIn company page, or a one-line description of what you sell — or set up your company profile and I'll use that.";

/** Asked when a profile-posts request names no profile. */
export const PROFILE_POSTS_NEED_URLS =
  "Which LinkedIn profile or company page should I pull recent posts from? Paste one or more LinkedIn URLs.";
