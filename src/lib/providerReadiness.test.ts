import { assertEquals, assert } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  withProviderAliases,
  isConnected,
  APIFY_PEOPLE_BLOCKED_REASON,
  type ProviderMap,
} from "./providerReadiness.ts";

const base = (): ProviderMap => ({
  firecrawl: { status: "connected", label: "Firecrawl (web research)" },
  apify_people: {
    status: "connected",
    label: "Apify (people / hiring signals)",
  },
});

Deno.test("apify_people connected → apify + linkedin aliases connected", () => {
  const p = withProviderAliases(base());
  assert(isConnected(p["apify"]), "apify alias should be connected");
  assert(isConnected(p["linkedin"]), "linkedin alias should be connected");
  // firecrawl untouched
  assert(isConnected(p["firecrawl"]));
});

Deno.test("apify_people unavailable → aliases not connected, firecrawl still ready", () => {
  const raw = base();
  raw.apify_people = { status: "setup_needed", label: "Apify", reason: "Add an Apify API token to find decision-makers and hiring signals." };
  const p = withProviderAliases(raw);
  assertEquals(p["apify"].status, "setup_needed");
  assertEquals(p["linkedin"].status, "setup_needed");
  // Firecrawl-backed hiring must NOT be reported as blocked.
  assert(isConnected(p["firecrawl"]), "firecrawl stays connected");
});

Deno.test("blocked reason is LinkedIn-specific and never claims hiring is blocked", () => {
  const raw = base();
  raw.apify_people = { status: "setup_needed", label: "Apify", reason: "…hiring signals" };
  const p = withProviderAliases(raw);
  assertEquals(p["apify"].reason, APIFY_PEOPLE_BLOCKED_REASON);
  assert(/LinkedIn/i.test(p["apify"].reason ?? ""));
  assert(!/hiring (signals )?(are|is) blocked/i.test(p["apify"].reason ?? ""));
});

Deno.test("existing apify key is not overwritten by the alias", () => {
  const raw = base();
  raw.apify = { status: "unavailable", label: "custom apify" };
  const p = withProviderAliases(raw);
  assertEquals(p["apify"].label, "custom apify");
});

Deno.test("no apify_people entry → no aliases fabricated", () => {
  const p = withProviderAliases({ firecrawl: { status: "connected", label: "fc" } });
  assertEquals(p["apify"], undefined);
  assertEquals(p["linkedin"], undefined);
});
