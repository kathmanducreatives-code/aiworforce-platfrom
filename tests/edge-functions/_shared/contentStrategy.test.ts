// SCRIBE DECIDES WHAT CONTENT TO MAKE — and the product keeps it honest.
//
// The format model (platform vs format vs surface), the strategist's brief,
// the validation of what Scribe returns, the attribution guard on the OUTPUT,
// the Company Brain as a strategist reads it, and the one writer persisting the
// strategy and structure — exercised through `writeMemoryFromAgentResult` with
// a fake database, not by reading source.
//
// ZERO network, ZERO models, ZERO providers.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  CONTENT_FORMAT_KINDS, FORMAT_SPECS, ARTIFACT_SHAPES, formatsForSurface, surfaceFor, formatPrior,
  validateScribePlan, artifactBody, artifactTitle, visualBriefOf, salvageBody, claimsSomeoneElsesNews,
} from "../../../supabase/functions/_shared/contentFormats.ts";
import { buildContentInstruction } from "../../../supabase/functions/_shared/contentInstruction.ts";
import { contentBrainFrom, renderContentBrain } from "../../../supabase/functions/_shared/contentBrainContext.ts";
import { writeMemoryFromAgentResult } from "../../../supabase/functions/_shared/memoryWriter.ts";

const ROOT = new URL("../../../", import.meta.url);
const read = (p: string) => Deno.readTextFile(new URL(p, ROOT));

// ══════════ 1. platform, format, surface ═══════════════════════════════════

Deno.test("platform and format are separate; the old enum survives only as post-vs-reply", () => {
  assertEquals(surfaceFor("carousel"), "linkedin_post");
  assertEquals(surfaceFor("meme"), "linkedin_post");
  assertEquals(surfaceFor("comment"), "linkedin_comment");
  assertEquals(formatsForSurface("linkedin_comment"), ["comment"], "a reply can only be a reply");
  const post = formatsForSurface("linkedin_post");
  assert(!post.includes("comment"), "a post is never a comment");
  for (const f of ["text", "framework", "single_image", "quote", "carousel", "infographic", "meme", "comic"]) {
    assert(post.includes(f as never), `${f} is a post format`);
  }
  // Every format has a spec and a declared artifact shape — extensible in one place.
  for (const f of CONTENT_FORMAT_KINDS) {
    assert(FORMAT_SPECS[f]?.label && FORMAT_SPECS[f].use_when, f);
    assert(ARTIFACT_SHAPES[f]?.includes(`"format":"${f}"`), f);
  }
});

// ══════════ 2. the strategist's brief ══════════════════════════════════════

const OUTREACH = { relationship: "competitor" as const, name: "Outreach" };

Deno.test("THE BRIEF keeps attribution AND asks Scribe to decide — never the user", () => {
  const b = buildContentInstruction({
    format: "linkedin_post", sourceType: "signal", idea: "",
    signalTitle: "Outreach launches an AI sales execution product", signalSubject: OUTREACH,
  });
  // attribution, unchanged
  assert(b.includes("Who it happened to: Outreach — a competitor of ours, not us."));
  assert(b.includes('"we shipped", "our release"'));
  // the decision layer
  assert(b.includes("YOU ARE THE CONTENT STRATEGIST"));
  assert(b.includes("Decide: objective, audience, core insight, angle, hook, format, structure, visual direction, CTA."));
  // brain vs signal: two things, named, never merged
  assert(b.includes("COMPANY BRAIN (in your context) = who we are and what we believe"));
  assert(b.includes("THE SOURCE (above) = what happened in the market. Keep it semantically separate from the Company Brain"));
  // every post format offered, no comment, and a first read toward carousel for a competitor launch
  assert(b.includes("- carousel: Carousel.") && b.includes("- meme: Meme.") && !b.includes("- comment:"));
  assert(b.includes(`leans toward "carousel"`), "a competitor launch leans to a contrast carousel");
  // the contract, with the relationship stated from the row
  assert(b.includes("RETURN ONLY ONE JSON OBJECT"));
  assert(b.includes(`"relationship_to_company":"competitor"`));
  assert(b.includes("Never invent customers, numbers or results."));
});

