// Onboarding progress as SERVER state (roadmap Phase 2).
//
// Setup progress used to live in the tab's sessionStorage, so closing the
// browser or switching device restarted onboarding. It now rides on the
// normal `save_draft` path inside the profile, at `onboarding_meta.setup`:
//
//   { version: 1, step, answers, updated_at }
//
// `answers` holds only what the wizard types BEFORE it becomes Brain fields
// (the company and founder forms and the first goal). Everything else is
// already a partially filled Brain. Research results are not kept here.
//
// Untrusted input: unknown keys are dropped, strings are trimmed and capped,
// and the whole record has a size limit. Pure.

type Raw = Record<string, unknown>;

export const SETUP_PROGRESS_VERSION = 1;
/** Highest wizard step index (GuidedSetup has steps 0–5). */
export const SETUP_MAX_STEP = 5;
const MAX_FIELD = 2000;
const MAX_BYTES = 8 * 1024;

/**
 * The wizard's own form fields, by form. Nothing else is stored. The founder's
 * `enrichment_consent` is deliberately absent: consent is recorded by its own
 * path and is never restored from autosaved progress.
 */
export const SETUP_ANSWER_FIELDS = {
  company: ["name", "website_url", "linkedin_url", "description", "stage", "team_size"],
  founder: ["name", "role", "linkedin_url", "timezone", "first_help_goal"],
} as const;

export type SetupAnswers = { [F in keyof typeof SETUP_ANSWER_FIELDS]?: Partial<Record<(typeof SETUP_ANSWER_FIELDS)[F][number], string>> };

export interface SetupProgress {
  version: typeof SETUP_PROGRESS_VERSION;
  step: number;
  answers: SetupAnswers;
  updated_at: string;
}

export type SetupParse =
  | { ok: true; step: number; answers: SetupAnswers }
  | { ok: false; reason: string };

const isObj = (v: unknown): v is Raw => !!v && typeof v === "object" && !Array.isArray(v);

function cleanAnswers(v: unknown): SetupAnswers {
  const out: SetupAnswers = {};
  if (!isObj(v)) return out;
  for (const form of Object.keys(SETUP_ANSWER_FIELDS) as Array<keyof typeof SETUP_ANSWER_FIELDS>) {
    const src = v[form];
    if (!isObj(src)) continue;
    const kept: Record<string, string> = {};
    for (const field of SETUP_ANSWER_FIELDS[form]) {
      const value = src[field];
      if (typeof value === "string" && value.trim()) kept[field] = value.trim().slice(0, MAX_FIELD);
    }
    if (Object.keys(kept).length) (out as Record<string, unknown>)[form] = kept;
  }
  return out;
}

/** Validate a client's `setup` payload. */
export function parseSetupProgress(v: unknown): SetupParse {
  if (!isObj(v)) return { ok: false, reason: "setup must be an object" };
  const step = v.step;
  if (typeof step !== "number" || !Number.isInteger(step) || step < 0 || step > SETUP_MAX_STEP) {
    return { ok: false, reason: `setup.step must be an integer 0–${SETUP_MAX_STEP}` };
  }
  const answers = cleanAnswers(v.answers);
  if (new TextEncoder().encode(JSON.stringify(answers)).length > MAX_BYTES) {
    return { ok: false, reason: "setup.answers is too large" };
  }
  return { ok: true, step, answers };
}

/** The profile with this progress recorded. Other `onboarding_meta` keys are kept. */
export function withSetupProgress(profile: Raw, p: { step: number; answers: SetupAnswers }, nowIso: string): Raw {
  const meta = isObj(profile.onboarding_meta) ? profile.onboarding_meta : {};
  const setup: SetupProgress = { version: SETUP_PROGRESS_VERSION, step: p.step, answers: p.answers, updated_at: nowIso };
  return { ...profile, onboarding_meta: { ...meta, setup } };
}

/** The profile without setup progress — activation ends onboarding. */
export function withoutSetupProgress(profile: Raw): Raw {
  if (!isObj(profile.onboarding_meta) || !("setup" in profile.onboarding_meta)) return profile;
  const { setup: _drop, ...meta } = profile.onboarding_meta;
  return { ...profile, onboarding_meta: meta };
}

/** Stored progress, re-validated on read (a row may predate this version). */
export function readSetupProgress(profile: unknown): SetupProgress | null {
  if (!isObj(profile) || !isObj(profile.onboarding_meta)) return null;
  const s = profile.onboarding_meta.setup;
  if (!isObj(s) || s.version !== SETUP_PROGRESS_VERSION) return null;
  const parsed = parseSetupProgress(s);
  if (!parsed.ok) return null;
  return { version: SETUP_PROGRESS_VERSION, step: parsed.step, answers: parsed.answers, updated_at: typeof s.updated_at === "string" ? s.updated_at : "" };
}
