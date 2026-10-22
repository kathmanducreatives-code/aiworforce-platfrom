// DRY RUN — report which stored Company Brains a save would still repair.
//
//   deno run --allow-read scripts/company-brain/reconcile-dry-run.ts <rows.json>
//
// <rows.json> is a JSON array of { workspace_id, profile } — an export made
// separately, under its own approval. This script has NO network or database
// access (run it with --allow-read only), writes nothing, and prints counts,
// paths and workspace ids — never a profile value.
//
// The assessment is the write paths' own reconcile (companyBrainReconcile.ts),
// so "would change" means "the next save of that row would change it".
import { assessBrains } from "../../supabase/functions/_shared/companyBrainReconcile.ts";

const path = Deno.args[0];
if (!path || Deno.args.length !== 1) {
  console.error("usage: reconcile-dry-run.ts <rows.json>   (array of { workspace_id, profile })");
  Deno.exit(2);
}
const rows = JSON.parse(await Deno.readTextFile(path));
if (!Array.isArray(rows) || rows.some((r) => !r || typeof r.workspace_id !== "string")) {
  console.error("expected a JSON array of { workspace_id, profile }");
  Deno.exit(2);
}
console.log(JSON.stringify(assessBrains(rows), null, 2));
