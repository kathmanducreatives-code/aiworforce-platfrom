import { Lock } from 'lucide-react';

interface Props {
  label: string;
  credits: number;
  onUnlock: () => void;
  disabled?: boolean;
}

export default function LockedCell({ label, credits, onUnlock, disabled }: Props) {
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
        title={disabled ? 'Blocked — missing prerequisite' : `Unlock — ~${credits} credit${credits === 1 ? '' : 's'}`}
      >
        <Lock className="h-2.5 w-2.5" />
        <span className="truncate max-w-[120px]">{label}</span>
        {credits > 0 && <span className="text-emerald-300/80 font-mono">~{credits}c</span>}
      </button>
    </div>
  );
}
