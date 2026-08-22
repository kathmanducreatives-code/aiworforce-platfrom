// THE ONE PLACE THAT READS WHY A MODEL CALL FAILED.
//
// ── THE BUG THIS EXISTS TO MAKE IMPOSSIBLE ──────────────────────────────────
//
// Two producers hand a model result across an adapter boundary, and both spell
// the failure the same way:
//
//     gptMissionModel.ts:106          errorCode: r.code,  error: r.detail
//     leadStrategy/provider.ts:48     errorCode?: StrategistErrorCode | string
//
// The consumer read different names entirely:
//
//     leadMissionCompilerBinding.ts   r?.code       r?.detail
//
// So `code` was ALWAYS undefined and fell through to the literal `"no_result"`,
// and `detail` was ALWAYS null. Not sometimes — always, for every failure this
// path has ever had, because no producer has ever emitted those names.
//
// The comment above that reader says it was added precisely to stop dropping
// the reason. It reads the wrong fields, so it dropped the reason anyway, and
// the log line proving the fix worked — `code: "no_result", detail: null` — is
// indistinguishable from the bug it was meant to fix.
//
// On 2026-08-21 the OpenAI balance ran out. `insufficient_quota` was in the
// response body, was correctly detected by `bodyIsQuotaExhausted`, survived
// `gptStructured` as a code, survived `gptMissionModel` as `errorCode` — and
// was discarded here, twice per message. Diagnosing it took a manual call to
// the provider.
//
// ── WHY A MODULE AND NOT A ONE-LINE PATCH ───────────────────────────────────
//
// The one-line patch is `r?.errorCode ?? r?.code`. It fixes today and leaves
// the shape that caused it: two producers, an `as never` cast at the boundary,
// and a consumer guessing at field names with no compiler anywhere in between.
//
// This gives the boundary a name and a type. `readModelFailure` is the only
// reader, `MODEL_FAILURE_FIELD_SPELLINGS` states every accepted spelling, and a
// test walks the real producer sources to assert each one is covered — so a
// third producer inventing a fourth name fails a test instead of silently
// reporting `no_result` for a month.
//
// PURE. No network, model or database access.

export const MODEL_FAILURE_CONTRACT_VERSION = "model-failure-contract-v1" as const;

/**
 * Every spelling a producer on this boundary is allowed to use.
 *
 * ORDER IS PRECEDENCE. `errorCode` first because it is what both current
 * producers actually emit; `code` second because it is what the consumer used
 * to look for and what a future producer might reasonably choose.
 *
 * Listed rather than inferred so the test that checks producers against it has
 * something to check against.
 */
export const MODEL_FAILURE_FIELD_SPELLINGS = Object.freeze({
  code: ["errorCode", "code", "failure_code"] as const,
  detail: ["error", "detail", "failure_message"] as const,
});

/**
 * The code meaning "nothing came back and nobody said why".
 *
 * It is a real outcome — a producer can genuinely return an empty result — but
 * it must be REACHED, never fallen into because the reader looked in the wrong
 * place. That is the whole distinction this module exists to preserve.
 */
export const NO_RESULT_CODE = "no_result" as const;

export interface ModelFailure {
  /** The provider's own code where one exists, else `no_result`. */
  code: string;
  /** The provider's own message, bounded. Null when none was supplied. */
  detail: string | null;
  /**
   * True when a producer actually named a reason.
   *
   * The field that makes "the model failed and said why" distinguishable from
   * "the reader could not find the reason" in a log — the ambiguity that made
   * the original bug invisible for as long as it lasted.
   */
  reported: boolean;
}

const str = (v: unknown): string | null => {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t.length ? t : null;
};

/**
 * Read the failure off a model result, whatever the producer called it.
 *
 * `detailMaxLength` bounds the message because it is logged and persisted, and
 * a provider error body can echo request content.
 */
export function readModelFailure(
  result: unknown, detailMaxLength = 300,
): ModelFailure {
  const r = (result && typeof result === "object")
    ? result as Record<string, unknown>
    : {};

  let code: string | null = null;
  for (const k of MODEL_FAILURE_FIELD_SPELLINGS.code) {
    code = str(r[k]);
    if (code) break;
  }

  let detail: string | null = null;
  for (const k of MODEL_FAILURE_FIELD_SPELLINGS.detail) {
    detail = str(r[k]);
    if (detail) break;
  }

  return {
    code: code ?? NO_RESULT_CODE,
    detail: detail ? detail.slice(0, detailMaxLength) : null,
    reported: code != null,
  };
}

/**
 * Codes that mean a human has to do something before any retry can work.
 *
 * Kept next to the reader because the reason for naming a failure precisely is
 * to be able to answer this question about it. Everything here is terminal for
 * the run: no amount of waiting, re-prompting or re-planning clears an empty
 * balance or a missing key.
 */
const UNRECOVERABLE = new Set(["quota_exhausted", "no_api_key"]);

export function isUnrecoverableModelFailure(code: string): boolean {
  return UNRECOVERABLE.has(code);
}
