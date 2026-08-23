// THE RESEARCH SPREADSHEET.
//
// ── WHAT THIS IS, AND WHAT IT IS NOT ────────────────────────────────────────
//
// A restoration of `LeadTable`, which I deleted in the card refactor. That was
// the wrong call: the fourteen columns were a real problem, but the SHAPE was
// the product — a grid you work across row by row, unlocking what you do not
// yet know. Replacing it with stacked cards fixed the columns and removed the
// workspace.
//
// Kept from the original, deliberately:
//
//   · the sticky company column, so a horizontal scroll never loses the name
//   · per-cell unlock affordances (`LockedCell` → `UnlockCell`)
//   · `accountViews` / `outreachHints` — the per-stage state the view has been
//     hydrating on every load with nothing to render it since the refactor
//
// Changed: fourteen columns to eight. Four of the originals were padlocks and
// Fit and Status were columns 12 and 14 — the two facts a reader most needs,
// off the right edge at any normal width. Fit and Status now sit beside the
// company name, and the unlockable work is three columns instead of four.
//
// ── DENSITY IS THE FEATURE ──────────────────────────────────────────────────
//
// A card was ~92px per lead; a row is ~44px. On a 600px results area that is
// six leads against thirteen. The whole reason to hold a grid rather than a
// list is seeing enough rows at once to compare them.

import { useMemo } from 'react';
import { ExternalLink, Globe } from 'lucide-react';
import type { LeadTableRow } from '@/hooks/useLeadResults';
import type { LeadResultPanelAction } from '@/lib/chatActions';
import type { WorkbenchAccountView } from '@/lib/workbenchAccountView';
import type { OutreachRowHint } from '@/lib/outreachOpener';
import type { RowAction } from '@/lib/leadRowAction';
import { buildLeadCard } from '@/lib/workbench/leadCard';
import { qualificationFromRow } from '@/lib/qualifiedLead/rowQualification';
import { unlockFailureReason, unlockStateFor } from '@/lib/workbench/unlockState';
import UnlockCell from './UnlockCell';
import { priceFor } from '@/lib/credits/pricing';

/**
 * Column widths.
 *
 * Fixed so the header and the body cannot disagree during a horizontal scroll,
 * which is the one thing a sticky-column table gets wrong most easily.
 */
const COL = {
  select: 'w-9 min-w-[36px]',
  company: 'w-[260px] min-w-[260px]',
  fit: 'w-[132px] min-w-[132px]',
  signal: 'w-[300px] min-w-[300px]',
  decisionMaker: 'w-[210px] min-w-[210px]',
  // Wider than its neighbours: an email is a single unbreakable token and
  // truncating one mid-domain shows something that looks like a different
  // address.
  contact: 'w-[230px] min-w-[230px]',
  research: 'w-[210px] min-w-[210px]',
  outreach: 'w-[190px] min-w-[190px]',
  status: 'w-[150px] min-w-[150px]',
} as const;

/**
 * ROW BACKGROUNDS ARE OPAQUE, ALWAYS.
 *
 * ── THE BLEED ───────────────────────────────────────────────────────────────
 *
 * This was `bg-[#0a0d12] group-hover:bg-white/[0.02]`, and selection was
 * `bg-emerald-500/[0.05]`. Both set the SAME CSS property, so on hover the
 * literal `#0a0d12` was replaced by `rgba(255,255,255,0.02)` — a 98%
 * transparent cell. For an ordinary column that is invisible; for a STICKY one
 * it is fatal, because the horizontally-scrolled columns pass underneath it and
 * show straight through. That is the "…eeded" from "Setup needed" appearing
 * inside the company column.
 *
 * Selection was worse: `emerald/[0.05]` is translucent unconditionally, so a
 * selected row bled whether or not it was hovered.
 *
 * ── WHY SOLID HEX AND NOT A LAYER ───────────────────────────────────────────
 *
 * The tints are pre-blended against the panel background rather than stacked as
 * an overlay element. An overlay inside a sticky `<td>` needs its own stacking
 * context and paints over the cell's own text as readily as under it, which is
 * the same class of bug one layer down. These are the exact colours the
 * translucent versions produced — the surface looks identical and is opaque.
 */
const ROW_BG = {
  /** #0a0d12 — the panel. */
  base: 'bg-[#0a0d12]',
  /** #0a0d12 + 2% white. */
  hover: 'group-hover:bg-[#0f1217]',
  /** #0a0d12 + 5% emerald-500. */
  selected: 'bg-[#0a1618]',
  /** …and the same again with the hover lift, so selection is not inert. */
  selectedHover: 'group-hover:bg-[#0f1b1d]',
} as const;

