// RC08 FOLLOW-UP — A SUPPLIED COMPANY'S IDENTITY KEY KEEPS EVERY SCRIPT.
//
// PR #34 review (Account A, f42482dd): the supplied-company key kept only
// [a-z0-9]. "Яндекс" and "株式会社メルカリ" keyed to "" and were dropped, so
// "Check whether Яндекс has an open sales role" compiled to known_companies [],
// entry job_discovery, count 5 — a direct company check turned into unrelated
// paid discovery. "Ödeon" keyed to "deon" and merged with "Deon".
//
// The key ignores case, whitespace, punctuation and symbols, and nothing else:
// no transliteration, no accent stripping, no fuzzy matching. A name with
// nothing to key on is kept as its own company. Pure.

import { assertEquals, assertNotEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  DEFAULT_REQUESTED_COUNT, dedupeSuppliedCompanies, effectiveRequestedCount, suppliedCompanyKey,
} from "../../../supabase/functions/_shared/leadMission.ts";
import { compileChain, hiring, named, request } from "../../lead-v2-quality/lib/chain.ts";

/** "Check whether <name> currently has an open sales role." through the whole compile chain. */
const directCheck = (name: string) => compileChain(request(`Check whether ${name} currently has an open sales role.`, {
  objective: "research", references: [named(name)], requirements: [hiring("currently has an open sales role", ["sales role"])],
} as never));

Deno.test("1. LlamaIndex / Llama Index → ONE company", () => {
  assertEquals(suppliedCompanyKey("LlamaIndex"), suppliedCompanyKey("Llama Index"));
  assertEquals(dedupeSuppliedCompanies(["LlamaIndex", "Llama Index"]), ["LlamaIndex"]);
});

Deno.test("2. Яндекс is preserved, stays a known company, and does not fall into discovery", () => {
  assertEquals(suppliedCompanyKey("Яндекс"), "яндекс");
  assertEquals(dedupeSuppliedCompanies(["Яндекс"]), ["Яндекс"]);
  const c = directCheck("Яндекс");
  assertEquals(c.ok, true);
  assertEquals(c.mission!.company_profile.known_companies, ["Яндекс"]);
  assertEquals(c.effectiveCount, 1);
  // The same entry a Latin-script supplied company gets — never job discovery.
  assertEquals(c.entry, directCheck("LlamaIndex").entry);
  assertNotEquals(c.entry, "job_discovery");
});

Deno.test("3. 株式会社メルカリ is preserved", () => {
  assertEquals(suppliedCompanyKey("株式会社メルカリ"), "株式会社メルカリ");
  assertEquals(dedupeSuppliedCompanies(["株式会社メルカリ"]), ["株式会社メルカリ"]);
  const c = directCheck("株式会社メルカリ");
  assertEquals(c.mission!.company_profile.known_companies, ["株式会社メルカリ"]);
  assertEquals(c.effectiveCount, 1);
  assertNotEquals(c.entry, "job_discovery");
});

Deno.test("4. Ödeon and Deon remain TWO companies — accents are not stripped", () => {
  assertNotEquals(suppliedCompanyKey("Ödeon"), suppliedCompanyKey("Deon"));
  assertEquals(dedupeSuppliedCompanies(["Ödeon", "Deon"]), ["Ödeon", "Deon"]);
  // The same name in composed and decomposed form is one company (NFC).
  assertEquals(dedupeSuppliedCompanies(["Ödeon", "Ödeon"]), ["Ödeon"]);
});

Deno.test("5. Solana Labs and Solana remain TWO companies — no fuzzy matching", () => {
  assertEquals(dedupeSuppliedCompanies(["Solana Labs", "Solana"]), ["Solana Labs", "Solana"]);
});

Deno.test("6. an explicit requested count still wins", () => {
  assertEquals(effectiveRequestedCount({ requested_count: 3, company_profile: { known_companies: ["Яндекс"] } }), 3);
});

Deno.test("7. no supplied companies and no count → the previous default", () => {
  assertEquals(effectiveRequestedCount({ requested_count: null, company_profile: { known_companies: [] } }), DEFAULT_REQUESTED_COUNT);
  assertEquals(effectiveRequestedCount({ requested_count: null }), DEFAULT_REQUESTED_COUNT);
});

Deno.test("a name with nothing to key on is never silently dropped", () => {
  assertEquals(suppliedCompanyKey("★★★"), "");
  assertEquals(dedupeSuppliedCompanies(["★★★", "LlamaIndex", "+++"]), ["★★★", "LlamaIndex", "+++"]);
  assertEquals(dedupeSuppliedCompanies(["★★★", "★★★"]), ["★★★"], "only an identical spelling is the same entry");
  assertEquals(dedupeSuppliedCompanies(["", "  "]), [], "a blank string is not a company");
});
