// LEAD V2 P6 — THE FUNDING-STAGE VERIFIER: ONE CAPABILITY, TWO PROVIDERS.
//
// Plugs into the Claim Registry route `apify_funding_atomus / funding_verification`.
// The gap router decides WHEN a company needs it (a hard `company_stage` claim
// PENDING, route READY, not yet answered); this decides WHAT the funding record
// says, cheapest first:
//
//   0. what the mission already holds: funding discovery's rounds, read from
//        the company's evidence graph (never re-bought). They cite, and they
//        can contradict; they never prove completeness.
//   1. atomus, one batch, by LinkedIn page                       ~$0.0035 each
//        a verified later round (Series A+)  → FAIL, done
//        complete history, latest = Seed, and a DISCOVERED round cites that
//        same Seed round                     → PASS, no pvalyou purchase
//   2. pvalyou, batches of 2, only for Seed / pre-seed / unclear    $0.02 each
//        corroborated by `fundingCorroboration`, decided with
//        `pass_requires_source_url`:
//        complete history + cited decisive Seed round → PASS
//        a cited later round atomus lacks             → FAIL
//        anything else                                → PENDING
//
// A pvalyou read of a company it has not seen can take many minutes, longer
// than a slice; the run is returned as PENDING-RUN with the atomus reading
// carried beside it, and adopted on the next slice — never bought twice.
//
// Nothing here infers a stage: no age, size, branding or model reading reaches
// the decision (`fundingStageClaim` takes rounds and nothing else).

import {
  batches, type ClaimVerifier, type PendingVerifierRun, type VerificationTarget,
  type VerifierDeps, type VerifierFinding,
} from "./claimVerifier.ts";
import {
  ATOMUS_FUNDING_ACTOR_KEY, atomusSettles, decideCorroboratedFundingStage, fundingRecordsInGraph,
  normalizeAtomusFunding, normalizePvalyouFunding, PVALYOU_FUNDING_ACTOR_KEY,
} from "./fundingCorroboration.ts";
import { fundingStageEvidenceItem, type FundingRecordFact, type FundingStageDecision } from "./fundingStageClaim.ts";

export const FUNDING_STAGE_VERIFIER_KEY = "funding_stage_corroboration" as const;
/** atomus is one call for all of them; bounded so per-candidate evidence spend stays small. */
export const FUNDING_MAX_TARGETS = 6;
/** Two pvalyou reads per call keeps each call under the $0.05 funding-evidence ceiling. */
export const PVALYOU_BATCH = 2;