Deno.test("a forced format is the only format; a reply is always a comment", () => {
  const forced = buildContentInstruction({
    format: "linkedin_post", sourceType: "idea", idea: "AI workforces", signalTitle: null, contentFormat: "meme",
  });
  assert(forced.includes("FORMAT: Meme — fixed by the user. Produce exactly this format."));
  assert(forced.includes(`- meme: {"format":"meme"`) && !forced.includes(`- carousel: {"format"`));
  const reply = buildContentInstruction({
    format: "linkedin_comment", sourceType: "idea", idea: "reply to this", signalTitle: null,
  });
  assert(reply.includes("FORMAT: Comment / reply — fixed (this is a reply to a post)."));
  assert(reply.startsWith("Scribe, write a LinkedIn comment about: reply to this. Draft only."));
});

Deno.test("market context is somebody else's news, and the brain switch is honoured", () => {
  const b = buildContentInstruction({
    format: "linkedin_post", sourceType: "idea", idea: "why coordination beats tools", signalTitle: null,
    marketSignals: [{ title: "Outreach launches Agents", relationship: "competitor", name: "Outreach" },
      { title: "AI SDR adoption doubles", relationship: "market", name: null }],
    useCompanyBrain: false,
  });
  assert(b.includes("MARKET CONTEXT — recent signals you may draw on. Every one is somebody else's news, never ours:"));
  assert(b.includes(`"Outreach launches Agents" — Outreach (competitor)`));
  assert(b.includes(`"AI SDR adoption doubles" — market-wide`));
  assert(b.includes("switched the Company Brain off"));
  assert(!b.includes("THE SOURCE"), "an idea is a goal, not a source");
});

// ══════════ 3. validating what Scribe returns ══════════════════════════════

const carouselPlan = {
  strategy: {
    content_format: "carousel", format_reason: "the contrast is easier to show visually",
    objective: "reframe the market", audience: "SaaS founders", source: "Outreach launch",
    source_owner: "Outreach", relationship_to_company: "competitor",
    core_insight: "coordination, not more tools", angle: "AI tools vs an AI workforce",
    hook: "Your company doesn't need another AI tool", visual_direction: "two columns, scattered vs connected",
    cta: "What does your stack look like?",
  },
  artifact: {
    format: "carousel",
    cover: { title: "Your company doesn't need another AI tool", subtitle: null },
    slides: [{ title: "The real problem is coordination", body: "Tools don't talk." },
      { title: "Outreach is betting on execution", body: "Their launch automates the SDR." }],
    closing: { title: "Coordinate first", body: null, cta: "Tell me your stack" },
    caption: "Outreach launched an execution agent. Here's why coordination matters more.",
    visual_direction: "scattered tools vs one connected workforce",
  },
};

Deno.test("a valid carousel plan becomes a strategy + artifact; body is the CAPTION", () => {
  const v = validateScribePlan(carouselPlan, { surface: "linkedin_post", relationship: "competitor" });
  assert(v.ok, v.violations.join(","));
  assertEquals(v.strategy!.content_format, "carousel");
  assertEquals(v.strategy!.audience, "SaaS founders");
  assertEquals(artifactBody(v.artifact!), carouselPlan.artifact.caption, "slides are structure, not body text");
  assertEquals(artifactTitle(v.artifact!), "Your company doesn't need another AI tool");
  assert(visualBriefOf(v.artifact!)!.includes("scattered tools vs one connected workforce"));
});

