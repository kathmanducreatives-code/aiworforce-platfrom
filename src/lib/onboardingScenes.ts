// Progressive onboarding scene model (pure — no React, no network).
//
// The user experiences ONE focused scene at a time, but the top progress still
// shows the five high-level phases. This module maps the 16 internal scenes to
// those five phases, drives the floating Company Brain state label, and owns the
// forward/back navigation so the page component stays presentational.
//
// Backend contract is unchanged: scenes are a presentation layer over the same
// research_founder / research_company / draft / save_draft / activate flow.

import { STEPS, type StepId } from './onboardingV3';

export type SceneId =
  | 'founder_name' | 'founder_linkedin' | 'founder_research' | 'founder_verify'
  | 'company_description' | 'company_website' | 'company_research' | 'company_verify'
  | 'draft_brain' | 'draft_summary'
  | 'review_targeting' | 'review_buyers' | 'review_signals' | 'review_safety' | 'review_messaging'
  | 'activate_ready';

export interface SceneDef {
  id: SceneId;
  phase: StepId;
}

/** Ordered scene list. The user never sees "16 steps" — only the phase + scene. */
export const SCENES: SceneDef[] = [
  { id: 'founder_name',        phase: 'founder' },
  { id: 'founder_linkedin',    phase: 'founder' },
  { id: 'founder_research',    phase: 'founder' },
  { id: 'founder_verify',      phase: 'founder' },
  { id: 'company_description', phase: 'company' },
  { id: 'company_website',     phase: 'company' },
  { id: 'company_research',    phase: 'company' },
  { id: 'company_verify',      phase: 'company' },
  { id: 'draft_brain',         phase: 'research' },
  { id: 'draft_summary',       phase: 'research' },
  { id: 'review_targeting',    phase: 'review' },
  { id: 'review_buyers',       phase: 'review' },
  { id: 'review_signals',      phase: 'review' },
  { id: 'review_safety',       phase: 'review' },
  { id: 'review_messaging',    phase: 'review' },
  { id: 'activate_ready',      phase: 'activate' },
];

export const sceneIndex = (id: SceneId): number => SCENES.findIndex((s) => s.id === id);
export const sceneAt = (i: number): SceneDef => SCENES[Math.max(0, Math.min(SCENES.length - 1, i))];
export const phaseOf = (id: SceneId): StepId => SCENES[sceneIndex(id)]?.phase ?? 'founder';
export const phaseIndexOf = (id: SceneId): number => STEPS.findIndex((s) => s.id === phaseOf(id));

/** First scene of a phase — used to jump to a phase from the progress bar / fixes. */
export function firstSceneOfPhase(phase: StepId): SceneId {
  return SCENES.find((s) => s.phase === phase)?.id ?? 'founder_name';
}

export const REVIEW_SCENES: SceneId[] = [
  'review_targeting', 'review_buyers', 'review_signals', 'review_safety', 'review_messaging',
];

// ------------------------------------------------------- floating Brain state -

export type BrainMode = 'idle' | 'thinking' | 'confirmed' | 'ready' | 'activated';

export interface BrainState {
  label: string;
  mode: BrainMode;
}

/**
 * The floating Company Brain's state label + visual mode for a scene.
 * `thinking` scenes (research/draft) intensify the orb; `activated` is the
 * launch state.
 */
export function brainStateFor(scene: SceneId, ctx: { activated?: boolean } = {}): BrainState {
  if (ctx.activated) return { label: 'Company Brain activated', mode: 'activated' };
  switch (scene) {
    case 'founder_name':        return { label: 'Waiting for founder context', mode: 'idle' };
    case 'founder_linkedin':    return { label: 'Waiting for founder context', mode: 'idle' };
    case 'founder_research':    return { label: 'Learning your background', mode: 'thinking' };
    case 'founder_verify':      return { label: 'Founder context added', mode: 'confirmed' };
    case 'company_description': return { label: 'Waiting for company', mode: 'idle' };
    case 'company_website':     return { label: 'Waiting for company', mode: 'idle' };
    case 'company_research':    return { label: 'Reading your website', mode: 'thinking' };
    case 'company_verify':      return { label: 'Understanding your market', mode: 'confirmed' };
    case 'draft_brain':         return { label: 'Drafting your ICP', mode: 'thinking' };
    case 'draft_summary':       return { label: 'First draft ready', mode: 'ready' };
    case 'review_targeting':
    case 'review_buyers':
    case 'review_signals':
    case 'review_safety':
    case 'review_messaging':    return { label: 'Ready for review', mode: 'ready' };
    case 'activate_ready':      return { label: 'Ready to activate', mode: 'ready' };
  }
}

// --------------------------------------------------- blocked-activation jumps -

/** Map a completeness step-key to the review scene that fixes it. */
export function reviewSceneForMissingStep(step: string): SceneId {
  switch (step) {
    case 'company':
    case 'customers':     return 'review_targeting';
    case 'buyers':        return 'review_buyers';
    case 'triggers':      return 'review_signals';
    case 'disqualifiers': return 'review_safety';
    case 'content':       return 'review_messaging';
    default:              return 'review_targeting';
  }
}
