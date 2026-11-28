// DEV-ONLY: the Workbench lead-discovery panel against the labelled simulation (MRLE).
// Rendered only when import.meta.env.DEV and VITE_STRATEGY_DISCOVERY_MOCK is set
// (strategyDiscoveryMockMode); never in a production build. It is the SAME component the
// chat's mission card renders — this only gives it a place to appear without a mission card.
//
// VITE_STRATEGY_DISCOVERY_MOCK=server (V5): the panel talks to the local ATLAS simulator backend
// (npm run dev:atlas-server) — the real lead-pipeline service with every provider faked. Pick a
// scenario; the two switches simulate an approval that has expired and a workspace you are not in.

import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { StrategyDiscoveryPanel } from '@/components/discovery/StrategyDiscoveryPanel';
import { localSimulation } from '@/components/discovery/devSimulation';
import { simControls, simServerUrl, strategyDiscoveryMockMode } from '@/lib/strategyDiscoveryMock';

const QUERY = 'Find 5 US B2B companies actively hiring Account Executives.';
type SimScenario = { name: string; description: string; query: string; requestedCount: number };

export function LeadDiscoveryPreview() {
  const [open, setOpen] = useState(true);
  const server = strategyDiscoveryMockMode() === 'server';
  const [list, setList] = useState<SimScenario[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [name, setName] = useState<string | null>(null);
  const [expired, setExpired] = useState(false);
  const [otherWs, setOtherWs] = useState(false);
  useEffect(() => {
    if (!server) return;
    fetch(`${simServerUrl()}/scenarios`).then((r) => r.json()).then((j: { default: string; scenarios: SimScenario[] }) => {
      setList(j.scenarios); setName(j.default); simControls.scenario = j.default;
    }).catch(() => setListError(`The ATLAS simulator is not running at ${simServerUrl()} — start it with: npm run dev:atlas-server`));
  }, [server]);
  if (!open) return null;
  const current = list?.find((s) => s.name === name) ?? null;
  const query = server ? current?.query ?? '' : localSimulation?.query ?? QUERY;
  const choose = (n: string) => { simControls.scenario = n; setName(n); };
  return (
    <div className="fixed bottom-14 left-3 z-[60] w-[480px] max-h-[85vh] overflow-auto rounded-xl border border-white/10 bg-[#0E1012]/95 p-3 text-[12px] shadow-2xl" data-testid="lead-discovery-preview">
      <div className="flex items-center gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-amber-200" data-testid="simulated-banner">Simulated data — no external providers called</span>
        <button type="button" onClick={() => setOpen(false)} className="ml-auto text-[#8B8F96] hover:text-[#ECE9E4]" aria-label="Close preview"><X className="h-3.5 w-3.5" /></button>
      </div>
      {server ? (
        <div className="mt-1 space-y-1" data-testid="sim-controls">
          {listError && <div className="text-red-300/90" data-testid="sim-server-error">{listError}</div>}
          {list && (
            <select value={name ?? ''} onChange={(e) => choose(e.target.value)} data-testid="sim-scenario"
              className="w-full h-7 rounded border border-white/10 bg-[#15181B] px-1.5 text-[11.5px] text-[#ECE9E4]">
              {list.map((s) => <option key={s.name} value={s.name}>{s.name}</option>)}
            </select>
          )}
          {current && <div className="text-[10.5px] text-amber-200/70" data-testid="sim-scenario-description">{current.description}</div>}
          <div className="flex items-center gap-3 text-[11px] text-[#8B8F96]">
            <label className="flex items-center gap-1"><input type="checkbox" checked={expired} data-testid="sim-expire"
              onChange={(e) => { setExpired(e.target.checked); simControls.clockHours = e.target.checked ? 25 : 0; }} /> Run 25 h later (approval expires)</label>
            <label className="flex items-center gap-1"><input type="checkbox" checked={otherWs} data-testid="sim-other-workspace"
              onChange={(e) => { setOtherWs(e.target.checked); simControls.otherWorkspace = e.target.checked; }} /> Another workspace</label>
          </div>
        </div>
      ) : (
        <div className="mt-0.5 text-[10.5px] text-amber-200/70">{localSimulation?.scenario ? `Scenario: ${localSimulation.scenario} (npm run dev:atlas)` : 'Committed simulation (scripts/dev/mrle-simulation.ts)'}</div>
      )}
      <div className="mt-1 text-[#ECE9E4]" data-testid="sim-query">{query}</div>
      {(!server || current) && <StrategyDiscoveryPanel key={name ?? 'local'} messageId={`dev-preview-${name ?? 'local'}`} query={query} requestedCount={current?.requestedCount ?? 5} />}
    </div>
  );
}
