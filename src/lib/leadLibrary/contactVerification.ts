// Is a contact a VERIFIED buyer? Pure, dependency-free (read by the lead library
// and by the CI frontend tests directly).
//
// S2 identity review (2026-11-01): a contact written by the discovery pipeline carries
// the pipeline's own verdict in `raw.agentory_pipeline.verification.status`
// (`requires_role_verification` | `employment_mismatch` | `verified`). A provider row's
// LinkedIn URL is how the person was found, not proof of role or current employment,
// so such a contact is verified ONLY when that status is `verified`. Contacts the
// pipeline did not write keep the existing rule (an email or a LinkedIn URL).

export function pipelineRoleVerification(raw: unknown): string | null {
  const ap = raw && typeof raw === "object" ? (raw as Record<string, unknown>).agentory_pipeline : null;
  const v = ap && typeof ap === "object" ? (ap as Record<string, unknown>).verification : null;
  const st = v && typeof v === "object" ? (v as Record<string, unknown>).status : null;
  return typeof st === "string" ? st : null;
}

export function contactIsVerified(c: { email?: string | null; linkedin_url?: string | null; raw?: unknown }): boolean {
  const status = pipelineRoleVerification(c.raw);
  if (status !== null) return status === "verified";
  const s = (v: unknown) => typeof v === "string" && v.trim() !== "";
  return s(c.email) || s(c.linkedin_url);
}
