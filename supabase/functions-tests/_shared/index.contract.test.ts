// Source-contract guard for generate-company-brain-draft.
//
// `company_brain` has exactly these columns: workspace_id, profile,
// onboarding_completed, onboarding_completed_at, created_at, updated_at.
// Writing anything else (notably `signal_preferences`) makes the upsert fail at
// runtime — a bug that unit tests on pure modules cannot catch, because the
// mistake lives in the row literal handed to Supabase.
//
// Run with: deno test --allow-read
// No network, no providers, no DB.

import { assert } from "https://deno.land/std@0.224.0/assert/mod.ts";

const SRC = new URL("./index.ts", import.meta.url);

/** Columns that actually exist on public.company_brain. */
const REAL_COLUMNS = [
  "workspace_id", "profile", "onboarding_completed", "onboarding_completed_at",
  "created_at", "updated_at",
];

Deno.test("activate never writes signal_preferences as a company_brain column", async () => {
  const src = await Deno.readTextFile(SRC);
  assert(
    !/row\.signal_preferences\s*=/.test(src),
    "signal_preferences must live inside `profile`, not on the row",
  );
  assert(
    !/signal_preferences\s*:/.test(src.replace(/\/\/.*$/gm, "")),
    "no signal_preferences key may appear in an upsert row literal",
  );
});

Deno.test("only real company_brain columns are assigned onto the upsert row", async () => {
  const src = await Deno.readTextFile(SRC);
  // Collect every `row.<key> =` assignment.
  const assigned = [...src.matchAll(/\brow\.([a-z_]+)\s*=/g)].map((m) => m[1]);
  for (const key of assigned) {
    assert(REAL_COLUMNS.includes(key), `row.${key} is not a real company_brain column`);
  }
});

Deno.test("the handler still persists the profile and completes onboarding", async () => {
  const src = await Deno.readTextFile(SRC);
  assert(/profile:\s*result\.profile/.test(src), "profile must be persisted");
  assert(/row\.onboarding_completed\s*=\s*true/.test(src), "activation must set onboarding_completed");
});

Deno.test("no provider is called from the save/activate path", async () => {
  const src = await Deno.readTextFile(SRC);
  const saveBlock = src.slice(src.indexOf('action === "save_draft"'));
  assert(!/api\.apify\.com|api\.firecrawl\.dev/.test(saveBlock), "save/activate must not call a provider");
});
