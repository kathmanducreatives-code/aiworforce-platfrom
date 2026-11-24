// Schema-valid fake evaluator receipts. This does not implement qualification;
// production parses and checks these and owns every final eligibility decision.
export function mockCriterionVerdicts(
  input: unknown,
  citations: Record<string, { evidence_id: string; excerpt: string } | null>,
) {
  const mission = (input as { mission?: { original_user_query?: string; criteria?: Array<{ id: string; dimension: string; geography_scope?: string }> } })?.mission;
  return (mission?.criteria ?? []).map((c) => {
    const key = ({ industry: "business", business_model: "business", geography: "location",
      company_size: "size", hiring: "hiring" } as Record<string, string>)[c.dimension];
    const receipt = citations[key];
    return { criterion_id: c.id,
      ...(c.dimension === "geography" ? { geography_scope: c.geography_scope ?? (mission?.original_user_query?.includes("headquartered") ? "headquarters" : "presence") } : {}),
      result: receipt ? "pass" : "unknown", reason: "fixture interpretation of supplied evidence",
      evidence: receipt ? [receipt] : [] };
  });
}
