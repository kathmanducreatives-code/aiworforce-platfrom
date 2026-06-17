import type { LeadTableRow } from '@/hooks/useLeadResults';

const LOCKED = 'Locked — not generated';

function esc(v: unknown): string {
  if (v == null || v === '') return '';
  const s = String(v).replace(/"/g, '""');
  return /[",\n]/.test(s) ? `"${s}"` : s;
}

export function rowsToCsv(rows: LeadTableRow[]): string {
  const headers = [
    'company', 'website', 'location', 'signal_type', 'signal_summary',
    'recommended_persona', 'contact_status',
    'contact_name', 'contact_title', 'contact_email', 'contact_linkedin',
    'enrichment_summary', 'personalized_message',
    'fit_score', 'status',
  ];
  const lines = [headers.join(',')];
  for (const r of rows) {
    const contactLocked = r.contact_status === 'needs_contact';
    const enrichLocked = r.enrichment_status !== 'enriched';
    const draftLocked = r.draft_status !== 'drafted' && r.draft_status !== 'approved';
    lines.push([
      esc(r.company_name),
      esc(r.website),
      esc(r.company_location),
      esc(r.signal_type),
      esc(r.signal_summary),
      esc(r.recommended_persona),
      esc(r.contact_status),
      esc(contactLocked ? LOCKED : r.contact_name),
      esc(contactLocked ? LOCKED : r.contact_title),
      esc(contactLocked ? LOCKED : r.contact_email),
      esc(contactLocked ? LOCKED : r.contact_linkedin_url),
      esc(enrichLocked ? LOCKED : r.enrichment_summary),
      esc(draftLocked ? LOCKED : r.personalized_message),
      esc(r.fit_score),
      esc(r.status),
    ].join(','));
  }
  return lines.join('\n');
}

export function downloadCsv(filename: string, csv: string) {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
