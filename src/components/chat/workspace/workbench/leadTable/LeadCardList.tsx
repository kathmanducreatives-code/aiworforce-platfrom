// THE LEADS, AS A LIST OF LEADS.
//
// Replaces a fourteen-column table behind a horizontal scroll. Four of those
// columns were padlocks — cells whose entire content was an upsell for an
// action — and Fit and Status, the two facts a reader most needs, were columns
// 12 and 14, off the right edge at any normal panel width.
//
// A table is right for comparing many values of the SAME kind. A lead is seven
// different kinds of fact about one company, and a row forced them into one
// visual rank where the important ones landed last.
//
// The detail the locked columns gated — decision-makers, contact hints,
// enrichment, drafts — is in `LeadDetailDrawer`, which every card opens. It was
// always the better home for it: a drawer can show one company properly,
// whereas a locked cell showed a padlock and a price.

import { useMemo } from 'react';
import type { LeadTableRow } from '@/hooks/useLeadResults';
import type { LeadResultPanelAction } from '@/lib/chatActions';
import { buildLeadCard } from '@/lib/workbench/leadCard';
import { qualificationFromRow } from '@/lib/qualifiedLead/rowQualification';
import { LEAD_ACTION_LOADING } from '@/lib/leadActionRequest';
import type { RowAction } from '@/lib/leadRowAction';
import LeadCard from './LeadCard';

interface Props {
  rows: LeadTableRow[];
  selected: Set<string>;
  rowActions: Record<string, RowAction>;
  onToggle: (id: string) => void;
  onToggleAll: () => void;
  onOpen: (row: LeadTableRow) => void;
  /** The card's own next step. Same dispatch the padlocks used. */
  onUnlock: (action: LeadResultPanelAction, id: string) => void;
}

export default function LeadCardList({
  rows, selected, rowActions, onToggle, onToggleAll, onOpen, onUnlock,
}: Props) {
  const allChecked = rows.length > 0 && rows.every((r) => selected.has(r.id));

  // Built once per render for the whole list rather than per card, so the
  // fallback chains run in one place and a card cannot disagree with its
  // neighbour about how a missing field is read.
  const models = useMemo(
    () => rows.map((r) => ({
      row: r,
      model: buildLeadCard({ ...r, ...qualificationFromRow(r) }),
    })),
    [rows],
  );

  return (
    <div className="flex-1 min-h-0 overflow-auto">
      {/* Select-all lives with the list, not in a column header — there is no
          header row any more, and it is the only table chrome worth keeping. */}
      <div className="sticky top-0 z-[2] bg-[#0a0d12]/95 backdrop-blur px-6 py-2.5 border-b border-white/[0.06] flex items-center gap-3">
        <input
          type="checkbox"
          checked={allChecked}
          onChange={onToggleAll}
          aria-label="Select all"
          className="h-3.5 w-3.5 rounded accent-emerald-500 cursor-pointer"
        />
        <span className="text-[12px] text-[#6e7681]">
          {allChecked ? 'All selected' : 'Select all'}
        </span>
      </div>

      {models.map(({ row, model }) => {
        const action = rowActions[row.id];
        // A running action replaces the state line — the row is doing something
        // now, and its previous state is not what the reader needs.
        const busy = action && action.status === 'running'
          ? LEAD_ACTION_LOADING[action.kind] ?? 'Working…'
          : null;
        return (
          <LeadCard
            key={row.id}
            model={model}
            selected={selected.has(row.id)}
            busyLabel={busy}
            onToggle={() => onToggle(row.id)}
            onOpen={() => onOpen(row)}
            onNextStep={
              // Only `needs_contact` offers one, and it maps to the same
              // dispatch the "Decision Maker 🔒" cell used.
              model.nextStep ? () => onUnlock('find_contacts', row.id) : undefined
            }
          />
        );
      })}
    </div>
  );
}