/** A LinkedIn company page as atomus accepts it: the canonical URL, or null. */
export function atomusInput(linkedinUrl: string | null): string | null {
  if (!linkedinUrl) return null;
  const m = /linkedin\.com\/company\/([^/?#]+)/i.exec(linkedinUrl);
  return m ? `https://www.linkedin.com/company/${m[1].toLowerCase()}` : null;
}

/** atomus's slug for a URL, for matching its row back when it echoes a slug. */
function slugOf(v: string | null): string | null {
  if (!v) return null;
  const m = /linkedin\.com\/company\/([^/?#]+)/i.exec(v);
  return (m ? m[1] : v).toLowerCase().replace(/\/+$/, "");
}

function finding(t: VerificationTarget, decision: FundingStageDecision, record: FundingRecordFact | null, i: {
  mission_id: string | null; provider_call_id: string | null; at: string; stage: string; conflicts?: string[];
}): VerifierFinding {
  const item = record
    ? fundingStageEvidenceItem({
      company_key: t.company_key, decision, record, mission_id: i.mission_id,
      provider_call_id: i.provider_call_id, observed_at: i.at,
    })
    : null;
  return {
    company_key: t.company_key, item, answered: true,
    detail: {
      stage: i.stage, verdict: decision.verdict, reasons: decision.reasons, explanation: decision.explanation,
      ...(i.conflicts?.length ? { conflicts: i.conflicts } : {}),
    },
  };
}

/** The carry a pending pvalyou run holds: each company's atomus record and the input it was read under. */
interface PvalyouCarry {
  targets: VerificationTarget[];
  atomus: Record<string, FundingRecordFact | null>;
  inputs: Record<string, string>;
  atomus_call_id: string | null;
  /** The funding records each company's graph already carried (discovery). */
  discovered?: Record<string, FundingRecordFact[]>;
}

/** The records discovery already bought for this company. */
const discoveredOf = (t: VerificationTarget): FundingRecordFact[] => (t.graph ? fundingRecordsInGraph(t.graph) : []);

export function fundingStageVerifier(): ClaimVerifier {
  return {
    key: FUNDING_STAGE_VERIFIER_KEY,
    claim: "funding_stage",
    route_actor: ATOMUS_FUNDING_ACTOR_KEY,
    max_targets: FUNDING_MAX_TARGETS,
    async verify(targets, deps, ctx) {
      const findings: VerifierFinding[] = [];
      const pending: PendingVerifierRun[] = [];
      const at = deps.now();

      // ── the pvalyou half of a pair, decided once its rows exist ──────────
      const settleWithPvalyou = (
        carry: PvalyouCarry, rows: Record<string, unknown>[] | null, callId: string | null,
      ) => {
        const reads = (rows ?? []).map(normalizePvalyouFunding);
        for (const t of carry.targets) {
          const sent = carry.inputs[t.company_key];
          const pv = reads.find((r) => r.input === sent) ?? null;
          const atomus = carry.atomus[t.company_key] ?? null;
          const { decision, corroboration } = decideCorroboratedFundingStage({
            required_stage: String(t.criterion.value ?? ""), atomus, pvalyou: pv?.record ?? null,
            discovered: carry.discovered?.[t.company_key] ?? [],
          });
          findings.push(finding(t, decision, corroboration.record, {
            mission_id: ctx.mission_id, provider_call_id: callId ?? carry.atomus_call_id, at,
            stage: rows === null ? "atomus_only" : "corroborated", conflicts: corroboration.conflicts,
          }));
        }
      };

      const runPvalyou = async (carry: PvalyouCarry, resume?: PendingVerifierRun) => {
        const input = resume?.input ?? {
          tier: "basic", companies: carry.targets.map((t) => carry.inputs[t.company_key]),
        };
        const out = await deps.call({
          actor_key: PVALYOU_FUNDING_ACTOR_KEY, input, purpose: "funding_evidence",
          candidate_keys: carry.targets.map((t) => t.company_key), resume_run_id: resume?.run_id ?? null,
        });
        if (out.status === "ok") return settleWithPvalyou(carry, out.rows, out.provider_call_id);
        if (out.status === "running") {
          pending.push({
            verifier: FUNDING_STAGE_VERIFIER_KEY, stage: "pvalyou", actor_key: PVALYOU_FUNDING_ACTOR_KEY,
            run_id: out.run_id, input, candidate_keys: carry.targets.map((t) => t.company_key),
            started_at: resume?.started_at ?? at, carry: carry as unknown as Record<string, unknown>,
          });
          deps.log("funding_verifier_run_pending", { run_id: out.run_id, companies: carry.targets.length });
          return;
        }
        // Refused or failed: nothing to cite. atomus alone can still FAIL (already
        // settled above) but can never PASS, so the claim stays PENDING — and is
        // answered: asking again this mission would return the same refusal.
        deps.log("funding_verifier_corroboration_unavailable", { status: out.status, reason: out.reason });
        settleWithPvalyou(carry, null, null);
      };

      // ── 1. adopt what earlier slices started ─────────────────────────────
      for (const p of ctx.pending.filter((x) => x.verifier === FUNDING_STAGE_VERIFIER_KEY && x.stage === "pvalyou")) {
        await runPvalyou(p.carry as unknown as PvalyouCarry, p);
      }
      const inFlight = new Set(ctx.pending.flatMap((p) => p.candidate_keys));
      const fresh = targets.filter((t) => !inFlight.has(t.company_key));
      if (fresh.length === 0) return { findings, pending };

      // ── 2. atomus, one batch, for every target with a LinkedIn page ──────
      const atomusRecords: Record<string, FundingRecordFact | null> = {};
      let atomusCallId: string | null = null;
      const byPage = fresh.map((t) => ({ t, page: atomusInput(t.linkedin_url) }));
      const withPage = byPage.filter((x) => x.page);
      if (withPage.length > 0 && deps.ready(ATOMUS_FUNDING_ACTOR_KEY)) {
        const out = await deps.call({
          actor_key: ATOMUS_FUNDING_ACTOR_KEY, purpose: "funding_evidence",
          input: { companies: withPage.map((x) => x.page!) },
          candidate_keys: withPage.map((x) => x.t.company_key),
        });
        if (out.status === "ok") {
          atomusCallId = out.provider_call_id;
          const reads = out.rows.map(normalizeAtomusFunding);
          for (const { t, page } of withPage) {
            const want = slugOf(page);
            const r = reads.find((x) => slugOf(x.input) === want || slugOf(x.linkedin_url) === want) ?? null;
            atomusRecords[t.company_key] = r?.record ?? null;
          }
        } else {
          deps.log("funding_verifier_atomus_unavailable", { status: out.status, reason: (out as { reason?: string }).reason });
        }
      }

      // ── 3. what atomus settles alone, or with what discovery carried ─────
      const needCitation: VerificationTarget[] = [];
      const discovered: Record<string, FundingRecordFact[]> = {};
      for (const t of fresh) {
        const atomus = atomusRecords[t.company_key] ?? null;
        discovered[t.company_key] = discoveredOf(t);
        const failed = atomusSettles(String(t.criterion.value ?? ""), atomus);
        if (failed) {
          findings.push(finding(t, failed, atomus, {
            mission_id: ctx.mission_id, provider_call_id: atomusCallId, at, stage: "atomus_later_round",
          }));
          continue;
        }
        // NOT RE-BOUGHT: a discovered round that cites the decisive round —
        // or cites a later one — decides the claim without pvalyou.
        if (atomus && discovered[t.company_key].length > 0) {
          const { decision, corroboration } = decideCorroboratedFundingStage({
            required_stage: String(t.criterion.value ?? ""), atomus, pvalyou: null, discovered: discovered[t.company_key],
          });
          if (decision.verdict !== "pending") {
            findings.push(finding(t, decision, corroboration.record, {
              mission_id: ctx.mission_id, provider_call_id: atomusCallId, at, stage: "atomus_with_discovery",
              conflicts: corroboration.conflicts,
            }));
            continue;
          }
        }
        needCitation.push(t);
      }

      // ── 4. pvalyou cites, for Seed / pre-seed / unclear ──────────────────
      const inputs: Record<string, string> = {};
      for (const t of needCitation) {
        const key = t.domain ?? t.linkedin_url;
        if (key) inputs[t.company_key] = key;
      }
      const citable = needCitation.filter((t) => inputs[t.company_key]);
      const uncitable = needCitation.filter((t) => !inputs[t.company_key]);
      if (uncitable.length > 0 || (citable.length > 0 && !deps.ready(PVALYOU_FUNDING_ACTOR_KEY))) {
        // Nothing can cite these this mission: decide on atomus alone (PENDING at best).
        settleWithPvalyou({
          targets: deps.ready(PVALYOU_FUNDING_ACTOR_KEY) ? uncitable : needCitation,
          atomus: atomusRecords, inputs, atomus_call_id: atomusCallId, discovered,
        }, null, null);
      }
      if (deps.ready(PVALYOU_FUNDING_ACTOR_KEY)) {
        for (const group of batches(citable, PVALYOU_BATCH)) {
          await runPvalyou({ targets: group, atomus: atomusRecords, inputs, atomus_call_id: atomusCallId, discovered });
        }
      }
      return { findings, pending };
    },
  };
}
