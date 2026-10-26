// A held migration still needs a unique version before it can be integrated.
// Rollback files intentionally repeat their up migration and are not inputs.
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
function collisions(paths: string[]) {
  const versions = new Map<string, string[]>();
  for (const path of paths) {
    const match = /^supabase\/(?:migrations|migrations-held)\/(\d+)_.*\.sql$/
      .exec(path);
    if (match) {
      versions.set(match[1], [...(versions.get(match[1]) ?? []), path]);
    }
  }
  return [...versions].filter(([, files]) => files.length > 1);
}
Deno.test("migration versions: active and held inputs share one unique version namespace", () => {
  const paths = ["supabase/migrations", "supabase/migrations-held"].flatMap((
    dir,
  ) =>
    [...Deno.readDirSync(dir)].filter((entry) => entry.isFile).map((entry) =>
      `${dir}/${entry.name}`
    )
  );
  assertEquals(
    collisions(paths),
    [],
    "Reconcile duplicate held/active versions before integration; never apply both blindly",
  );
});
Deno.test("migration versions: distinct held names with the same version are a collision (107/108)", () => {
  assertEquals(
    collisions([
      "supabase/migrations-held/20261019120000_lead_mission_exhausted_claim_recovery.sql",
      "supabase/migrations-held/20261019120000_lead_mission_v2_exhausted_lease_terminal.sql",
    ]).length,
    1,
  );
});
Deno.test("migration versions: rollback companions and non-SQL documents are excluded", () => {
  assertEquals(
    collisions([
      "supabase/migrations-held/123_up.sql",
      "supabase/migrations-held/rollback/123_up.down.sql",
      "supabase/migrations-held/123_notes.md",
    ]),
    [],
  );
  assertEquals(
    collisions([
      "supabase/migrations/123_first.sql",
      "supabase/migrations-held/123_second.sql",
    ]).length,
    1,
  );
});
