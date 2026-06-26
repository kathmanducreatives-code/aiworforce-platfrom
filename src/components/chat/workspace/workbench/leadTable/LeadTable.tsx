import { ExternalLink, Linkedin, Globe } from 'lucide-react';
import type { LeadTableRow } from '@/hooks/useLeadResults';
import type { LeadResultPanelAction } from '@/lib/chatActions';
import LockedCell from './LockedCell';
import { ContactStatusChip, RowStatusChip } from './StatusChip';

interface Props {
  rows: LeadTableRow[];
  selected: Set<string>;
  onToggle: (id: string) => void;
  onToggleAll: () => void;
  onOpen: (row: LeadTableRow) => void;
  onUnlock: (action: LeadResultPanelAction, rowId: string) => void;
}

const COL_W = {
  select: 'w-9',
  company: 'min-w-[200px]',
  signal: 'min-w-[200px]',
  persona: 'min-w-[140px]',
  contactStatus: 'min-w-[120px]',
  decisionMaker: 'min-w-[180px]',
  contactInfo: 'min-w-[180px]',
  enrichment: 'min-w-[200px]',
  message: 'min-w-[200px]',
  fit: 'w-[70px]',
  source: 'min-w-[120px]',
  status: 'w-[90px]',
};

export default function LeadTable({ rows, selected, onToggle, onToggleAll, onOpen, onUnlock }: Props) {
  const allChecked = rows.length > 0 && rows.every((r) => selected.has(r.id));

  return (
    <div className="flex-1 min-h-0 overflow-auto">
      <table className="w-max min-w-full border-separate border-spacing-0 text-[12px]">
        <thead className="sticky top-0 z-[4] bg-[#0a0d12] backdrop-blur">
          <tr className="text-left text-[10.5px] uppercase tracking-wider text-[#7D8590]">
            <th className={`${COL_W.select} sticky left-0 z-[5] bg-[#0a0d12] border-b border-r border-white/[0.08] px-2 py-2`}>
              <input
                type="checkbox"
                checked={allChecked}
                onChange={onToggleAll}
                className="h-3 w-3 rounded accent-emerald-500 cursor-pointer"
                aria-label="Select all"
              />
            </th>
            <th className={`${COL_W.company} sticky left-9 z-[3] bg-[#0a0d12]/95 border-b border-white/[0.08] px-2 py-2`}>Company / Account</th>
            <th className={`${COL_W.signal} border-b border-white/[0.08] px-2 py-2`}>Signal</th>
            <th className={`${COL_W.persona} border-b border-white/[0.08] px-2 py-2`}>Recommended Persona</th>
            <th className={`${COL_W.contactStatus} border-b border-white/[0.08] px-2 py-2`}>Contact Status</th>
            <th className={`${COL_W.decisionMaker} border-b border-white/[0.08] px-2 py-2`}>Decision Maker 🔒</th>
            <th className={`${COL_W.contactInfo} border-b border-white/[0.08] px-2 py-2`}>Contact Info 🔒</th>
            <th className={`${COL_W.enrichment} border-b border-white/[0.08] px-2 py-2`}>Company Enrichment 🔒</th>
            <th className={`${COL_W.message} border-b border-white/[0.08] px-2 py-2`}>Personalized Message 🔒</th>
            <th className={`${COL_W.fit} border-b border-white/[0.08] px-2 py-2`}>Fit</th>
            <th className={`${COL_W.source} border-b border-white/[0.08] px-2 py-2`}>Source</th>
            <th className={`${COL_W.status} border-b border-white/[0.08] px-2 py-2`}>Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const isSel = selected.has(r.id);
            const contactLocked = r.contact_status === 'needs_contact';
            const enrichLocked = r.enrichment_status !== 'enriched';
            const draftLocked = r.draft_status !== 'drafted' && r.draft_status !== 'approved';
            return (
              <tr
                key={r.id}
                className={`group ${isSel ? 'bg-emerald-500/[0.05]' : 'hover:bg-white/[0.02]'}`}
              >
                <td className={`${COL_W.select} sticky left-0 z-[1] ${isSel ? 'bg-emerald-500/[0.05]' : 'bg-[#0a0d12] group-hover:bg-white/[0.02]'} border-b border-white/[0.05] px-2`}>
                  <input
                    type="checkbox"
                    checked={isSel}
                    onChange={() => onToggle(r.id)}
                    className="h-3 w-3 rounded accent-emerald-500 cursor-pointer"
                  />
                </td>
                <td className={`${COL_W.company} sticky left-9 z-[1] ${isSel ? 'bg-emerald-500/[0.05]' : 'bg-[#0a0d12] group-hover:bg-white/[0.02]'} border-b border-white/[0.05] px-2 py-1.5`}>
                  <button onClick={() => onOpen(r)} className="text-left w-full">
                    <div className="text-[12.5px] font-medium text-[#F0F6FC] truncate">{r.company_name ?? 'Unknown company'}</div>
                    <div className="text-[10.5px] text-[#7D8590] truncate inline-flex items-center gap-1">
                      {r.website ? (
                        <><Globe className="h-2.5 w-2.5" /> {r.website.replace(/^https?:\/\//, '')}</>
                      ) : (
                        <span className="text-amber-300/80">no website</span>
                      )}
                    </div>
                  </button>
                </td>
                <td className={`${COL_W.signal} border-b border-white/[0.05] px-2 py-1.5 align-top`}>
                  <div className="text-[11.5px] text-[#C9D1D9] truncate">{r.signal_type ?? '—'}</div>
                  <div className="text-[10.5px] text-[#7D8590] line-clamp-2">{r.signal_summary ?? ''}</div>
                </td>
                <td className={`${COL_W.persona} border-b border-white/[0.05] px-2 py-1.5 align-top text-[11.5px] text-[#C9D1D9]`}>
                  {r.recommended_persona ?? <span className="text-[#7D8590]">—</span>}
                </td>
                <td className={`${COL_W.contactStatus} border-b border-white/[0.05] px-2 py-1.5 align-top`}>
                  <ContactStatusChip status={r.contact_status} />
                </td>
                <td className={`${COL_W.decisionMaker} border-b border-white/[0.05] align-top p-0`}>
                  {contactLocked ? (
                    <LockedCell label="Find decision-maker" credits={1} onUnlock={() => onUnlock('find_contacts', r.id)} />
                  ) : (
                    <div className="px-2 py-1.5">
                      <div className="text-[11.5px] text-[#F0F6FC] truncate">{r.contact_name ?? '—'}</div>
                      <div className="text-[10.5px] text-[#7D8590] truncate">{r.contact_title ?? ''}</div>
                    </div>
                  )}
                </td>
                <td className={`${COL_W.contactInfo} border-b border-white/[0.05] align-top p-0`}>
                  {contactLocked ? (
                    <LockedCell label="Enrich contact" credits={1} onUnlock={() => onUnlock('find_contacts', r.id)} />
                  ) : (
                    <div className="px-2 py-1.5 space-y-0.5">
                      {r.contact_email ? (
                        <div className="text-[11.5px] text-emerald-200 truncate">{r.contact_email}</div>
                      ) : (
                        <div className="text-[10.5px] text-[#7D8590] italic">no email</div>
                      )}
                      {r.contact_linkedin_url && (
                        <a href={r.contact_linkedin_url} target="_blank" rel="noopener noreferrer" className="text-[10.5px] inline-flex items-center gap-1 text-sky-300 hover:text-sky-200">
                          <Linkedin className="h-2.5 w-2.5" /> LinkedIn <ExternalLink className="h-2.5 w-2.5" />
                        </a>
                      )}
                    </div>
                  )}
                </td>
                <td className={`${COL_W.enrichment} border-b border-white/[0.05] align-top p-0`}>
                  {enrichLocked ? (
                    <LockedCell
                      label={r.domain_status === 'missing' ? 'Needs domain' : 'Research company'}
                      credits={r.domain_status === 'missing' ? 0 : 1}
                      onUnlock={() => onUnlock('research_company', r.id)}
                      disabled={r.domain_status === 'missing'}
                    />
                  ) : (
                    <div className="px-2 py-1.5 text-[11px] text-[#C9D1D9] line-clamp-2">{r.enrichment_summary ?? '—'}</div>
                  )}
                </td>
                <td className={`${COL_W.message} border-b border-white/[0.05] align-top p-0`}>
                  {draftLocked ? (
                    <LockedCell
                      label={r.contact_status === 'needs_contact' ? 'Needs contact' : 'Generate outreach'}
                      credits={r.contact_status === 'needs_contact' ? 0 : 2}
                      onUnlock={() => onUnlock('draft_outreach', r.id)}
                      disabled={r.contact_status === 'needs_contact'}
                    />
                  ) : (
                    <div className="px-2 py-1.5 text-[11px] text-[#C9D1D9] line-clamp-2">{r.personalized_message ?? '—'}</div>
                  )}
                </td>
                <td className={`${COL_W.fit} border-b border-white/[0.05] px-2 py-1.5 align-top font-mono text-[11px] text-emerald-200`}>
                  {typeof r.fit_score === 'number' ? r.fit_score : <span className="text-[#7D8590]">—</span>}
                </td>
                <td className={`${COL_W.source} border-b border-white/[0.05] px-2 py-1.5 align-top text-[11px] text-[#9aa4af] truncate`}>
                  {r.signal_type ?? '—'}
                </td>
                <td className={`${COL_W.status} border-b border-white/[0.05] px-2 py-1.5 align-top`}>
                  <RowStatusChip value={r.status} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
