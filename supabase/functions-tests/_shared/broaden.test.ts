// Tests for broaden.ts role expansion — including the assistant / founder-support
// alias set that drives actor input + acceptance.
//
// Run with: supabase--test_edge_functions

import { assertEquals, assert } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { roleAliases, SUPPORT_ROLE_ALIASES, SUPPORT_ROLE_RE, isSupportRoleText } from "../../functions/_shared/broaden.ts";

Deno.test("roleAliases: assistant role expands to the full support alias set", () => {
  for (const role of ["assistant", "Executive Assistant", "executive assistant", "admin", "Chief of Staff"]) {
    const aliases = roleAliases(role);
    assert(aliases.length >= SUPPORT_ROLE_ALIASES.length, `${role} should expand to the full support set`);
    assert(aliases.some((a) => /executive assistant/i.test(a)), `${role} → should include Executive Assistant`);
    assert(aliases.some((a) => /chief of staff/i.test(a)), `${role} → should include Chief of Staff`);
    assert(aliases.some((a) => /founder/i.test(a)), `${role} → should include founder-support variants`);
  }
});

Deno.test("roleAliases: GTM role still expands to GTM aliases (no regression)", () => {
  const aliases = roleAliases("gtm");
  assert(aliases.some((a) => /sales/i.test(a)));
  assert(aliases.some((a) => /SDR/i.test(a)));
  assert(!aliases.some((a) => /executive assistant/i.test(a)), "GTM must not pull in support aliases");
});

Deno.test("roleAliases: empty input returns []", () => {
  assertEquals(roleAliases(""), []);
  assertEquals(roleAliases(null), []);
  assertEquals(roleAliases(undefined), []);
});

Deno.test("SUPPORT_ROLE_RE: matches assistant / founder-support variants", () => {
  for (const t of [
    "Executive Assistant", "executive assistants", "Administrative Assistant",
    "Operations Associate", "Virtual Assistant", "Personal Assistant",
    "Chief of Staff", "Office Manager", "EA to CEO", "Assistant to the Founder",
    "Founder's Office", "Founder Office", "founders office", "Founder Associate",
    "assistant", "admin",
  ]) {
    assert(SUPPORT_ROLE_RE.test(t), `should match: ${t}`);
    assert(isSupportRoleText(t), `isSupportRoleText should be true: ${t}`);
  }
});

Deno.test("SUPPORT_ROLE_RE: does not match unrelated roles", () => {
  for (const t of ["Co-Founder", "CEO", "CTO", "Software Engineer", "SDR", "Head of Growth"]) {
    assert(!SUPPORT_ROLE_RE.test(t), `should NOT match: ${t}`);
  }
});

Deno.test("SUPPORT_ROLE_ALIASES: includes the Phase-5 canonical list", () => {
  // The actor-input alias list the spec requires.
  for (const required of ["Executive Assistant", "Founder Assistant", "Assistant to Founder", "Assistant to CEO", "Operations Assistant", "Admin Assistant", "Administrative Assistant", "Virtual Assistant", "Personal Assistant", "Chief of Staff", "Operations Associate", "Office Manager", "EA to CEO", "EA to Founder"]) {
    assert(SUPPORT_ROLE_ALIASES.includes(required), `missing canonical alias: ${required}`);
  }
});