Deno.test("the plan must honour the surface, a forced format and its own completeness", () => {
  assertEquals(validateScribePlan(carouselPlan, { surface: "linkedin_comment" }).violations,
    ["format_not_allowed_for_linkedin_comment:carousel"]);
  assertEquals(validateScribePlan(carouselPlan, { surface: "linkedin_post", forcedFormat: "meme" }).violations,
    ["forced_format_ignored:meme"]);
  const empty = { ...carouselPlan, artifact: { ...carouselPlan.artifact, slides: [] } };
  assertEquals(validateScribePlan(empty, { surface: "linkedin_post" }).violations, ["artifact_incomplete:carousel"]);
  assertEquals(validateScribePlan({ strategy: { content_format: "hologram" } }, { surface: "linkedin_post" }).violations,
    ["unknown_format"]);
  const noWhy = { ...carouselPlan, strategy: { ...carouselPlan.strategy, format_reason: "" } };
  assert(validateScribePlan(noWhy, { surface: "linkedin_post" }).violations.includes("strategy_missing:format_reason"),
    "a post's decision must be stated");
});

Deno.test("THE ATTRIBUTION GUARD: a competitor's launch cannot come back as ours — even if the model says 'ours'", () => {
  const claimed = {
    strategy: { ...carouselPlan.strategy, relationship_to_company: "ours" },
    artifact: { ...carouselPlan.artifact, caption: "We just shipped AI that executes. Our release changes everything." },
  };
  const v = validateScribePlan(claimed, { surface: "linkedin_post", relationship: "competitor" });
  assertEquals(v.ok, false);
  assertEquals(v.violations, ["claims_someone_elses_news"]);
  assert(v.strategy && v.artifact, "returned, so the writer keeps the paid draft WITH a flag");
  assertEquals(v.strategy!.relationship_to_company, "competitor", "the row's relationship wins over the model's");
  assertEquals(claimsSomeoneElsesNews("We launched our new agent", "ours"), false, "our own news may say we");
});

Deno.test("every format has a readable body and never stores raw JSON", () => {
  const meme = validateScribePlan({
    strategy: { ...carouselPlan.strategy, content_format: "meme", format_reason: "shared frustration" },
    artifact: { format: "meme", concept: "tool sprawl", setup: "Me with 14 AI tools", punchline: "none of them talk",
      image_brief: "a desk buried in app windows", caption: "Sound familiar?" },
  }, { surface: "linkedin_post" });
  assert(meme.ok);
  assertEquals(artifactBody(meme.artifact!), "Sound familiar?");
  assertEquals(visualBriefOf(meme.artifact!), "a desk buried in app windows");
  assertEquals(salvageBody({ artifact: { format: "carousel", caption: "the caption" } }), "the caption");
  assertEquals(salvageBody({}), null);
});

Deno.test("the first read leans conservatively", () => {
  assertEquals(formatPrior({ goal: "5 mistakes founders make with outbound" }).format, "carousel");
  assertEquals(formatPrior({ goal: "a funny take on tool sprawl" }).format, "meme");
  assertEquals(formatPrior({ goal: "our survey data on AI adoption" }).format, "infographic");
  assertEquals(formatPrior({ goal: "why I think sales teams are changing" }).format, "text", "unclear leans text");
});

// ══════════ 4. the Company Brain, as a strategist reads it ═════════════════

const PROFILE = {
  company: { name: "Agentory", description: "an AI workforce for founder-led teams" },
  icp: { buyer_roles: ["Founders"], industries: ["B2B SaaS"], pain_points: ["no time for outbound", "tool sprawl"] },
  positioning: {
    promise: "companies need coordinated AI workforces, not disconnected tools",
    differentiators: ["approval-first"], proof_points: ["drafts only — nothing sends without approval"],
    avoid_positioning: ["replacing your team"], offer: "€99/month",
  },
  brand_voice: { tone: "direct, warm", style_rules: ["short sentences"], avoid: ["hype words"] },
  competitors: { known: ["Outreach", "Clay"] },
  goals: { content: "founder-led GTM" },
};

