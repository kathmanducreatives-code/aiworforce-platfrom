import { Lock } from 'lucide-react';

// NO CREDIT COST IS DISPLAYED HERE, DELIBERATELY.
//
// This cell used to render a `~Nc` badge and an "Unlock — ~N credits" tooltip.
// It was not true. Every action these buttons dispatch ('find_contacts',
// 'research_company', 'draft_outreach') is mapped by workbenchActionToLeadKind()
// to a lead_action kind, and LeadResultsView's runAction() sends those straight
// to runDirectLeadAction() — returning BEFORE estimateCredits() and before the
// confirm dialog. No credit is reserved and none is charged. The separate
// credit-ledgered flow (supabase/functions/unlock-founders + credits_reserve/
// credits_finalize) has zero callers in src/.
//
// So the badge advertised a charge that never happened. The label is corrected
// rather than the wiring: these actions are free to the user today, by decision.
// If a paid unlock is ever wired up, the cost belongs here AND on the path that
// actually reserves it — never on one without the other.
// Guarded by tests/frontend/lockedCellCost.test.ts.

interface Props {
  label: string;
  onUnlock: () => void;
  disabled?: boolean;
}

export default function LockedCell({ label, onUnlock, disabled }: Props) {
  return (
    <div className="relative h-full w-full flex items-center px-2 py-1.5 group">
      <div
        aria-hidden
        className="absolute inset-0 pointer-events-none opacity-60"
        style={{
          backgroundImage: 'repeating-linear-gradient(135deg, rgba(255,255,255,0.025) 0 6px, transparent 6px 12px)',
        }}
      />
      <button
        type="button"
        onClick={onUnlock}
        disabled={disabled}
        className="relative z-[1] inline-flex items-center gap-1.5 text-[10.5px] px-1.5 py-1 rounded border border-white/[0.08] bg-white/[0.03] text-[#9aa4af] hover:bg-emerald-500/[0.10] hover:border-emerald-500/30 hover:text-emerald-200 transition-colors disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap"
        title={disabled ? 'Blocked — missing prerequisite' : label}
      >
        <Lock className="h-2.5 w-2.5" />
        <span className="truncate max-w-[120px]">{label}</span>
      </button>
    </div>
  );
}
