// WORKFORCE V2 SECURITY · a viewer may not start paid work. Unit + wiring.
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { canRunPaidOperation } from "../../../../supabase/functions/_shared/paidOperationRole.ts";

Deno.test("paid role: owner/admin/editor may spend; viewer and unknown roles may not", () => {
  for (const r of ["owner", "admin", "editor", "Editor "]) assert(canRunPaidOperation(r), r);
  for (const r of ["viewer", "member", "", null, undefined, "superuser"]) assertEquals(canRunPaidOperation(r), false, String(r));
});

Deno.test("paid role: every browser-reachable paid endpoint checks the role after membership", async () => {
  for (const f of ["firecrawl-scrape", "run-radar-scan", "run-lead-action", "generate-content-image"]) {
    const src = await Deno.readTextFile(new URL(`../../../../supabase/functions/${f}/index.ts`, import.meta.url));
    assert(src.includes(`select("workspace_id, role")`), `${f} reads the member's role`);
    assert(/canRunPaidOperation\(/.test(src), `${f} enforces the paid-operation role`);
  }
});
