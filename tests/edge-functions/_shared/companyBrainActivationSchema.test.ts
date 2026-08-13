// REGRESSION: Company Brain activation wrote a column the schema never declared.
//
// `generate-company-brain-draft` (action="activate") upserts
// `company_brain.onboarding_completed_at` on a SUCCESSFUL activation only. The
// TEST project was missing that column (canonical migration 20260531101103 was
// never applied there), so the upsert failed with Postgres 42703, the edge
// function returned 500, and the onboarding UI surfaced the generic
// "Save failed - Nothing was lost - try again."
//
// It only ever broke on success: `save_draft` and a BLOCKED activation both
// upsert without that column, so every earlier step of onboarding passed.
//
// These tests are structural and pure - no DB, no network. They fail if the
// activate path ever writes a `company_brain` column that no migration declares.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

const fnSrc = () =>
  Deno.readTextFile(
    new URL("../../../supabase/functions/generate-company-brain-draft/index.ts", import.meta.url),
  );

/** Columns declared on public.company_brain across all migration files. */
async function declaredColumns(): Promise<Set<string>> {
  const dirUrl = new URL("../../../supabase/migrations/", import.meta.url);
  const cols = new Set<string>();
  for await (const entry of Deno.readDir(dirUrl)) {
    if (!entry.isFile || !entry.name.endsWith(".sql")) continue;
    const sql = await Deno.readTextFile(new URL(entry.name, dirUrl));

    // ALTER TABLE ... company_brain ... ADD COLUMN [IF NOT EXISTS] <name>
    const alterBlocks = sql.split(/ALTER\s+TABLE/i).slice(1);
    for (const block of alterBlocks) {
      if (!/company_brain/i.test(block.slice(0, 120))) continue;
      for (const m of block.matchAll(/ADD\s+COLUMN\s+(?:IF\s+NOT\s+EXISTS\s+)?([a-z_][a-z0-9_]*)/gi)) {
        cols.add(m[1].toLowerCase());
      }
    }

    // CREATE TABLE ... company_brain ( <name> <type>, ... )
    for (const m of sql.matchAll(
      /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:public\.)?company_brain\s*\(([\s\S]*?)\n\s*\);/gi,
    )) {
      for (const line of m[1].split("\n")) {
        const col = line.trim().match(/^([a-z_][a-z0-9_]*)\s+[a-z]/i);
        if (col && !/^(primary|unique|constraint|foreign|check)$/i.test(col[1])) {
          cols.add(col[1].toLowerCase());
        }
      }
    }
  }
  return cols;
}

/**
 * Columns the activate path assigns onto the upserted row.
 *
 * Matches both the literal `{ workspace_id, profile, updated_at }` row and the
 * conditional `row.<col> = ...` assignments that only run on activation.
 */
async function writtenColumns(src: string): Promise<Set<string>> {
  const cols = new Set<string>(["workspace_id", "profile", "updated_at"]);
  for (const m of src.matchAll(/\brow\.([a-z_][a-z0-9_]*)\s*=/g)) cols.add(m[1].toLowerCase());
  return cols;
}

Deno.test("activation writes onboarding_completed_at, and a migration declares it", async () => {
  const src = await fnSrc();
  assert(
    /row\.onboarding_completed_at\s*=/.test(src),
    "activate path no longer sets onboarding_completed_at - update this test if that is intentional",
  );

  const declared = await declaredColumns();
  assert(
    declared.has("onboarding_completed_at"),
    "no migration declares company_brain.onboarding_completed_at - activation will fail with 42703",
  );
  assert(
    declared.has("onboarding_completed"),
    "no migration declares company_brain.onboarding_completed",
  );
});

Deno.test("every company_brain column the activate path writes is declared by a migration", async () => {
  const src = await fnSrc();
  const written = await writtenColumns(src);
  const declared = await declaredColumns();

  const undeclared = [...written].filter((c) => !declared.has(c)).sort();
  assertEquals(
    undeclared,
    [],
    `activate upsert writes company_brain column(s) no migration declares: ${undeclared.join(", ")}. ` +
      "This is exactly the 42703 -> 500 -> \"Save failed\" regression.",
  );
});

Deno.test("the blocked-activation upsert stays narrower than the success upsert", async () => {
  // The blocked path must NOT write onboarding_completed_at - that is what kept
  // every pre-activation step working while activation alone failed, and it is
  // the property that makes this bug reproduce only at Step 5.
  const src = await fnSrc();
  const blocked = src.match(
    /if\s*\(action === "activate" && !result\.onboarding_completed\)\s*\{[\s\S]*?\n\s{6}\}/,
  );
  assert(blocked, "could not locate the blocked-activation branch");
  assert(
    !/onboarding_completed_at/.test(blocked[0]),
    "blocked-activation branch must not write onboarding_completed_at",
  );
});
