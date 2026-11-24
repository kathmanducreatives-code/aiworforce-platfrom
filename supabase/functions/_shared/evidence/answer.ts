// THE STRUCTURED ORION ANSWER. PURE AND DETERMINISTIC.
//
// Six sections, in this order (Workforce V2 §5):
//   Executive answer · Why it matters · Evidence · Recommended actions ·
//   Agent collaboration · Uncertainty
//
// Every sentence is built from an EvidenceItem or the approved Company Brain.
// No section may state a fact the evidence does not carry; where there is
// nothing, the section says so. A model may later reword this text, but the
// facts and their verification labels are fixed here.

import type { SharedBrainContext } from "../companyBrainContextLoader.ts";
import { matchExclusion } from "../brainMemoryModel.ts";
import { VERIFICATION_LABEL, type EvidenceItem, type EvidenceSourceType } from "./model.ts";
import type { RetrieveResult, SourceStatus } from "./retrieve.ts";

export const EVIDENCE_ANSWER_VERSION = "evidence-answer-v1" as const;

export type EvidenceQuestionKind = "verification" | "rejection" | "priority" | "company";

export interface StructuredAnswer {
  version: typeof EVIDENCE_ANSWER_VERSION;
  kind: EvidenceQuestionKind;
  executive_answer: string;
  why_it_matters: string;
  evidence: Array<{ ref: string; id: string; line: string }>;
  recommended_actions: Array<{ department: "ORION" | "ATLAS" | "LISA" | "LYRA"; action: string; needs_approval: boolean }>;
  agent_collaboration: string;
  uncertainty: string[];
  /** Evidence ids the answer rests on, for provenance and the dashboard. */
  cited_ids: string[];
  brain_fingerprint: string | null;
}

const VERIFY_RE = /\b(verified|verify|confirm(ed)?|true|real|legit|accurate)\b/i;
const REJECT_RE = /\bwhy\b.*\b(reject|rejected|disqualif|drop|dropped|exclude|excluded|skip|skipped)\b/i;
const PRIORITY_RE = /\b(priorit|focus|attention|what should (i|we) (do|work)|most important|top (things|opportunit))/i;

/** Which kind of evidence question this is, or null when it is not one. */
export function evidenceQuestionKind(message: string): EvidenceQuestionKind | null {
  const m = String(message ?? "");
  if (REJECT_RE.test(m)) return "rejection";
  if (/\b(is|was|are)\b/i.test(m) && VERIFY_RE.test(m) && /\b(announcement|news|signal|expansion|claim|report|this|it|that)\b/i.test(m)) return "verification";
  if (PRIORITY_RE.test(m)) return "priority";
  return null;
}

/**
 * The company a verification question names: "Is Kestrel Fabrication's
 * expansion verified?" → "Kestrel Fabrication". Null for a pronoun ("this").
 */
