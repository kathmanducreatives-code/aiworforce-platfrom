// THE HOME GREETING — band edges, names, and when it may change.
//
// PURE. No DOM, no clock of its own.

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { greetingFor, greetingName, greetingVariantsFor, msUntilNextHour } from "../../src/lib/greeting.ts";

const at = (h: number, m = 0) => new Date(2026, 8, 16, h, m, 0, 0);

Deno.test("each band starts exactly on its hour and ends one minute before the next", () => {
  assertEquals(greetingFor(at(4, 59)), "Working late");
  assertEquals(greetingFor(at(5, 0)), "Good morning");
  assertEquals(greetingFor(at(11, 59)), "Good morning");
  assertEquals(greetingFor(at(12, 0)), "Good afternoon");
  assertEquals(greetingFor(at(16, 59)), "Good afternoon");
  assertEquals(greetingFor(at(17, 0)), "Good evening");
  assertEquals(greetingFor(at(21, 59)), "Good evening");
  assertEquals(greetingFor(at(22, 0)), "Working late");
  assertEquals(greetingFor(at(0, 0)), "Working late");
});

Deno.test("the name is the first word, first letter raised; no name is null, never invented", () => {
  assertEquals(greetingName("prasidha"), "Prasidha");
  assertEquals(greetingName("  maya  rai "), "Maya");
  assertEquals(greetingName("Élodie Martin"), "Élodie");
  assertEquals(greetingName(""), null);
  assertEquals(greetingName("   "), null);
  assertEquals(greetingName(null), null);
  assertEquals(greetingName(undefined), null);
});

Deno.test("each time band has a personal greeting followed by restrained rotating copy", () => {
  for (const hour of [6, 13, 18, 23]) {
    const variants = greetingVariantsFor(at(hour, 0));
    assertEquals(variants.length, 4);
    assertEquals(variants[0], { text: greetingFor(at(hour, 0)), personal: true });
    assertEquals(variants.slice(1).every((variant) => !variant.personal && variant.text.length <= 36), true);
  }
});

Deno.test("the next possible change is the top of the next hour", () => {
  assertEquals(msUntilNextHour(at(11, 59)), 60_000);
  assertEquals(msUntilNextHour(at(9, 0)), 3_600_000);
  assertEquals(msUntilNextHour(new Date(2026, 8, 16, 23, 30, 15, 500)), 29 * 60_000 + 44_500);
});
