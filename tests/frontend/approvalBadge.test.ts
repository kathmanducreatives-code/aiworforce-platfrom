import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { approvalBadge } from "../../src/lib/nav/approvalBadge.ts";

Deno.test("Awaiting You badge states only real pending work", () => {
  assertEquals(approvalBadge(0, false), undefined);
  assertEquals(approvalBadge(3, true), undefined, "no number while loading");
  assertEquals(approvalBadge(1, false), "1");
  assertEquals(approvalBadge(2, false), "2");
  assertEquals(approvalBadge(120, false), "99+");
  assertEquals(approvalBadge(Number.NaN, false), undefined);
});

Deno.test("the sidebar carries no hard-coded badge numbers", async () => {
  const src = await Deno.readTextFile(new URL("../../src/components/Sidebar.tsx", import.meta.url));
  assertEquals(src.match(/badge:\s*'[^']*'/g), null);
});
