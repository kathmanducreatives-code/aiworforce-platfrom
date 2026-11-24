// companyBrainContext: compact, prompt-safe Company Brain context for Pilot.
// Pure (Deno testable); its one import, the normalizer, is itself import-free.
//
// TARGETING IS READ FROM THE STRUCTURED BRAIN. ICP, exclusions, must-haves and
// qualification rules come from `normalizeCompanyBrain`, the same reading the
// lead compiler and the Company Brain page use. Before, this block read the
// legacy `icp.*` copy, so an edit on the Company Brain page never reached the
// agents (docs/audits/company-brain-onboarding, P0-1/P0-2). Legacy-only
// profiles still work: the normalizer folds `icp.*` into the structured shape
// whenever the structured field is absent. Handles BOTH stored shapes:
//   - flat (legacy/seed): { company_name, what_we_do, who_we_sell_to, voice_and_tone, website, competitors }
//   - structured (onboarding wizard): { icp:{}, goals:{}, positioning:{}, brand_voice:{}, competitors:{known,adjacent}, approval_rules:{} }
// Only present fields are emitted — never invents missing ICP/competitors/voice.

import { flattenDisqualifiers, normalizeCompanyBrain, type CompanyBrainV2 } from "./normalizeCompanyBrain.ts";

type Profile = Record<string, unknown> | null | undefined;

/** Live provider readiness (see integrationReadiness.ts); status keys only, never secrets. */
export type IntegrationStatusMap = Record<string, { status?: string; label?: string } | undefined>;

function structured(p: Profile): CompanyBrainV2 {
  return normalizeCompanyBrain(obj(p));
}

/** The target size as a person would say it — an explicit range wins over a free label. */
function targetSize(b: CompanyBrainV2): string | null {
  const s = b.target_customer.company_size;
  if (s.min != null && s.max != null) return `${s.min}–${s.max} employees`;
  if (s.min != null) return `${s.min}+ employees`;
  if (s.max != null) return `up to ${s.max} employees`;
  return str(s.label);
}

function obj(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}
function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}
function arr(v: unknown): string[] {
  if (Array.isArray(v)) return v.map((x) => String(x).trim()).filter(Boolean);
  if (typeof v === "string" && v.trim()) return [v.trim()];
  return [];
}
function uniq(a: string[]): string[] {
  return a.filter((v, i) => a.indexOf(v) === i);
}

export function brainCompanyName(p: Profile): string | null {
  const o = obj(p);
  const company = obj(o.company);
  return str(company.name) ?? str(o.company_name) ?? str(o.company) ?? str(o.name);
}

export function brainCompetitors(p: Profile): string[] {
  const o = obj(p);
  const c = obj(o.competitors);
  return uniq([...arr(c.known), ...arr(c.adjacent), ...arr(o.competitors)]);
}

export function brainDescription(p: Profile): string | null {
  const o = obj(p);
  const company = obj(o.company);
  return str(company.description) ?? str(o.what_we_do) ?? str(o.description) ?? str(o.short_description) ?? str(obj(o.positioning).promise);
}

export function brainICP(p: Profile): string | null {
  const o = obj(p);
  const b = structured(p);
  const t = b.target_customer;
  const parts: string[] = [];
  const flat = str(o.who_we_sell_to);
  if (flat) parts.push(flat);
  if (b.buyer_personas.length) parts.push(b.buyer_personas.join(", "));
  if (t.industries.length) parts.push(t.industries.join(", "));
  if (t.business_models.length) parts.push(t.business_models.join(", "));
  const size = targetSize(b); if (size) parts.push(size);
  if (t.geography.length) parts.push(t.geography.join(", "));
  if (t.funding_stage.length) parts.push(t.funding_stage.join(", "));
  return parts.length ? uniq(parts).join("; ") : null;
}

/**
 * True only when onboarding is complete AND the profile carries enough to
 * personalize (company name, description, or ICP). Used to gate business-
 * specific prompts and to decide whether to inject brain context.
 */
export function hasUsableBrain(p: Profile, onboardingCompleted?: boolean | null): boolean {
  if (onboardingCompleted !== true) return false;
  return !!(brainCompanyName(p) || brainDescription(p) || brainICP(p));
}

/**
 * Compact, human-readable context block. Lines are omitted when absent.
 * Keep this small — it is injected into prompts, not raw JSON.
 */
