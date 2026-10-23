// CHAT, AGENT CONTEXT AND CONTENT FOLLOW ONE READINESS RULE (roadmap Phase 2b).
//
// Behind BRAIN_READINESS_V2 a request is refused only when the Brain lacks what
// ITS capability needs, and a run the gate admits gets the Brain as context.
// Owner decisions, 2026-10-23:
//   · lead search runs before activation once industries + (buyers or must-haves) exist;
//   · content DRAFTS run with a description + a pain point or content angle, and
//     a person reviews before anything is published;
//   · outreach still needs a fully activated Brain.
// With the flag off, every gate behaves exactly as before.
import { assert, assertEquals, assertFalse, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  brainReadinessV2Enabled, capabilityForObjective, readinessGate, shouldGateObjective,
} from "../../../supabase/functions/_shared/companyBrainGate.ts";
import { companyBrainReadiness } from "../../../supabase/functions/_shared/companyBrainReadiness.ts";
import { normalizeCompanyBrain } from "../../../supabase/functions/_shared/normalizeCompanyBrain.ts";

const ROOT = new URL("../../../", import.meta.url);
const read = (p: string) => Deno.readTextFileSync(new URL(p, ROOT));
const readiness = (p: Record<string, unknown>, activated = false) =>
  companyBrainReadiness(normalizeCompanyBrain({ schema_version: 2, ...p }), activated);

const LEAD_READY = { target_customer: { industries: ["Fintech"] }, buyer_personas: ["CFO"] };
const CONTENT_READY = { company: { description: "Revenue analytics" }, pain_points: ["Slow close"] };

Deno.test("G-1 the flag is off unless explicitly enabled", () => {
  for (const v of [undefined, "", "0", "false", "off", "yes please"]) assertFalse(brainReadinessV2Enabled(() => v), String(v));
  for (const v of ["1", "true", "TRUE", " on "]) assert(brainReadinessV2Enabled(() => v), v);
});

Deno.test("G-2 objectives map to capabilities; reading and talking are never gated", () => {
  assertEquals(capabilityForObjective("source", null), "lead_search");
  assertEquals(capabilityForObjective("research", null), "signals");
  assertEquals(capabilityForObjective("compose", "content"), "content");
  assertEquals(capabilityForObjective("compose", "outreach"), "outreach");
  assertEquals(capabilityForObjective("compose", null), "outreach", "an unclassified compose takes the stricter rule");
  for (const o of ["read", "converse", "monitor", null, undefined]) assertEquals(capabilityForObjective(o, null), null);
});

Deno.test("G-3 decision 1: lead search runs before activation with industries plus buyers or must-haves", () => {
  assertFalse(readinessGate("source", null, readiness(LEAD_READY)).gated);
  assertFalse(readinessGate("source", null, readiness({ target_customer: { industries: ["Fintech"], must_have: ["SOC 2"] } })).gated);
  const blocked = readinessGate("source", null, readiness({ target_customer: { industries: ["Fintech"] } }));
  assert(blocked.gated);
  assertStringIncludes(blocked.reply, "lead search");
  assertStringIncludes(blocked.reply, "buyer persona or a must-have trait");
  // The old gate refused the same request outright.
  assert(shouldGateObjective("source", { onboarding_completed: false }));
});

Deno.test("G-4 decision 2: content drafts run with a description plus a pain point or content angle", () => {
  assertFalse(readinessGate("compose", "content", readiness(CONTENT_READY)).gated);
  assertFalse(readinessGate("compose", "content", readiness({ company: { description: "x" }, content_angles: ["y"] })).gated);
  const blocked = readinessGate("compose", "content", readiness({ company: { description: "x" } }));
  assert(blocked.gated);
  assertStringIncludes(blocked.reply, "pain point or a content angle");
});

Deno.test("G-5 outreach still needs a fully activated Brain", () => {
  const draftWithEverything = readiness({ ...LEAD_READY, ...CONTENT_READY, positioning: { promise: "Close faster" } });
  const g = readinessGate("compose", "outreach", draftWithEverything);
  assert(g.gated);
  assertStringIncludes(g.reply, "finish setting up your Company Brain");
  assertFalse(readinessGate("compose", "outreach", readiness({ positioning: { promise: "Close faster" } }, true)).gated);
});

Deno.test("G-6 decision 2: generated content is a draft until a person approves it; nothing publishes", () => {
  // The only backend write to content_item (Scribe's generation) sets status "draft".
  const writer = read("supabase/functions/_shared/memoryWriter.ts");
  const contentWrite = writer.slice(writer.indexOf('.from("content_item")'), writer.indexOf("[memoryWriter] content_item update failed"));
  assertStringIncludes(contentWrite, 'status: "draft"');
  // No edge function or shared module sets a content item to approved or publishes it.
  const offenders: string[] = [];
  const walk = (dir: URL) => {
    for (const e of Deno.readDirSync(dir)) {
      const u = new URL(e.name + (e.isDirectory ? "/" : ""), dir);
      if (e.isDirectory) walk(u);
      else if (/\.ts$/.test(e.name)) {
        const src = Deno.readTextFileSync(u);
        if (/content_item[\s\S]{0,400}status:\s*["']approved["']/.test(src) || /\bpublishContent\b|\bauto_?publish\b/i.test(src)) offenders.push(e.name);
      }
    }
  };
  walk(new URL("supabase/functions/", ROOT));
  assertEquals(offenders, [], "approval and publishing stay human actions");
  // Approval is the person's click in the content editor.
  assertStringIncludes(read("src/lib/content/contentService.ts"), "updateContentItem(itemId, { status: 'approved' })");
});

Deno.test("G-7 pilot-chat: V2 gates on readiness and gives a usable Brain as context; off, the old gate is untouched", () => {
  const src = read("supabase/functions/pilot-chat/index.ts");
  assert(/const readinessV2 = brainReadinessV2Enabled\(/.test(src));
  assert(/if \(readinessV2\) \{\s*const gate = readinessGate\(understood\.request\.objective, planCompose\(understood\.request\)\?\.kind \?\? null, brainReadiness\)/.test(src),
    "the gate asks the capability this request needs");
  assert(/\} else if \(shouldGateObjective\(understood\.request\.objective,\s*\{ onboarding_completed: brainOnboardedForGate \}\)\) \{\s*return await replyAndReturn\(ONBOARDING_GATE_REPLY/.test(src),
    "flag off: the original gate and reply");
  assert(/const contextAllowed = readinessV2 \? brainReadiness\.state !== "draft" : brainOnboardedForGate;/.test(src));
  assert(/const brainContextAllowed = readinessV2\s*\?\s*companyBrainReadiness\(/.test(src), "the reply layer uses the same rule");
});

Deno.test("G-8 run-agent: an admitted run on a usable Brain gets it as context; off, only an activated Brain", () => {
  const src = read("supabase/functions/run-agent/index.ts");
  assert(/const brainContextAllowed = brainReadinessV2Enabled\([\s\S]{0,120}\)\s*\?\s*companyBrainReadiness\(normalizeCompanyBrain\(brain \?\? \{\}\), brainOnboardingCompleted\)\.state !== "draft"\s*:\s*brainOnboardingCompleted;/.test(src));
  assert(src.includes("renderBrainForAgent(brain, brainContextAllowed)"));
  assert(src.includes("renderContentBrain(brainContextAllowed ? brain : null"));
  assertFalse(src.includes("renderBrainForAgent(brain, brainOnboardingCompleted)"));
});
