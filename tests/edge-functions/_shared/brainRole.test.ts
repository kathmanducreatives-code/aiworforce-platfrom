// WHO MAY DO WHAT TO THE COMPANY BRAIN (roadmap Phase 3a; owner decision P3-D1).
//
// owner, admin, editor, viewer — anything else is a viewer. A viewer reads; an
// editor edits; only owner/admin activate. Both Brain handlers check the role
// right after membership and BEFORE any model call or write, so a refused
// caller costs nothing and changes nothing. The browser cannot write the table
// at all (tests/db-contract/companyBrainServerWrites.contract.test.ts).
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  brainPermissionForAction, canBrain, normalizeWorkspaceRole, type BrainPermission, type WorkspaceRole,
} from "../../../supabase/functions/_shared/brainRole.ts";

const ROOT = new URL("../../../", import.meta.url);
const read = (p: string) => Deno.readTextFileSync(new URL(p, ROOT));

Deno.test("R3-1 the four roles; anything else fails closed as a viewer", () => {
  for (const r of ["owner", "admin", "editor", "viewer"]) assertEquals(normalizeWorkspaceRole(r), r);
  assertEquals(normalizeWorkspaceRole(" Admin "), "admin");
  for (const r of ["member", "operator", "superuser", "", null, undefined, 7, {}]) assertEquals(normalizeWorkspaceRole(r), "viewer", String(r));
});

Deno.test("R3-2 the permission matrix", () => {
  const matrix: Record<WorkspaceRole, Record<BrainPermission, boolean>> = {
    owner: { read: true, edit: true, activate: true },
    admin: { read: true, edit: true, activate: true },
    editor: { read: true, edit: true, activate: false },
    viewer: { read: true, edit: false, activate: false },
  };
  for (const [role, perms] of Object.entries(matrix)) {
    for (const [perm, allowed] of Object.entries(perms)) {
      assertEquals(canBrain(role as WorkspaceRole, perm as BrainPermission), allowed, `${role} ${perm}`);
    }
  }
});

Deno.test("R3-3 every draft-function action needs edit, except status (read) and activate (activate); unknown needs edit", () => {
  assertEquals(brainPermissionForAction("status"), "read");
  assertEquals(brainPermissionForAction("activate"), "activate");
  for (const a of ["update", "save_draft", "draft", "research_founder", "research_company", "something_new", ""]) {
    assertEquals(brainPermissionForAction(a), "edit", a);
  }
});

function assertRoleGateFirst(file: string, gate: RegExp, laterMarkers: RegExp[]) {
  const src = read(file);
  const g = src.search(gate);
  assert(g > 0, `${file}: role gate present`);
  for (const m of laterMarkers) {
    const i = src.search(m);
    assert(i > g, `${file}: ${m} comes after the role gate`);
  }
}

Deno.test("R3-4 generate-company-brain-draft checks the role after membership and before any model call or write", () => {
  const f = "supabase/functions/generate-company-brain-draft/index.ts";
  const src = read(f);
  assert(src.includes('.from("workspace_members").select("workspace_id, role")'), "reads the caller's role");
  assert(/if \(!canBrain\(role, required\)\) return json\(\{ error: "brain_role_forbidden", role, required \}, 403\);/.test(src));
  assertRoleGateFirst(f, /if \(!canBrain\(role, required\)\)/, [
    /= buildDeps\(\);/,                            // model and provider dependencies (the call)
    /if \(action === "research_founder"\)/,         // first action
    /authorizedBrainWrite\(admin/,                  // every Brain write (re-authorized again in its transaction)
  ]);
});

Deno.test("R3-5 setup-company-brain checks the role before any model call or write; finalize needs activate", () => {
  const f = "supabase/functions/setup-company-brain/index.ts";
  const src = read(f);
  assert(src.includes('.from("workspace_members").select("workspace_id, role")'));
  assert(src.includes('const required = action === "finalize" ? "activate" : "edit";'));
  assertRoleGateFirst(f, /if \(!canBrain\(role, required\)\)/, [
    /if \(action === "save_basics"\)/,
    /if \(action === "analyze"\)/,
    /saveProfile\(patch, \{ activate: true \}\)/,   // finalize: the activating write
  ]);
});
