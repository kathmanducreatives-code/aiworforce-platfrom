// The owner pilot script refuses anything outside the pilot limits, before any network call.
import { assertEquals, assertThrows } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { PILOT_LIMITS, pilotRequest } from "../../scripts/owner-pilot-run.ts";

Deno.test("owner pilot: TEST workspace, apify_only, no LeadOcean records, at most 3 companies and $0.05", () => {
  const r = pilotRequest("Find 3 US companies actively hiring Account Executives.", 3, 0.04, "pilot-x");
  assertEquals([r.workspace_id, r.strategy, r.max_leadocean_records, r.requested_count, r.max_apify_usd], ["40e2512f-09b6-433e-97fe-f9999a1f1897", "apify_only", 0, 3, 0.04]);
  assertThrows(() => pilotRequest("q", 4, 0.04, "w"), Error, "count");
  assertThrows(() => pilotRequest("q", 3, 0.06, "w"), Error, "Apify");
  assertThrows(() => pilotRequest("q", 3, 0, "w"), Error, "Apify");
  assertThrows(() => pilotRequest(" ", 3, 0.04, "w"), Error, "query");
  assertEquals(PILOT_LIMITS, { maxCount: 3, maxApifyUsd: 0.05, strategy: "apify_only" });
});

Deno.test("owner pilot: the script targets TEST only and never prints a token", async () => {
  const src = await Deno.readTextFile(new URL("../../scripts/owner-pilot-run.ts", import.meta.url));
  assertEquals(src.includes("ohsdatpvfdjdemstoiuj"), false, "no production project reference");
  assertEquals(/console\.log\([^)]*(approval_token|access_token|password|jwt)\b/.test(src), false, "no secret is printed");
});
