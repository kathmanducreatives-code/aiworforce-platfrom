// Canonical seller identity resolver + conflict block.
//
// The proven production incident: a Brain with
//   profile.company_name = "goji"   (legacy flat, competitor-contaminated)
//   profile.company.name = "Agentory" (current nested)
// must resolve to "Agentory" and BLOCK, never resolve to "goji".
//
// No network, database, provider or model.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  resolveCanonicalSellerIdentity,
  isSellerIdentityBlocked,
  sellerIdentityConflictDiagnostics,
  normalizeDomain,
} from "./sellerIdentity.ts";

// 1. nested company.name outranks flat company_name -----------------------------
Deno.test("1. nested company.name outranks flat company_name", () => {
  const id = resolveCanonicalSellerIdentity({
    profile: { company_name: "Legacy Co", company: { name: "Canonical Co" } },
  });
  assertEquals(id.companyName, "Canonical Co");
  assertEquals(id.identitySource, "nested");
});

// 2. nested website outranks flat website ---------------------------------------
Deno.test("2. nested website outranks flat website", () => {
  const id = resolveCanonicalSellerIdentity({
    profile: {
      website_url: "https://legacy.example",
      company: { name: "Co", website_url: "https://canonical.example" },
    },
  });
  assertEquals(id.domain, "canonical.example");
});

// 3. legacy flat value fills ONLY a missing canonical field ---------------------
Deno.test("3. legacy flat fills only a missing canonical field", () => {
  const id = resolveCanonicalSellerIdentity({
    profile: { company_name: "Only Legacy", website_url: "http://only-legacy.example/path" },
  });
  assertEquals(id.companyName, "Only Legacy");
  assertEquals(id.identitySource, "legacy_flat");
  assertEquals(id.domain, "only-legacy.example");
  assertEquals(id.conflicts.length, 0, "filling an empty field is not a conflict");
});

// 4. conflicting nested and flat names BLOCK ------------------------------------
Deno.test("4. conflicting nested and flat names block", () => {
  const id = resolveCanonicalSellerIdentity({
    profile: { company_name: "goji", company: { name: "Agentory" } },
  });
  assertEquals(id.companyName, "Agentory", "canonical value is reported, never the legacy one");
  assertEquals(id.identityStatus, "conflict");
  assert(isSellerIdentityBlocked(id));
  assertEquals(id.conflicts[0].field, "company_name");
});

// 5. conflicting domains block --------------------------------------------------
Deno.test("5. conflicting domains block", () => {
  const id = resolveCanonicalSellerIdentity({
    profile: {
      website_url: "https://gojiberry.ai",
      company: { name: "Agentory", website_url: "https://agentory.space" },
    },
  });
  assert(isSellerIdentityBlocked(id));
  assert(id.conflicts.some((c) => c.field === "website_domain"));
  assertEquals(id.domain, "agentory.space");
});

// 8. identity provenance persists (hash + source + brain id) --------------------
Deno.test("8. identity provenance persists", () => {
  const id = resolveCanonicalSellerIdentity({
    profile: { company: { name: "Agentory", website_url: "https://agentory.space" } },
    companyBrainId: "ws-1",
    companyBrainUpdatedAt: "2026-07-21T00:00:00.000Z",
  });
  assertEquals(id.companyBrainId, "ws-1");
  assertEquals(id.companyBrainUpdatedAt, "2026-07-21T00:00:00.000Z");
  assert(/^[0-9a-f]{8}$/.test(id.identityHash), "stable hex fingerprint");
  // Deterministic: same inputs → same hash.
  const again = resolveCanonicalSellerIdentity({
    profile: { company: { name: "Agentory", website_url: "https://agentory.space" } },
    companyBrainId: "ws-1",
    companyBrainUpdatedAt: "2026-07-21T00:00:00.000Z",
  });
  assertEquals(id.identityHash, again.identityHash);
});

// 9. Goji-like contamination → never Goji ---------------------------------------
Deno.test("9. seller=Agentory, legacy flat=goji resolves to Agentory, never goji", () => {
  const id = resolveCanonicalSellerIdentity({
    profile: {
      company_name: "goji",
      website_url: "https://gojiberry.ai",
      linkedin_company_url: "https://linkedin.com/company/goji",
      company: {
        name: "Agentory",
        website_url: "https://agentory.space",
        linkedin_url: "https://linkedin.com/company/agentory",
      },
    },
  });
  assertEquals(id.companyName, "Agentory");
  assertEquals(id.domain, "agentory.space");
  assert(id.companyName!.toLowerCase() !== "goji");
  assert(isSellerIdentityBlocked(id));
  const diag = sellerIdentityConflictDiagnostics(id);
  assert(diag.normalized_values.includes("goji"));
  assert(diag.conflicting_paths.includes("company_name"));
  assert(!diag.company_brain_id === true || diag.identity_hash.length === 8);
});

// confirmed nested identity → confirmed status ----------------------------------
Deno.test("confirmed nested identity reports confirmed status", () => {
  const id = resolveCanonicalSellerIdentity({
    profile: { company: { name: "Agentory", name_confirmed: true } },
  });
  assertEquals(id.identitySource, "confirmed_nested");
  assertEquals(id.identityStatus, "confirmed");
});

// workspace profile fills when nested absent ------------------------------------
Deno.test("workspace profile identity fills when nested absent (rank 3)", () => {
  const id = resolveCanonicalSellerIdentity({
    profile: { company_name: "Flat Co" },
    workspaceProfile: { companyName: "Profile Co" },
  });
  assertEquals(id.companyName, "Profile Co");
  assertEquals(id.identitySource, "workspace_profile");
  // Flat disagrees with the chosen profile value → conflict.
  assert(isSellerIdentityBlocked(id));
});

// unavailable when nothing is set -----------------------------------------------
Deno.test("unavailable when no identity present", () => {
  const id = resolveCanonicalSellerIdentity({ profile: {} });
  assertEquals(id.companyName, null);
  assertEquals(id.identitySource, "unavailable");
  assertEquals(id.identityStatus, "unavailable");
  assert(!isSellerIdentityBlocked(id));
});

// same normalized value (case/whitespace) is NOT a conflict ---------------------
Deno.test("case/punctuation-only difference is not a conflict", () => {
  const id = resolveCanonicalSellerIdentity({
    profile: { company_name: "agentory.", company: { name: "Agentory" } },
  });
  assertEquals(id.conflicts.length, 0);
  assertEquals(id.companyName, "Agentory");
});

// char-index noise (historical string-spread) is ignored ------------------------
Deno.test("char-indexed noise keys are ignored", () => {
  const id = resolveCanonicalSellerIdentity({
    profile: { company: { name: "Agentory", "0": "A", "1": "g" } },
  });
  assertEquals(id.companyName, "Agentory");
});

// normalizeDomain helper --------------------------------------------------------
Deno.test("normalizeDomain strips scheme/www/path/port", () => {
  assertEquals(normalizeDomain("https://www.Agentory.Space/pricing?x=1"), "agentory.space");
  assertEquals(normalizeDomain("http://gojiberry.ai:443/"), "gojiberry.ai");
  assertEquals(normalizeDomain(""), null);
  assertEquals(normalizeDomain(null), null);
});
