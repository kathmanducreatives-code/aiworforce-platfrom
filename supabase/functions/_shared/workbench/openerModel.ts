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
    "You write ONE short opening line for a first outreach message.",
    "You do NOT write emails. No subject, no greeting, no signature, no body, no sequence.",

    // The single most important instruction: two different companies.
    "THE SELLER AND THE PROSPECT ARE DIFFERENT COMPANIES.",
    "Seller Context describes the person writing. Prospect Context describes the company being written to.",
    "Never describe the seller using the prospect's business description, job posting, industry or signal.",
    "Never state a prospect fact that came from Seller Context.",

    // Seller claims are a closed set — this is what stops an invented category.
    "Every claim about what the seller does or provides MUST come from an Approved seller claim, in your own words.",
    "If no approved seller claim is relevant, do not invent one — use the closest supported claim or omit seller relevance entirely.",
    "Report which approved claims you used in used_seller_claim_ids.",

    "Every factual claim about the prospect company, the person or timing MUST come from the supplied observations.",
    "If no timing observation is supplied, do NOT imply one — no hiring, funding, growth or launch claims.",

    `Hard limits: at most ${constraints.hard_max_chars} characters, at most ${constraints.max_sentences} sentences, at most ${constraints.max_questions} question.`,
    `Preferred length: ${constraints.preferred_min_words}-${constraints.preferred_max_words} words.`,

    // Shape, not template — several structures so every message isn't identical.
    "Aim for: one concrete verified observation, then why the seller is relevant. Vary the phrasing.",
    "Do not include a question unless it genuinely earns its place.",

    "Write plainly, like a competent human sending a first message.",
    "Do not praise the prospect. Do not use words like impressive, exciting, innovative, game-changing or revolutionary.",
    "Avoid filler openings such as 'I wanted to reach out', 'I came across', 'I hope you are well', 'just reaching out'.",
    "Prefer direct language: saw, noticed in the job posting, your team is hiring, your company is building.",
    "Never use fake familiarity, hype, or mass-outreach language.",
    "Never mention internal system terms such as ICP, fit score, buyer role, qualification or evidence id.",

    ctx.seller.brand_voice.tone.length > 0
      ? `Tone: ${ctx.seller.brand_voice.tone.join(", ")}.`
      : "Tone: plain, direct, human.",
    ctx.seller.brand_voice.avoided_language.length > 0
      ? `Avoid this language: ${ctx.seller.brand_voice.avoided_language.join("; ")}.`
      : "",
    ctx.seller.prohibited_claims.length > 0
      ? `Never claim any of: ${ctx.seller.prohibited_claims.join("; ")}.`
      : "",

    "Return TWO genuinely different angles, not a reworded pair:",
    "  opener — lead with the strongest verified observation.",
    "  alternative_opener — a safer angle led by the seller outcome, usable with no timing claim.",
    'Respond with STRICT JSON only: {"opener": string, "alternative_opener": string|null, "used_evidence_ids": string[], "used_seller_claim_ids": string[]}',
  ].filter(Boolean).join("\n");

  const timing = timingObservation(ctx);
  const company = companyObservation(ctx);
  const outcome = ctx.selected_seller_outcome ?? ctx.seller.offer.promise ?? ctx.seller.offer.primary_offer ?? null;

  const user = [
    // ---- SELLER: who is writing. Nothing here is a fact about the prospect. --
    "=== SELLER CONTEXT (the company writing this message) ===",
    ctx.seller.seller_company_name ? `Seller company: ${ctx.seller.seller_company_name}` : "Seller company: refer to the seller as 'we'.",
    ctx.seller.seller_summary ? `What the seller does: ${ctx.seller.seller_summary}` : null,
    ctx.seller.target_customer.profile ? `Who the seller serves: ${ctx.seller.target_customer.profile}` : null,
    outcome ? `Most relevant seller outcome for this account: ${outcome}` : null,
    "Approved seller claims (use these, in your own words):",
    ...(ctx.seller_claims.length > 0
      ? ctx.seller_claims.map((c) => `  ${c.id} [${c.type}]: ${c.text}`)
      : ["  none supplied — do not describe what the seller provides"]),

    // ---- PROSPECT: who is being written to. Never used to describe the seller.
    "",
    "=== PROSPECT CONTEXT (a DIFFERENT company, the recipient's employer) ===",
    ctx.company.name ? `Prospect company: ${ctx.company.name}` : null,
    ctx.company.summary ? `What the prospect company does: ${ctx.company.summary}` : null,
    ctx.company.industry ? `Prospect industry: ${ctx.company.industry}` : null,
    company ? `Supported observation about the prospect: ${company}` : null,
    // Stated either way, so the model can never quietly assume a trigger.
    timing
      ? `Supported timing observation: ${timing}`
      : "No timing observation is available. Do not imply any hiring, funding, growth or launch event.",

    // ---- RECIPIENT --------------------------------------------------------
    "",
    "=== RECIPIENT ===",
    dm ? `First name: ${dm.first_name ?? dm.full_name}` : null,
    dm?.current_title ? `Role: ${dm.current_title}` : null,

    // ---- TASK -------------------------------------------------------------
    "",
    "=== TASK ===",
    eligibility.personalization_depth === "specific"
      ? "Lead with the supported observation and cite the evidence ids you used."
      : "No fresh timing signal exists. Write a company-level opener using stable facts only, and return an empty used_evidence_ids array.",
    `Allowed evidence ids: ${eligibility.allowed_evidence_ids.join(", ") || "none"}`,
    `Allowed seller claim ids: ${ctx.seller_claims.map((c) => c.id).join(", ") || "none"}`,
  ].filter((l) => l !== null).join("\n");

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
    used_seller_claim_ids: Array.isArray(obj.used_seller_claim_ids)
      ? obj.used_seller_claim_ids.filter((x): x is string => typeof x === "string")
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
