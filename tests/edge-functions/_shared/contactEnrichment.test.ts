// BUYING A CONTACT METHOD — AND THE FOUR WAYS THAT GOES WRONG.
//
// ── THE DEFECT THIS CAPABILITY REPLACES ─────────────────────────────────────
//
// `contact_unlock` charged 2 credits and called `runFounderUnlock` — the same
// people SEARCH `founder_unlock` had just run for 3. The endpoint read
// `unlock_type` four times (replay lookup, ledger kind, log line, stored
// record) and never branched on it. `UnlockedPerson` carries no email and no
// phone, so the second purchase could not have delivered a contact method under
// any circumstances, and `founder_unlock_required_first` made it mandatory.
//
// ── WHAT THESE TESTS PIN ────────────────────────────────────────────────────
//
//   IT CANNOT SEARCH        with no resolved person it declines. If it could
//                           fall back to a search it would be the founder
//                           unlock again, wearing a different price.
//   CONSENT IS EXPLICIT     the email mode is a purchase, not a parameter.
//   A MISS IS AN ANSWER     `not_found` is distinct from `provider_error`, and
//                           an address is never constructed from a name.
//   NO PHONE, EVER          nothing registered returns one.
//
// PURE. The provider is injected; no network, database or model access.

import {
  assert, assertEquals, assertFalse,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  runContactEnrichment, contactAlreadyHeld, profileTargetFor,
  readProviderEmail, CONTACT_ENRICHMENT_ACTOR,
  type ContactEvidenceRecord, type ResolvedPerson,
} from "../../../supabase/functions/_shared/contactEnrichmentRunner.ts";
import {
  compileHarvestProfileScraperInput,
} from "../../../supabase/functions/_shared/hiringActorInputs.ts";
import {
  PROFILE_SCRAPER_EMAIL_MODE, PROFILE_SCRAPER_MODES,
  EMAIL_ENRICHMENT_MODES, HIRING_ACTOR_CATALOG,
} from "../../../supabase/functions/_shared/hiringActorCatalog.ts";

const ADA: ResolvedPerson = {
  source_profile_id: "ACwAAABc1234",
  linkedin_url: "https://www.linkedin.com/in/ACwAAABc1234",
  full_name: "Ada Kestrel",
  title: "Founder",
};

const noProvider = {
  invoke: () => {
    throw new Error("the provider must not be reached in this case");
  },
};
const returns = (rows: Record<string, unknown>[]) => ({
  invoke: () => Promise.resolve(rows),
});

// ═══════════════ 1-3. IT TAKES A PERSON. IT DOES NOT FIND ONE. ═════════════

Deno.test("1. with NO resolved person it declines — it never searches", () => {
  // THE WHOLE DISTINCTION. Discovery takes a company and returns candidates.
  // Enrichment takes a person. If this fell back to a search it would be the
  // founder unlock again at a second price, which is the defect being removed.
  return runContactEnrichment(
    { person: null, emailLookupAuthorized: true }, noProvider,
  ).then((out) => {
    assertEquals(out.provider_ran, false, "nothing may be spent");
    assertEquals(out.refusal, "no_resolved_person");
    assertEquals(out.record.status, "refused");
    assertEquals(out.call, null);
    assert(/cannot find one/.test(out.record.reason), out.record.reason);
    // It says what to do instead, naming the other action rather than failing mutely.
    assert(/Find Decision Maker/.test(out.record.reason));
  });
});

Deno.test("2. a person with no profile identifier declines", async () => {
  const out = await runContactEnrichment(
    { person: { full_name: "Ada Kestrel" }, emailLookupAuthorized: true },
    noProvider,
  );
  assertEquals(out.provider_ran, false);
  assertEquals(out.refusal, "no_usable_profile_identifier");
  assertEquals(out.record.full_name, "Ada Kestrel", "the refusal still names who");
});

