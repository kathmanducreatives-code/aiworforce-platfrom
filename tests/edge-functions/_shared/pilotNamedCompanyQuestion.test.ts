// A YES/NO QUESTION ABOUT A COMPANY THE USER NAMED BECOMES A VERIFICATION RUN.
//
// Production, 2026-09-26 10:58 (workspace e8af257d): "Has Salvo Software
// (https://www.linkedin.com/company/salvosoftware) raised funding in the last
// 3 years?" answered "I understood the request, but I can't turn it into a run
// yet." — `lead_projection_refused:objective_not_servable`. The model read the
// question as `research` on a named company (right) wanting an `answer` or
// `events` (also right, for a yes/no question), and the lead projection served
// only `records`. Five local replays of the same sentence: `events`, `answer`,
// `events`, `events`, and one `records` read that compiled but whose block
// reasons were lost — `requestToMission` read `violations`, the error carries
// `reasons`.
//
// The parses below are the shapes the model actually returned.
//
// Pure. ZERO network, provider or model calls.

import { assert, assertEquals, assertFalse } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { projectToLeadMission } from "../../../supabase/functions/_shared/projectToLeadMission.ts";
import { routeRequest } from "../../../supabase/functions/_shared/objectiveRouter.ts";
import { compileRequestMission } from "../../../supabase/functions/_shared/requestToMission.ts";
import type { RequestV1 } from "../../../supabase/functions/_shared/requestV1.ts";

globalThis.fetch = () => { throw new Error("these tests must not reach the network"); };

const Q = "Has Salvo Software (https://www.linkedin.com/company/salvosoftware) raised funding in the last 3 years?";
const LI = "https://www.linkedin.com/company/salvosoftware";

/** The model's reading: research on a named company, a 3-year funding requirement. */
function parse(o: {
  shape: "records" | "answer" | "events" | "artifact"; count?: number | null; ref?: string | null;
  companyNameFilter?: string | string[]; objective?: string; entity?: string;
}): RequestV1 {
  return {
    version: "request-v1", objective: (o.objective ?? "research") as never, confidence: 0.9, ambiguity: [],
    parts: [{
      id: "p1", objective: (o.objective ?? "research") as never,
      subject: {
        entity: (o.entity ?? "company") as never,
        references: o.ref === null ? [] : [{ kind: "named", value: o.ref ?? "Salvo Software", cardinality: "one" } as never],
        ...(o.companyNameFilter !== undefined ? { filters: [{ field: "company_name", op: "eq", value: o.companyNameFilter }] } : {}),
      },
      requirements: [{ event: "funding", subject: "company", phrase: "raised funding in the last 3 years", recency_days: 1095 } as never],
      output: { shape: o.shape, count: o.count ?? null },
    }],
  } as unknown as RequestV1;
}

function compiled(r: RequestV1) {
  const route = routeRequest(r, { spendAllowed: true });
  assertEquals(route.kind, "lead_mission", `route: ${route.kind} ${(route as { reason?: string }).reason ?? ""}`);
  const m = compileRequestMission(r, (route as unknown as { lead: never }).lead, { originalUserQuery: Q });
  assert(m.ok, JSON.stringify(m));
  return m.ok ? m.result.final_mission : null!;
}
const hard = (m: { criteria?: Array<{ kind: string; dimension: string; time_window?: { days?: number } }> }) =>
  (m.criteria ?? []).filter((c) => c.kind === "hard").map((c) => c.dimension + (c.time_window?.days ? `/${c.time_window.days}` : ""));

// ══════════════════════ the readings the model returned ══════════════════════

Deno.test("1. `answer` (production's reading): a verification run for exactly that company", () => {
  const m = compiled(parse({ shape: "answer" }));
  assertEquals(m.requested_count, 1, "one named company is one company");
  assertEquals(m.company_profile.known_companies, [LI], "the user's own LinkedIn page is the identity");
  assertEquals(hard(m), ["known_companies", "funding/1095"]);
});

Deno.test("2. `events` (three of five local replays): the same run", () => {
  const m = compiled(parse({ shape: "events", companyNameFilter: "Salvo Software" }));
  assertEquals([m.requested_count, m.company_profile.known_companies, hard(m)], [1, [LI], ["known_companies", "funding/1095"]]);
});

Deno.test("3. the reference may be the URL itself — still one company", () => {
  const m = compiled(parse({ shape: "answer", ref: LI }));
  assertEquals([m.requested_count, m.company_profile.known_companies], [1, [LI]]);
});