const STATE_DOT: Record<string, string> = {
  ready: 'bg-emerald-400',
  needs_contact: 'bg-amber-400',
  in_review: 'bg-[#6e7681]',
};

const FIT_TONE: Record<string, string> = {
  'Strong match': 'text-emerald-300',
  'Good match': 'text-emerald-200/80',
  'Possible match': 'text-[#8b949e]',
};

interface Props {
  rows: LeadTableRow[];
  selected: Set<string>;
  rowActions: Record<string, RowAction>;
  accountViews: Record<string, WorkbenchAccountView>;
  outreachHints: Record<string, OutreachRowHint>;
  /** Provider readiness, so a cell can say "setup needed" rather than failing. */
  providers: { people: boolean; research: boolean };
  onToggle: (id: string) => void;
  onToggleAll: () => void;
  onOpen: (row: LeadTableRow) => void;
  onUnlock: (action: LeadResultPanelAction, rowId: string) => void;
}

export default function LeadSpreadsheet({
  rows, selected, rowActions, accountViews, outreachHints, providers,
  onToggle, onToggleAll, onOpen, onUnlock,
}: Props) {
  const allChecked = rows.length > 0 && rows.every((r) => selected.has(r.id));
  const models = useMemo(
    () => rows.map((r) => ({ row: r, card: buildLeadCard({ ...r, ...qualificationFromRow(r) }) })),
    [rows],
  );

  const TH = ({ w, children }: { w: string; children?: React.ReactNode }) => (
    <th className={`${w} text-left font-normal text-[11.5px] text-[#6e7681] px-3 py-2.5`}>
      {children}
    </th>
  );

  return (
    // ONE SCROLL REGION, both axes. A nested vertical scroller inside a
    // horizontal one is how a sticky header comes unstuck.
    <div className="flex-1 min-h-0 overflow-auto">
      <table className="w-max min-w-full border-separate border-spacing-0">
        <thead className="sticky top-0 z-[3]">
          <tr className="bg-[#0a0d12]">
            <th className={`${COL.select} sticky left-0 z-[4] bg-[#0a0d12] px-3 py-2.5 border-b border-white/[0.07]`}>
              <input
                type="checkbox"
                checked={allChecked}
                onChange={onToggleAll}
                aria-label="Select all"
                className="h-3.5 w-3.5 rounded accent-emerald-500 cursor-pointer align-middle"
              />
            </th>
            <th className={`${COL.company} sticky left-9 z-[4] bg-[#0a0d12] text-left font-normal text-[11.5px] text-[#6e7681] px-3 py-2.5 border-b border-r border-white/[0.07]`}>
              Company
            </th>
            <TH w={COL.fit}>Fit</TH>
            <TH w={COL.signal}>Strongest signal</TH>
            <TH w={COL.decisionMaker}>Decision maker</TH>
            <TH w={COL.contact}>Contact details</TH>
            <TH w={COL.research}>Company research</TH>
            <TH w={COL.outreach}>Outreach</TH>
            <TH w={COL.status}>Status</TH>
          </tr>
          {/* A single hairline under the whole header, drawn once.
              Opaque above it, because this row is sticky too and a translucent
              rule would let the scrolled rows show through the header seam. */}
          <tr className="bg-[#0a0d12]">
            {/* 8 → 9: the Contact details column. This hairline is drawn ONCE
                    under the whole header, so its span is the column count and
                    a stale number leaves the last column underlined by nothing. */}
            <td colSpan={9} className="p-0 h-px bg-white/[0.07]" />
          </tr>
        </thead>

        <tbody>
          {models.map(({ row: r, card }) => {
            const isSel = selected.has(r.id);
            const view = accountViews[r.id];
            const running = rowActions[r.id]?.status === 'running'
              ? rowActions[r.id].kind : null;
            // EVERY VARIANT IS AN OPAQUE HEX. A sticky cell whose background
            // is even slightly translucent shows the scrolled columns through
            // itself, which is the entire defect this replaced.
            const rowBg = isSel
              ? `${ROW_BG.selected} ${ROW_BG.selectedHover}`
              : `${ROW_BG.base} ${ROW_BG.hover}`;

            const dmState = running === 'find_decision_makers' ? 'processing'
              : unlockStateFor({ stage: view?.decision_makers, providerReady: providers.people });
            // ── CONTACT DETAILS ────────────────────────────────────────
            //
            // `providers.people` is the readiness flag: the enrichment Actor is
            // an Apify people provider, the same configuration the
            // decision-maker column depends on. A separate flag would let this
            // column claim to be runnable when the account it belongs to is not.
            const contactState = running === 'find_contact_details' ? 'processing'
              : unlockStateFor({ stage: view?.contact_enrichment, providerReady: providers.people });
            const researchState = running === 'research_company' ? 'processing'
              : unlockStateFor({ stage: view?.company_research, providerReady: providers.research });
            const outreachState = running === 'generate_outreach' ? 'processing'
              : unlockStateFor({ stage: view?.outreach });

            const dm = view?.decision_makers.last_success;
            const contact = view?.contact_enrichment.last_success;
            const research = view?.company_research.last_success;
            const outreach = view?.outreach.last_success;

            return (
              // `align-middle` with a fixed height: every cell now holds at
              // most two lines, so a row's height no longer depends on which
              // columns happen to be unlocked. `align-top` plus variable line
              // counts is what made one row taller than its neighbours.
              <tr key={r.id} className={`group h-[62px] align-middle ${rowBg}`}>
                <td className={`${COL.select} sticky left-0 z-[2] ${rowBg} px-3 border-b border-white/[0.04] overflow-hidden`}>
                  <input
                    type="checkbox"
                    checked={isSel}
                    onChange={() => onToggle(r.id)}
                    aria-label={`Select ${card.company}`}
                    className="h-3.5 w-3.5 rounded accent-emerald-500 cursor-pointer"
                  />
                </td>

                {/* STICKY. A horizontal scroll must never lose the name. */}
                <td className={`${COL.company} sticky left-9 z-[2] ${rowBg} px-3 border-b border-r border-white/[0.04] overflow-hidden`}>
                  <button
                    onClick={() => onOpen(r)}
                    className="text-left w-full text-[14px] font-medium text-[#F0F6FC] hover:text-emerald-300 transition-colors truncate block leading-snug"
                  >
                    {card.company}
                  </button>
                  {card.websiteLabel && (
                    card.websiteHref ? (
                      <a
                        href={card.websiteHref}
                        target="_blank" rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="inline-flex items-center gap-1 text-[12px] text-[#6e7681] hover:text-[#C9D1D9] transition-colors truncate max-w-full"
                      >
                        <Globe className="h-2.5 w-2.5 shrink-0" />
                        <span className="truncate">{card.websiteLabel}</span>
                      </a>
                    ) : (
                      <span className="text-[12px] text-[#6e7681]">{card.websiteLabel}</span>
                    )
                  )}
                </td>

                <td className={`${COL.fit} px-3 border-b border-white/[0.04] overflow-hidden`}>
                  {card.fit !== null ? (
                    <>
                      <div className={`text-[13px] tabular-nums ${FIT_TONE[card.fitLabel ?? ''] ?? 'text-[#8b949e]'}`}>
                        {card.fit}
                      </div>
                      <div className="text-[12px] text-[#6e7681]">{card.fitLabel}</div>
                    </>
                  ) : (
                    <span className="text-[12px] text-[#6e7681]">Not scored</span>
                  )}
                </td>

                <td className={`${COL.signal} px-3 border-b border-white/[0.04] overflow-hidden`}>
                  <div className="text-[13px] text-[#C9D1D9] truncate leading-snug">
                    {card.signal ?? <span className="text-[#6e7681]">No signal recorded</span>}
                  </div>
                  {/* WHY, in one line, with the evidence link on the same row.
                      It was a third stacked line, which made this column the
                      tallest in the table. The full reasoning is in the drawer:
                      paragraphs of evidence in every row is what made the
                      original table unreadable. */}
                  <div className="flex items-baseline gap-2 min-w-0">
                    <span className="text-[12px] text-[#6e7681] truncate">
                      {card.reason ?? card.whyLine}
                    </span>
                    {card.signalHref && (
                      <a
                        href={card.signalHref}
                        target="_blank" rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="shrink-0 inline-flex items-center gap-1 text-[12px] text-emerald-300/70 hover:text-emerald-200 transition-colors"
                      >
                        Evidence <ExternalLink className="h-2.5 w-2.5" />
                      </a>
                    )}
                  </div>
                </td>

                <td className={`${COL.decisionMaker} px-3 border-b border-white/[0.04] overflow-hidden`}>
                  {dmState === 'unlocked' && dm ? (
                    // TWO LINES, LIKE EVERY OTHER CELL. This was three — name,
                    // title, then a LinkedIn link on its own row — so any row
                    // with a decision-maker stood taller than its neighbours.
                    // The link moves onto the name line, where it also sits
                    // closer to the thing it identifies.
                    <>
                      <div className="flex items-baseline gap-1.5 min-w-0">
                        <span className="text-[13px] text-[#F0F6FC] truncate">{dm.full_name}</span>
                        {dm.linkedin_url && (
                          <a
                            href={dm.linkedin_url}
                            target="_blank" rel="noopener noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            className="shrink-0 text-sky-300/80 hover:text-sky-200"
                            aria-label={`${dm.full_name} on LinkedIn`}
                          >
                            <ExternalLink className="h-2.5 w-2.5" />
                          </a>
                        )}
                      </div>
                      <div className="text-[12px] text-[#6e7681] truncate">{dm.title}</div>
                    </>
                  ) : (
                    <UnlockCell
                      state={dmState}
                      label="Find contact"
                      // The price the reserve will take. Same table, both sides.
                      cost={priceFor('find_decision_makers')}
                      onUnlock={() => onUnlock('find_contacts', r.id)}
                      blockedReason="A people-search provider is not configured"
                      failureReason={unlockFailureReason(view?.decision_makers)}
                    />
                  )}
                </td>

                <td className={`${COL.contact} px-3 border-b border-white/[0.04] overflow-hidden`}>
                  {contactState === 'unlocked' && contact?.email_status === 'email_found'
                    && contact.business_email ? (
                    // AN ADDRESS WE HOLD. Selectable, because the first thing
                    // anyone does with it is copy it, and `truncate` on a
                    // single unbreakable token still yields a copyable string.
                    <span
                      className="block truncate text-[12.5px] text-[#C9D1D9] select-all"
                      title={contact.business_email}
                    >
                      {contact.business_email}
                    </span>
                  ) : contactState === 'unlocked' ? (
                    // ── HELD, AND THE ANSWER IS "NONE" ────────────────────
                    //
                    // `unlockStateFor` reports `unlocked` whenever a payload
                    // was persisted, and a paid `not_found` IS a payload — the
                    // lookup ran and settled the question. Rendering the same
                    // priced button here would invite the user to buy the same
                    // nothing again, which is the defect the `not_found` state
                    // exists to prevent. Its `reason` says why a retry would
                    // change nothing.
                    <span
                      className="inline-flex items-center gap-1.5 text-[12px] text-[#6e7681]"
                      title={contact?.reason ?? undefined}
                    >
                      No email found
                    </span>
                  ) : (
                    <UnlockCell
                      state={contactState}
                      label="Find contact details"
                      // The price the reserve will take. Same table, both sides.
                      cost={priceFor('find_contact_details')}
                      onUnlock={() => onUnlock('find_contact_details', r.id)}
                      blockedReason="A people-search provider is not configured"
                      failureReason={unlockFailureReason(view?.contact_enrichment)}
                    />
                  )}
                </td>

                <td className={`${COL.research} px-3 border-b border-white/[0.04] overflow-hidden`}>
                  {researchState === 'unlocked' && research ? (
                    <div className="text-[12.5px] text-[#C9D1D9] line-clamp-2 leading-snug">
                      {research.summary ?? 'Researched'}
                    </div>
                  ) : (
                    <UnlockCell
                      state={researchState}
                      label="Research company"
                      // The price the reserve will take. Same table, both sides.
                      cost={priceFor('research_company')}
                      onUnlock={() => onUnlock('research_company', r.id)}
                      blockedReason="Firecrawl is not configured"
                      failureReason={unlockFailureReason(view?.company_research)}
                    />
                  )}
                </td>

                <td className={`${COL.outreach} px-3 border-b border-white/[0.04] overflow-hidden`}>
                  {outreachState === 'unlocked' && outreach ? (
                    <button
                      onClick={() => onOpen(r)}
                      className="text-left text-[12.5px] text-[#C9D1D9] line-clamp-2 hover:text-emerald-300 transition-colors leading-snug"
                    >
                      {outreach.preview ?? outreachHints[r.id]?.opener ?? 'Draft ready'}
                    </button>
                  ) : (
                    <UnlockCell
                      state={outreachState}
                      label="Draft outreach"
                      // The price the reserve will take. Same table, both sides.
                      cost={priceFor('generate_outreach')}
                      onUnlock={() => onUnlock('draft_outreach', r.id)}
                      failureReason={unlockFailureReason(view?.outreach)}
                    />
                  )}
                </td>

                <td className={`${COL.status} px-3 border-b border-white/[0.04] overflow-hidden`}>
                  <span className="inline-flex items-center gap-1.5 text-[12.5px] text-[#8b949e]">
                    <span className={`h-1.5 w-1.5 rounded-full ${STATE_DOT[card.state] ?? 'bg-[#6e7681]'}`} />
                    {card.stateLabel}
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
