// Harvest a live TEST run into the benchmark.
//
// Reads the gitignored DB harvest (db-lead_candidates.json + db-contacts.json)
// captured from a single authenticated TEST run-agent sourcing run, maps the
// persisted leads into the benchmark RawCandidate shape, runs the deterministic
// evaluation, and writes the standard artifacts. It performs ZERO provider calls
// — pure replay over already-captured data. Private emails/phones are dropped.
//
//   deno run --allow-read --allow-write scripts/lead-quality-benchmark/harvest-live-run.ts --dir <artifact-dir>

import { evaluateRun, evaluationReasonCodes } from "./evaluate.ts";
import { humanReviewCsv, qualityReportMd, rankedLeadsCsv, rejectedLeadsCsv, summarize, writeText } from "./artifacts.ts";
import type { AgentoryOutput, RawCandidate } from "./types.ts";

function arg(name: string): string | undefined {
  const i = Deno.args.indexOf(`--${name}`);
  return i >= 0 ? Deno.args[i + 1] : undefined;
}

/** Map a persisted lead_candidate + its contact into a benchmark RawCandidate. */
export function mapLeadToRaw(lead: Record<string, any>, contact: Record<string, any> | undefined, index: number): RawCandidate {
  const c = contact ?? {};
  const profile = (lead.raw?.profile ?? {}) as Record<string, any>;
  // The founder's stated current employer (self-reported on the profile).
  const company = c.company ?? profile.company ?? null;
  return {
    provider: "apify",
    actorKey: "apify_people_search",
    actorId: (lead.raw?.provider_provenance?.actor_id as string) ?? "harvestapi/linkedin-profile-search",
    actorRunId: (lead.raw?.provider_provenance?.run_id as string) ?? null,
    rawItemIndex: index,
    sourceUrl: c.linkedin_url ?? null,
    companyName: company,
    companyDomain: null,
    companyLinkedinUrl: profile.company_linkedin_url ?? null,
    // These are founder person-leads: no hiring-signal job was linked to them.
    jobTitle: profile.job_title ?? null,
    jobDescriptionExcerpt: c.headline ?? null,
    jobLocation: c.location ?? null,
    jobPostingUrl: null,
    jobObservedDate: lead.created_at ?? null,
    personName: c.full_name ?? null,
    personTitle: c.title ?? null,
    personLinkedinUrl: c.linkedin_url ?? null,
    statedCurrentCompany: company,
    rawLocation: c.location ?? null,
    // Drop private contact details (email/phone) — never needed by the benchmark.
    rawMeta: { companyDescription: c.headline ?? null, leadOrigin: lead.raw?.lead_origin ?? null },
  };
}

/** Agentory's own output for a persisted lead (score/decision as persisted). */
function agentoryFor(lead: Record<string, any>): AgentoryOutput {
  return {
    leadCandidateId: lead.id ?? null,
    score: typeof lead.fit_score === "number" ? lead.fit_score : null,
    decision: lead.status ?? null, // e.g. "new" = surfaced, unscored
    rank: null,
    whyNow: typeof lead.reason === "string" ? lead.reason : null,
    outreachAngle: null,
  };
}

async function main() {
  const dir = arg("dir");
  if (!dir) { console.error("--dir <artifact-dir> required"); Deno.exit(2); }
  const leads = JSON.parse(await Deno.readTextFile(`${dir}/db-lead_candidates.json`)) as Record<string, any>[];
  const contacts = JSON.parse(await Deno.readTextFile(`${dir}/db-contacts.json`)) as Record<string, any>[];
  const byId = new Map(contacts.map((c) => [c.id, c]));

  const raws = leads.map((l, i) => mapLeadToRaw(l, byId.get(l.contact_id), i));
  const agentoryByCandidateId: Record<string, AgentoryOutput> = {};
  const asOf = new Date().toISOString();
  // Build agentory map keyed by derived candidateId (normalize is deterministic).
  const { normalizeCandidate } = await import("./normalize.ts");
  raws.forEach((r, i) => {
    const cid = normalizeCandidate(r, { asOf }).candidateId;
    agentoryByCandidateId[cid] = agentoryFor(leads[i]);
  });

  const evals = evaluateRun(raws, { asOf, agentoryByCandidateId });
  const summary = summarize(evals);

  await writeText(`${dir}/raw-apify-results.json`, JSON.stringify(raws, null, 2));
  await writeText(`${dir}/agentory-results.json`, JSON.stringify(agentoryByCandidateId, null, 2));
  await writeText(`${dir}/normalized-candidates.json`, JSON.stringify(evals.map((e) => e.normalized), null, 2));
  await writeText(`${dir}/benchmark-evaluation.json`, JSON.stringify(evals, null, 2));
  await writeText(`${dir}/ranked-leads.csv`, rankedLeadsCsv(evals));
  await writeText(`${dir}/rejected-leads.csv`, rejectedLeadsCsv(evals));
  await writeText(`${dir}/human-review.csv`, humanReviewCsv(evals));
  await writeText(`${dir}/quality-report.md`, qualityReportMd({ runId: dir.split("/").pop() ?? "run", query: "Founders of SaaS startups hiring Sales Operations in the United States", mode: "live-harvest", summary, evals, costUsd: 0, modelCalls: 0 }));

  console.log(`candidates: ${evals.length}`);
  for (const e of evals) {
    console.log(`  ${e.finalRank}. ${e.normalized.raw.companyName} — ${e.normalized.raw.personName} [${e.normalized.raw.personTitle}] => ${e.verdict} (score ${e.benchmarkScore.total}) codes=${evaluationReasonCodes(e).join("|")}`);
  }
  console.log(`summary: CONTACT ${summary.contact} · WATCH ${summary.watch} · NEEDS_REVIEW ${summary.needsReview} · REJECT ${summary.reject}`);
}

if (import.meta.main) await main();
