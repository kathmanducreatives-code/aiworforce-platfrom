// P4 CANARY — re-evaluate ONE candidate from evidence already bought.
//
// Reads a real prior verdict and the real cached pages, runs exactly the
// re-evaluation path `run-agent` will run, and prints before/after.
//
// It makes ONE model call and ZERO provider calls. It writes nothing: no
// database mutation, no checkpoint, no credit. The point is to see whether
// evidence the run already paid for changes a verdict, before wiring the path
// into a mission.
//
//   deno run --allow-read --allow-env --allow-net \
//     --env-file=.env.eval.local scripts/reevaluation-canary.ts <fixture.json>

import {
  buildMissionReevaluationInput, mergeReevaluation,
  parseMissionEvaluationStrict, MISSION_REEVALUATION_PROMPT,
  type MissionEvaluation, type MissionEvaluationInput,
} from "../supabase/functions/_shared/missionEvaluation.ts";
import { buildEvidenceRegistry } from "../supabase/functions/_shared/leadEvidenceRegistry.ts";
import { createGptStrategistGenerateJson } from "../supabase/functions/_shared/gptStrategistModel.ts";
import { routeModel } from "../supabase/functions/_shared/gptModelRouter.ts";

const fixturePath = Deno.args[0];
if (!fixturePath) {
  console.error("usage: reevaluation-canary.ts <fixture.json>");
  Deno.exit(1);
}

const fx = JSON.parse(await Deno.readTextFile(fixturePath)) as {
  company_key: string;
  company_name: string;
  domain: string;
  instruction: string;
  prior: MissionEvaluation;
  geography?: string | null;
  employee_count?: number | null;
  industries?: string[];
  description?: string | null;
  jobs?: unknown[];
  pages: Array<{
    source_url: string; page_intent: string; source_text: string; fetched_at: string;
  }>;
};

// The pages are the ONLY new input. Everything else is what the first pass had.
const registry = buildEvidenceRegistry({
  evidence: {
    version: "company-evidence-v1",
    company_key: fx.company_key,
    company_name: fx.company_name,
    domain: fx.domain,
    linkedin_company_url: null,
    identity_state: "resolved",
    // The evidence the FIRST pass had. Without it the model's re-citations of
    // already-established requirements resolve to ids this registry does not
    // hold and are dropped — an artefact of the canary, not of the pipeline,
    // which always carries the whole registry.
    geography_evidence: fx.geography ?? null,
    employee_evidence: fx.employee_count ?? null,
    industry_evidence: fx.industries ?? [],
    description: fx.description ?? null,
    source_query: null,
    source_capability: "general_company_discovery",
    commercial_job_evidence: (fx.jobs ?? []) as never,
    strongest_signal: null,
    evidence_urls: [],
    missing_fields: [],
    conflicting_evidence: [],
  } as never,
  web_pages: fx.pages,
});

const base: MissionEvaluationInput = {
  schema_version: "mission-evaluation-input-v1",
  instruction: fx.instruction,
  mission: {
    verticals: ["b2b saas"],
    locations: ["United Kingdom"],
    employee_range: { min: 20, max: 200 },
  },
  brain: {},
  company: { company_name: fx.company_name, canonical_domain: fx.domain },
};

const payload = buildMissionReevaluationInput({ base, prior: fx.prior, registry });

const route = routeModel("evidence_extraction");
const generate = createGptStrategistGenerateJson({}, {
  model: route.model, reasoningEffort: route.reasoning_effort,
  tier: route.tier, purpose: route.stage, reason: route.reason,
});

console.log("── BEFORE ──────────────────────────────────────────────");
console.log("  decision      :", fx.prior.decision);
console.log("  mission_fit   :", fx.prior.mission_fit);
console.log("  match_score   :", fx.prior.match_score);
console.log("  established   :", fx.prior.matched_requirements.length, "requirements");
for (const m of fx.prior.matched_requirements) {
  console.log("     ✓", m.requirement.slice(0, 62));
}
console.log("  OPEN          :", fx.prior.unknown_fields);
console.log("  web pages fed :", fx.pages.length, "(all from cache — zero purchased)");
console.log("  registry items:", registry.items.length,
  `(${registry.items.filter((i) => i.evidence_type === "web_page").length} web_page)`);

const res = await generate({
  systemPrompt: MISSION_REEVALUATION_PROMPT,
  messages: [{ role: "user", content: JSON.stringify(payload) }],
} as never);

const raw = (res as { ok?: boolean; json?: unknown })?.ok
  ? (res as { json?: unknown }).json
  : null;
if (!raw) {
  console.error("model returned nothing usable");
  Deno.exit(2);
}

const rawObj = raw as { matched_requirements?: Array<Record<string,unknown>> };
console.log("\n── WHAT THE MODEL ACTUALLY CITED ───────────────────────");
for (const m of rawObj.matched_requirements ?? []) {
  console.log("  req  :", String(m.requirement).slice(0, 60));
  console.log("  id   :", m.evidence_id);
  console.log("  quote:", JSON.stringify(String(m.excerpt ?? "").slice(0, 120)));
}
const parsed = parseMissionEvaluationStrict(raw, registry);
// The registry knows which page each id came from; the receipt rule needs it
// to tell corroboration from one page quoted twice.
const pageIntentFor = (id: string) => {
  const it = registry.items.find((x) => x.evidence_id === id);
  const pi = it?.metadata?.page_intent;
  return typeof pi === "string" ? pi : null;
};
const merged = mergeReevaluation(fx.prior, parsed.evaluation, pageIntentFor);

console.log("\n── AFTER ───────────────────────────────────────────────");
console.log("  decision      :", merged.decision);
console.log("  mission_fit   :", merged.mission_fit);
console.log("  match_score   :", merged.match_score);
console.log("  parse_status  :", parsed.parse_status);
console.log("  dropped cites :", parsed.raw_shape.dropped_citations.length);
for (const d of parsed.raw_shape.dropped_citations) console.log("        DROP:", d);
console.log("  matched       :", merged.matched_requirements.length, "requirements");
for (const m of merged.matched_requirements) {
  const isNew = !fx.prior.matched_requirements.some((p) => p.requirement === m.requirement);
  console.log(`     ${isNew ? "NEW" : "  ✓"}`, m.requirement.slice(0, 58));
  console.log("          cite:", m.evidence_id);
  console.log("          quote:", JSON.stringify(m.excerpt.slice(0, 90)));
  console.log("          page :", pageIntentFor(m.evidence_id) ?? "(n/a)", "| support:", m.support ?? "verified");
}
console.log("  failed        :", merged.failed_requirements.length);
for (const f of merged.failed_requirements) console.log("     ✗", f.requirement, "—", f.why.slice(0, 70));
console.log("  STILL OPEN    :", merged.unknown_fields);
console.log("\n  reasoning:", merged.reasoning.slice(0, 400));

console.log("\n── INVARIANTS ──────────────────────────────────────────");
for (const p of fx.prior.matched_requirements) {
  const kept = merged.matched_requirements.find((m) => m.requirement === p.requirement);
  console.log(
    `  ${kept ? "PRESERVED" : "LOST     "}  ${p.requirement.slice(0, 50)}`,
    kept && kept.evidence_id === p.evidence_id ? "(same citation)" : kept ? "(RECITED)" : "",
  );
}
