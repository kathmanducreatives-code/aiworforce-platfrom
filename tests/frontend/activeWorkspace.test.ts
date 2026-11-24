// THE ACTIVE WORKSPACE IS DETERMINISTIC, AND A FAILED READ NEVER CREATES ONE
// (roadmap Phase 3b). Pure, plus source assertions on the two call sites.
import { assert, assertEquals, assertFalse } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { decideActiveWorkspace } from "../../src/lib/activeWorkspace.ts";

const ROOT = new URL("../../", import.meta.url);
const read = (p: string) => Deno.readTextFileSync(new URL(p, ROOT));
const A = { workspace_id: "aaaa", created_at: "2026-10-01T00:00:00Z" };
const B = { workspace_id: "bbbb", created_at: "2026-09-01T00:00:00Z" };
const C = { workspace_id: "cccc", created_at: "2026-09-01T00:00:00Z" };

Deno.test("AW-1 a failed read is an error — never a new workspace", () => {
  assertEquals(decideActiveWorkspace({ memberships: null, queryFailed: true, remembered: null }), { kind: "error" });
  assertEquals(decideActiveWorkspace({ memberships: [A], queryFailed: true, remembered: "aaaa" }), { kind: "error" });
});

Deno.test("AW-2 no memberships at all: provision (a genuinely new user)", () => {
  assertEquals(decideActiveWorkspace({ memberships: [], queryFailed: false, remembered: null }), { kind: "provision" });
});

Deno.test("AW-3 a remembered workspace is used only while it is still a membership", () => {
  assertEquals(decideActiveWorkspace({ memberships: [A, B], queryFailed: false, remembered: "aaaa" }),
    { kind: "use", workspaceId: "aaaa", reason: "remembered" });
  assertEquals(decideActiveWorkspace({ memberships: [A, B], queryFailed: false, remembered: "gone" }),
    { kind: "use", workspaceId: "bbbb", reason: "oldest" }, "a removed membership is never reused");
});

Deno.test("AW-4 otherwise the oldest membership, ties broken by id — the same answer whatever the row order", () => {
  for (const rows of [[A, B, C], [C, B, A], [B, A, C]]) {
    assertEquals(decideActiveWorkspace({ memberships: rows, queryFailed: false, remembered: null }),
      { kind: "use", workspaceId: "bbbb", reason: "oldest" });
  }
});

Deno.test("AW-5 getCurrentWorkspaceId: ordered read, error throws, provisions only on zero rows, remembers the choice", () => {
  const src = read("src/lib/orchestration.ts");
  const fn = src.slice(src.indexOf("export async function getCurrentWorkspaceId"), src.indexOf("// ---------------- Fetchers"));
  assertFalse(/\.limit\(1\)/.test(fn), "no arbitrary first row");
  assert(/\.order\('created_at', \{ ascending: true \}\)/.test(fn));
  assert(/if \(decision\.kind === 'error'\) throw new Error/.test(fn), "an error is surfaced to the retryable workspace gate");
  assertFalse(/if \(error \|\| !data\)/.test(fn), "the old provision-on-error branch is gone");
  assert(/if \(decision\.kind === 'provision'\)/.test(fn));
  assert(/rememberWorkspace\(userId, decision\.workspaceId\)/.test(fn));
});

Deno.test("AW-6 login routing reads the Brain of the workspace the app will open", () => {
  const src = read("src/pages/Auth.tsx");
  const fn = src.slice(src.indexOf("async function destinationForUser"), src.indexOf("const Auth = ()"));
  assert(/const workspaceId = await getCurrentWorkspaceId\(\);/.test(fn));
  assert(/\.eq\('workspace_id', workspaceId\)/.test(fn));
  assertFalse(/\.limit\(1\)/.test(fn));
});
