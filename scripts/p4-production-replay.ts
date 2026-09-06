// P4 PRODUCTION REPLAY — rebuild the EXACT payload run-agent hands the
// re-evaluator, from persisted checkpoint state, and (optionally) run it.
//
//   deno run --allow-read --allow-env --allow-net --env-file=.env.eval.local \
//     scripts/p4-production-replay.ts <fixture.json> [--call]
//
// Writes nothing. Buys no page. One model call only with --call.

import {
  buildMissionReevaluationInput, mergeReevaluation,
  parseMissionEvaluationStrict, MISSION_REEVALUATION_PROMPT,
  evaluationInputFromContext,
  type MissionEvaluation,
} from "../supabase/functions/_shared/missionEvaluation.ts";
import { buildEvidenceRegistry } from "../supabase/functions/_shared/leadEvidenceRegistry.ts";
import { selectCompanyPages } from "../supabase/functions/_shared/webEvidenceSelection.ts";
import { buildCompanyEvidence } from "../supabase/functions/_shared/leadCompanyEvidence.ts";
import { createGptStrategistGenerateJson } from "../supabase/functions/_shared/gptStrategistModel.ts";
import { routeModel } from "../supabase/functions/_shared/gptModelRouter.ts";

const fx = JSON.parse(await Deno.readTextFile(Deno.args[0])) as {
  company_key: string; company_name: string; domain: string; instruction: string;
  prior: MissionEvaluation; mission: Record<string, unknown>;
  enriched: Record<string, unknown>; identity: Record<string, unknown> | null;
  hiring_jobs: unknown[];
  pages: Array<{ source_url: string; page_intent: string; source_text: string; fetched_at: string }>;
};
const call = Deno.args.includes("--call");

// ── EXACTLY what run-agent/index.ts does today ────────────────────────────
// ── WHAT PRODUCTION NOW SHOWS THE MODEL ───────────────────────────────────
const selection = selectCompanyPages(fx.pages);
console.log(`  selection    : ${selection.chars_in} -> ${selection.chars_out} chars, ` +
  `${selection.pages.length}/${fx.pages.length} pages, ` +
  `${selection.duplicate_blocks} duplicate blocks`);
for (const d of selection.dropped) console.log("      dropped:", d.reason, d.source_url);
fx.pages = selection.pages as typeof fx.pages;

// The DECLARED field names — `identity_state` and `commercial_jobs`, not
// `identity` and `jobs`. The production path now reaches the engine's own
// builder; this mirrors what that builder is given.
const registry = buildEvidenceRegistry({
  evidence: buildCompanyEvidence({
    company: fx.enriched,
    company_key: fx.company_key,
    source_capability: "general_company_discovery",
    identity_state: fx.identity?.status === "verified_match" ? "resolved" : "unresolved",
    linkedin_company_url: (fx.identity?.linkedin_company_url as string) ?? null,
    commercial_jobs: (fx.hiring_jobs as Array<Record<string, unknown>>).map((j) => ({
      title: (j.title as string) ?? "", url: j.job_url, location: j.location,
      posted_date: j.posted_date, tier: null,
    })),
    strongest_signal: null,
  } as never),
  jobs: fx.hiring_jobs as never,
  web_pages: fx.pages,
});

// --drop <evidence_type>  removes an evidence class, to test priming.
const di = Deno.args.indexOf("--drop");
if (di >= 0) {
  const t = Deno.args[di + 1];
  (registry as { items: Array<{ evidence_type: string }> }).items =
    registry.items.filter((x) => x.evidence_type !== t);
}

const base = evaluationInputFromContext({
  version: "mission-reevaluation-context-v1",
  instruction: fx.instruction,
  mission: fx.mission,
  brain: {},
});

const payload = buildMissionReevaluationInput({ base, prior: fx.prior, registry });
// --open "<text>"  replaces the open requirement list, to test whether the
// WORDING the first pass authored is what the second pass cannot settle.
const oi = Deno.args.indexOf("--open");
if (oi >= 0) payload.open_requirements = [Deno.args[oi + 1]];
// --no-jobs / --no-industry strip registry classes, to test priming.


