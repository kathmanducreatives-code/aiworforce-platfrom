// Provider-free replay fixture for the Q1 person-lead persistence failure.
//
// Freezes the exact shape the live audit reconstructed (plan
// d94484db-5e60-49ec-a08b-66f7f888bab7): five GENUINE HarvestAPI person profiles
// that all passed provenance + source-quality gates, were tiered `rejected` by
// the scoring stack, and were persisted BEFORE Aria ran. Also captures the
// separate 10-candidate Scout LLM narrative pool (1 provider-backed, 9 invented)
// that the handoff guard counted.
//
// No credentials, tokens or provider calls — hand-transcribed identity fields
// only, matching the audit report.

import type { ArtifactType, TargetEntity } from "./leadEntityIntent.ts";

export interface Q1PersonProfile {
  full_name: string;
  title: string;
  company: string;
  profile_url: string;
  country_code: string;
  /** Provider provenance validated at source-quality acceptance. */
  provider_verified: boolean;
  /** Normalized artifact type the person actor yields. */
  artifact_type: ArtifactType;
  /** Live scoring verdict the stack assigned (all five: rejected). */
  tier: "hot" | "qualified" | "weak" | "rejected";
  /** Live Aria scoring object (deterministic ariaScoring engine). */
  aria: { star_label: string; gate_decision: string; overall_fit: number };
  /** Evidence-invariant violations recorded on the row. */
  evidence_violations: string[];
}

export const Q1_TARGET_ENTITY: TargetEntity = "person";
export const Q1_EXPECTED_ARTIFACT_TYPE: ArtifactType = "person_candidate";
export const Q1_ACTOR_KEY = "apify_people_search";
export const Q1_ACTOR_IMPL = "harvestapi/linkedin-profile-search";

/** The five persisted rows exactly as reconstructed by the audit. */
export const Q1_PROVIDER_PEOPLE: Q1PersonProfile[] = [
  {
    full_name: "Jeff Esposito", title: "Co-Founder/COO", company: "VeraAI Technologies Inc.",
    profile_url: "https://www.linkedin.com/in/veraai", country_code: "US",
    provider_verified: true, artifact_type: "person_candidate", tier: "rejected",
    aria: { star_label: "Reject", gate_decision: "needs_verification", overall_fit: 20 },
    evidence_violations: ["profile_as_job", "identity_only_signal"],
  },
  {
    full_name: "Jim Smith", title: "Founder & CEO", company: "Proper Sky - Managed IT Services",
    profile_url: "https://www.linkedin.com/in/propersky-jim", country_code: "US",
    provider_verified: true, artifact_type: "person_candidate", tier: "rejected",
    aria: { star_label: "Weak", gate_decision: "needs_verification", overall_fit: 30 },
    evidence_violations: ["profile_as_job", "identity_only_signal"],
  },
  {
    full_name: "Nabeel Farooq", title: "Co-Founder", company: "Improdata",
    profile_url: "https://www.linkedin.com/in/nabeelfarooq1", country_code: "US",
    provider_verified: true, artifact_type: "person_candidate", tier: "rejected",
    aria: { star_label: "Weak", gate_decision: "needs_verification", overall_fit: 30 },
    evidence_violations: ["profile_as_job", "identity_only_signal"],
  },
  {
    full_name: "Kumar Velugula", title: "Founder", company: "XNODE Inc.",
    profile_url: "https://www.linkedin.com/in/kumar-velugula", country_code: "US",
    provider_verified: true, artifact_type: "person_candidate", tier: "rejected",
    aria: { star_label: "Reject", gate_decision: "needs_verification", overall_fit: 20 },
    evidence_violations: ["profile_as_job", "identity_only_signal"],
  },
  {
    full_name: "Joe Apfelbaum", title: "Founder", company: "evyAI",
    profile_url: "https://www.linkedin.com/in/joeapfelbaum", country_code: "US",
    provider_verified: true, artifact_type: "person_candidate", tier: "rejected",
    aria: { star_label: "Weak", gate_decision: "needs_verification", overall_fit: 30 },
    evidence_violations: ["profile_as_job", "identity_only_signal"],
  },
];

/**
 * A hypothetical "success replay": the same five profiles, but with two of them
 * genuinely qualifying (Aria accept + qualified tier + no hard violations). Used
 * to prove the accepted subset persists while the rejected subset does not.
 */
export const Q1_SUCCESS_REPLAY: Q1PersonProfile[] = Q1_PROVIDER_PEOPLE.map((p, i) =>
  i < 2
    ? {
        ...p,
        tier: "qualified" as const,
        aria: { star_label: "Qualified", gate_decision: "contact", overall_fit: 72 },
        evidence_violations: ["identity_only_signal"],
      }
    : p,
);

/** The 10-candidate Scout LLM narrative pool: only #1 is provider-backed. */
export const Q1_SCOUT_NARRATIVE_NAMES: string[] = [
  "Jeff Esposito",   // provider-backed (matches Q1_PROVIDER_PEOPLE[0])
  "Sarah Chen", "Marcus Thorne", "Elena Rodriguez", "David Haimes",
  "Julianna Wu", "Robert Glass", "Amina Okafor", "Siddharth Mehta", "Chloe Sterling",
];
export const Q1_PROVIDER_BACKED_NARRATIVE_COUNT = 1;
export const Q1_INVENTED_NARRATIVE_COUNT = 9;
