// THE DEFAULT SUPABASE URL AND KEY NAME ONE PROJECT.
//
// Until 2026-09-30 the client defaulted to the production URL
// (ohsdatpvfdjdemstoiuj) with the OLD Lovable-Cloud project's anon key
// (wqnigjhcwjxtmordrwno): a build without VITE_SUPABASE_PUBLISHABLE_KEY could
// sign nobody in. These tests hold the pair together and prove the guard the
// production build and the client both use refuses a mixed pair.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  PRODUCTION_SUPABASE_PROJECT_REF, PRODUCTION_SUPABASE_PUBLISHABLE_KEY, PRODUCTION_SUPABASE_URL,
  projectRefOfKey, projectRefOfUrl, supabaseTargetMismatch,
} from "../../src/integrations/supabase/productionTarget.ts";

const OLD_LOVABLE_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Indxbmlnamhjd2p4dG1vcmRyd25vIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzcxNzQ0NjUsImV4cCI6MjA5Mjc1MDQ2NX0.GelbMIlFnirbVFu50ywoFekbHSBcg_v2hc3dIVHMPog";

Deno.test("1. the production URL and key belong to the same project", () => {
  assertEquals(projectRefOfUrl(PRODUCTION_SUPABASE_URL), PRODUCTION_SUPABASE_PROJECT_REF);
  assertEquals(projectRefOfKey(PRODUCTION_SUPABASE_PUBLISHABLE_KEY), PRODUCTION_SUPABASE_PROJECT_REF);
  assertEquals(supabaseTargetMismatch(PRODUCTION_SUPABASE_URL, PRODUCTION_SUPABASE_PUBLISHABLE_KEY), null);
});

Deno.test("2. the old pairing — production URL, Lovable-Cloud key — is refused", () => {
  const m = supabaseTargetMismatch(PRODUCTION_SUPABASE_URL, OLD_LOVABLE_KEY);
  assert(m && m.includes("ohsdatpvfdjdemstoiuj") && m.includes("wqnigjhcwjxtmordrwno"), String(m));
});

Deno.test("3. only what can be proven is refused", () => {
  // A modern publishable key names no project; a custom domain names no ref.
  assertEquals(projectRefOfKey("sb_publishable_abc123"), null);
  assertEquals(supabaseTargetMismatch(PRODUCTION_SUPABASE_URL, "sb_publishable_abc123"), null);
  assertEquals(supabaseTargetMismatch("https://api.example.com", OLD_LOVABLE_KEY), null);
  assertEquals(projectRefOfKey("not-a-jwt"), null);
  assertEquals(projectRefOfUrl("http://localhost:54321"), null);
});

Deno.test("4. the client and the build both use the guard, and no old key remains", async () => {
  const client = await Deno.readTextFile(new URL("../../src/integrations/supabase/client.ts", import.meta.url));
  const vite = await Deno.readTextFile(new URL("../../vite.config.ts", import.meta.url));
  assert(client.includes("supabaseTargetMismatch(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY)"),
    "the client must refuse a mixed URL/key pair at startup");
  assert(client.includes("?? PRODUCTION_SUPABASE_PUBLISHABLE_KEY"),
    "the client's default key must be the production target's");
  assert(vite.includes('command === "build" && mode === "production"') && vite.includes("supabaseTargetMismatch("),
    "a production build must refuse a mixed URL/key pair");
  for (const [name, src] of [["client.ts", client], ["vite.config.ts", vite]]) {
    assert(!src.includes(OLD_LOVABLE_KEY.split(".")[1]),
      `${name} must not carry the old Lovable-Cloud key`);
  }
});
