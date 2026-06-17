import type { ContactStatus } from '@/hooks/useLeadResults';

const CONTACT_LABEL: Record<ContactStatus, string> = {
  needs_contact: 'Needs contact',
  profile_found: 'Profile',
  email_found: 'Email',
  verified: 'Verified',
};

const CONTACT_TONE: Record<ContactStatus, string> = {
  needs_contact: 'border-amber-500/30 bg-amber-500/[0.06] text-amber-200',
  profile_found: 'border-sky-500/30 bg-sky-500/[0.06] text-sky-200',
  email_found: 'border-emerald-500/30 bg-emerald-500/[0.08] text-emerald-200',
  verified: 'border-emerald-500/40 bg-emerald-500/[0.15] text-emerald-100',
};

export function ContactStatusChip({ status }: { status: ContactStatus }) {
  return (
    <span className={`inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded border ${CONTACT_TONE[status]}`}>
      <span className="h-1 w-1 rounded-full bg-current opacity-70" />
      {CONTACT_LABEL[status]}
    </span>
  );
}

export function RowStatusChip({ value }: { value: string }) {
  const v = (value || 'new').toLowerCase();
  const tone =
    v === 'new' ? 'border-white/10 bg-white/[0.04] text-[#C9D1D9]'
    : v === 'saved' ? 'border-sky-500/30 bg-sky-500/[0.06] text-sky-200'
    : v === 'enriched' ? 'border-emerald-500/30 bg-emerald-500/[0.08] text-emerald-200'
    : v === 'drafted' ? 'border-violet-500/30 bg-violet-500/[0.08] text-violet-200'
    : v === 'reviewed' ? 'border-emerald-500/40 bg-emerald-500/[0.15] text-emerald-100'
    : 'border-white/10 bg-white/[0.04] text-[#9aa4af]';
  return (
    <span className={`inline-flex items-center text-[10px] px-1.5 py-0.5 rounded border ${tone}`}>{v}</span>
  );
}