Deno.test("4. `records` is unchanged: compiles as before, with the count the model gave", () => {
  assertEquals(compiled(parse({ shape: "records" })).requested_count, null);
  assertEquals(compiled(parse({ shape: "records", count: 1 })).requested_count, 1);
});

Deno.test("5. two companies named in one question are two", () => {
  const r = parse({ shape: "answer", companyNameFilter: ["Linear"] });
  assertEquals(projectToLeadMission(r).requestedCount, 2);
});

// ══════════════════════ what still does NOT become a run ══════════════════════

Deno.test("6. an unnamed company's `answer` is still refused — no discovery run for a yes/no question", () => {
  const p = projectToLeadMission(parse({ shape: "answer", ref: null }));
  assertEquals(p.refusal, "objective_not_servable");
});

Deno.test("7. discovery (`source`) still needs `records`", () => {
  assertEquals(projectToLeadMission(parse({ shape: "answer", objective: "source" })).refusal, "objective_not_servable");
});

Deno.test("8. an `artifact` about a named company is content, not a run", () => {
  assertEquals(projectToLeadMission(parse({ shape: "artifact" })).refusal, "objective_not_servable");
});

Deno.test("9. a person-shaped yes/no question is not widened by this", () => {
  assertEquals(projectToLeadMission(parse({ shape: "answer", entity: "person" })).refusal, "objective_not_servable");
});

// ══════════════════════ a blocked compilation says why ══════════════════════

Deno.test("10. a compile block reports the compiler's reasons, not an empty list", () => {
  // A LinkedIn page the user never wrote: the proposal scan refuses a URL the model introduced.
  const r = parse({ shape: "answer", ref: "https://www.linkedin.com/company/someone-else" });
  const route = routeRequest(r, { spendAllowed: true });
  assertEquals(route.kind, "lead_mission");
  const m = compileRequestMission(r, (route as unknown as { lead: never }).lead, { originalUserQuery: "Has this company raised funding lately?" });
  assertFalse(m.ok);
  if (!m.ok) {
    assertEquals(m.reason, "mission_compilation_blocked");
    assert(m.violations.length > 0, "the reasons reach the log and the caller");
    assert(m.violations.some((v) => /url/i.test(v)), JSON.stringify(m.violations));
  }
});

// ══════════════════════ a page is still a page, unless it is the company ══════════════════════

Deno.test("11. a LinkedIn company page asked about with NO signal is still a page to read", () => {
  const r = parse({ shape: "answer", ref: LI }) as unknown as { parts: Array<{ requirements: unknown[] }> };
  r.parts[0].requirements = [];
  assertEquals(routeRequest(r as never, { spendAllowed: true }).kind, "url_analysis");
});

Deno.test("12. any other website is still a page to read, even with a signal", () => {
  assertEquals(routeRequest(parse({ shape: "answer", ref: "https://salvosoftware.com/about" }), { spendAllowed: true }).kind, "url_analysis");
});

// ══════════════════════ every way the model writes the user's page ══════════════════════

import { scanProposalForViolations } from "../../../supabase/functions/_shared/leadMissionCompiler.ts";

Deno.test("13. every spelling of the user's own LinkedIn page compiles to that one company", () => {
  // Local replays after the shape fix still blocked with `url:known_companies[0]`.
  for (const v of [LI, `${LI}/`, "https://linkedin.com/company/salvosoftware", "linkedin.com/company/salvosoftware",
    "www.linkedin.com/company/salvosoftware", `Salvo Software (${LI})`, "Salvo Software"]) {
    const m = compiled(parse({ shape: "answer", ref: v }));
    assertEquals([m.requested_count, m.company_profile.known_companies], [1, [LI]], v);
  }
});

Deno.test("14. the scan admits a LinkedIn page by the slug the USER typed — and nothing else", () => {
  const kc = (s: string) => scanProposalForViolations({ known_companies: [s] }, Q).filter((v) => v.kind === "url");
  assertEquals(kc("https://linkedin.com/company/salvosoftware"), [], "the user's company, spelled differently");
  assertEquals(kc("linkedin.com/company/SalvoSoftware/"), [], "case and a trailing slash do not change the company");
  assertEquals(kc("https://www.linkedin.com/company/salvo-labs").length, 1, "a company the user never named is refused");
  assertEquals(kc("https://www.linkedin.com/in/salvosoftware").length, 1, "a person's page is not a company page");
  assertEquals(scanProposalForViolations({ geographies: ["https://www.linkedin.com/company/salvosoftware"] }, Q)
    .filter((v) => v.kind === "url").length, 1, "only known_companies may carry it");
});