console.log("── REGISTRY AS PRODUCTION BUILDS IT ────────────────────");
console.log("  items:", registry.items.length);
const byType: Record<string, number> = {};
for (const it of registry.items) byType[it.evidence_type] = (byType[it.evidence_type] ?? 0) + 1;
console.log("  by type:", JSON.stringify(byType));
console.log("  hard_facts:", JSON.stringify(registry.hard_facts));
console.log("\n── DO THE ESTABLISHED CITATIONS STILL RESOLVE? ─────────");
for (const m of fx.prior.matched_requirements) {
  const hit = registry.items.some((x) => x.evidence_id === m.evidence_id);
  console.log(` ${hit ? "RESOLVES" : "MISSING "}  ${m.evidence_id}  ${m.requirement.slice(0, 44)}`);
}
console.log("\n── OPEN REQUIREMENTS SENT ──────────────────────────────");
for (const o of payload.open_requirements) console.log("  ?", o);
console.log("\n── PAYLOAD SIZE ────────────────────────────────────────");
console.log("  bytes:", JSON.stringify(payload).length);
console.log("  company block keys:", Object.keys(payload.company).join(", "));

if (!call) Deno.exit(0);

// ── PROMPT ARMS, for the differential audit only ──────────────────────────
const LEGACY_SUFFICIENCY = [
  "HOW STRONG IS STRONG ENOUGH.",
  "- Satisfied: the company's own page states it, OR a structural fact entails",
  "  it — for example per-seat recurring pricing tiers on a pricing page.",
  "- Satisfied by corroboration: at least TWO INDEPENDENT facts, from two",
  "  different pages, pointing the same way with nothing contradicting them.",
].join("\n");
const pi = Deno.args.indexOf("--policy");
const arm = pi >= 0 ? Deno.args[pi + 1] : "current";
const systemPrompt = arm === "fixed"
  ? MISSION_REEVALUATION_PROMPT.replace(
      "HOW STRONG IS STRONG ENOUGH.",
      LEGACY_SUFFICIENCY + "\n\nHOW STRONG IS STRONG ENOUGH.")
  : MISSION_REEVALUATION_PROMPT;
console.log("\n  policy arm:", arm);

const route = routeModel("mission_evaluation");
const generate = createGptStrategistGenerateJson({}, {
  model: route.model, reasoningEffort: route.reasoning_effort,
  tier: route.tier, purpose: route.stage, reason: route.reason,
});
const res = await generate({
  systemPrompt,
  messages: [{ role: "user", content: JSON.stringify(payload) }],
} as never);
const raw = (res as { ok?: boolean; json?: unknown })?.ok ? (res as { json?: unknown }).json : null;
if (!raw) { console.error("model returned nothing usable"); Deno.exit(2); }

const r = raw as { matched_requirements?: Array<Record<string, unknown>>; unknown_fields?: string[]; reasoning?: string };
const webCites = (r.matched_requirements ?? []).filter((m) =>
  String(m.evidence_id ?? "").startsWith("web_page")).length;
console.log(`RESULT arm=${arm} company=${fx.company_name} web_cites=${webCites}`);
console.log("\n── WHAT THE MODEL CITED (raw) ──────────────────────────");
for (const m of r.matched_requirements ?? []) {
  console.log("  req  :", String(m.requirement).slice(0, 60));
  console.log("  id   :", m.evidence_id, "| support:", m.support);
  console.log("  quote:", JSON.stringify(String(m.excerpt ?? "").slice(0, 100)));
}
console.log("  raw unknown_fields:", JSON.stringify(r.unknown_fields));
const parsed = parseMissionEvaluationStrict(raw, registry);
const pageIntentFor = (id: string) => {
  const it = registry.items.find((x) => x.evidence_id === id);
  const pi = it?.metadata?.page_intent;
  return typeof pi === "string" ? pi : null;
};
// What the FIRST pass held: the same registry without the pages P2 later bought.
const firstPass = buildEvidenceRegistry({
  evidence: buildCompanyEvidence({
    company: fx.enriched, company_key: fx.company_key,
    source_capability: "general_company_discovery",
    identity_state: fx.identity?.status === "verified_match" ? "resolved" : "unresolved",
    commercial_jobs: (fx.hiring_jobs as Array<Record<string, unknown>>).map((j) => ({
      title: (j.title as string) ?? "", url: j.job_url, location: j.location,
      posted_date: j.posted_date, tier: null,
    })),
  } as never),
  jobs: fx.hiring_jobs as never,
});
const priorIds = new Set(firstPass.items.map((i) => i.evidence_id));
const merged = mergeReevaluation(
  fx.prior, parsed.evaluation, pageIntentFor, (id) => !priorIds.has(id));
console.log("\n── AFTER ───────────────────────────────────────────────");
console.log("  decision   :", merged.decision, "| fit:", merged.mission_fit);
console.log("  dropped    :", parsed.raw_shape.dropped_citations);
console.log("  still open :", merged.unknown_fields);
console.log("  reasoning  :", (merged.reasoning ?? "").slice(0, 350));
