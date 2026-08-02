// Signals V2 feature-flag — provider-free unit tests (test matrix §1-7 flag half).
// The flag is the single safety gate: only three explicit values enable dual-write;
// everything else — typos, "yes", "on", numbers, undefined — resolves OFF.

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  isSignalsV2Enabled,
  parseSignalsV2Flag,
  SIGNALS_V2_FLAG,
} from "../../functions/_shared/signalsV2Flag.ts";

// 1. defaults OFF (no env / empty reader) -------------------------------------
Deno.test("flag defaults OFF when unset", () => {
  assertEquals(isSignalsV2Enabled(() => undefined), false);
});

// 2. undefined / empty OFF -----------------------------------------------------
Deno.test("undefined and empty string are OFF", () => {
  assertEquals(parseSignalsV2Flag(undefined), false);
  assertEquals(parseSignalsV2Flag(null), false);
  assertEquals(parseSignalsV2Flag(""), false);
  assertEquals(parseSignalsV2Flag("   "), false);
});

// 3. random non-empty OFF ------------------------------------------------------
Deno.test("random non-empty strings are OFF", () => {
  for (const v of ["yes", "on", "TRUE!", "2", "enable", "enabledx", "y", "ok", "banana"]) {
    assertEquals(parseSignalsV2Flag(v), false, `"${v}" must be OFF`);
  }
});

// 4. false / 0 / disabled OFF --------------------------------------------------
Deno.test("false, 0, disabled are OFF", () => {
  for (const v of ["false", "0", "disabled", "FALSE", "Disabled", "no"]) {
    assertEquals(parseSignalsV2Flag(v), false, `"${v}" must be OFF`);
  }
});

// 5. true / 1 / enabled ON (case-insensitive, trimmed) -------------------------
Deno.test("true, 1, enabled are ON (case-insensitive + trimmed)", () => {
  for (const v of ["true", "1", "enabled", "TRUE", "Enabled", "  true  ", "ENABLED"]) {
    assertEquals(parseSignalsV2Flag(v), true, `"${v}" must be ON`);
  }
});

Deno.test("isSignalsV2Enabled reads the canonical key via an injected reader", () => {
  const on = (k: string) => (k === SIGNALS_V2_FLAG ? "enabled" : undefined);
  const off = (k: string) => (k === SIGNALS_V2_FLAG ? "nope" : undefined);
  assertEquals(isSignalsV2Enabled(on), true);
  assertEquals(isSignalsV2Enabled(off), false);
});

Deno.test("a throwing reader resolves OFF, never throws", () => {
  assertEquals(isSignalsV2Enabled(() => { throw new Error("env denied"); }), false);
});
