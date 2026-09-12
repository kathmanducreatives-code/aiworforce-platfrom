// WHAT A PIECE OF CONTENT IS — platform, format, strategy and artifact.
//
// ── WHY THIS EXISTS ─────────────────────────────────────────────────────────
//
// Content used to be one enum: `linkedin_post | linkedin_comment`. That baked
// the PLATFORM and the SHAPE into one word, so "a carousel" or "a meme" had
// nowhere to live except as prose inside a text body, and the user had to pick
// the shape before Scribe had even looked at the opportunity.
//
// Three separate things now, each with one job:
//
//   platform        where it goes           linkedin
//   content_format  what shape it takes     text | carousel | meme | …
//   surface         post or reply           the existing `content_item.format`
//                                           column (linkedin_post/_comment),
//                                           derived from the format, so every
//                                           existing reader keeps working
//
// And two objects Scribe produces, instead of one text blob:
//
//   strategy   WHY: objective, audience, whose news it is, insight, angle,
//              hook, the format it chose and the reason, visual direction, CTA
//   artifact   WHAT: the format-specific structure — slides for a carousel,
//              setup/punchline/image brief for a meme, panels for a comic
//
// The artifact's caption (or full text) is still written to `content_item.body`
// — the editable, versioned copy — so manual edits, history and approval work
// exactly as before. The structure rides alongside it in `metadata`, and the
// version trigger snapshots it through `last_prompt_context`.
//
// PURE. No network, no model, no database. Shared by the edge runtime (the
// writer and the brief) and the frontend (the Studio renders the artifact).

// ── the vocabulary ───────────────────────────────────────────────────────────

export const CONTENT_FORMATS_VERSION = "content-formats-v1" as const;

export const CONTENT_PLATFORMS = ["linkedin"] as const;
export type ContentPlatform = typeof CONTENT_PLATFORMS[number];

export const CONTENT_FORMAT_KINDS = [
  "text",          // a written post: hook, body, CTA
  "framework",     // a short framework post: named steps or principles
  "single_image",  // one image carrying the idea, with a caption
  "quote",         // an insight or quote graphic
  "carousel",      // a document post: cover, slides, closing slide
  "infographic",   // a visual explainer: sections of data or process
  "meme",          // a known-format joke that lands a real point
  "comic",         // a few panels with dialogue
  "comment",       // a reply to someone else's post
] as const;
export type ContentFormatKind = typeof CONTENT_FORMAT_KINDS[number];

/** The existing `content_item.format` column: is this a post or a reply? */
export type ContentSurface = "linkedin_post" | "linkedin_comment";

export function isContentFormatKind(v: unknown): v is ContentFormatKind {
  return typeof v === "string" && (CONTENT_FORMAT_KINDS as readonly string[]).includes(v);
}

/** A comment is a reply; everything else is a post. */
export function surfaceFor(format: ContentFormatKind): ContentSurface {
  return format === "comment" ? "linkedin_comment" : "linkedin_post";
}

/**
 * The formats Scribe may choose for a draft of this surface. A comment can only
 * be a comment — it answers someone else's post — and a post can be any post
 * shape. This is why the old "post vs comment" question is not asked any more:
 * it is decided by WHAT the draft is answering, not by the user.
 */
export function formatsForSurface(surface: ContentSurface): ContentFormatKind[] {
  return surface === "linkedin_comment"
    ? ["comment"]
    : CONTENT_FORMAT_KINDS.filter((f) => f !== "comment");
}

// ── what each format is, for the strategist and for the Studio ──────────────

export type RendererStatus =
  /** The Studio can show and edit it fully today. */
  | "native"
  /** The structure and visual brief are produced; a visual renderer is future work. */
  | "brief_only";

export interface FormatSpec {
  label: string;
  /** When a strategist should reach for it. Shown to Scribe, never to the user as a question. */
  use_when: string;
  /** Does it need a visual to exist at all? */
  visual: "none" | "optional" | "required";
  renderer: RendererStatus;
}

