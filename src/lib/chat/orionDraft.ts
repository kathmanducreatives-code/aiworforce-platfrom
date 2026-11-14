// ORION's text-only draft marker, read from the message metadata the server
// wrote (`metadata.orion_draft`, pilot-chat R1.1). Pure and defensive: anything
// malformed is treated as "not a draft", and a draft is ALWAYS presented as
// not sent, whatever else the metadata says.

export type OrionDraftKind =
  | 'linkedin_post' | 'linkedin_message' | 'cold_email' | 'follow_up' | 'video_script' | 'campaign' | 'other';

export interface OrionDraftInfo {
  kinds: OrionDraftKind[];
  labels: string[];
}

const LABEL: Record<OrionDraftKind, string> = {
  linkedin_post: 'LinkedIn post', linkedin_message: 'LinkedIn message', cold_email: 'Cold email',
  follow_up: 'Follow-up', video_script: 'Video script', campaign: 'Campaign concept', other: 'Draft',
};

export function readOrionDraft(metadata: unknown): OrionDraftInfo | null {
  const d = (metadata && typeof metadata === 'object' ? (metadata as Record<string, unknown>).orion_draft : null) as
    Record<string, unknown> | null | undefined;
  if (!d || typeof d !== 'object' || d.text_only !== true) return null;
  const kinds = (Array.isArray(d.kinds) ? d.kinds : [])
    .filter((k): k is OrionDraftKind => typeof k === 'string' && k in LABEL);
  const list: OrionDraftKind[] = kinds.length ? kinds : ['other'];
  return { kinds: list, labels: list.map((k) => LABEL[k]) };
}

/** The sentence the chip carries. Fixed text: the UI never claims a draft was sent. */
export const ORION_DRAFT_CHIP_TEXT = 'Draft only · nothing sent or published · campaign execution is off in this release';