Deno.test("3. the OPAQUE member id is routed to profileIds, never urls", () => {
  // `company-employees` returns the ACwAAA… member form and never a vanity
  // slug — its own `company_employees_opaque_profile_url` defect. The
  // enrichment Actor accepts that form only in `profileIds`.
  assertEquals(profileTargetFor(ADA), { profileIds: ["ACwAAABc1234"] });

  // Even when it arrives only as a URL, the SHAPE decides — not a convention
  // somebody has to remember at the call site.
  assertEquals(
    profileTargetFor({ linkedin_url: "https://www.linkedin.com/in/ACwAAABxyz" }),
    { profileIds: ["ACwAAABxyz"] });

  // A real vanity slug is a URL.
  assertEquals(
    profileTargetFor({ linkedin_url: "https://www.linkedin.com/in/ada-kestrel" }),
    { urls: ["https://www.linkedin.com/in/ada-kestrel"] });

  // Anything that is not a person profile is not a target.
  assertEquals(profileTargetFor({ linkedin_url: "https://example.com/team" }), null);
  assertEquals(profileTargetFor({}), null);
});

// ═══════════════ 4-5. CONSENT IS EXPLICIT, BOTH WAYS ═══════════════════════

Deno.test("4. an email lookup without authorisation is refused", async () => {
  const out = await runContactEnrichment(
    { person: ADA, emailLookupAuthorized: false }, noProvider,
  );
  assertEquals(out.provider_ran, false);
  assertEquals(out.refusal, "not_authorized");
  assert(/separately-priced/.test(out.record.reason));
});

Deno.test("5. THE COMPILER is the guard, not a convention", () => {
  // The email mode compiles ONLY with explicit authorisation…
  const unauthorised = compileHarvestProfileScraperInput({
    profileIds: ["ACwAAABc1234"],
    profileScraperMode: PROFILE_SCRAPER_EMAIL_MODE,
  });
  assertFalse(unauthorised.ok);
  assert(unauthorised.ok === false &&
    unauthorised.errors.some((e) => /emailLookupAuthorized: true/.test(e)));

  // …and authorisation without the email mode is ALSO refused, because it would
  // report "no email found" for a lookup that never ran.
  const hollow = compileHarvestProfileScraperInput({
    profileIds: ["ACwAAABc1234"],
    profileScraperMode: PROFILE_SCRAPER_MODES[0],
    emailLookupAuthorized: true,
  });
  assertFalse(hollow.ok);
  assert(hollow.ok === false &&
    hollow.errors.some((e) => /never ran/.test(e)));

  const good = compileHarvestProfileScraperInput({
    profileIds: ["ACwAAABc1234"],
    profileScraperMode: PROFILE_SCRAPER_EMAIL_MODE,
    emailLookupAuthorized: true,
  });
  assert(good.ok);
  // THE CONSENT FLAG IS NOT SENT. It is a fact about the user, and this Actor
  // has never heard of it.
  assert(good.ok && !("emailLookupAuthorized" in (good.input as object)),
    "the authorisation flag must be stripped from the wire payload");
});

Deno.test("6. a sibling Actor's enum is named, not silently accepted", () => {
  // Three people Actors, three vocabularies. An unrecognised value does not
  // error on the platform — it falls back to the Actor default, the expensive
  // one — so the compiler has to catch it and say which sibling it came from.
  const wrong = compileHarvestProfileScraperInput({
    profileIds: ["ACwAAABc1234"],
    profileScraperMode: "Full + email search" as never,
    emailLookupAuthorized: true,
  });
  assertFalse(wrong.ok);
  assert(wrong.ok === false &&
    wrong.errors.some((e) => /linkedin-profile-search enum/.test(e)),
    "the error must name which sibling's vocabulary was used");
});

Deno.test("7. no target at all is refused before any spend", () => {
  const none = compileHarvestProfileScraperInput({
    profileScraperMode: PROFILE_SCRAPER_MODES[0],
  });
  assertFalse(none.ok);
  assert(none.ok === false &&
    none.errors.some((e) => /never searches/.test(e)));
});

// ═══════════════ 8-10. A MISS IS AN ANSWER, NOT A FAILURE ══════════════════

Deno.test("8. an address is quoted from the provider, never constructed", async () => {
  const out = await runContactEnrichment(
    { person: ADA, emailLookupAuthorized: true },
    returns([{ email: "Ada.Kestrel@Nimbusforge.com", linkedinUrl: "https://www.linkedin.com/in/ada" }]),
  );
  assertEquals(out.provider_ran, true);
  assertEquals(out.record.status, "email_found");
  assertEquals(out.record.business_email, "ada.kestrel@nimbusforge.com");
  assertEquals(out.record.email_source, CONTACT_ENRICHMENT_ACTOR);
  assertEquals(out.record.missing, []);
  // NO PHONE. Not "not yet" — nothing registered returns one.
  assertEquals(out.record.phone, null);
});