Deno.test("the strategist's brain: beliefs, pains, proof, voice — and competitors marked NOT us", () => {
  const b = contentBrainFrom(PROFILE);
  assertEquals(b.beliefs, ["companies need coordinated AI workforces, not disconnected tools"]);
  assertEquals(b.claims_we_can_make, ["drafts only — nothing sends without approval"]);
  assertEquals(b.claims_to_avoid, ["replacing your team"]);
  const block = renderContentBrain(PROFILE, {
    onboardingCompleted: true,
    recent: [{ title: "Why approval-first matters", content_format: "text", angle: "trust" }],
  });
  assert(block.startsWith("COMPANY BRAIN — who we are and what we believe (this is US; a signal is somebody else's news):"));
  assert(block.includes("- We are: Agentory — an AI workforce for founder-led teams"));
  assert(block.includes("Competitors — these are NOT us; their news is theirs: Outreach, Clay"));
  assert(block.includes("Claims we can safely make (proof)") && block.includes("Never position us as / never claim"));
  assert(block.includes("OUR RECENT CONTENT — do not repeat these angles") && block.includes("[text] Why approval-first matters (angle: trust)"));
});

Deno.test("an empty brain invents nothing; the switch leaves only who is writing", () => {
  const empty = renderContentBrain({}, {});
  assert(empty.includes("Not configured yet") && empty.includes("make no claims"));
  const off = renderContentBrain(PROFILE, { useCompanyBrain: false });
  assert(off.includes("We are: Agentory") && !off.includes("approval-first") && !off.includes("Outreach"));
});

// ══════════ 5. the ONE writer persists the decision ════════════════════════

/** A fake admin: one content_item row, every update captured. */
function fakeAdmin(row: { format: string; metadata: Record<string, unknown> }) {
  const updates: Record<string, unknown>[] = [];
  const inserts: { table: string; row: unknown }[] = [];
  const chain = (table: string) => {
    let pendingUpdate: Record<string, unknown> | null = null;
    const q: Record<string, unknown> = {
      select: () => q, eq: () => q, neq: () => q, order: () => q, limit: () => q,
      maybeSingle: () => Promise.resolve({ data: table === "content_item" ? row : null, error: null }),
      update: (u: Record<string, unknown>) => { pendingUpdate = u; updates.push(u); return q; },
      insert: (r: unknown) => { inserts.push({ table, row: r }); return Promise.resolve({ data: null, error: null }); },
      then: (res: (v: unknown) => unknown) => res({ data: null, error: null }),
    };
    void pendingUpdate;
    return q;
  };
  return { admin: { from: chain } as never, updates, inserts };
}

async function runScribe(output: unknown, row: { format: string; metadata: Record<string, unknown> }, loop: Record<string, unknown> = {}) {
  const f = fakeAdmin(row);
  await writeMemoryFromAgentResult({
    admin: f.admin, workspace_id: "w1", conversation_id: "c1", plan_id: null, task_id: "t1",
    agent_slug: "scribe", output_text: typeof output === "string" ? output : JSON.stringify(output),
    model_used: "claude-haiku-4-5-20251001", provider_used: "anthropic",
    content_loop: { source: "content_surface", subtype: "linkedin_post", content_item_id: "item1", ...loop },
  } as never);
  const upd = f.updates.find((u) => "body" in u) as Record<string, unknown> | undefined;
  return { upd, meta: (upd?.metadata ?? {}) as Record<string, unknown>, inserts: f.inserts };
}

const SIGNAL_ROW = {
  format: "linkedin_post",
  metadata: { brief: "…", brief_input: { sourceType: "signal", signalSubject: OUTREACH }, topic: "Outreach launch" },
};

Deno.test("WRITER: a carousel lands as caption + strategy + artifact + visual brief, snapshotted for the version", async () => {
  const { upd, meta, inserts } = await runScribe(carouselPlan, SIGNAL_ROW);
  assert(upd, "the draft was filled");
  assertEquals(upd!.body, carouselPlan.artifact.caption);
  assertEquals(upd!.title, "Your company doesn't need another AI tool");
  assertEquals(meta.content_format, "carousel");
  assertEquals(meta.platform, "linkedin");
  assertEquals((meta.content_strategy as Record<string, unknown>).angle, "AI tools vs an AI workforce");
  assertEquals(((meta.content_artifact as Record<string, unknown>).slides as unknown[]).length, 2);
  assert(String(meta.visual_brief).includes("scattered tools vs one connected workforce"), "feeds generate-content-image");
  assertEquals(meta.content_review_flags, []);
  const pc = meta.last_prompt_context as Record<string, unknown>;
  assertEquals(pc.content_format, "carousel", "the version trigger copies this onto the version");
  assert(pc.artifact && pc.strategy);
  assertEquals((meta.brief_input as Record<string, unknown>).sourceType, "signal", "the brief is merged, not replaced");
  assertEquals(inserts.filter((i) => i.table === "saved_outputs").length, 0, "one draft, one row");
});