export function buildCompanyBrainContext(p: Profile, opts: { integrationStatus?: IntegrationStatusMap } = {}): string {
  const o = obj(p);
  const b = structured(p);
  const tc = b.target_customer;
  const company = obj(o.company);
  const founder = obj(o.founder);
  const lines: string[] = [];

  // Founder
  const fName = str(founder.name);
  const fRole = str(founder.role);
  const fGoal = str(founder.first_help_goal);
  const fTz = str(founder.timezone);
  if (fName || fRole || fGoal) {
    const parts = [fName && fRole ? `${fName} (${fRole})` : (fName ?? fRole ?? "")].filter(Boolean) as string[];
    if (fTz) parts.push(`tz ${fTz}`);
    if (fGoal) parts.push(`wants: ${fGoal}`);
    if (parts.length) lines.push(`Founder: ${parts.join(" · ")}`);
  }

  // Company
  const name = brainCompanyName(p);
  if (name) lines.push(`Company: ${name}`);
  const meta: string[] = [];
  const stage = str(company.stage); if (stage) meta.push(`stage ${stage}`);
  const team = str(company.team_size); if (team) meta.push(`team ${team}`);
  const loc = str(company.location); if (loc) meta.push(loc);
  if (meta.length) lines.push(`Profile: ${meta.join(" · ")}`);

  const category = str(o.category) ?? str(company.category) ?? str(o.industry) ?? str(company.industry);
  if (category) lines.push(`Category: ${category}`);

  const desc = brainDescription(p);
  if (desc) lines.push(`Description: ${desc}`);

  const icp = brainICP(p);
  if (icp) lines.push(`ICP: ${icp}`);

  if (tc.must_have.length) lines.push(`Must have: ${tc.must_have.join("; ")}`);
  if (tc.nice_to_have.length) lines.push(`Nice to have: ${tc.nice_to_have.join("; ")}`);
  const disq = flattenDisqualifiers(tc.disqualifiers);
  if (disq.length) lines.push(`Disqualifiers: ${disq.join(", ")}`);
  const qual = b.qualification_rules;
  if (qual.required_evidence.length) lines.push(`Qualify only with evidence of: ${qual.required_evidence.join("; ")}`);
  if (qual.manual_review_if.length) lines.push(`Send to review if: ${qual.manual_review_if.join("; ")}`);
  if (qual.reject_if.length) lines.push(`Reject if: ${qual.reject_if.join("; ")}`);

  // Compiled-brain signals consumed by content, agents and outreach drafting.
  // v2 fields preferred, legacy fallback; only present fields render (never invented).
  if (b.pain_points.length) lines.push(`Pain points: ${b.pain_points.join("; ")}`);
  if (b.triggers.length) lines.push(`Triggers: ${b.triggers.join(", ")}`);
  if (b.jobs_to_watch.length) lines.push(`Roles to watch for: ${b.jobs_to_watch.join(", ")}`);
  const contentAngles = arr(o.content_angles);
  if (contentAngles.length) lines.push(`Content angles: ${contentAngles.join("; ")}`);

  // Honesty layer: when the Brain lacks a workable ICP (no industries+buyers and
  // no must-have), agents/content/outreach must ask for setup, not fabricate a fit.
  const setupRequired = !((tc.industries.length && b.buyer_personas.length) || tc.must_have.length);
  if (setupRequired) lines.push("Setup needed: Company Brain ICP incomplete — ask for target customer + buyer roles before targeting; draft low-confidence only, never claim a strong fit.");

  // GTM (new) – falls back to legacy goals if missing
  const gtm = obj(o.gtm);
  const gtmBits: string[] = [];
  const motion = str(gtm.motion); if (motion) gtmBits.push(`motion ${motion}`);
  const pchan = str(gtm.primary_channel); if (pchan) gtmBits.push(`primary ${pchan}`);
  const chans = arr(gtm.preferred_channels); if (chans.length) gtmBits.push(`channels ${chans.join(", ")}`);
  const bottleneck = str(gtm.biggest_bottleneck); if (bottleneck) gtmBits.push(`bottleneck: ${bottleneck}`);
  const tools = arr(gtm.current_tools); if (tools.length) gtmBits.push(`tools ${tools.join(", ")}`);
  const goal30 = str(gtm.thirty_day_goal); if (goal30) gtmBits.push(`30d: ${goal30}`);
  if (gtmBits.length) lines.push(`GTM: ${gtmBits.join(" · ")}`);

  const goals = obj(o.goals);
  const goalVals = ["gtm", "content", "competitor_tracking", "outreach", "hiring"]
    .map((k) => str(goals[k])).filter(Boolean) as string[];
  const flatGoals = arr(o.goals);
  const allGoals = goalVals.length ? goalVals : flatGoals;
  if (allGoals.length) lines.push(`Goals: ${allGoals.join("; ")}`);

  const positioning = obj(o.positioning);
  const offer = str(positioning.offer);
  const pricing = str(positioning.pricing);
  if (offer) lines.push(`Offer: ${offer}${pricing ? ` (${pricing})` : ""}`);
  const diffs = arr(positioning.differentiators);
  const promise = str(positioning.promise);
  if (diffs.length) lines.push(`Positioning: ${diffs.join("; ")}`);
  else if (promise && !desc) lines.push(`Positioning: ${promise}`);
  const proof = arr(positioning.proof_points);
  if (proof.length) lines.push(`Proof: ${proof.join("; ")}`);
  const avoidPos = arr(positioning.avoid_positioning);
  if (avoidPos.length) lines.push(`Avoid positioning: ${avoidPos.join("; ")}`);

  const comps = brainCompetitors(p);
  if (comps.length) lines.push(`Competitors: ${comps.join(", ")}`);

  const voice = obj(o.brand_voice);
  const voiceStr = str(o.voice_and_tone) ?? str(voice.tone);
  const voiceTags = arr(voice.tags);
  const voiceAvoid = arr(voice.avoid);
  const voiceParts = uniq([voiceStr ?? "", voiceTags.join(", ")].filter(Boolean) as string[]);
  if (voiceParts.length) lines.push(`Voice: ${voiceParts.join("; ")}`);
  if (voiceAvoid.length) lines.push(`Voice avoid: ${voiceAvoid.join(", ")}`);
  if (b.brand_voice.style_rules.length) lines.push(`Voice rules: ${b.brand_voice.style_rules.join("; ")}`);

  const wfp = arr(obj(o.workflow_preferences).priority_workflows);
  if (wfp.length) lines.push(`Priority workflows: ${wfp.join(", ")}`);

  // Integration readiness summary (status keys only, never secret values). The
  // live map is preferred; a stored `integration_status` is a legacy snapshot
  // from when integration-readiness wrote the Brain on every page visit.
  const integ = opts.integrationStatus ? obj(opts.integrationStatus) : obj(o.integration_status);
  const ready: string[] = [];
  const setupNeeded: string[] = [];
  for (const k of Object.keys(integ)) {
    const item = obj(integ[k]);
    const lbl = str(item.label) ?? k;
    const status = str(item.status);
    if (status === "connected") ready.push(lbl);
    else if (status === "setup_needed") setupNeeded.push(lbl);
  }
  if (ready.length) lines.push(`Integrations ready: ${ready.join(", ")}`);
  if (setupNeeded.length) lines.push(`Integrations setup needed: ${setupNeeded.join(", ")}`);

  // Approval rules
  const ar = obj(o.approval_rules);
  const rules: string[] = ["draft-only"];
  if (ar.email_requires_approval !== false) rules.push("email requires approval");
  if (ar.linkedin_manual_only !== false) rules.push("LinkedIn comments/DMs approval-only");
  lines.push(`Approval rules: ${uniq(rules).join("; ")}`);

  return lines.join("\n");
}