export const FORMAT_SPECS: Record<ContentFormatKind, FormatSpec> = {
  text: {
    label: "Text post",
    use_when: "A strong opinion, a story or a single sharp point that words carry best.",
    visual: "optional", renderer: "native",
  },
  framework: {
    label: "Framework post",
    use_when: "A method, checklist or set of principles the reader can apply — steps that stand alone.",
    visual: "optional", renderer: "native",
  },
  single_image: {
    label: "Single-image post",
    use_when: "One visual idea — a contrast, a diagram, a before/after — makes the point faster than text.",
    visual: "required", renderer: "brief_only",
  },
  quote: {
    label: "Quote / insight graphic",
    use_when: "One memorable line worth saving and sharing, with context in the caption.",
    visual: "required", renderer: "brief_only",
  },
  carousel: {
    label: "Carousel",
    use_when: "A contrast, a sequence or an argument with several steps that benefits from one idea per slide.",
    visual: "required", renderer: "brief_only",
  },
  infographic: {
    label: "Infographic / visual explainer",
    use_when: "Data, a process or a comparison that is clearer laid out than written.",
    visual: "required", renderer: "brief_only",
  },
  meme: {
    label: "Meme",
    use_when: "A shared frustration the audience already feels; humour that still makes a real point. Never punch down, never at a named person.",
    visual: "required", renderer: "brief_only",
  },
  comic: {
    label: "Comic-style post",
    use_when: "A small scene — a conversation or a before/after moment — that shows the problem instead of stating it.",
    visual: "required", renderer: "brief_only",
  },
  comment: {
    label: "Comment / reply",
    use_when: "Answering someone else's post: add something specific, never pitch.",
    visual: "none", renderer: "native",
  },
};

export function formatLabel(f: unknown): string {
  return isContentFormatKind(f) ? FORMAT_SPECS[f].label : "Text post";
}

// ── the strategy ─────────────────────────────────────────────────────────────

/** Whose news the source is. The same vocabulary as the brief's attribution. */
export type SourceRelationship = "ours" | "competitor" | "external_company" | "market" | "external" | "none";

export interface ContentStrategy {
  platform: ContentPlatform;
  content_format: ContentFormatKind;
  /** Why this format, in one sentence. Shown to the user as "Scribe chose …". */
  format_reason: string;
  objective: string;
  audience: string;
  /** What the content is built on: the user's goal, a signal, or both. */
  source: string;
  /** Who the source is about. Null for an idea with no subject. */
  source_owner: string | null;
  relationship_to_company: SourceRelationship;
  /** The one thing the reader should understand. */
  core_insight: string;
  angle: string;
  hook: string;
  /** What any visual should show. Feeds the image provider. */
  visual_direction: string | null;
  cta: string | null;
}

const STRATEGY_REQUIRED: (keyof ContentStrategy)[] = [
  "content_format", "format_reason", "objective", "audience", "core_insight", "angle", "hook",
];

// ── the artifacts, one shape per format ─────────────────────────────────────

export interface TextArtifact { format: "text"; hook: string; body: string; cta: string | null }
export interface FrameworkArtifact {
  format: "framework"; hook: string; intro: string | null;
  steps: { title: string; detail: string }[]; cta: string | null;
}
export interface SingleImageArtifact {
  format: "single_image"; headline: string; supporting_copy: string | null;
  visual_brief: string; caption: string;
}
export interface QuoteArtifact {
  format: "quote"; quote: string; attribution: string | null; visual_brief: string; caption: string;
}
export interface CarouselArtifact {
  format: "carousel"; cover: { title: string; subtitle: string | null };
  slides: { title: string; body: string }[];
  closing: { title: string; body: string | null; cta: string | null };
  caption: string; visual_direction: string;
}
export interface InfographicArtifact {
  format: "infographic"; title: string;
  sections: { heading: string; points: string[] }[];
  visual_brief: string; caption: string;
}
export interface MemeArtifact {
  format: "meme"; concept: string; setup: string; punchline: string;
  image_brief: string; caption: string;
}
export interface ComicArtifact {
  format: "comic"; concept: string;
  panels: { scene: string; dialogue: string }[];
  visual_brief: string; caption: string;
}
export interface CommentArtifact { format: "comment"; comment: string }

