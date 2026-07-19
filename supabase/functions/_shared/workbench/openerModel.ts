// Runtime model boundary for the personalized opener.
//
// Uses the EXISTING approved provider architecture (aiProvider.generateText) —
// no new provider is introduced. This is the only file that builds a prompt, and
// it is deliberately thin so the prompt surface stays auditable.
//
// The prompt carries ONLY sanitized, evidence-backed facts:
//   verified first name · verified title + company · one strongest observation ·
//   one saved-ICP relevance statement · one Company Brain outcome · tone ·
//   prohibited claims · hard length and style rules.
//
// It never carries raw scraped pages, provider payloads, unrestricted lead JSON,
// emails, phone numbers or internal scoring dumps.

import { generateText } from "../aiProvider.ts";
import type {
  ModelBoundary,
  ModelOpenerRequest,
  ModelOpenerResponse,
  PersonalizationContext,
} from "./openerBackend.ts";

/** A fresh, allowed timing signal — the ONLY thing that may ground a why-now. */
function timingObservation(ctx: PersonalizationContext): string | null {
  const t = ctx.evidence.find((e) =>
    e.allowed && e.fresh && (e.source_type === "job_posting" || e.source_type === "signal"));
  return t ? t.statement : null;
}

/** The strongest allowed non-timing observation, or null. */
function companyObservation(ctx: PersonalizationContext): string | null {
  const c = ctx.evidence.find((e) => e.allowed && e.source_type !== "job_posting" && e.source_type !== "signal");
  return c ? c.statement : null;
}

export function buildOpenerPrompt(req: ModelOpenerRequest): { system: string; user: string } {
  const { personalization_context: ctx, eligibility, constraints } = req;
  const dm = ctx.decision_maker;

  const system = [
    "You write ONE short opening line for a founder-to-founder outreach message.",
    "You do NOT write emails. No subject, no greeting, no signature, no body, no sequence.",
    `Hard limits: at most ${constraints.hard_max_chars} characters, at most ${constraints.max_sentences} sentences, at most ${constraints.max_questions} question.`,
    `Preferred length: ${constraints.preferred_min_words}-${constraints.preferred_max_words} words.`,
    "Every factual claim about the company, the person or timing MUST come from the supplied observations.",
    "If no timing observation is supplied, do NOT imply one — no hiring, funding, growth or launch claims.",
    "Never use fake familiarity, hype, or mass-outreach language.",
    ctx.brain.tone ? `Tone: ${ctx.brain.tone}.` : "Tone: plain, direct, human.",
    ctx.brain.prohibited_claims.length > 0
      ? `Never claim any of: ${ctx.brain.prohibited_claims.join("; ")}.`
      : "",
    'Respond with STRICT JSON only: {"opener": string, "alternative_opener": string|null, "used_evidence_ids": string[]}',
  ].filter(Boolean).join("\n");

  const timing = timingObservation(ctx);
  const company = companyObservation(ctx);
  const outcome = ctx.brain.outcomes[0] ?? ctx.brain.positioning ?? null;

  const user = [
    dm ? `Recipient first name: ${dm.first_name ?? dm.full_name}` : null,
    dm?.current_title ? `Recipient role: ${dm.current_title}` : null,
    ctx.company.name ? `Company: ${ctx.company.name}` : null,
    ctx.company.summary ? `What the company does: ${ctx.company.summary}` : null,
    company ? `Supported company observation: ${company}` : null,
    // Stated either way, so the model can never quietly assume a trigger.
    timing
      ? `Supported timing observation: ${timing}`
      : "No timing observation is available. Do not imply any hiring, funding, growth or launch event.",
    ctx.icp_matched_criteria.length > 0
      ? `Why they fit our ICP: ${ctx.icp_matched_criteria.join(", ")}`
      : null,
    outcome ? `Outcome we deliver: ${outcome}` : null,
    `Personalization depth: ${eligibility.personalization_depth}`,
    `Allowed evidence ids: ${eligibility.allowed_evidence_ids.join(", ") || "none"}`,
  ].filter(Boolean).join("\n");

  return { system, user };
}

function parseModelJson(raw: unknown, content: string): ModelOpenerResponse {
  const obj = (raw && typeof raw === "object" ? raw : safeParse(content)) as Record<string, unknown> | null;
  if (!obj) return { opener: "" };
  return {
    opener: typeof obj.opener === "string" ? obj.opener : "",
    alternative_opener: typeof obj.alternative_opener === "string" ? obj.alternative_opener : undefined,
    used_evidence_ids: Array.isArray(obj.used_evidence_ids)
      ? obj.used_evidence_ids.filter((x): x is string => typeof x === "string")
      : [],
  };
}

function safeParse(text: string): Record<string, unknown> | null {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    return JSON.parse(match[0]) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * Build the live model boundary. Injected everywhere else, so tests supply a
 * deterministic stub and never reach a provider.
 */
export function makeOpenerModel(opts: { workspaceId: string; agentSlug?: string }): ModelBoundary {
  return async (req: ModelOpenerRequest): Promise<ModelOpenerResponse> => {
    const { system, user } = buildOpenerPrompt(req);

    const res = await generateText({
      taskType: "agent_execution",
      systemPrompt: system,
      messages: [{ role: "user", content: user }],
      temperature: 0.4,
      maxTokens: 300,
      jsonMode: true,
      agentSlug: opts.agentSlug ?? "penn",
      functionName: "workbench_personalized_opener",
      workspaceId: opts.workspaceId,
    });

    if (!res.ok) {
      // Throw a SANITIZED marker; generateOpener classifies it. The provider's
      // own message is never propagated.
      throw new Error(res.errorCode ?? "provider_failed");
    }

    return parseModelJson(res.json, res.content ?? "");
  };
}
