import { assertEquals, assert, assertFalse } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { resolveCompanyIdentity, sameCompany, dedupeCompanies, canonicalLinkedinCompany } from "../../functions/_shared/companyIdentity.ts";

Deno.test("domain is canonicalized and drives the dedupe key", () => {
  const id = resolveCompanyIdentity({ name: "BigID Inc.", website_url: "https://www.BigID.com/careers?x=1" });
  assertEquals(id.canonicalDomain, "bigid.com");
  assertEquals(id.dedupeKeyKind, "domain");
  assertEquals(id.normalizedName, "bigid");
});

Deno.test("LinkedIn /company/<slug> id is extracted", () => {
  assertEquals(canonicalLinkedinCompany("https://www.linkedin.com/company/Harmonic-Security/about/").id, "harmonic-security");
  const id = resolveCompanyIdentity({ name: "Harmonic", linkedin_url: "https://linkedin.com/company/harmonic-security" });
  assertEquals(id.linkedinCompanyId, "harmonic-security");
  assertEquals(id.dedupeKeyKind, "linkedin_id");
});

Deno.test("same company by domain / li-id; distinct otherwise", () => {
  const a = resolveCompanyIdentity({ name: "Acme", domain: "acme.com" });
  const b = resolveCompanyIdentity({ name: "Acme Inc", domain: "acme.com" });
  assert(sameCompany(a, b));
  // similar NAME but different domains → NOT the same company (test 22 / 5).
  const c = resolveCompanyIdentity({ name: "Acme", domain: "acme-one.com" });
  const d = resolveCompanyIdentity({ name: "Acme", domain: "acme-two.com" });
  assertFalse(sameCompany(c, d));
});

Deno.test("name-only fallback matches ONLY when neither side has a strong id", () => {
  const a = resolveCompanyIdentity({ name: "Northwind Analytics", location: "Austin" });
  const b = resolveCompanyIdentity({ name: "Northwind Analytics", location: "Austin" });
  assert(sameCompany(a, b));
  // one side gains a domain → name match no longer collapses them.
  const c = resolveCompanyIdentity({ name: "Northwind Analytics", domain: "northwind.com" });
  assertFalse(sameCompany(a, c));
});

Deno.test("dedupeCompanies collapses same company, preserves distinct", () => {
  const items = [
    { identity: resolveCompanyIdentity({ name: "DupCo", domain: "dupco.com" }) },
    { identity: resolveCompanyIdentity({ name: "Dup Co.", domain: "dupco.com" }) },
    { identity: resolveCompanyIdentity({ name: "Other", domain: "other.com" }) },
  ];
  const out = dedupeCompanies(items);
  assertEquals(out.length, 2);
});