Deno.test("WRITER: a claimed launch is kept as a FLAGGED draft, with the row's relationship", async () => {
  const claimed = { ...carouselPlan, artifact: { ...carouselPlan.artifact, caption: "We just shipped AI that executes." } };
  const { upd, meta } = await runScribe(claimed, SIGNAL_ROW);
  assertEquals(upd!.body, "We just shipped AI that executes.");
  assertEquals(meta.content_review_flags, ["claims_someone_elses_news"]);
  assertEquals((meta.content_strategy as Record<string, unknown>).relationship_to_company, "competitor");
});

Deno.test("WRITER: an unusable plan never stores raw JSON, and clears the previous structure", async () => {
  const stale = { ...SIGNAL_ROW, metadata: { ...SIGNAL_ROW.metadata, content_format: "carousel", content_artifact: carouselPlan.artifact } };
  const { upd, meta } = await runScribe({ strategy: { content_format: "carousel" }, artifact: { format: "carousel", caption: "Just the caption" } }, stale);
  assertEquals(upd!.body, "Just the caption");
  assert(!String(upd!.body).trim().startsWith("{"));
  assertEquals(meta.content_review_flags, ["plan_unusable"]);
  assertEquals([meta.content_format, meta.content_artifact, meta.visual_brief], [null, null, null]);
});

Deno.test("WRITER: a forced format that Scribe ignored is not accepted as the decision", async () => {
  const { meta } = await runScribe(carouselPlan, SIGNAL_ROW, { content_format: "meme" });
  assertEquals(meta.content_review_flags, ["plan_unusable"]);
  assertEquals(meta.content_format, null);
});

Deno.test("WRITER: plain text still works exactly as before", async () => {
  const { upd, meta } = await runScribe("A plain draft.\n\nSecond line.", SIGNAL_ROW);
  assertEquals(upd!.body, "A plain draft.\n\nSecond line.");
  assert(!("content_format" in meta), "no plan, no structure written");
  assertEquals(meta.content_review_flags, []);
});

// ══════════ 6. wiring and schema ═══════════════════════════════════════════

Deno.test("run-agent gives Scribe content runs the strategist's brain, once, behind the onboarding gate", async () => {
  const s = await read("supabase/functions/run-agent/index.ts");
  assert(s.includes('import { renderContentBrain, type RecentContent } from "../_shared/contentBrainContext.ts";'));
  assert(s.includes('agent_slug === "scribe" && tool_input_body?.content_loop'));
  assert(s.includes("brainBlock = renderContentBrain(brainOnboardingCompleted ? brain : null, {"));
  assert(s.includes("useCompanyBrain: contentLoop.use_company_brain !== false"));
  assert(s.includes(".neq(\"status\", \"archived\")"), "recent content excludes archived drafts");
});

Deno.test("the migration is additive: derived columns, checked values, post-vs-reply coherence", async () => {
  const m = await read("supabase/migrations/20260912160000_content_format_model.sql");
  assert(m.includes("add column if not exists content_format text\n    generated always as"));
  assert(m.includes("add column if not exists platform text\n    generated always as"));
  assert(m.includes("check ((content_format = 'comment') = (format = 'linkedin_comment'))"));
  for (const f of CONTENT_FORMAT_KINDS) assert(m.includes(`'${f}'`), f);
  assert(!/drop\s+column|drop\s+table|delete\s+from|update\s+public\./i.test(m), "additive only");
});
