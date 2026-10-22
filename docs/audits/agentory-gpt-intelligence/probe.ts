// Documentation-only offline audit fixture. No application execution or network permission.
// deno-lint-ignore no-import-prefix
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
const root = new URL(
  (Deno.env.get("INTELLIGENCE_SOURCE_ROOT") ?? Deno.cwd()).replace(/\/?$/, "/"),
  "file:///",
);
const load = (name: string) =>
  import(new URL(`supabase/functions/_shared/${name}.ts`, root).href);
const compiler = await load("leadMissionCompiler");
const criteria = await load("missionCriteria");
const graphApi = await load("leadCapabilityGraph");
const scenarios = [
  {
    id: "I01",
    request:
      "Find SaaS companies that must be hiring Account Executives in the last 30 days.",
    types: ["SaaS"],
    signals: ["hiring Account Executives"],
    strategies: ["hiring"],
  },
  {
    id: "I02",
    request:
      "Find founders who might be considering outsourcing their outbound sales based on LinkedIn discussions.",
    types: [],
    signals: ["founder discussions about outbound sales outsourcing"],
    strategies: ["social"],
  },
  {
    id: "I03",
    request:
      "Find recruiting agencies that must be hiring internal salespeople, excluding client job advertisements.",
    types: ["recruiting agency"],
    signals: ["hiring internal salespeople"],
    strategies: ["hiring"],
  },
  {
    id: "I04",
    request:
      "Find growing manufacturing companies expanding production and struggling with outdated sales processes.",
    types: ["manufacturing"],
    signals: [
      "expanding production",
      "struggling with outdated sales processes",
    ],
    strategies: ["news"],
  },
  {
    id: "I05",
    request:
      "Find companies that must have adopted Salesforce in the last 60 days, excluding resellers.",
    types: [],
    signals: ["adopted Salesforce in the last 60 days"],
    strategies: ["news"],
  },
  {
    id: "I06",
    request: "Find startups that must be hiring their first sales leader.",
    types: ["startup"],
    signals: ["hiring their first sales leader"],
    strategies: ["hiring"],
  },
  {
    id: "I07",
    request:
      "Find software companies with confirmed seed funding in the last 90 days; hold conflicting funding reports.",
    types: ["software"],
    signals: ["seed funding in the last 90 days"],
    strategies: ["funding"],
  },
  {
    id: "I08",
    request:
      "Find recruiting agencies that must be expanding into European markets within 90 days.",
    types: ["recruiting agency"],
    signals: ["expanding into European markets"],
    strategies: ["news"],
  },
  {
    id: "I09",
    request:
      "Find B2B software companies hiring Account Executives OR funded in the last 90 days, AND headquartered in the US.",
    types: ["B2B software"],
    signals: ["hiring Account Executives", "funding in the last 90 days"],
    strategies: ["hiring", "funding"],
  },
  {
    id: "I10",
    request:
      "Find unusually efficient service companies with exactly 23 employees and a credible plan to grow, preferably founder-led.",
    types: ["service"],
    signals: ["credible plan to grow"],
    strategies: [],
  },
  {
    id: "I11",
    request:
      "Find founders explicitly seeking a CRM; exclude quotations, employees' opinions and statements that they are not looking for tools.",
    types: [],
    signals: ["founders seeking a CRM"],
    strategies: ["social"],
  },
  {
    id: "I12",
    request:
      "Research these approved existing Apollo leads and prepare source-backed call briefs. Do not find new prospects or send messages.",
    types: [],
    signals: [],
    strategies: [],
  },
];
for (const s of scenarios) {
  const proposal = {
    requested_opportunity_count: 1,
    company_types: s.types,
    geographies: [],
    employee_range: { min: null, max: null },
    output_intent: s.id === "I12"
      ? "enriched_companies"
      : s.id === "I02" || s.id === "I11"
      ? "social_posts"
      : "qualified_companies",
    preferred_signals: s.signals,
    required_signal_terms: s.signals,
    required_capabilities: s.id === "I12"
      ? ["known_company_identity_resolution", "company_details_enrichment"]
      : s.id === "I02" || s.id === "I11"
      ? ["offer_founder_unlock"]
      : ["general_company_discovery", "company_semantic_evaluation"],
    strategies: s.strategies,
    confidence: 0.95,
  };
  try {
    const compiled = compiler.compileLeadMission({
      originalUserQuery: s.request,
      proposal,
    });
    const mission = compiled.final_mission;
    const graph = graphApi.buildCapabilityGraph(mission, {
      executability: "enforce",
    });
    console.log(
      "INTELLIGENCE_PROBE",
      JSON.stringify({
        id: s.id,
        request: s.request,
        proposal,
        compiled,
        criteria: criteria.deriveMissionCriteria(mission),
        graph,
        boundary:
          "real pure compiler/graph with supplied mock proposal; no provider, evaluator, persistence or UI executed",
      }),
    );
  } catch (e) {
    console.log(
      "INTELLIGENCE_PROBE",
      JSON.stringify({
        id: s.id,
        request: s.request,
        proposal,
        error: String(e),
        boundary: "compiler/graph refused; downstream not reached",
      }),
    );
  }
}
const extraction = await load("webEvidenceExtraction");
const funding = await load("fundingCorroboration");
const observed = new Date().toISOString();
const announced = new Date(Date.now() - 10 * 86400000).toISOString().slice(
  0,
  10,
);
const fundingRecord = (actor: string, round_type: string, cited: boolean) => ({
  provider: "synthetic",
  actor,
  reported_round_count: 1,
  history_complete: true,
  observed_at: observed,
  source_url: null,
  rounds: [{
    round_type,
    announced_date: announced,
    amount_usd: 1000000,
    investors: ["Synthetic Investor"],
    source_urls: cited ? ["https://synthetic.example/funding"] : [],
    method: "provider_field",
  }],
});
for (const round of ["Seed", "Series A"]) {
  const result = funding.decideCorroboratedFundingStage({
    required_stage: "seed",
    atomus: fundingRecord("atomus", "Seed", false),
    pvalyou: fundingRecord("pvalyou", round, true),
  });
  assertEquals(result.decision.verdict === "pass", round === "Seed");
  console.log(
    "INTELLIGENCE_RISK",
    JSON.stringify({
      id: "F01",
      citing_provider_round: round,
      result,
      boundary:
        "real pure funding corroboration/decision, synthetic provider records; not a complete mission",
    }),
  );
}
const source = "We are not looking for new sales tools. We already have a CRM.";
const input = {
  company_key: "synthetic.example",
  requirement_id: "buying-intent",
  pages: [{
    url: "https://synthetic.example/about",
    intent: "about",
    markdown: source,
  }],
};
const claims = (excerpt: string) => ({
  claims: [{
    claim: "Company is searching for new sales tools",
    excerpt,
    source_url: input.pages[0].url,
    supports: "supports",
    confidence: "high",
  }],
});
const negative = extraction.parseExtractionStrict(claims(source), input);
const fabricated = extraction.parseExtractionStrict(
  claims("We are looking for a CRM vendor now."),
  input,
);
assertEquals(negative.claims.length, 1);
assertEquals(fabricated.claims.length, 0);
console.log(
  "INTELLIGENCE_RISK",
  JSON.stringify({
    id: "E01",
    negative,
    fabricated,
    meaning:
      "substring validation accepts a real negative quotation labelled supports; this is an inference-parser boundary probe, NOT proof of a final qualified company",
  }),
);
const provider = await load("gptProvider");
for (const finish_reason of ["stop", "length"]) {
  let calls = 0;
  const r = await provider.gptStructured({
    purpose: "offline-audit",
    model: "gpt-5.6-luna",
    system: "Return JSON",
    user: "synthetic",
    maxTokens: 40,
  }, {
    readEnv: (k: string) =>
      k === "OPENAI_API_KEY" ? "synthetic-offline-key" : undefined,
    fetch: () => {
      calls++;
      return Promise.resolve(
        new Response(
          JSON.stringify({
            choices: [{
              finish_reason,
              message: { content: '{"partial":true}' },
            }],
            usage: { prompt_tokens: 10, completion_tokens: 5 },
          }),
        ),
      );
    },
  });
  assertEquals(calls, 1);
  console.log(
    "INTELLIGENCE_RISK",
    JSON.stringify({
      id: "T01",
      finish_reason,
      accepted: r.ok,
      calls,
      boundary:
        "real GPT transport parser; injected external response, no model",
    }),
  );
  if (
    Deno.env.get("INTELLIGENCE_ASSERT_EXPECTATIONS") === "1" &&
    finish_reason === "length"
  ) {
    assertEquals(
      r.ok,
      false,
      "truncated completion must not be a successful structured result",
    );
  }
}
