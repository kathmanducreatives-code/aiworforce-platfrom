// THE PAGE AND THE SERVER APPLY THE SAME ROLE RULE (roadmap Phase 3a).
//
// The server decides (supabase/functions/_shared/brainRole.ts); the page's copy
// (src/lib/brainRole.ts) only decides what a viewer is shown. They must be the
// same code, and give the same answer for every role and permission, or a
// viewer would be offered an edit the server refuses (or an editor denied one).
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import * as server from "../../../supabase/functions/_shared/brainRole.ts";
import * as page from "../../../src/lib/brainRole.ts";

Deno.test("RP-1 the two copies are the same code apart from their header comment", async () => {
  const strip = (s: string) => s.replace(/^\/\/.*$/gm, "").replace(/\s+/g, " ").trim();
  const a = await Deno.readTextFile(new URL("../../../supabase/functions/_shared/brainRole.ts", import.meta.url));
  const b = await Deno.readTextFile(new URL("../../../src/lib/brainRole.ts", import.meta.url));
  assertEquals(strip(b), strip(a));
});

Deno.test("RP-2 same answers for every role value, permission and action", () => {
  const roles = ["owner", "admin", "editor", "viewer", "member", "Owner", " admin ", "", null, undefined, 3];
  for (const r of roles) {
    const sr = server.normalizeWorkspaceRole(r), pr = page.normalizeWorkspaceRole(r);
    assertEquals(pr, sr, String(r));
    for (const p of ["read", "edit", "activate"] as const) assertEquals(page.canBrain(pr, p), server.canBrain(sr, p), `${String(r)} ${p}`);
  }
  for (const a of ["status", "activate", "update", "save_draft", "draft", "research_company", "x"]) {
    assertEquals(page.brainPermissionForAction(a), server.brainPermissionForAction(a), a);
  }
});
