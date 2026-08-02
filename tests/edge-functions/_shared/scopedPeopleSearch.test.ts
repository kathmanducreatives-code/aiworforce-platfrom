import { assertEquals, assert } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { buildPeopleScope, resultBelongsToScope } from "../../../supabase/functions/_shared/scopedPeopleSearch.ts";
import { resolveCompanyIdentity } from "../../../supabase/functions/_shared/companyIdentity.ts";

const opts = { requestedRole: "founder", queryIntent: "Founders of SaaS startups hiring Sales Operations" };

Deno.test("scope carries the strongest company identifier + requested role + source job", () => {
  const c = resolveCompanyIdentity({ name: "BigID", domain: "bigid.com", linkedin_url: "https://linkedin.com/company/bigid" });
  const s = buildPeopleScope(c, { ...opts, sourceJobId: "job-1" })!;
  assertEquals(s.scopedBy, "linkedin_id");
  assertEquals(s.requestedRole, "founder");
  assertEquals(s.companyDomain, "bigid.com");
  assertEquals(s.companyLinkedinId, "bigid");
  assertEquals(s.sourceJobId, "job-1");
  assertEquals(s.queryIntent, opts.queryIntent);
});

Deno.test("two similarly-named companies produce distinguishable scopes", () => {
  const a = buildPeopleScope(resolveCompanyIdentity({ name: "Acme", domain: "acme-one.com" }), opts)!;
  const b = buildPeopleScope(resolveCompanyIdentity({ name: "Acme", domain: "acme-two.com" }), opts)!;
  assert(a.companyDedupeKey !== b.companyDedupeKey);
});

Deno.test("an unverified (name-only) company yields no scope by default", () => {
  const c = resolveCompanyIdentity({ name: "Mystery Co" });
  assertEquals(buildPeopleScope(c, opts), null);
});

Deno.test("a people result attaches only to its own company scope", () => {
  const scope = buildPeopleScope(resolveCompanyIdentity({ name: "BigID", domain: "bigid.com" }), opts)!;
  assert(resultBelongsToScope(scope, "domain:bigid.com"));
  assertEquals(resultBelongsToScope(scope, "domain:other.com"), false);
});