export function evidenceSubjectFromMessage(message: string): string | null {
  const m = String(message ?? "").match(/\b(?:[Ii]s|[Ww]as|[Aa]re)\s+(?:the\s+)?([A-Z][\w&.-]*(?:\s+[A-Z][\w&.-]*){0,4})(?:['’]s)?\s+(?:announcement|news|expansion|signal|claim|report|funding|hiring|launch)/);
  if (!m) return null;
  const name = m[1].trim();
  return /^(this|that|it|the)$/i.test(name) ? null : name;
}

const date = (iso: string | null) => (iso ? iso.slice(0, 10) : "undated");
const host = (u: string | null) => { try { return u ? new URL(u).hostname.replace(/^www\./, "") : null; } catch { return null; } };
const SOURCE_LABEL: Record<EvidenceSourceType, string> = {
  company_brain: "Company Brain", lead: "ATLAS lead record", lisa_signal: "LISA signal", web_page: "company page (cached)",
};
const DEPT_OF_SOURCE: Record<EvidenceSourceType, string> = {
  company_brain: "Company Brain", lead: "ATLAS", lisa_signal: "LISA", web_page: "ATLAS research",
};

function line(e: EvidenceItem): string {
  const who = e.subject.name ?? e.subject.domain ?? "workspace";
  const src = host(e.source_url) ?? SOURCE_LABEL[e.source_type];
  return `${who}: ${e.content.slice(0, 220)} — ${VERIFICATION_LABEL[e.verification]} · ${date(e.published_at ?? e.retrieved_at)} · ${src}`;
}

function excludedBy(brain: SharedBrainContext | null, e: EvidenceItem): string | null {
  if (!brain) return null;
  return matchExclusion(brain.exclusions, { name: e.subject.name, domain: e.subject.domain, industry: e.content });
}

export function composeStructuredAnswer(i: {
  kind: EvidenceQuestionKind;
  subject?: { name?: string | null; domain?: string | null } | null;
  retrieved: Pick<RetrieveResult, "items" | "sources" | "brain">;
}): StructuredAnswer {
  const brain = i.retrieved.brain;
  const subjectName = i.subject?.name ?? i.subject?.domain ?? null;
  const all = i.retrieved.items;
  // Workspace-level Brain facts frame the answer (why_it_matters); they are not evidence about a company.
  const evidenceOnly = all.filter((e) => e.source_type !== "company_brain");
  const signals = evidenceOnly.filter((e) => e.source_type === "lisa_signal");
  const leads = evidenceOnly.filter((e) => e.source_type === "lead");
  const current = (e: EvidenceItem) => e.verification === "verified" || e.verification === "single_source";

  let executive = "";
  let why = "";
  let used: EvidenceItem[] = [];
  const actions: StructuredAnswer["recommended_actions"] = [];

  if (i.kind === "verification") {
    const top = signals[0] ?? evidenceOnly[0];
    if (!top) {
      executive = `I have no stored evidence about ${subjectName ?? "that announcement"}, so I cannot say it is verified.`;
      actions.push({ department: "LISA", action: `Check ${subjectName ?? "the announcement"} for a dated, sourced report`, needs_approval: true });
    } else {
      used = [top, ...signals.slice(1, 3)];
      const v = top.verification;
      executive = v === "verified"
        ? `Yes — ${top.subject.name ?? subjectName}'s ${top.content.split(" — ")[0]} is verified by independent sources.`
        : v === "contradicted"
          ? `No — sources contradict ${top.subject.name ?? subjectName}'s ${top.content.split(" — ")[0]}; treat it as unconfirmed.`
          : v === "stale"
            ? `It was reported, but the evidence is stale (${date(top.published_at ?? top.retrieved_at)}); it may no longer hold.`
            : `Not verified — it rests on ${VERIFICATION_LABEL[v]} evidence only.`;
      if (v === "single_source" || v === "unknown" || v === "stale") {
        actions.push({ department: "LISA", action: "Look for a second, independent source before anyone acts on it", needs_approval: true });
      }
    }
  } else if (i.kind === "rejection") {
    const lead = leads.find((e) => /\b(rejected|disqualified|dismissed|excluded)\b/i.test(e.content)) ?? leads[0];
    const ex = lead ? excludedBy(brain, lead) : (brain && i.subject ? matchExclusion(brain.exclusions, i.subject) : null);
    if (lead) used = [lead];
    executive = !lead && !ex
      ? `I have no saved lead record for ${subjectName ?? "that company"}, so I cannot say why it was rejected.`
      : ex
        ? `${subjectName ?? lead?.subject.name} was left out because your Company Brain excludes ${ex}.${lead ? ` ATLAS's record: ${lead.content}.` : ""}`
        : `ATLAS's record says: ${lead!.content}.`;
  } else if (i.kind === "priority") {
    const ranked = [...signals.filter(current), ...leads.filter((e) => /\b(new|qualified|pending)\b/i.test(e.content))]
      .filter((e) => !excludedBy(brain, e));
    used = ranked.slice(0, 3);
    executive = used.length
      ? `Focus on ${used.map((e) => e.subject.name ?? e.subject.domain).filter(Boolean).join(", ")} — the strongest current items in your workspace.`
      : "Nothing current in your workspace needs attention: no recent verified signals or open leads.";
    for (const e of used.filter((x) => x.source_type === "lisa_signal" && x.verification === "verified").slice(0, 2)) {
      actions.push({ department: "ATLAS", action: `Qualify ${e.subject.name} against your ICP (paid sourcing waits for your approval)`, needs_approval: true });
    }
  } else {
    used = evidenceOnly.slice(0, 5);
    executive = used.length
      ? `Here is what Agentory has on record about ${subjectName ?? "this"}: ${used.length} item${used.length === 1 ? "" : "s"}.`
      : `I have no stored evidence about ${subjectName ?? "that company"}.`;
  }

  const firstEx = used.map((e) => excludedBy(brain, e)).find(Boolean) ?? null;
  const tc = brain?.canonical?.target_customer;
  const size = tc?.company_size;
  const icp = tc ? [
    tc.geography?.join("/"), tc.industries?.join("/"),
    size && (size.min != null || size.max != null) ? `${size.min ?? "?"}–${size.max ?? "?"} employees` : "",
  ].filter(Boolean).join(", ") : "";
  why = !brain
    ? "Your Company Brain is not set up, so I cannot judge fit against your goals."
    : firstEx
      ? `It conflicts with your Company Brain: excluded ${firstEx}.`
      : used.length
        ? `${icp ? `Judged against your ICP (${icp.slice(0, 140)}). ` : ""}${used.some((e) => e.verification === "verified") ? "At least one item is verified." : "None of it is independently verified yet."}`
        : "There is nothing on record to weigh yet.";

  if (used.some((e) => e.source_type === "lisa_signal" && e.verification === "verified" && !excludedBy(brain, e))) {
    actions.push({ department: "LYRA", action: "Draft a post or outreach about the verified signal (draft only; nothing is sent)", needs_approval: false });
  }
  if (!actions.length) actions.push({ department: "ORION", action: "No action needed until new evidence arrives", needs_approval: false });

  const contributors = [...new Set(used.map((e) => DEPT_OF_SOURCE[e.source_type]))];
  const gaps = (Object.entries(i.retrieved.sources) as Array<[EvidenceSourceType, SourceStatus]>)
    .filter(([, st]) => st === "unavailable").map(([k]) => SOURCE_LABEL[k]);
  const uncertainty: string[] = [];
  for (const cls of ["stale", "contradicted", "inference", "unknown", "single_source"] as const) {
    const n = used.filter((e) => e.verification === cls).length;
    if (n) uncertainty.push(`${n} item${n === 1 ? " is" : "s are"} ${VERIFICATION_LABEL[cls]}`);
  }
  if (gaps.length) uncertainty.push(`Could not read: ${gaps.join(", ")}`);
  if (!brain || brain.status !== "ready") uncertainty.push("Company Brain incomplete — fit judgements are provisional");
  uncertainty.push("Only stored records were consulted; no live web search was run");

  const evidence = used.map((e, n) => ({ ref: `E${n + 1}`, id: e.id, line: line(e) }));
  return {
    version: EVIDENCE_ANSWER_VERSION, kind: i.kind,
    executive_answer: executive, why_it_matters: why, evidence,
    recommended_actions: actions,
    agent_collaboration: contributors.length
      ? `Drawn from ${contributors.join(", ")}.${actions.some((a) => a.needs_approval) ? " Steps marked (approval) wait for you." : ""}`
      : "No department has records on this yet.",
    uncertainty, cited_ids: used.map((e) => e.id), brain_fingerprint: brain?.fingerprint ?? null,
  };
}

export function renderStructuredAnswer(a: StructuredAnswer): string {
  const out = [
    `**Executive answer**\n${a.executive_answer}`,
    `**Why it matters**\n${a.why_it_matters}`,
    `**Evidence**\n${a.evidence.length ? a.evidence.map((e) => `[${e.ref}] ${e.line}`).join("\n") : "None on record."}`,
    `**Recommended actions**\n${a.recommended_actions.map((x) => `- ${x.department}: ${x.action}${x.needs_approval ? " (approval)" : ""}`).join("\n")}`,
    `**Agent collaboration**\n${a.agent_collaboration}`,
    `**Uncertainty**\n${a.uncertainty.map((u) => `- ${u}`).join("\n")}`,
  ];
  return out.join("\n\n");
}
