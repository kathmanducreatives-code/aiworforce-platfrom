// THE BOUNDARY BETWEEN WHAT A MODEL MAY DECIDE AND WHAT IT MAY NOT.
//
// The planner is allowed to say WHAT would answer a requirement and WHICH KINDS
// of page would carry the answer. It is not allowed to name a URL, name a
// domain, raise its own page budget, or add a company nobody approved for
// spending.
//
// These are money and safety guardrails, so they are tested against a hostile
// reply rather than a well-formed one: every test below feeds the parser
// something a model could plausibly emit and asserts the parser refuses it.
//
// The planner is NOT invoked in production at P1 — this file is why the
// contract can be trusted before a single token is spent.
//
// ZERO network, ZERO DB, ZERO model, ZERO provider spend.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  buildEvidencePlannerInput,
  DEFAULT_PLANNER_BUDGET,
  EVIDENCE_PLANNER_PROMPT,
  parseEvidencePlanStrict,
} from "../../supabase/functions/_shared/webEvidencePlanner.ts";
import { PAGE_INTENTS } from "../../supabase/functions/_shared/evidenceRequest.ts";
import type { EvidenceDebt } from "../../supabase/functions/_shared/webEvidenceDebt.ts";

const debt = (key: string, domain = `${key}.com`): EvidenceDebt => ({
  company_key: key,
  company_name: key,
  domain,
  requirement_id: `req-${key}`,
  open_question: `Whether ${key} is specifically a B2B SaaS company`,
  known_evidence_types: ["company_industry"],
  match_score: 86,
});

const plan = (o: Record<string, unknown>) => ({ plans: [o] });

// ─────────────────────────── the model's freedom ────────────────────────────

Deno.test("a well-formed plan becomes a bounded request", () => {
  const d = [debt("metaview")];
  const parsed = parseEvidencePlanStrict(
    plan({
      company_key: "metaview",
      research_question: "Does Metaview sell software to businesses on a subscription?",
      page_intents: ["pricing", "customers", "product"],
    }),
    d,
  );
  assertEquals(parsed.requests.length, 1);
  const r = parsed.requests[0];
  assertEquals(r.version, "evidence-request-v1");
  assertEquals(r.page_intents, ["pricing", "customers", "product"]);
  assertEquals(r.blocking_qualification, true);
  assert(r.request_id.length > 0);
});

// ───────────────────────────── the model's limits ───────────────────────────

Deno.test("the domain comes from code, never from the model", () => {
  const parsed = parseEvidencePlanStrict(
    plan({
      company_key: "metaview",
      research_question: "q",
      page_intents: ["pricing"],
      // A model trying to redirect the fetch. There is no field for it, and
      // the parsed request must carry the debt's own domain.
      domain: "evil.example.com",
      url: "https://evil.example.com/pricing",
    }),
    [debt("metaview")],
  );
  assertEquals(parsed.requests[0].domain, "metaview.com");
  assert(!("url" in parsed.requests[0]));
});

Deno.test("the model cannot raise its own budget", () => {
  const parsed = parseEvidencePlanStrict(
    plan({
      company_key: "metaview",
      research_question: "q",
      page_intents: ["pricing", "customers", "product"],
      max_pages: 500,
      freshness_window_hours: 1,
    }),
    [debt("metaview")],
  );
  const r = parsed.requests[0];
  assert(r.max_pages <= DEFAULT_PLANNER_BUDGET.max_pages);
  assertEquals(
    r.freshness_window_hours,
    DEFAULT_PLANNER_BUDGET.freshness_window_hours,
  );
});

Deno.test("intents beyond the cap are trimmed, not honoured", () => {
  const parsed = parseEvidencePlanStrict(
    plan({
      company_key: "metaview",
      research_question: "q",
      page_intents: [...PAGE_INTENTS],
    }),
    [debt("metaview")],
  );
  assertEquals(
    parsed.requests[0].page_intents.length,
    DEFAULT_PLANNER_BUDGET.max_intents,
  );
});

Deno.test("an intent outside the vocabulary rejects the whole plan", () => {
  // Silently narrowing to the valid subset would hide a contract violation.
  const parsed = parseEvidencePlanStrict(
    plan({
      company_key: "metaview",
      research_question: "q",
      page_intents: ["pricing", "scrape_everything"],
    }),
    [debt("metaview")],
  );
  assertEquals(parsed.requests.length, 0);
  assertEquals(parsed.rejected[0].reason, "invalid_page_intent");
});

