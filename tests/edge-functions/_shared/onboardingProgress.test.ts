// ONBOARDING PROGRESS IS SERVER STATE (roadmap Phase 2).
//
// The progress record (`onboarding_meta.setup`) is validated untrusted input,
// keeps only the wizard's own form fields (never consent), survives a reload,
// and ends at activation. The save_draft wiring — versioned only when progress
// is sent, conditional on the version read — is pinned structurally, because
// the edge handler starts `Deno.serve` on import.
import { assert, assertEquals, assertFalse } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  parseSetupProgress, readSetupProgress, SETUP_MAX_STEP, withoutSetupProgress, withSetupProgress,
} from "../../../supabase/functions/_shared/onboardingProgress.ts";

const NOW = "2026-10-23T10:00:00.000Z";

Deno.test("OP-1 progress keeps only the wizard's form fields, trimmed — never consent or unknown keys", () => {
  const r = parseSetupProgress({
    step: 2,
    answers: {
      company: { name: "  Northwind ", website_url: "https://northwind.example", secret: "x", team_size: "24" },
      founder: { name: "Ada", enrichment_consent: true, linkedin_url: "", first_help_goal: "Improve outbound" },
      research: { huge: "blob" },
    },
  });
  assert(r.ok);
  assertEquals(r.answers, {
    company: { name: "Northwind", website_url: "https://northwind.example", team_size: "24" },
    founder: { name: "Ada", first_help_goal: "Improve outbound" },
  });
});

Deno.test("OP-2 the step is a bounded integer; bad payloads are refused, not coerced", () => {
  for (const bad of [null, [], "2", { step: -1 }, { step: SETUP_MAX_STEP + 1 }, { step: 1.5 }, { step: "1" }]) {
    assertFalse(parseSetupProgress(bad).ok, JSON.stringify(bad));
  }
  assert(parseSetupProgress({ step: 0 }).ok);
  assert(parseSetupProgress({ step: SETUP_MAX_STEP }).ok);
});

Deno.test("OP-3 fields are capped and the record has a size limit", () => {
  const long = "x".repeat(5000);
  const r = parseSetupProgress({ step: 1, answers: { company: { description: long } } });
  assert(r.ok);
  assertEquals(r.answers.company?.description?.length, 2000);
  const all = Object.fromEntries(["name", "website_url", "linkedin_url", "description", "stage", "team_size"].map((k) => [k, long]));
  const founder = Object.fromEntries(["name", "role", "linkedin_url", "timezone", "first_help_goal"].map((k) => [k, long]));
  assertFalse(parseSetupProgress({ step: 1, answers: { company: all, founder } }).ok, "over 8 KB is refused");
});

Deno.test("OP-4 recorded progress round-trips through the profile and keeps other onboarding_meta keys", () => {
  const parsed = parseSetupProgress({ step: 3, answers: { company: { name: "Northwind" } } });
  assert(parsed.ok);
  const profile = withSetupProgress({ company: { name: "Northwind" }, onboarding_meta: { current_step: "review" } }, parsed, NOW);
  assertEquals((profile.onboarding_meta as Record<string, unknown>).current_step, "review");
  const reloaded = JSON.parse(JSON.stringify(profile)); // what device B reads
  assertEquals(readSetupProgress(reloaded), { version: 1, step: 3, answers: { company: { name: "Northwind" } }, updated_at: NOW });
});

Deno.test("OP-5 activation removes the progress record; reading tolerates old or foreign shapes", () => {
  const parsed = parseSetupProgress({ step: 5, answers: {} });
  assert(parsed.ok);
  const done = withoutSetupProgress(withSetupProgress({ onboarding_meta: { current_step: "x" } }, parsed, NOW));
  assertEquals(done.onboarding_meta, { current_step: "x" });
  assertEquals(readSetupProgress(done), null);
  assertEquals(readSetupProgress({ onboarding_meta: { setup: { version: 99, step: 1 } } }), null);
  assertEquals(readSetupProgress({ onboarding_meta: { setup: { version: 1, step: 42 } } }), null);
  assertEquals(readSetupProgress(null), null);
});

Deno.test("OP-6 save_draft: progress makes the save versioned and conditional; saves without it are unchanged", async () => {
  const src = await Deno.readTextFile(new URL("../../../supabase/functions/generate-company-brain-draft/index.ts", import.meta.url));
  const block = src.slice(src.indexOf('if (action === "save_draft" || action === "activate")'), src.indexOf('if (action === "status")'));
  assert(block.includes("parseSetupProgress(body.setup)"), "progress is validated");
  assert(/rejected_reason: "invalid_setup"[\s\S]{0,40}400/.test(block), "bad progress is a 400, not a silent drop");
  assert(/if \(setup && expectedUpdatedAt !== currentUpdatedAt\)/.test(block), "a versioned save must name the stored version");
  assert(/rejected_reason: "stale", current_updated_at: currentUpdatedAt, profile: existing \}, 409/.test(block),
    "a stale autosave gets the current copy back to merge against");
  assert(/setup && currentUpdatedAt !== null\s*\?\s*admin\.from\("company_brain"\)\.update\(row\)\.eq\("workspace_id", workspace_id\)\.eq\("updated_at", currentUpdatedAt\)/.test(block),
    "a versioned write lands only on the version read");
  assert(block.includes('upsert(row, { onConflict: "workspace_id" })'), "an unversioned save keeps the original upsert");
  assert(/if \(setup && !saved\.landed\) return staleDuringSave\(\)/.test(block), "a lost race is reported as stale");
  assert(/if \(result\.onboarding_completed\) result\.profile = withoutSetupProgress\(result\.profile\)/.test(block), "activation ends progress");
  assert(/ok: true, activated: result\.onboarding_completed, updated_at: saved\.updated_at/.test(block), "the new version is returned");
});
