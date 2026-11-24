// LISA → COMPANY BRAIN: evidence-backed PROPOSALS, never facts.
//
// The one proposal LISA makes today is the safest one there is: a company a
// person ALREADY told LISA to watch as a competitor (a `monitoring_subjects`
// row of kind 'competitor') that the Company Brain does not list. LISA does not
// decide that anything is a competitor — the person did, in a different place
// — it only notices the two disagree and offers to reconcile them. A reviewer
// approves, corrects or rejects it on the Company Brain page; until then it is
// not knowledge and no agent reads it.
//
// Monitoring claims (funding, hiring, launches) are deliberately NOT proposed
// as Brain facts: they are observations about other companies and live in
// signal_events with their own lifecycle. Raw observation → reviewed signal →
// approved memory stay three separate things.
//
// PURE. The caller submits through company_brain_proposal_submit (service role).

import { canonicalDomain, proposalError, type ProposalInput } from "./brainMemoryModel.ts";

export interface MonitoredSubject {
  kind: string;            // monitoring_subjects.subject_kind
  identifier: string | null;
  label: string | null;
}

export interface SubjectEvidence {
  /** signal_events ids this pass wrote or deduplicated for the subject. */
  event_ids: string[];
  /** Source URLs those events carry, when any. */
  source_urls: string[];
  observed_at: string;
}

/**
 * Competitor subjects missing from the Brain → proposals. `known` is the
 * Brain's competitor list (names + domains, from the shared loader).
 */
export function competitorProposalsFromMonitoring(
  subjects: MonitoredSubject[],
  known: Array<{ name: string; domain: string | null }>,
  evidenceFor: (identifier: string) => SubjectEvidence | null,
  now: Date = new Date(),
): ProposalInput[] {
  const knownDomains = new Set(known.map((k) => k.domain).filter(Boolean) as string[]);
  const knownNames = new Set(known.map((k) => k.name.trim().toLowerCase()));
  const out: ProposalInput[] = [];
  const seen = new Set<string>();
  for (const s of subjects) {
    if (s.kind !== "competitor" || !s.identifier) continue;
    const domain = canonicalDomain(s.identifier) ?? canonicalDomain(s.identifier.replace(/^.*linkedin\.com\/company\//i, ""));
    if (!domain || seen.has(domain)) continue;
    seen.add(domain);
    const name = (s.label?.trim() || domain.split(".")[0]);
    if (knownDomains.has(domain) || knownNames.has(name.toLowerCase())) continue;

    const ev = evidenceFor(s.identifier);
    const evidence: ProposalInput["evidence"] = [
      { source_ref: `monitoring_subject:${s.identifier}`, observed_at: now.toISOString(),
        excerpt: "Your team set this company up to be monitored as a competitor." },
      ...(ev?.event_ids ?? []).slice(0, 10).map((id) => ({ source_ref: `signal_events:${id}`, observed_at: ev!.observed_at })),
      ...(ev?.source_urls ?? []).filter((u) => /^https?:\/\//i.test(u)).slice(0, 10)
        .map((u) => ({ source_url: u, observed_at: ev!.observed_at })),
    ];
    const p: ProposalInput = {
      kind: "fact", category: "competitors", fact_key: `competitor:${domain}`,
      value_type: "object", value: { name, domain },
      rationale: `${name} (${domain}) is monitored as a competitor but is not in your Company Brain's competitor list.`,
      evidence, source_type: "agent_suggestion",
      // The person's own monitoring choice is strong evidence of intent, not of fact.
      confidence: "medium",
      dedupe_key: `lisa:competitor:${domain}`,
    };
    if (!proposalError(p, "lisa")) out.push(p);
  }
  return out;
}

/** Submit each proposal; failures are reported, never thrown (proposals are advisory). */
export async function submitProposals(
  admin: { rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message: string } | null }> },
  workspaceId: string,
  agent: "orion" | "atlas" | "lyra" | "lisa",
  proposals: ProposalInput[],
): Promise<Array<{ fact_key: string; outcome: string }>> {
  const results: Array<{ fact_key: string; outcome: string }> = [];
  for (const p of proposals) {
    try {
      const { data, error } = await admin.rpc("company_brain_proposal_submit", {
        p_workspace_id: workspaceId, p_agent: agent, p_payload: p,
      });
      results.push({ fact_key: p.fact_key, outcome: error ? `error: ${error.message}` : String((data as { outcome?: string })?.outcome ?? "unknown") });
    } catch (e) {
      results.push({ fact_key: p.fact_key, outcome: `error: ${e instanceof Error ? e.message : String(e)}` });
    }
  }
  return results;
}