export type ContentArtifact =
  | TextArtifact | FrameworkArtifact | SingleImageArtifact | QuoteArtifact | CarouselArtifact
  | InfographicArtifact | MemeArtifact | ComicArtifact | CommentArtifact;

/**
 * The JSON shape Scribe is asked for, per format — one line each, so the
 * strategist sees the contract without a schema dump. The validator below is
 * the enforcement; this is the description.
 */
export const ARTIFACT_SHAPES: Record<ContentFormatKind, string> = {
  text: `{"format":"text","hook":"…","body":"…","cta":"…|null"}`,
  framework: `{"format":"framework","hook":"…","intro":"…|null","steps":[{"title":"…","detail":"…"}],"cta":"…|null"}`,
  single_image: `{"format":"single_image","headline":"…","supporting_copy":"…|null","visual_brief":"…","caption":"…"}`,
  quote: `{"format":"quote","quote":"…","attribution":"…|null","visual_brief":"…","caption":"…"}`,
  carousel: `{"format":"carousel","cover":{"title":"…","subtitle":"…|null"},"slides":[{"title":"…","body":"…"}],"closing":{"title":"…","body":"…|null","cta":"…|null"},"caption":"…","visual_direction":"…"}`,
  infographic: `{"format":"infographic","title":"…","sections":[{"heading":"…","points":["…"]}],"visual_brief":"…","caption":"…"}`,
  meme: `{"format":"meme","concept":"…","setup":"…","punchline":"…","image_brief":"…","caption":"…"}`,
  comic: `{"format":"comic","concept":"…","panels":[{"scene":"…","dialogue":"…"}],"visual_brief":"…","caption":"…"}`,
  comment: `{"format":"comment","comment":"…"}`,
};

// ── validation ───────────────────────────────────────────────────────────────

const s = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
const sOrNull = (v: unknown): string | null => s(v);
const o = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {};
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

export interface PlanValidation {
  ok: boolean;
  strategy: ContentStrategy | null;
  artifact: ContentArtifact | null;
  /** Machine-readable reasons the plan was rejected or corrected. */
  violations: string[];
}

