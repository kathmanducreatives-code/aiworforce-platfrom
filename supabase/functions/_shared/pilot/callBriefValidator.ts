import { object } from "./pilotPolicy.ts";
import { boundedJson, exactKeys, refuse } from "./pilotCompanyResearch.ts";
import {
  type BriefChoice,
  CALL_BRIEF_VERSION,
  QUESTION_KINDS,
} from "./callBriefContract.ts";
import type { BriefCatalog } from "./callBriefPrompt.ts";
export function validateBriefChoice(
  raw: unknown,
  c: BriefCatalog,
): BriefChoice {
  const v = boundedJson(object(raw), 5000);
  exactKeys(v, [
    "schema_version",
    "company_overview",
    "business_context",
    "signal_evidence",
    "talking_points",
    "discovery_questions",
    "missing_information",
  ]);
  if (v.schema_version !== CALL_BRIEF_VERSION) {
    refuse("brief_schema_version_invalid");
  }
  const facts = new Map(c.facts.map((f) => [f.id, f.fact])),
    brain = new Map(c.brain.map((b) => [b.id, b])),
    unknowns = new Set(c.unknowns.map((u) => u.id));
  const list = (v: unknown, max: number, min = 0): unknown[] => {
    if (
      !Array.isArray(v) || v.length < min || v.length > max ||
      new Set(v.map((x) => JSON.stringify(x))).size !== v.length
    ) refuse("brief_array_invalid");
    return v;
  };
  const fact = (id: unknown) => {
    if (typeof id !== "string" || !facts.has(id)) {
      refuse("brief_fact_reference_invalid");
    }
    return facts.get(id)!;
  };
  const context = (id: unknown, offer = false) => {
    if (
      typeof id !== "string" || !brain.has(id) ||
      offer && !brain.get(id)!.path.startsWith("positioning.")
    ) refuse("brief_brain_reference_invalid");
    return brain.get(id)!;
  };
  const overview = list(v.company_overview, 3, 1).map(fact);
  if (!overview.some((f) => f.field === "company_name")) {
    refuse("brief_company_identity_missing");
  }
  list(v.business_context, 3).forEach((id) => context(id));
  list(v.signal_evidence, 2).forEach((id) => {
    if (fact(id).field !== "source_excerpt") {
      refuse("brief_signal_not_source_excerpt");
    }
  });
  list(v.missing_information, 5).forEach((id) => {
    if (typeof id !== "string" || !unknowns.has(id)) {
      refuse("brief_unknown_reference_invalid");
    }
  });
  list(v.talking_points, 2).forEach((value) => {
    const r = object(value);
    exactKeys(r, ["fact_id", "brain_id"]);
    fact(r.fact_id);
    context(r.brain_id, true);
  });
  list(v.discovery_questions, 3, 1).forEach((value) => {
    const r = object(value);
    exactKeys(r, ["kind", "fact_id", "brain_id"]);
    if (!(QUESTION_KINDS as readonly unknown[]).includes(r.kind)) {
      refuse("brief_question_kind_invalid");
    }
    if (r.kind === "understand_priorities") {
      if (r.fact_id !== null) refuse("brief_question_premise_invalid");
      context(r.brain_id);
    } else {
      const f = fact(r.fact_id);
      if (r.kind === "explore_fit") context(r.brain_id, true);
      else if (r.brain_id !== null) refuse("brief_question_premise_invalid");
      if (
        r.kind === "clarify_conflict" &&
        !c.conflicting_source_ids.includes(f.source_id)
      ) refuse("brief_unfounded_conflict");
    }
  });
  return v as unknown as BriefChoice;
}
export function renderCallBrief(choice: BriefChoice, c: BriefCatalog) {
  const v = validateBriefChoice(choice, c),
    facts = new Map(c.facts.map((f) => [f.id, f.fact])),
    brain = new Map(c.brain.map((b) => [b.id, b]));
  const fact = (id: string) => facts.get(id)!,
    context = (id: string) => brain.get(id)!;
  const question = (q: BriefChoice["discovery_questions"][number]) => ({
    kind: q.kind,
    mode: "question_not_assertion" as const,
    text: q.kind === "verify_context"
      ? "Is the quoted information still accurate and current?"
      : q.kind === "clarify_conflict"
      ? "Which of these unresolved supplied statements is accurate?"
      : q.kind === "explore_fit"
      ? "Could the reviewed offer be relevant to your current priorities?"
      : "Is this reviewed client topic relevant to your current priorities?",
    buyer_premise: q.fact_id ? fact(q.fact_id) : null,
    client_context: q.brain_id ? context(q.brain_id) : null,
  });
  const used = [
    ...new Set([
      ...v.company_overview,
      ...v.signal_evidence,
      ...v.talking_points.map((t) => t.fact_id),
      ...v.discovery_questions.flatMap((q) => q.fact_id ? [q.fact_id] : []),
    ]),
  ];
  return {
    company_overview: v.company_overview.map(fact),
    relevant_business_context: v.business_context.map(context),
    reviewed_client_instructions: c.brain,
    source_snapshots_for_review: c.source_snapshots,
    verified_facts: [],
    grounded_buying_signals: [],
    signal_evidence_for_human_review: v.signal_evidence.map(fact),
    talking_points: v.talking_points.map((t) => ({
      mode: "plausible_fit_not_buyer_fact" as const,
      buyer_context: fact(t.fact_id),
      reviewed_offer: context(t.brain_id),
      question: question({
        kind: "explore_fit",
        fact_id: t.fact_id,
        brain_id: t.brain_id,
      }),
    })),
    discovery_questions: v.discovery_questions.map(question),
    missing_information: [
      ...v.missing_information.map((id) =>
        c.unknowns.find((u) => u.id === id)!
      ),
      ...c.unknowns.filter((u) => !v.missing_information.includes(u.id)),
    ],
    do_not_claim: [
      "Current hiring, funding, technologies, buyer problems, founder status, employment or buying intent are not verified.",
      "Supplied quotations may be old, negative, incomplete or contradictory; confirm them with the human contact.",
      "No qualification decision or outreach approval is supplied by this brief.",
    ],
    sources_used: [...new Set(used.map((id) => fact(id).source_id))].sort(),
    qualification_decision: null,
    qualification_evaluated: false as const,
  };
}
