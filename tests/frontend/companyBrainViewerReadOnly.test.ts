// A VIEWER SEES THE COMPANY BRAIN READ-ONLY (roadmap Phase 3a, owner decision P3-D1).
//
// The server is the boundary — the browser cannot write the table and the Brain
// handlers refuse a viewer before any model call — so this is honesty, not
// security: a viewer's page offers no control that would only be refused.
// Browser-checked with the preview harness (?role=viewer): zero buttons in
// every panel, all sentence slots static, no Edit section / Re-run setup /
// pencil; owner and editor keep every control; a legacy 'member' is a viewer.
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { canBrain, normalizeWorkspaceRole } from "../../src/lib/brainRole.ts";

const ROOT = new URL("../../", import.meta.url);
const read = (p: string) => Deno.readTextFileSync(new URL(p, ROOT));

Deno.test("V-1 the page uses the server's rule: owner/admin/editor edit, viewer and anything else read", () => {
  for (const r of ["owner", "admin", "editor"]) assert(canBrain(normalizeWorkspaceRole(r), "edit"), r);
  for (const r of ["viewer", "member", "", null, "Owner2"]) assertEquals(canBrain(normalizeWorkspaceRole(r), "edit"), false, String(r));
  assertEquals(canBrain("editor", "activate"), false);
});

Deno.test("V-2 every in-place editor and edit affordance reads the editable context", () => {
  const inline = read("src/components/company-brain/InlineEdit.tsx");
  assertEquals((inline.match(/const editable = useBrainEditable\(\);/g) ?? []).length, 2, "InlineChips and InlineText");
  assert(/const addControl = !editable \? null/.test(inline));
  assertEquals((inline.match(/\{editable && <button type="button" className="brain-chip-x"/g) ?? []).length, 3, "chips, rows, people");
  const overview = read("src/components/company-brain/BrainOverview.tsx");
  assert(/\{editable && <><DropdownMenu>/.test(overview), "Edit section and Re-run setup");
  assert(/\{editable && <button type="button" className="brain-icon-btn"/.test(overview), "identity pencil");
  assert(/if \(!editable\) return <>\{' '\}<span className=\{cn\(cls, 'is-static'\)\}>/.test(overview), "sentence slots");
  const panels = read("src/components/company-brain/BrainSectionPanels.tsx");
  assert(/if \(!useBrainEditable\(\)\) return null;/.test(panels), "move-to menu");
  assert(/\{editable \? \(\s*<button type="button" className=\{cn\('brain-text-view'/.test(panels), "company size");
});

Deno.test("V-3 the page provides the context from the user's role, and the role fails closed while unknown", () => {
  const page = read("src/pages/CompanyBrainDashboard.tsx");
  assert(/const \{ canEditBrain \} = useWorkspaceRole\(\);/.test(page));
  assert(/<BrainEditableContext\.Provider value=\{canEditBrain\}><BrainOverview/.test(page));
  const hook = read("src/hooks/useWorkspaceRole.ts");
  assert(/const role = q\.data \?\? 'viewer';/.test(hook), "loading or unreadable → viewer");
  assert(/\.eq\('user_id', user!\.id\)/.test(hook), "reads the caller's own membership only");
});
