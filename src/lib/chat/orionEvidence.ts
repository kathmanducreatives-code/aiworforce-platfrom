// ORION's evidence for one answer, read from the message metadata the server
// wrote (`metadata.orion_evidence.items`). Pure and defensive: anything malformed
// is dropped, never rendered half-formed, and nothing here can break the chat.

export type EvidenceTone = 'verified' | 'single' | 'inference' | 'stale' | 'contradicted' | 'unknown';

export interface OrionEvidenceRow {
  ref: string;
  subject: string;
  content: string;
  verification: string;
  label: string;
  tone: EvidenceTone;
  date: string | null;
  ageDays: number | null;
  sourceType: string;
  sourceHost: string | null;
  sourceUrl: string | null;
  excludedBy: string | null;
}

const TONES: Record<string, EvidenceTone> = {
  verified: 'verified', single_source: 'single', inference: 'inference',
  stale: 'stale', contradicted: 'contradicted', unknown: 'unknown',
};
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);
const SOURCE_LABEL: Record<string, string> = {
  lisa_signal: 'LISA signal', lead: 'ATLAS lead record', web_page: 'Company page (cached)', company_brain: 'Company Brain',
};

export function readOrionEvidence(metadata: unknown): OrionEvidenceRow[] {
  const ev = (metadata && typeof metadata === 'object' ? (metadata as Record<string, unknown>).orion_evidence : null) as
    Record<string, unknown> | null | undefined;
  const items = Array.isArray(ev?.items) ? ev!.items : [];
  const out: OrionEvidenceRow[] = [];
  for (const raw of items) {
    if (!raw || typeof raw !== 'object') continue;
    const o = raw as Record<string, unknown>;
    const ref = str(o.ref), subject = str(o.subject), content = str(o.content);
    if (!ref || !/^E\d+$/.test(ref) || !subject || !content) continue;
    const verification = str(o.verification) ?? 'unknown';
    const url = str(o.source_url);
    out.push({
      ref, subject, content, verification,
      label: str(o.verification_label) ?? verification.replace(/_/g, ' '),
      tone: TONES[verification] ?? 'unknown',
      date: str(o.date),
      ageDays: typeof o.age_days === 'number' && Number.isFinite(o.age_days) ? o.age_days : null,
      sourceType: SOURCE_LABEL[str(o.source_type) ?? ''] ?? (str(o.source_type) ?? 'record'),
      sourceHost: str(o.source_host),
      sourceUrl: url && /^https?:\/\//i.test(url) ? url : null,
      excludedBy: str(o.excluded_by),
    });
  }
  return out;
}

export function ageText(days: number | null): string {
  if (days == null) return 'undated';
  if (days === 0) return 'today';
  return `${days} day${days === 1 ? '' : 's'} ago`;
}
