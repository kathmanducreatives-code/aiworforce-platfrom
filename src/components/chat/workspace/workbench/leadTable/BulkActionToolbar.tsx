import { Search, Globe, PenLine, Star, Download, Save, X } from 'lucide-react';
import type { LeadResultPanelAction } from '@/lib/chatActions';
import { ACTION_LABEL } from './credits';

interface Props {
  selectedCount: number;
  onClear: () => void;
  onAction: (a: LeadResultPanelAction) => void;
  credits: Record<LeadResultPanelAction, number>;
}

const ICONS: Partial<Record<LeadResultPanelAction, any>> = {
  find_contacts: Search,
  research_company: Globe,
  draft_outreach: PenLine,
  rank: Star,
  export_csv: Download,
  save_to_signal_feed: Save,
};

const ORDER: LeadResultPanelAction[] = [
  'find_contacts', 'research_company', 'draft_outreach', 'rank', 'export_csv', 'save_to_signal_feed',
];

export default function BulkActionToolbar({ selectedCount, onClear, onAction, credits }: Props) {
  if (selectedCount === 0) return null;
  return (
    <div className="sticky top-0 z-20 mx-3 mt-2 flex items-center gap-2 px-2.5 py-1.5 rounded-md border border-emerald-500/30 bg-emerald-500/[0.06] backdrop-blur">
      <span className="text-[11px] font-medium text-emerald-100 tabular-nums">{selectedCount} selected</span>
      <span className="h-3 w-px bg-emerald-500/30" />
      <div className="flex items-center gap-1 flex-wrap">
        {ORDER.map((a) => {
          const Icon = ICONS[a] ?? Star;
          const c = credits[a] ?? 0;
          return (
            <button
              key={a}
              onClick={() => onAction(a)}
              title={ACTION_LABEL[a]}
              className="inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded border border-white/[0.08] bg-white/[0.03] text-[#C9D1D9] hover:bg-emerald-500/[0.10] hover:border-emerald-500/30 hover:text-emerald-100 transition-colors"
            >
              <Icon className="h-3 w-3" />
              {ACTION_LABEL[a]}
              {c > 0 && <span className="text-emerald-300/80 font-mono">~{c}c</span>}
            </button>
          );
        })}
      </div>
      <button onClick={onClear} className="ml-auto p-1 rounded hover:bg-white/[0.06] text-[#7D8590] hover:text-[#C9D1D9]" title="Clear selection">
        <X className="h-3 w-3" />
      </button>
    </div>
  );
}
