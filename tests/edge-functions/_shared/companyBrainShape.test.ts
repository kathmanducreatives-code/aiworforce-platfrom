// The Company Brain gate must read the schema onboarding ACTUALLY persists.
//
// Regression cover for the 2026-07-19 16:17 request: a complete, onboarded
// Company Brain (45 profile keys, onboarding_completed = true) was read as
// entirely absent and blocked the opener with `blocked_missing_company_brain`,
// because the mapper expected a flat `positioning` string / `product_summary` /
// `target_outcomes` while the stored profile is nested and differently named.
//
// Fixtures are SYNTHETIC. They mirror the SHAPE of the production record only —
// no real company text. No network, database, provider or model.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { brainContextFromProfile } from "../../../supabase/functions/_shared/openerBackend.ts";

/**
 * The nested shape onboarding writes. `positioning` also carries char-indexed
 * keys ("0", "1", …) from a historical string-spread — deliberately reproduced
 * here, because the mapper must ignore that noise rather than reassemble it.
 */
function nestedBrain(overrides: Record<string, unknown> = {}) {
  return {
    company_summary: "A synthetic company summary for tests.",
    offer_summary: "A synthetic offer summary.",
    short_description: "Synthetic short description.",
    positioning: {
      "0": "A", "1": "b", "2": "c",
      promise: "A synthetic promise statement.",
      offer: "A synthetic offer statement.",
      differentiators: ["synthetic differentiator"],
      proof_points: ["synthetic proof point"],
      use_cases: ["synthetic use case"],
      avoid_positioning: ["never claim synthetic certification"],
    },
    brand_voice: {
      "0": "x", "1": "y",
      tone: "direct",
      avoid: ["no hype words"],
    },
    pain_points: ["synthetic pain point"],
    outreach_style: "short and plain",
    negative_examples: ["never promise guaranteed results"],
    ...overrides,
  };
}

// ------------------------------------------------------------- the core bug ---

Deno.test("a nested onboarded Company Brain is AVAILABLE, not missing", () => {
  const b = brainContextFromProfile(nestedBrain());
  assertEquals(b.available, true);
});

Deno.test("nested positioning resolves from promise, not the char-index noise", () => {
  const b = brainContextFromProfile(nestedBrain());
  assertEquals(b.positioning, "A synthetic promise statement.");
  // The "0"/"1"/"2" keys must never be reassembled into prose.
  assert(!b.positioning?.startsWith("Abc"), "char-indexed keys leaked into positioning");
});

Deno.test("the product summary falls back through the canonical names", () => {
  assertEquals(
    brainContextFromProfile(nestedBrain()).product_summary,
    "A synthetic company summary for tests.",
  );
  // company_summary absent → offer_summary
  const noCompany = nestedBrain();
  delete (noCompany as Record<string, unknown>).company_summary;
  assertEquals(brainContextFromProfile(noCompany).product_summary, "A synthetic offer summary.");
});

Deno.test("outcomes resolve from nested use_cases when no flat list exists", () => {
  assertEquals(brainContextFromProfile(nestedBrain()).outcomes, ["synthetic use case"]);
});

Deno.test("differentiators and proof read the nested positioning arrays", () => {
  const b = brainContextFromProfile(nestedBrain());
  assertEquals(b.differentiators, ["synthetic differentiator"]);
  assertEquals(b.proof, ["synthetic proof point"]);
});

Deno.test("tone resolves from brand_voice", () => {
  assertEquals(brainContextFromProfile(nestedBrain()).tone, "direct");
});

// ------------------------------------------------------------------ safety ----

Deno.test("prohibited claims are the UNION of every source, never first-wins", () => {
  // Dropping a prohibition because another list was non-empty would let a
  // forbidden claim through.
  const b = brainContextFromProfile(nestedBrain({
    prohibited_claims: ["never claim SOC2"],
  }));
  assert(b.prohibited_claims.includes("never claim SOC2"), "flat list lost");
  assert(b.prohibited_claims.includes("never claim synthetic certification"), "avoid_positioning lost");
  assert(b.prohibited_claims.includes("no hype words"), "brand_voice.avoid lost");
  assert(b.prohibited_claims.includes("never promise guaranteed results"), "negative_examples lost");
});

Deno.test("prohibited claims are de-duplicated", () => {
  const b = brainContextFromProfile(nestedBrain({
    prohibited_claims: ["no hype words"],
  }));
  assertEquals(b.prohibited_claims.filter((c) => c === "no hype words").length, 1);
});

// -------------------------------------------------- flat profiles unchanged ---

Deno.test("a flat legacy profile still works and still WINS over nested", () => {
  const b = brainContextFromProfile(nestedBrain({
    positioning: "Flat positioning wins.",
    product_summary: "Flat product summary wins.",
    target_outcomes: ["flat outcome"],
  }));
  assertEquals(b.positioning, "Flat positioning wins.");
  assertEquals(b.product_summary, "Flat product summary wins.");
  assertEquals(b.outcomes, ["flat outcome"]);
  assertEquals(b.available, true);
});

// ------------------------------------------------- genuinely empty is empty ---

Deno.test("a genuinely empty Brain is still UNAVAILABLE — the gate is not disabled", () => {
  assertEquals(brainContextFromProfile({}).available, false);
  assertEquals(brainContextFromProfile(null).available, false);
  assertEquals(brainContextFromProfile({ company_name: "Only a name" }).available, false);
});

Deno.test("a Brain whose only substance is empty strings/arrays is unavailable", () => {
  const b = brainContextFromProfile({
    company_summary: "   ",
    positioning: { promise: "", offer: "" },
    target_outcomes: [],
    pain_points: [],
  });
  assertEquals(b.available, false);
});

Deno.test("a non-object positioning value does not throw", () => {
  assertEquals(brainContextFromProfile({ positioning: 42 }).available, false);
  assertEquals(brainContextFromProfile({ positioning: ["a"] }).available, false);
});