Deno.test("9. a lookup that finds nothing is NOT_FOUND, and says why re-running is pointless", async () => {
  const out = await runContactEnrichment(
    { person: ADA, emailLookupAuthorized: true },
    returns([{ firstName: "Ada", lastName: "Kestrel" }]),
  );
  assertEquals(out.provider_ran, true, "the provider ran and billed for the search");
  assertEquals(out.record.status, "not_found");
  assertEquals(out.record.business_email, null);
  assertEquals(out.record.missing, ["business_email"]);
  // THE SENTENCE THAT STOPS A USER PAYING TWICE.
  assert(/same nothing at the same price/.test(out.record.reason), out.record.reason);

  // AND NOTHING IS INVENTED. A first name and a company are not an address.
  assertFalse(/@/.test(String(out.record.business_email ?? "")));
});

Deno.test("10. a provider failure is NOT evidence that no address exists", async () => {
  const out = await runContactEnrichment(
    { person: ADA, emailLookupAuthorized: true },
    { invoke: () => Promise.reject(new Error("actor timed out")) },
  );
  assertEquals(out.record.status, "provider_error");
  assertEquals(out.provider_ran, true);
  // The difference that decides whether a retry is right.
  assert(/not evidence that no address exists/.test(out.record.reason));
  assertFalse(contactAlreadyHeld(out.record),
    "an error is not held — the user must be able to try again");
});

Deno.test("11. only real addresses are read out of a provider row", () => {
  assertEquals(readProviderEmail({ email: "a@b.com" }), "a@b.com");
  assertEquals(readProviderEmail({ workEmail: "A@B.COM" }), "a@b.com");
  assertEquals(readProviderEmail({ emailAddress: " c@d.io " }), "c@d.io");
  // Not an address, and never assembled from one.
  assertEquals(readProviderEmail({ email: "" }), null);
  assertEquals(readProviderEmail({ email: "not-an-address" }), null);
  assertEquals(readProviderEmail({ firstName: "Ada", companyDomain: "acme.com" }), null);
  assertEquals(readProviderEmail({}), null);
});

// ═══════════════ 12-13. NEVER BUY WHAT WE ALREADY HAVE ═════════════════════

const held = (status: string): ContactEvidenceRecord => ({
  status: status as ContactEvidenceRecord["status"],
  business_email: status === "email_found" ? "a@b.com" : null,
  email_source: null, phone: null, linkedin_url: null,
  full_name: null, title: null, missing: [], reason: "",
});

Deno.test("12. a held answer — INCLUDING a miss — is reused, not re-purchased", async () => {
  for (const status of ["email_found", "not_found"]) {
    assert(contactAlreadyHeld(held(status)), status);
    const out = await runContactEnrichment(
      { person: ADA, emailLookupAuthorized: true, existing: held(status) },
      noProvider,
    );
    assertEquals(out.provider_ran, false, `${status} must not re-run the provider`);
    assertEquals(out.refusal, "already_enriched");
    assert(/nothing was purchased again/.test(out.record.reason));
  }
  // An error is NOT held: nothing was established and a retry is right.
  assertFalse(contactAlreadyHeld(held("provider_error")));
  assertFalse(contactAlreadyHeld(held("refused")));
  assertFalse(contactAlreadyHeld(null));
});

Deno.test("13. the catalog agrees with the runner about this Actor", () => {
  const card = HIRING_ACTOR_CATALOG["apify_linkedin_profile_enrichment"];
  assert(card, "the enrichment Actor must be carded");
  assertEquals(card.actor_id, "harvestapi/linkedin-profile-scraper");
  assertEquals(card.purposes, ["contact_enrichment"]);
  // Its email mode is on the forbidden list every DISCOVERY compiler enforces —
  // which is exactly why enrichment needs an explicit authorisation flag rather
  // than the absence of a ban.
  assert(EMAIL_ENRICHMENT_MODES.includes(PROFILE_SCRAPER_EMAIL_MODE));
  // The three facts GPT must know to not misuse it.
  const text = JSON.stringify(card).toLowerCase();
  assert(text.includes("it does not search"));
  assert(text.includes("guaranteeing an email"));
  assert(text.includes("phone numbers"));
});