/** Normalise one artifact; null when a required field is missing. */
export function normalizeArtifact(raw: unknown, format: ContentFormatKind): ContentArtifact | null {
  const a = o(raw);
  switch (format) {
    case "text": {
      const hook = s(a.hook), body = s(a.body);
      return hook && body ? { format, hook, body, cta: sOrNull(a.cta) } : null;
    }
    case "framework": {
      const hook = s(a.hook);
      const steps = list(a.steps).map((x) => ({ title: s(o(x).title), detail: s(o(x).detail) }))
        .filter((x): x is { title: string; detail: string } => !!x.title && !!x.detail);
      return hook && steps.length >= 2 ? { format, hook, intro: sOrNull(a.intro), steps, cta: sOrNull(a.cta) } : null;
    }
    case "single_image": {
      const headline = s(a.headline), visual_brief = s(a.visual_brief), caption = s(a.caption);
      return headline && visual_brief && caption
        ? { format, headline, supporting_copy: sOrNull(a.supporting_copy), visual_brief, caption } : null;
    }
    case "quote": {
      const quote = s(a.quote), visual_brief = s(a.visual_brief), caption = s(a.caption);
      return quote && visual_brief && caption
        ? { format, quote, attribution: sOrNull(a.attribution), visual_brief, caption } : null;
    }
    case "carousel": {
      const cover = o(a.cover), closing = o(a.closing);
      const slides = list(a.slides).map((x) => ({ title: s(o(x).title), body: s(o(x).body) }))
        .filter((x): x is { title: string; body: string } => !!x.title && !!x.body);
      const title = s(cover.title), caption = s(a.caption), visual_direction = s(a.visual_direction);
      const closingTitle = s(closing.title);
      return title && slides.length >= 2 && caption && visual_direction && closingTitle
        ? {
          format, cover: { title, subtitle: sOrNull(cover.subtitle) }, slides,
          closing: { title: closingTitle, body: sOrNull(closing.body), cta: sOrNull(closing.cta) },
          caption, visual_direction,
        }
        : null;
    }
    case "infographic": {
      const title = s(a.title), visual_brief = s(a.visual_brief), caption = s(a.caption);
      const sections = list(a.sections).map((x) => ({
        heading: s(o(x).heading),
        points: list(o(x).points).map(s).filter((p): p is string => !!p),
      })).filter((x): x is { heading: string; points: string[] } => !!x.heading && x.points.length > 0);
      return title && sections.length >= 2 && visual_brief && caption
        ? { format, title, sections, visual_brief, caption } : null;
    }
    case "meme": {
      const concept = s(a.concept), setup = s(a.setup), punchline = s(a.punchline);
      const image_brief = s(a.image_brief), caption = s(a.caption);
      return concept && setup && punchline && image_brief && caption
        ? { format, concept, setup, punchline, image_brief, caption } : null;
    }
    case "comic": {
      const concept = s(a.concept), visual_brief = s(a.visual_brief), caption = s(a.caption);
      const panels = list(a.panels).map((x) => ({ scene: s(o(x).scene), dialogue: s(o(x).dialogue) }))
        .filter((x): x is { scene: string; dialogue: string } => !!x.scene && !!x.dialogue);
      return concept && panels.length >= 2 && visual_brief && caption
        ? { format, concept, panels, visual_brief, caption } : null;
    }
    case "comment": {
      const comment = s(a.comment) ?? s(a.body) ?? s(a.text);
      return comment ? { format, comment } : null;
    }
  }
}

/**
 * THE ATTRIBUTION GUARD, on the OUTPUT.
 *
 * The brief forbids claiming someone else's launch; this checks the result did
 * not. Production 2026-09-11: a competitor's release became "We just shipped…".
 * Only fires when the source is somebody else's news — for our own news "we
 * launched" is simply true.
 */
const CLAIMING = /\b(we (just )?(shipped|launched|released|raised|announced|hired)|our (new )?(release|launch|funding|round))\b/i;

export function claimsSomeoneElsesNews(text: string, relationship: SourceRelationship): boolean {
  if (relationship === "ours" || relationship === "none") return false;
  return CLAIMING.test(text);
}

/**
 * Validate what Scribe returned: `{ strategy, artifact }`.
 *
 *   · the format must be one this surface allows (a post cannot become a
 *     comment, a reply cannot become a carousel)
 *   · a forced format (the user's "Change format") must be honoured
 *   · the strategy's decision fields and the artifact's required fields must
 *     exist — an empty carousel is not a carousel
 *   · somebody else's news must not come back as ours
 *
 * Never throws; a rejected plan returns `ok: false` with the reasons, and the
 * writer falls back to storing the text so a paid generation is never lost.
 */
