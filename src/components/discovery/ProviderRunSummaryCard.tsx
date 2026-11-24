// What each data provider contributed to one discovery run. Display only: every
// figure is the backend's `providerSummary` (src/lib/providerRunSummary.ts);
// nothing is counted or estimated here. Renders nothing without a valid summary.

import { AlertTriangle } from 'lucide-react';
import { conflictsLine, contributionRows, evidenceSourcesLine, readProviderRunSummary, totalsLine, usd } from '@/lib/providerRunSummary';

export function ProviderRunSummaryCard({ response }: { response: unknown }) {
  const s = readProviderRunSummary(response);
  if (!s) return null;
  const rows = contributionRows(s);
  const conflicts = conflictsLine(s);
  const evidence = evidenceSourcesLine(s);
  return (
    <div className="mt-2 rounded-lg border border-white/[0.07] bg-white/[0.02] px-3 py-2 text-[12px] text-[#A3A7AD]" data-testid="provider-run-summary">
      <div className="text-[#ECE9E4]">{totalsLine(s)}</div>
      <table className="mt-2 w-full text-left">
        <caption className="sr-only">Contribution by provider</caption>
        <thead className="text-[11px] text-[#6E7278]">
          <tr>
            <th scope="col" className="font-normal">Provider</th>
            <th scope="col" className="font-normal text-right">Found</th>
            <th scope="col" className="font-normal text-right">Only here</th>
            <th scope="col" className="font-normal text-right">Qualified</th>
            <th scope="col" className="font-normal text-right">Pending</th>
            <th scope="col" className="font-normal text-right">Rejected</th>
            <th scope="col" className="font-normal text-right">Spend</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.provider} className="tabular-nums">
              <th scope="row" className="font-medium text-[#ECE9E4]">{r.label}</th>
              <td className="text-right">{r.discovered}</td>
              <td className="text-right">{r.unique}</td>
              <td className="text-right">{r.qualified}</td>
              <td className="text-right">{r.pending}</td>
              <td className="text-right">{r.rejected}</td>
              <td className="text-right">{r.spend}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {s.totals.costPerQualifiedUsd !== null && (
        <div className="mt-1.5 text-[11px] text-[#6E7278]">{usd(s.totals.costPerQualifiedUsd)} Apify per qualified company</div>
      )}
      {evidence && <div className="mt-1 text-[11px] text-[#6E7278]">{evidence}</div>}
      {conflicts && <div className="mt-1 text-[11px] text-[#8B8F96]">{conflicts}</div>}
      {s.evidenceRefused > 0 && (
        <div className="mt-1 text-[11px] text-[#8B8F96]">{s.evidenceRefused} evidence item{s.evidenceRefused === 1 ? '' : 's'} refused: it named a different company</div>
      )}
      {rows.flatMap((r) => r.failures.map((f) => (
        <div key={`${r.provider}-${f}`} className="mt-1 flex items-center gap-1.5 text-[11px] text-amber-300/90">
          <AlertTriangle className="h-3 w-3 shrink-0" aria-hidden /> {r.label} — {f}
        </div>
      )))}
      {rows.flatMap((r) => r.partial.map((f) => (
        <div key={`${r.provider}-p-${f}`} className="mt-1 text-[11px] text-[#6E7278]">{r.label} — {f}</div>
      )))}
    </div>
  );
}