/**
 * The `<company_brain>` block injected into agent prompts (Scout, Aria, Penn,
 * Hawk, Scribe). Extracted here so it is unit-testable and used identically by
 * every caller.
 *
 * `onboardingCompleted` gates the block: a workspace that has ACTIVATED its
 * Company Brain gets the full compiled context; otherwise agents are told the
 * brain is not ready and must not invent an ICP. Passing the real flag (rather
 * than a hardcoded null) is what makes the active brain reach the agents.
 */
export function renderCompanyBrainBlock(
  p: Profile,
  onboardingCompleted?: boolean | null,
  opts: { integrationStatus?: IntegrationStatusMap } = {},
): string {
  if (!hasUsableBrain(p, onboardingCompleted)) {
    return "<company_brain>\n(no active company brain yet — workspace hasn't completed onboarding. Do not invent company details, ICP, or competitors.)\n</company_brain>";
  }
  return `<company_brain>\n${buildCompanyBrainContext(p, opts)}\n</company_brain>`;
}

/** Field-presence map so callers can honestly say "I don't have X yet." */
export function brainMissingFields(p: Profile): string[] {
  const missing: string[] = [];
  if (!brainCompanyName(p)) missing.push("company name");
  if (!brainDescription(p)) missing.push("what you do");
  if (!brainICP(p)) missing.push("ICP / target buyers");
  if (brainCompetitors(p).length === 0) missing.push("competitors");
  const o = obj(p);
  if (!str(o.voice_and_tone) && !str(obj(o.brand_voice).tone)) missing.push("brand voice");
  return missing;
}