export function validateScribePlan(raw: unknown, ctx: {
  surface: ContentSurface;
  forcedFormat?: ContentFormatKind | null;
  relationship?: SourceRelationship;
}): PlanValidation {
  const violations: string[] = [];
  const root = o(raw);
  const st = o(root.strategy);
  const art = o(root.artifact);
  const allowed = formatsForSurface(ctx.surface);

  const claimed = st.content_format ?? art.format;
  if (!isContentFormatKind(claimed)) {
    return { ok: false, strategy: null, artifact: null, violations: ["unknown_format"] };
  }
  let format: ContentFormatKind = claimed;
  if (!allowed.includes(format)) {
    return { ok: false, strategy: null, artifact: null, violations: [`format_not_allowed_for_${ctx.surface}:${format}`] };
  }
  if (ctx.forcedFormat && format !== ctx.forcedFormat) {
    violations.push(`forced_format_ignored:${ctx.forcedFormat}`);
    return { ok: false, strategy: null, artifact: null, violations };
  }
  if (art.format !== undefined && art.format !== format) {
    violations.push("strategy_and_artifact_disagree_on_format");
    return { ok: false, strategy: null, artifact: null, violations };
  }

  const artifact = normalizeArtifact(art, format);
  if (!artifact) return { ok: false, strategy: null, artifact: null, violations: [`artifact_incomplete:${format}`] };

  for (const k of STRATEGY_REQUIRED) {
    if (k !== "content_format" && !s(st[k])) violations.push(`strategy_missing:${k}`);
  }
  // A comment's strategy may be thin; a post's decision must be stated.
  if (violations.length && format !== "comment") {
    return { ok: false, strategy: null, artifact: null, violations };
  }

  const rel = (["ours", "competitor", "external_company", "market", "external", "none"] as const)
    .find((r) => r === st.relationship_to_company) ?? ctx.relationship ?? "none";
  // The caller's relationship is the truth — it comes from the source row, not
  // from the model. Scribe may not relabel a competitor's launch as ours.
  const relationship: SourceRelationship = ctx.relationship && ctx.relationship !== "none" ? ctx.relationship : rel;

  format = artifact.format;
  const strategy: ContentStrategy = {
    platform: "linkedin",
    content_format: format,
    format_reason: s(st.format_reason) ?? "",
    objective: s(st.objective) ?? "",
    audience: s(st.audience) ?? "",
    source: s(st.source) ?? "",
    source_owner: sOrNull(st.source_owner),
    relationship_to_company: relationship,
    core_insight: s(st.core_insight) ?? "",
    angle: s(st.angle) ?? "",
    hook: s(st.hook) ?? "",
    visual_direction: sOrNull(st.visual_direction) ?? visualBriefOf(artifact),
    cta: sOrNull(st.cta),
  };
  // Rejected — but RETURNED, so the writer can keep the paid draft with a
  // visible flag instead of either losing it or saving the false claim quietly.
  if (claimsSomeoneElsesNews(artifactText(artifact), relationship)) {
    return { ok: false, strategy, artifact, violations: ["claims_someone_elses_news"] };
  }
  return { ok: true, strategy, artifact, violations };
}

/**
 * Something readable from a plan that failed validation — never the raw JSON.
 * The generation was paid for; the user should see words they can fix.
 */
export function salvageBody(raw: unknown): string | null {
  const root = o(raw);
  const art = o(root.artifact);
  const st = o(root.strategy);
  const f = art.format ?? st.content_format;
  if (isContentFormatKind(f)) {
    const n = normalizeArtifact(art, f);
    if (n) return artifactBody(n);
  }
  const parts = [s(art.hook), s(art.body), s(art.caption), s(art.comment), s(art.setup), s(art.punchline),
    s(o(art.cover).title), ...list(art.slides).map((x) => s(o(x).title)), s(st.hook)]
    .filter((x): x is string => !!x);
  return parts.length ? [...new Set(parts)].join("\n\n") : null;
}

// ── what the artifact becomes in `body`, and what feeds an image ────────────

/**
 * THE COPY THAT GOES ON LINKEDIN — what `content_item.body` holds.
 *
 * For a written format that is the whole post. For a visual format it is the
 * caption: the slides, panels and image briefs are STRUCTURE, kept in metadata
 * and rendered by the Studio, not flattened into the text the user edits.
 */
export function artifactBody(a: ContentArtifact): string {
  switch (a.format) {
    case "text": return [a.hook, a.body, a.cta].filter(Boolean).join("\n\n");
    case "framework":
      return [a.hook, a.intro, a.steps.map((x, i) => `${i + 1}. ${x.title} — ${x.detail}`).join("\n"), a.cta]
        .filter(Boolean).join("\n\n");
    case "comment": return a.comment;
    default: return a.caption;
  }
}

/** A short title for the draft list. */
export function artifactTitle(a: ContentArtifact, strategy?: ContentStrategy | null): string {
  const t = (() => {
    switch (a.format) {
      case "text": case "framework": return a.hook;
      case "single_image": return a.headline;
      case "quote": return a.quote;
      case "carousel": return a.cover.title;
      case "infographic": return a.title;
      case "meme": case "comic": return a.concept;
      case "comment": return a.comment;
    }
  })() || strategy?.hook || "Content draft";
  return t.replace(/\s+/g, " ").trim().slice(0, 120);
}

