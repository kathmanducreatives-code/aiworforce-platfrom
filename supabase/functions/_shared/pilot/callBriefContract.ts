// Reference-only model contract: a valid citation never licenses invented factual prose.
export const CALL_BRIEF_VERSION = "call_brief_v1" as const;
export const QUESTION_KINDS = [
  "verify_context",
  "explore_fit",
  "clarify_conflict",
  "understand_priorities",
] as const;
export type QuestionKind = typeof QUESTION_KINDS[number];
export interface BriefChoice {
  schema_version: typeof CALL_BRIEF_VERSION;
  company_overview: string[];
  business_context: string[];
  signal_evidence: string[];
  talking_points: { fact_id: string; brain_id: string }[];
  discovery_questions: {
    kind: QuestionKind;
    fact_id: string | null;
    brain_id: string | null;
  }[];
  missing_information: string[];
}
const ref = { type: "string" };
const objectSchema = (properties: Record<string, unknown>) => ({
  type: "object",
  additionalProperties: false,
  properties,
  required: Object.keys(properties),
});
const array = (items: unknown) => ({ type: "array", items });
// Use the supported strict JSON Schema core; bounds/reference membership are checked in application too.
export const CALL_BRIEF_SCHEMA = {
  name: CALL_BRIEF_VERSION,
  schema: objectSchema({
    schema_version: { type: "string", enum: [CALL_BRIEF_VERSION] },
    company_overview: array(ref),
    business_context: array(ref),
    signal_evidence: array(ref),
    talking_points: array(objectSchema({ fact_id: ref, brain_id: ref })),
    discovery_questions: array(
      objectSchema({
        kind: { type: "string", enum: QUESTION_KINDS },
        fact_id: { type: ["string", "null"] },
        brain_id: { type: ["string", "null"] },
      }),
    ),
    missing_information: array(ref),
  }),
};
