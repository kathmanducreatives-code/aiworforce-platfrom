// "PER-USER LICENSING" IS SEAT PRICING — HYPHEN OR NOT.
//
// MintMCP's own pricing page (2026-09-27): "Custom pricing based on team size
// and needs. Per-user licensing with scalable platform fees." The facet reader
// matched seat pricing only as "per user" / "per seat" / "/seat", so the most
// common way pricing pages write it — hyphenated — stated nothing, and a
// business-model claim quoting it could never be accepted.
//
// The bar does not move: only a SEAT or USER unit states SaaS delivery. Usage
// pricing, "per-use", and words that merely contain "user" state nothing.
//
// Pure. ZERO network, providers, models or database.

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { statedFacets, unstatedFacets } from "../../../supabase/functions/_shared/businessModelMatch.ts";

const saas = (...q: string[]) => statedFacets(q).has("saas_delivery");

Deno.test("MINTMCP: its own pricing line now states SaaS delivery", () => {
  assertEquals(saas("Custom pricing based on team size and needs. Per-user licensing with scalable platform fees."), true);
});

Deno.test("hyphenated and plural seat units state SaaS delivery, as the spaced forms already did", () => {
  for (const q of ["Per-user licensing", "per-seat pricing", "$12 per-user per month", "Pricing per-seat", "billed per-users", "per users"]) {
    assertEquals(saas(q), true, q);
  }
  for (const q of ["$20 per user", "per seat", "50/seat", "$8 / user"]) assertEquals(saas(q), true, q);
});

Deno.test("…and nothing else does: usage units and words that only contain 'user' state nothing", () => {
  for (const q of ["Pay per-use", "per-usage billing", "superuser access", "user-friendly dashboards", "per session", "Seat belts"]) {
    assertEquals(saas(q), false, q);
  }
});

Deno.test("a hyphenated seat line plus a named business buyer carries b2b_saas", () => {
  assertEquals(unstatedFacets("b2b_saas", ["Built for platform teams.", "Per-user licensing with scalable platform fees."]), []);
  assertEquals(unstatedFacets("b2b_saas", ["Per-user licensing with scalable platform fees."]), ["business_customer"],
    "delivery alone is not a buyer");
});
