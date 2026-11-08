// DEV-ONLY: the Workbench lead-discovery panel against the labelled simulation (MRLE).
// Rendered only when import.meta.env.DEV and VITE_STRATEGY_DISCOVERY_MOCK is set
// (strategyDiscoveryMockMode); never in a production build. It is the SAME component the
// chat's mission card renders — this only gives it a place to appear without a mission card.

import { useState } from 'react';
import { X } from 'lucide-react';
import { StrategyDiscoveryPanel } from '@/components/discovery/StrategyDiscoveryPanel';

const QUERY = 'Find 5 US B2B companies actively hiring Account Executives.';

export function LeadDiscoveryPreview() {
  const [open, setOpen] = useState(true);
  if (!open) return null;
  return (
    <div className="fixed bottom-14 left-3 z-[60] w-[460px] max-h-[80vh] overflow-auto rounded-xl border border-white/10 bg-[#0E1012]/95 p-3 text-[12px] shadow-2xl" data-testid="lead-discovery-preview">
      <div className="flex items-center gap-2">
        <span className="text-[11px] uppercase tracking-wide text-amber-200/80">Dev preview · simulated</span>
        <button type="button" onClick={() => setOpen(false)} className="ml-auto text-[#8B8F96] hover:text-[#ECE9E4]" aria-label="Close preview"><X className="h-3.5 w-3.5" /></button>
      </div>
      <div className="mt-1 text-[#ECE9E4]">{QUERY}</div>
      <StrategyDiscoveryPanel messageId="dev-preview" query={QUERY} requestedCount={5} />
    </div>
  );
}
