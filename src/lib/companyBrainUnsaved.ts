// Inline edits the server refused because the Company Brain changed elsewhere
// (another tab, a teammate, onboarding). The page rolls back to the server's
// copy, so without this the typed value would simply vanish. We keep the
// edit's FIELD-LEVEL changes — not the patch, which was built on the old copy
// and would overwrite the other change — and offer to apply them again on top
// of the latest version, through the same authorized save.

import type { SectionKey } from './companyBrainSections';
import type { SectionState } from './companyBrainPatch';

export interface UnsavedEdit {
  section: SectionKey;
  changes: SectionState;
}

const FIELD_LABEL: Record<string, string> = {
  size_min: 'company size', size_max: 'company size', size_label: 'company size',
  disq_industries: 'excluded industries', disq_company_types: 'excluded company types',
  disq_keywords: 'excluded keywords', disq_titles: 'excluded titles',
  website_url: 'website', business_model: 'business model', team_size: 'team size',
  founder_name: 'founder name', founder_role: 'founder role', founder_background: 'founder background',
  founder_linkedin_url: 'founder LinkedIn', founder_credibility: 'founder credibility',
  must_have: 'must-haves', nice_to_have: 'nice-to-haves', funding_stage: 'funding stage',
  positive_examples: 'good-fit examples', negative_examples: 'bad-fit examples',
  required_evidence: 'required evidence', reject_if: 'reject rules', manual_review_if: 'review rules',
};

const label = (field: string) => FIELD_LABEL[field] ?? field.replace(/_/g, ' ');

/** Add a refused edit; a later edit to the same section and field replaces the earlier one. */
export function keepUnsaved(list: UnsavedEdit[], edit: UnsavedEdit): UnsavedEdit[] {
  const i = list.findIndex((e) => e.section === edit.section);
  if (i < 0) return [...list, edit];
  const next = list.slice();
  next[i] = { section: edit.section, changes: { ...list[i].changes, ...edit.changes } };
  return next;
}

/** "ICP / targeting: industries, company size" — for the banner. */
export function describeUnsaved(list: UnsavedEdit[], titleOf: (section: SectionKey) => string): string {
  return list
    .map((e) => `${titleOf(e.section)}: ${[...new Set(Object.keys(e.changes).map(label))].join(', ')}`)
    .join(' · ');
}
