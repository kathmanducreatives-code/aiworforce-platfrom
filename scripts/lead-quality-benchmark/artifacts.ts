// Artifact writers: CSVs, the quality report, and a benchmark summary.
//
// All artifacts are deterministic given the evaluations. Raw provider artifacts
// (which may contain names) are written only under the gitignored artifacts/
// tree — never committed. Sanitized fixtures/examples are the only committed data.

import { evaluationReasonCodes } from "./evaluate.ts";
import { CONTACT_THRESHOLD } from "./score.ts";
import type { BenchmarkVerdict, RankedEvaluation } from "./types.ts";

// ------------------------------------------------------------------- CSV ----

export function toCsv(headers: string[], rows: Array<Record<string, unknown>>): string {
  const esc = (v: unknown): string => {
    const s = v == null ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const head = headers.map(esc).join(",");
  const body = rows.map((r) => headers.map((h) => esc(r[h])).join(",")).join("\n");
  return `${head}\n${body}\n`;
}

const RANKED_HEADERS = [
  "final_rank", "company", "domain", "company_url", "company_linkedin", "person", "title",
  "person_linkedin", "job_title", "job_location", "job_url", "job_date", "agentory_score",
  "benchmark_score", "agentory_decision", "audit_verdict", "hard_gates_passed",
  "hard_gate_failure_reasons", "current_employer_match", "us_relevance", "saas_validity",
  "hiring_signal_validity", "signal_recency_days", "why_now", "why_now_support", "outreach_angle",
  "duplicate_status", "recommended_action",
];

function gateOutcome(e: RankedEvaluation, id: string): string {
  return e.gates.gates.find((g) => g.id === id)?.outcome ?? "";
}

function recommendedAction(v: BenchmarkVerdict): string {
  switch (v) {
    case "CONTACT": return "Contact now";
    case "WATCH": return "Watch — needs one more signal";
    case "NEEDS_REVIEW": return "Manual review";
    case "REJECT": return "Reject";
  }
}

function rankedRecord(e: RankedEvaluation): Record<string, unknown> {
  const n = e.normalized;
  return {
    final_rank: e.finalRank,
    company: n.raw.companyName ?? "",
    domain: n.canonicalDomain ?? "",
    company_url: n.raw.sourceUrl ?? "",
    company_linkedin: n.companyLinkedinUrl ?? "",
    person: n.raw.personName ?? "",
    title: n.raw.personTitle ?? "",
    person_linkedin: n.personLinkedinUrl ?? "",
    job_title: n.raw.jobTitle ?? "",
    job_location: n.normalizedLocation ?? "",
    job_url: n.raw.jobPostingUrl ?? "",
    job_date: n.sourceDate ?? "",
    agentory_score: e.agentory?.score ?? "",
    benchmark_score: e.benchmarkScore.total,
    agentory_decision: e.agentory?.decision ?? "",
    audit_verdict: e.verdict,
    hard_gates_passed: e.gates.gates.filter((g) => g.outcome === "pass").length + "/6",
    hard_gate_failure_reasons: evaluationReasonCodes(e).join("|"),
    current_employer_match: gateOutcome(e, "employer_match"),
    us_relevance: gateOutcome(e, "us_relevance"),
    saas_validity: gateOutcome(e, "company_type"),
    hiring_signal_validity: gateOutcome(e, "hiring_signal"),
    signal_recency_days: n.evidenceFreshnessDays ?? "",
    why_now: e.whyNow.statement ?? "",
    why_now_support: e.whyNow.statement ? (e.whyNow.supported ? "supported" : "unsupported") : "none",
    outreach_angle: e.outreachAngle.angle ?? "",
    duplicate_status: e.duplicateStatus,
    recommended_action: recommendedAction(e.verdict),
  };
}

export function rankedLeadsCsv(evals: RankedEvaluation[]): string {
  const rows = evals.filter((e) => e.verdict !== "REJECT").map(rankedRecord);
  return toCsv(RANKED_HEADERS, rows);
}

export function rejectedLeadsCsv(evals: RankedEvaluation[]): string {
  const rows = evals.filter((e) => e.verdict === "REJECT").map(rankedRecord);
  return toCsv(RANKED_HEADERS, rows);
}

export function humanReviewCsv(evals: RankedEvaluation[]): string {
  const headers = [
    "final_rank", "company", "person", "audit_verdict", "why_now",
    "reviewer_contact_yes_no", "reviewer_reason", "ranking_correct_yes_no",
    "why_now_useful_yes_no", "notes",
  ];
  const rows = evals.slice(0, 10).map((e) => ({
    final_rank: e.finalRank,
    company: e.normalized.raw.companyName ?? "",
    person: e.normalized.raw.personName ?? "",
    audit_verdict: e.verdict,
    why_now: e.whyNow.statement ?? "",
    reviewer_contact_yes_no: "",
    reviewer_reason: "",
    ranking_correct_yes_no: "",
    why_now_useful_yes_no: "",
    notes: "",
  }));
  return toCsv(headers, rows);
}

// --------------------------------------------------------------- summary ----

export interface BenchmarkSummary {
  totalRaw: number;
  uniqueAccounts: number;
  verifiedFounders: number;
  validHiringSignals: number;
  validUsSignals: number;
  contact: number;
  watch: number;
  needsReview: number;
  reject: number;
  duplicateAccountsRemoved: number;
  duplicatePeopleRemoved: number;
  offCompanyRemoved: number;
  unsupportedWhyNow: number;
  scoreInflationCases: number;
}

export function summarize(evals: RankedEvaluation[]): BenchmarkSummary {
  const byVerdict = (v: BenchmarkVerdict) => evals.filter((e) => e.verdict === v).length;
  const gatePass = (id: string) => evals.filter((e) => e.gates.gates.find((g) => g.id === id)?.outcome === "pass").length;
  return {
    totalRaw: evals.length,
    uniqueAccounts: evals.filter((e) => e.duplicateStatus === "unique").length,
    verifiedFounders: gatePass("founder_role"),
    validHiringSignals: gatePass("hiring_signal"),
    validUsSignals: gatePass("us_relevance"),
    contact: byVerdict("CONTACT"),
    watch: byVerdict("WATCH"),
    needsReview: byVerdict("NEEDS_REVIEW"),
    reject: byVerdict("REJECT"),
    duplicateAccountsRemoved: evals.filter((e) => e.duplicateStatus === "duplicate_account").length,
    duplicatePeopleRemoved: evals.filter((e) => e.duplicateStatus === "duplicate_person").length,
    offCompanyRemoved: evals.filter((e) => e.gates.gates.find((g) => g.id === "employer_match")?.reasonCode === "current_employer_mismatch").length,
    unsupportedWhyNow: evals.filter((e) => e.agentory?.whyNow && !e.whyNow.supported).length,
    scoreInflationCases: evals.filter((e) => e.inflationWarning).length,
  };
}

/** Acceptance targets (section 12) evaluated against the CONTACT set + top 10. */
export function acceptanceTargets(evals: RankedEvaluation[]): Record<string, { value: string; pass: boolean }> {
  const contacts = evals.filter((e) => e.verdict === "CONTACT");
  // "Top 10" = the top 10 PRESENTED leads (matching ranked-leads.csv, which
  // excludes REJECT/duplicate rows) — never rejects padding the list.
  const top10 = evals.filter((e) => e.verdict !== "REJECT").slice(0, 10);
  const pct = (num: number, den: number) => (den === 0 ? 1 : num / den);
  const g = (e: RankedEvaluation, id: string) => e.gates.gates.find((x) => x.id === id)?.outcome === "pass";

  const employerMatch = pct(contacts.filter((e) => g(e, "employer_match")).length, contacts.length);
  const hiring = pct(contacts.filter((e) => g(e, "hiring_signal")).length, contacts.length);
  const evidence = pct(contacts.filter((e) => Boolean(e.normalized.evidenceUrl)).length, contacts.length);
  const us = pct(contacts.filter((e) => g(e, "us_relevance")).length, contacts.length);
  const saasTop10 = pct(top10.filter((e) => g(e, "company_type")).length, top10.length);
  const dupTop10 = top10.filter((e) => e.duplicateStatus !== "unique").length;
  const offCompanyTop10 = top10.filter((e) => e.gates.gates.find((x) => x.id === "employer_match")?.reasonCode === "current_employer_mismatch").length;
  const unsupportedWhyNow = evals.filter((e) => e.agentory?.whyNow && !e.whyNow.supported && e.verdict === "CONTACT").length;
  const gateFailContact = contacts.filter((e) => e.gates.gates.some((x) => x.outcome === "fail")).length;

  return {
    contact_employer_match_100: { value: `${Math.round(employerMatch * 100)}%`, pass: employerMatch >= 1 },
    contact_hiring_signal_100: { value: `${Math.round(hiring * 100)}%`, pass: hiring >= 1 },
    contact_evidence_url_100: { value: `${Math.round(evidence * 100)}%`, pass: evidence >= 1 },
    contact_us_relevance_90: { value: `${Math.round(us * 100)}%`, pass: us >= 0.9 },
    top10_saas_90: { value: `${Math.round(saasTop10 * 100)}%`, pass: saasTop10 >= 0.9 },
    top10_duplicate_accounts_0: { value: String(dupTop10), pass: dupTop10 === 0 },
    top10_off_company_0: { value: String(offCompanyTop10), pass: offCompanyTop10 === 0 },
    contact_unsupported_why_now_0: { value: String(unsupportedWhyNow), pass: unsupportedWhyNow === 0 },
    contact_gate_fail_0: { value: String(gateFailContact), pass: gateFailContact === 0 },
  };
}

// ------------------------------------------------------------- report md ----

export function qualityReportMd(opts: {
  runId: string;
  query: string;
  mode: string;
  summary: BenchmarkSummary;
  evals: RankedEvaluation[];
  costUsd: number;
  modelCalls: number;
}): string {
  const { summary: s, evals } = opts;
  const top10 = evals.slice(0, 10);
  const targets = acceptanceTargets(evals);
  const targetLines = Object.entries(targets)
    .map(([k, v]) => `| ${k} | ${v.value} | ${v.pass ? "PASS" : "FAIL"} |`).join("\n");
  const top10Rows = top10.map((e) =>
    `| ${e.finalRank} | ${e.normalized.raw.companyName ?? ""} | ${e.normalized.raw.personName ?? ""} | ${e.verdict} | ${e.benchmarkScore.total} | ${e.agentory?.score ?? "—"} | ${e.whyNow.statement ? (e.whyNow.supported ? "supported" : "unsupported") : "—"} |`,
  ).join("\n");

  const readyForSignals = s.contact >= 1 && Object.values(targets).every((t) => t.pass);

  return `# Lead-quality benchmark — ${opts.runId}

**Mode:** ${opts.mode}
**Fixed query:** \`${opts.query}\`

## 1. Executive verdict
${s.contact} CONTACT · ${s.watch} WATCH · ${s.needsReview} NEEDS_REVIEW · ${s.reject} REJECT.
Contact-threshold = ${CONTACT_THRESHOLD}. Ready for Signals UI work: **${readyForSignals ? "yes" : "no"}**.

## 2–7. Funnel
- Total raw results: ${s.totalRaw}
- Unique accounts: ${s.uniqueAccounts}
- Verified founders: ${s.verifiedFounders}
- Valid Sales/Revenue-Operations hiring signals: ${s.validHiringSignals}
- Valid US signals: ${s.validUsSignals}
- Contact/Watch/Needs-review/Reject: ${s.contact}/${s.watch}/${s.needsReview}/${s.reject}

## 8. Top 10
| Rank | Company | Person | Verdict | Benchmark | Agentory | Why-now |
|---|---|---|---|---|---|---|
${top10Rows || "| — | — | — | — | — | — | — |"}

## 9–14. Quality flags
- Score-inflation cases: ${s.scoreInflationCases}
- Unsupported why-now cases: ${s.unsupportedWhyNow}
- Duplicate accounts removed: ${s.duplicateAccountsRemoved}
- Duplicate people removed: ${s.duplicatePeopleRemoved}
- Off-company people removed: ${s.offCompanyRemoved}

## 15–16. Cost + model calls
- Apify reported spend: $${opts.costUsd.toFixed(2)}
- Model calls: ${opts.modelCalls}

## 19. Acceptance targets
| Target | Value | Result |
|---|---|---|
${targetLines}

## 20. Ready for Signals UI work
**${readyForSignals ? "yes" : "no"}**
`;
}

// -------------------------------------------------------------- file I/O ----

export async function writeText(path: string, content: string): Promise<void> {
  const dir = path.slice(0, path.lastIndexOf("/"));
  await Deno.mkdir(dir, { recursive: true });
  await Deno.writeTextFile(path, content);
}