Deno.test("a company nobody approved cannot be added by the model", () => {
  // The gate decides who we spend on. A model must not widen that set.
  const parsed = parseEvidencePlanStrict(
    { plans: [
      { company_key: "metaview", research_question: "q", page_intents: ["pricing"] },
      { company_key: "not-in-debt", research_question: "q", page_intents: ["pricing"] },
    ] },
    [debt("metaview")],
  );
  assertEquals(parsed.requests.length, 1);
  assertEquals(parsed.requests[0].company_key, "metaview");
  assertEquals(parsed.rejected[0].reason, "unknown_company");
});

Deno.test("a duplicated company yields one request, not two", () => {
  const parsed = parseEvidencePlanStrict(
    { plans: [
      { company_key: "metaview", research_question: "q", page_intents: ["pricing"] },
      { company_key: "metaview", research_question: "q2", page_intents: ["about"] },
    ] },
    [debt("metaview")],
  );
  assertEquals(parsed.requests.length, 1);
  assertEquals(parsed.rejected[0].reason, "duplicate_company");
});

Deno.test("an empty intent list is an ANSWER, not a failure", () => {
  // "No public page will answer this" routes to a truthful insufficient_evidence
  // at zero cost. It must never become a request.
  const parsed = parseEvidencePlanStrict(
    plan({ company_key: "metaview", research_question: "q", page_intents: [] }),
    [debt("metaview")],
  );
  assertEquals(parsed.requests.length, 0);
  assertEquals(parsed.rejected[0].reason, "no_page_intents");
});

Deno.test("a missing research question is refused", () => {
  const parsed = parseEvidencePlanStrict(
    plan({ company_key: "metaview", page_intents: ["pricing"] }),
    [debt("metaview")],
  );
  assertEquals(parsed.requests.length, 0);
  assertEquals(parsed.rejected[0].reason, "missing_research_question");
});

Deno.test("garbage parses to nothing rather than throwing", () => {
  for (const junk of [null, undefined, 42, "text", [], {}, { plans: "no" }]) {
    const parsed = parseEvidencePlanStrict(junk, [debt("metaview")]);
    assertEquals(parsed.requests.length, 0);
    assertEquals(parsed.unanswered, ["metaview"]);
  }
});

// ───────────────────────────── identity + genericity ────────────────────────

Deno.test("request identity ignores intent ORDER but not intent SET", () => {
  const d = [debt("metaview")];
  const a = parseEvidencePlanStrict(
    plan({ company_key: "metaview", research_question: "q", page_intents: ["pricing", "about"] }),
    d,
  ).requests[0];
  const b = parseEvidencePlanStrict(
    plan({ company_key: "metaview", research_question: "q", page_intents: ["about", "pricing"] }),
    d,
  ).requests[0];
  const c = parseEvidencePlanStrict(
    plan({ company_key: "metaview", research_question: "q", page_intents: ["docs"] }),
    d,
  ).requests[0];
  assertEquals(a.request_id, b.request_id, "same pages = same request");
  assert(a.request_id !== c.request_id, "different pages = different request");
});

Deno.test("request identity does NOT depend on the research question", () => {
  // Two missions wording the same need differently must reuse one fetch. This
  // is the property that makes evidence cacheable across missions.
  const d = [debt("metaview")];
  const a = parseEvidencePlanStrict(
    plan({ company_key: "metaview", research_question: "Is it B2B SaaS?", page_intents: ["pricing"] }),
    d,
  ).requests[0];
  const b = parseEvidencePlanStrict(
    plan({
      company_key: "metaview",
      research_question: "Does it sell software to recruiting teams?",
      page_intents: ["pricing"],
    }),
    d,
  ).requests[0];
  assertEquals(a.request_id, b.request_id);
});

Deno.test("T-3 the prompt contains no requirement-specific vocabulary", () => {
  // The guard against this silently becoming a keyword system. If someone adds
  // "if the requirement mentions SaaS, ask for pricing", this fails.
  const banned = [
    "b2b", "saas", "fintech", "plg", "cybersecurity", "salesforce",
    "enterprise-focused", "fortune 500", "banks",
  ];
  const prompt = EVIDENCE_PLANNER_PROMPT.toLowerCase();
  for (const w of banned) {
    assert(
      !prompt.includes(w),
      `planner prompt must not name "${w}" — the path must stay generic`,
    );
  }
  // It must still name the vocabulary it DOES constrain.
  for (const intent of PAGE_INTENTS) assert(prompt.includes(intent));
});

Deno.test("planner input carries the open question verbatim", () => {
  const input = buildEvidencePlannerInput([debt("metaview")]);
  assertEquals(input.companies.length, 1);
  assertEquals(
    input.companies[0].open_question,
    "Whether metaview is specifically a B2B SaaS company",
  );
  // No URL or domain is ever shown to the planner: it cannot leak one back.
  assert(!JSON.stringify(input).includes("metaview.com"));
});
