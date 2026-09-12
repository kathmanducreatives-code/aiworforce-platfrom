// CONTENT CREATION: TELL SCRIBE WHAT YOU WANT, NOT HOW TO BUILD IT.
//
// The composer asks one question; Scribe decides the strategy and format; the
// Studio shows that decision with optional overrides. Behaviour where the code
// is pure (the Studio model), source where the guarantee is about wiring.
//
// ZERO network, ZERO database, ZERO models.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  studioStrategyOf, artifactOf, reviewFlagsOf, switchableFormats, formatChangeRevision,
  versionLabel, revisionInstruction, SCRIBE_ACTIONS,
} from "../../src/lib/content/contentStudioModel.ts";

const ROOT = new URL("../../", import.meta.url);
const read = (p: string) => Deno.readTextFile(new URL(p, ROOT));
const code = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, "").split("\n")
  .map((l) => (l.trim().startsWith("//") ? "" : l.replace(/\s\/\/.*$/, ""))).join("\n");

// ══════════ 1. the composer is a question, not a form ══════════════════════

Deno.test("the composer asks what to talk about — not post vs comment, idea vs signal, or angle", async () => {
  const c = code(await read("src/components/content/ContentComposer.tsx"));
  assert(c.includes("What do you want to talk about?"));
  assert(c.includes("Use current market signals") && c.includes("Use Company Brain"));
  assert(c.includes("useState(true)"), "both switches start ON");
  assert(c.includes("useState<ContentFormatKind | 'auto'>('auto')"), "format is Auto unless overridden");
  assert(c.includes("Advanced"), "format is an override behind Advanced, never a required choice");
  assert(!c.includes("'linkedin_comment'") && !c.includes("LinkedIn comment"), "a reply is never chosen in a form");
  assert(!/label: 'Angle'|placeholder="Angle/.test(c), "the angle is Scribe's decision");
  // still typed data, still real signals
  for (const f of ["format", "sourceType", "signalId", "useMarketSignals", "useCompanyBrain"]) assert(c.includes(f), f);
  assert(/signals: ComposerSignal\[\]/.test(c));
  assert(c.includes("Signal selected"), "starting from a signal shows the signal, then one Create");
});

Deno.test("the page sends market context only when asked, and never alongside a chosen signal", async () => {
  const page = code(await read("src/pages/Content.tsx"));
  const start = page.slice(page.indexOf("const startDraft"), page.indexOf("const turnSignalInto"));
  assert(start.includes("i.useMarketSignals && !i.signal"));
  assert(start.includes("forYouSignals.slice(0, 3)"), "a few, ranked — not the whole feed");
  assert(start.includes("contentFormat: i.contentFormat ?? 'auto'"));
  assert(start.includes("useCompanyBrain: i.useCompanyBrain !== false"));
  assert(start.includes("contentFormat: forced"), "a forced format reaches run-agent as data");
  const submit = page.slice(page.indexOf("onSubmit={async (input: ComposerSubmission)"));
  assert(submit.includes("surface: 'linkedin_post'"), "the composer makes posts; Scribe picks the shape");
});

Deno.test("a signal card offers ONE create — Scribe decides what it becomes", async () => {
  const p = code(await read("src/components/content/SourcePreview.tsx"));
  assert(p.includes("Create content") && !p.includes("Create post"));
});

// ══════════ 2. the Studio shows the decision ═══════════════════════════════

const carouselItem = {
  format: "linkedin_post",
  metadata: {
    content_format: "carousel",
    content_strategy: {
      content_format: "carousel", format_reason: "the contrast is easier to show visually",
      audience: "SaaS founders", angle: "Coordination > more AI tools", hook: "Your company doesn't need another AI tool",
      objective: "reframe", core_insight: "coordination", visual_direction: "scattered vs connected", cta: null,
    },
    content_artifact: {
      format: "carousel", cover: { title: "Your company doesn't need another AI tool", subtitle: null },
      slides: [{ title: "The real problem is coordination", body: "Tools don't talk." }, { title: "Two", body: "b" }],
      closing: { title: "Coordinate first", body: null, cta: null }, caption: "cap", visual_direction: "v",
    },
    content_review_flags: ["claims_someone_elses_news"],
  },
} as never;

Deno.test("Scribe chose: Carousel · for SaaS founders · Angle — read from the row", () => {
  const s = studioStrategyOf(carouselItem);
  assertEquals([s.format, s.label, s.audience, s.angle], ["carousel", "Carousel", "SaaS founders", "Coordination > more AI tools"]);
  assertEquals(s.renderer, "brief_only", "honest: the plan exists, the visual renderer is future work");
  assertEquals(artifactOf((carouselItem as { metadata: Record<string, unknown> }).metadata)?.format, "carousel");
  assertEquals(reviewFlagsOf(carouselItem), ["claims_someone_elses_news"]);
  // an older row with no decision reads as what its surface was
  assertEquals(studioStrategyOf({ format: "linkedin_comment", metadata: {} } as never).format, "comment");
  assertEquals(studioStrategyOf({ format: "linkedin_post", metadata: {} } as never).format, "text");
});

Deno.test("Change format: any post shape, never for a reply; the revision says what to keep", () => {
  assert(switchableFormats(carouselItem).includes("meme") && !switchableFormats(carouselItem).includes("comment"));
  assertEquals(switchableFormats({ format: "linkedin_comment", metadata: {} } as never), []);
  assert(formatChangeRevision("meme").includes("Remake this as a meme") && formatChangeRevision("meme").includes("whose news it is"));
});

Deno.test("history names the format of each version", () => {
  assertEquals(versionLabel({ generation_source: "scribe_generation", prompt_context: { content_format: "carousel" } }),
    "Written by Scribe · Carousel");
  assertEquals(versionLabel({ generation_source: "scribe_generation", prompt_context: { content_format: "text" } }),
    "Written by Scribe", "the default shape is not noise in every row");
});

Deno.test("revisions ask for the whole structure back, and the new tone actions exist", () => {
  const r = revisionInstruction("BRIEF", "Make it more educational", "{\"artifact\":{}}");
  assert(r.startsWith("BRIEF") && r.includes("Return the full JSON object again") && r.endsWith("{\"artifact\":{}}"));
  const labels = SCRIBE_ACTIONS.map((a) => a.label);
  assert(labels.includes("Make more provocative") && labels.includes("Make more educational"));
});

Deno.test("the Studio shows the decision with optional overrides, and renders the structure", async () => {
  const e = code(await read("src/components/content/ContentStudioEditor.tsx"));
  assert(e.includes('"Scribe chose"') && e.includes("Change format") && e.includes("Change angle"));
  assert(e.includes("Your overrides"), "the old strategy fields remain — optional");
  assert(e.includes("<ContentArtifactView artifact={artifact} />"));
  assert(e.includes("REVIEW_FLAG_TEXT"), "a flagged draft says so before approval");
});

// ══════════ 3. overrides go through the one service ═══════════════════════

Deno.test("format and angle overrides are persisted on the brief and regenerate through the one path", async () => {
  const svc = code(await read("src/lib/content/contentService.ts"));
  assert(svc.includes("export async function changeContentFormat("));
  assert(svc.includes("export async function changeContentAngle("));
  assert(svc.includes("contentFormat: format"), "stored on brief_input, so later regenerations keep it");
  assert(svc.includes("a_reply_stays_a_reply"));
  assert(svc.includes("...draftOptions(brief.input)"), "every regeneration carries the forced format and brain switch");
  const gen = code(await read("src/lib/content/generateContentDraft.ts"));
  assert(gen.includes("content_format: args.contentFormat ?? null") && gen.includes("use_company_brain: args.useCompanyBrain !== false"));
  // Still no provider, model or key in the Content UI.
  for (const f of ["src/components/content/ContentComposer.tsx", "src/components/content/ContentArtifactView.tsx"]) {
    const s = code(await read(f));
    for (const bad of ["api.openai.com", "api.anthropic.com", "functions.invoke(", "gpt-image"]) assert(!s.includes(bad), `${f}: ${bad}`);
  }
});
