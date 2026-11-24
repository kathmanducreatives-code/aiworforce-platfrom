// LISA → LYRA: a source-aware content brief, and a draft for human review.
//
// The brief carries the signal, its sources and COUNTED verification, the
// facts split into CONFIRMED and UNCERTAIN, the Company Brain's voice (tone,
// notes, things to avoid), content restrictions, the audience and an angle.
//
// The draft is DETERMINISTIC (no model call, no paid provider): a structured
// outline in the brand's tone that
//   * states only confirmed facts as facts;
//   * words anything single-source as "reportedly" and lists it under
//     "Needs confirmation before publishing";
//   * never compares the customer with a competitor (no verified basis);
//   * cites its sources;
//   * is created as a `content_item` with status `draft` — the content flow
//     has no publish state reachable from here, and approval is a person's.
//
// PURE.

import type { LyraBrainView } from "../companyBrainAgentViews.ts";
import type { AgentSignal } from "../lisa/weekly.ts";
import { COLLAB_CONTRACT_VERSION, idempotencyKeyFor, type Handoff } from "./contract.ts";
import type { OrionOpportunity } from "./lisaToOrion.ts";

export const LYRA_BRIEF_VERSION = "lyra-content-brief-v1" as const;

export interface LyraClaim { text: string; status: "confirmed" | "uncertain"; sources: string[] }

export interface LyraContentBrief {
  brief_version: typeof LYRA_BRIEF_VERSION;
  signal: { id: string; summary: string; event_date: string | null; verification: AgentSignal["verification"]; independent_sources: number };
  sources: Array<{ url: string; domain: string }>;
  claims: LyraClaim[];
  brand: { tone: string | null; voice_notes: string[]; avoid: string[] };
  restrictions: string[];
  audience: string[];
  angle: string;
  claimable_company_facts: string[];
  competitor_subject: boolean;
}

export function buildLyraBrief(s: AgentSignal, opp: OrionOpportunity, lyra: LyraBrainView | null, exclusions: string[] = []): LyraContentBrief {
  const urls = s.evidence.filter((e) => /^https?:\/\//.test(e.url)).map((e) => ({ url: e.url, domain: e.domain }));
  if (!urls.length && s.source_url) urls.push({ url: s.source_url, domain: new URL(s.source_url).hostname.replace(/^www\./, "") });
  const verified = s.verification === "corroborated" || s.verification === "self_reported";
  const claims: LyraClaim[] = [{ text: s.what_happened, status: verified ? "confirmed" : "uncertain", sources: urls.map((u) => u.url) }];
  if (opp.inferred_opportunity) claims.push({ text: opp.inferred_opportunity, status: "uncertain", sources: [] });
  const competitor = opp.recommended.some((r) => r.kind === "orion_review") && s.relevance.reasons.some((r) => /competitor/i.test(r));
  const restrictions = [
    "Do not present uncertain claims as fact.",
    "Do not compare us with any competitor; there is no verified basis for a comparison.",
    "Do not name or contact individuals.",
    "Cite the sources listed.",
    ...(lyra?.content_preferences ?? []).filter((p) => /restrict|avoid/i.test(p.text)).map((p) => p.text),
    ...(lyra?.brand_voice.avoid ?? []).map((a) => `Avoid: ${a}`),
    ...(exclusions ?? []).map((x) => `Do not target or court ${x} — excluded by your Company Brain.`),
  ];
  return {
    brief_version: LYRA_BRIEF_VERSION,
    signal: { id: s.id, summary: s.what_happened, event_date: s.event_date, verification: s.verification, independent_sources: s.independent_sources },
    sources: urls, claims,
    brand: { tone: lyra?.brand_voice.tone ?? null, voice_notes: lyra?.brand_voice.voice_notes ?? [], avoid: lyra?.brand_voice.avoid ?? [] },
    restrictions, audience: lyra?.audiences.length ? lyra.audiences : ["your target customers"],
    angle: competitor
      ? `What ${s.company.name}'s move means for buyers evaluating options — educational, no comparison claims.`
      : `What this ${s.category.replace("_", " ")} signals for ${lyra?.audiences[0] ?? "your market"}, and what to consider now.`,
    claimable_company_facts: (lyra?.claimable_facts ?? []).map((f) => f.text).slice(0, 5),
    competitor_subject: competitor,
  };
}

export interface LyraDraft {
  format: "linkedin_post";
  title: string;
  body: string;
  metadata: {
    brief_version: typeof LYRA_BRIEF_VERSION;
    generated_by: "deterministic-template";
    claims: LyraClaim[];
    sources: string[];
    needs_confirmation: string[];
    tone: string | null;
    review_required: true;
    audience: string;
    angle: string;
  };
}

export function draftFromBrief(b: LyraContentBrief): LyraDraft {
  const confirmed = b.claims.filter((c) => c.status === "confirmed");
  const uncertain = b.claims.filter((c) => c.status === "uncertain");
  const lead = confirmed[0]
    ? `${confirmed[0].text}${b.signal.event_date ? ` (${b.signal.event_date})` : ""}.`
    : `Reportedly: ${b.signal.summary}. This is not yet confirmed by independent sources.`;
  const body = [
    lead,
    "",
    `Why it matters: ${b.angle}`,
    "",
    "[Your point of view here — keep it to what the sources support.]",
    "",
    "Sources:",
    ...b.sources.map((s) => `- ${s.url}`),
  ].join("\n");
  return {
    format: "linkedin_post",
    title: `Draft: ${b.signal.summary}`.slice(0, 140),
    body,
    metadata: {
      brief_version: b.brief_version, generated_by: "deterministic-template", claims: b.claims,
      sources: b.sources.map((s) => s.url), needs_confirmation: uncertain.map((c) => c.text),
      tone: b.brand.tone, review_required: true, audience: b.audience[0] ?? "", angle: b.angle,
    },
  };
}

export function buildLyraHandoff(workspace_id: string, s: AgentSignal, opp: OrionOpportunity, lyra: LyraBrainView | null, exclusions: string[] = []): Handoff<{ brief: LyraContentBrief }> {
  const rec = opp.recommended.find((r) => r.kind === "lyra_content")!;
  return {
    contract_version: COLLAB_CONTRACT_VERSION, workspace_id, source_agent: "orion", target_agent: "lyra", kind: "lyra_content",
    company: opp.company, signal_ids: [s.id], lead_ids: [], brain_fingerprint: opp.brain_fingerprint,
    reason: rec.action, evidence: opp.evidence, verification: opp.verification, requires_approval: true,
    idempotency_key: idempotencyKeyFor("lyra_content", opp.company, [s.id]), payload: { brief: buildLyraBrief(s, opp, lyra, exclusions) },
  };
}