/** Every word the artifact would publish — for the attribution guard. */
export function artifactText(a: ContentArtifact): string {
  switch (a.format) {
    case "text": return [a.hook, a.body, a.cta ?? ""].join("\n");
    case "framework": return [a.hook, a.intro ?? "", ...a.steps.flatMap((x) => [x.title, x.detail]), a.cta ?? ""].join("\n");
    case "single_image": return [a.headline, a.supporting_copy ?? "", a.caption].join("\n");
    case "quote": return [a.quote, a.caption].join("\n");
    case "carousel": return [a.cover.title, a.cover.subtitle ?? "", ...a.slides.flatMap((x) => [x.title, x.body]),
      a.closing.title, a.closing.body ?? "", a.caption].join("\n");
    case "infographic": return [a.title, ...a.sections.flatMap((x) => [x.heading, ...x.points]), a.caption].join("\n");
    case "meme": return [a.setup, a.punchline, a.caption].join("\n");
    case "comic": return [...a.panels.map((x) => x.dialogue), a.caption].join("\n");
    case "comment": return a.comment;
  }
}

/**
 * THE VISUAL BRIEF the image provider receives — Scribe's own words about what
 * the picture should show, written with the Company Brain in context. Null for a
 * format with no visual. Feeds `metadata.visual_brief`, which
 * `generate-content-image` already prefers over the draft text.
 */
export function visualBriefOf(a: ContentArtifact): string | null {
  switch (a.format) {
    case "single_image": case "quote": case "infographic": case "comic": return a.visual_brief;
    case "meme": return a.image_brief;
    case "carousel": return `Carousel cover for "${a.cover.title}". ${a.visual_direction}`;
    default: return null;
  }
}

// ── a deterministic prior: a hint for the strategist, and the honest default ─

/**
 * WHICH FORMAT THE OPPORTUNITY LEANS TOWARD, from the words alone.
 *
 * Not the decision — Scribe makes that with the Company Brain in context. This
 * is the hint the brief offers ("this reads like a framework") and the
 * fallback's format when a plan comes back unusable. Deliberately conservative:
 * anything unclear leans `text`, the format that never needs a renderer.
 */
export function formatPrior(i: {
  goal: string; signalTitle?: string | null; relationship?: SourceRelationship;
}): { format: ContentFormatKind; reason: string } {
  const t = `${i.goal} ${i.signalTitle ?? ""}`.toLowerCase();
  if (/\b(meme|funny|joke|humou?r|relatable|lol)\b/.test(t)) return { format: "meme", reason: "the request asks for humour" };
  if (/\b(comic|story ?board|scene|panel)\b/.test(t)) return { format: "comic", reason: "the request describes a scene" };
  if (/\b(\d+ (steps|ways|lessons|mistakes|rules|principles)|framework|checklist|playbook|how to)\b/.test(t)) {
    return { format: "carousel", reason: "a multi-step idea reads best one step per slide" };
  }
  if (/\b(data|stats?|statistics|percent|%|benchmark|numbers|survey|report)\b/.test(t)) {
    return { format: "infographic", reason: "numbers are clearer laid out than written" };
  }
  if (/\b(vs\.?|versus|instead of|not another|compared|contrast|before and after)\b/.test(t)) {
    return { format: "carousel", reason: "a contrast lands best side by side, one idea per slide" };
  }
  if (i.relationship === "competitor" && /\b(launch|launches|launched|release|releases|announce|ships?)\b/.test(t)) {
    return { format: "carousel", reason: "a competitor's launch is a chance to contrast approaches" };
  }
  if (/\b(quote|one line|mantra|belief)\b/.test(t)) return { format: "quote", reason: "a single line is the point" };
  return { format: "text", reason: "a clear point words carry best" };
}
