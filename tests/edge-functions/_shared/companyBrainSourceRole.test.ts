// Seller-vs-competitor source separation.
//
// A competitor URL (gojiberry.ai) ingested through the same website path as the
// real seller website must NEVER populate seller identity or positioning.
//
// No network, database, provider or model.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  classifyWebsiteSourceRole,
  stripNonSellerIdentityFields,
  isValidSourceRole,
} from "../../supabase/functions/_shared/companyBrainSourceRole.ts";
import { resolveCanonicalSellerIdentity } from "../../supabase/functions/_shared/workbench/sellerIdentity.ts";

const AGENTORY = resolveCanonicalSellerIdentity({
  profile: { company: { name: "Agentory", website_url: "https://agentory.space" } },
});
const NO_IDENTITY = resolveCanonicalSellerIdentity({ profile: {} });

// 10/13. a competitor domain is never seller; unknown never becomes seller ------
Deno.test("10/13. competitor URL is classified unknown, never seller", () => {
  const d = classifyWebsiteSourceRole({
    submittedUrl: "https://gojiberry.ai/product",
    canonicalIdentity: AGENTORY,
    userConfirmedAsSeller: true, // even confirmed, a conflicting domain cannot be seller
  });
  assertEquals(d.role, "unknown");
  assertEquals(d.reason, "domain_conflicts_canonical_identity");
});

Deno.test("the seller's own domain, user-confirmed, is seller", () => {
  const d = classifyWebsiteSourceRole({
    submittedUrl: "https://www.agentory.space/pricing",
    canonicalIdentity: AGENTORY,
    userConfirmedAsSeller: true,
  });
  assertEquals(d.role, "seller");
});

Deno.test("13. a consistent but UNCONFIRMED domain is unknown, not seller", () => {
  const d = classifyWebsiteSourceRole({
    submittedUrl: "https://agentory.space",
    canonicalIdentity: AGENTORY,
    userConfirmedAsSeller: false,
  });
  assertEquals(d.role, "unknown");
  assertEquals(d.reason, "not_user_confirmed_as_seller");
});

Deno.test("first-ever identity: confirmed URL with no canonical yet is seller", () => {
  const d = classifyWebsiteSourceRole({
    submittedUrl: "https://newco.example",
    canonicalIdentity: NO_IDENTITY,
    userConfirmedAsSeller: true,
  });
  assertEquals(d.role, "seller");
  assertEquals(d.reason, "confirmed_first_identity");
});

// 11/12. competitor content cannot populate approved seller fields --------------
Deno.test("11/12. non-seller source: seller identity + positioning are stripped", () => {
  const draftPatch = {
    company: { name: "Goji", website_url: "https://gojiberry.ai" },
    company_name: "Goji",
    positioning: { offer: "passive talent discovery", use_cases: ["candidate intelligence"] },
    content_angles: ["hiring signals"],
    // A legitimately competitive-research field that is NOT seller-owned:
    competitors: ["Agentory"],
  };
  const { safePatch, stripped } = stripNonSellerIdentityFields(draftPatch, "unknown");

  // Every seller field is gone.
  assertEquals(safePatch.company, undefined);
  assertEquals(safePatch.company_name, undefined);
  assertEquals(safePatch.positioning, undefined);
  assertEquals(safePatch.content_angles, undefined);
  assert(stripped.includes("company"));
  assert(stripped.includes("positioning"));

  // Competitive research survives.
  assertEquals(safePatch.competitors, ["Agentory"]);
});

Deno.test("a seller source keeps its fields untouched", () => {
  const patch = { company: { name: "Agentory" }, positioning: { offer: "AI workforce platform" } };
  const { safePatch, stripped } = stripNonSellerIdentityFields(patch, "seller");
  assertEquals(stripped.length, 0);
  assertEquals(safePatch, patch);
});

Deno.test("isValidSourceRole guards the enum", () => {
  assert(isValidSourceRole("competitor"));
  assert(!isValidSourceRole("vendor"));
  assert(!isValidSourceRole(null));
});
