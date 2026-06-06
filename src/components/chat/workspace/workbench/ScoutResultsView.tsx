import { ExternalLink, Building2, MapPin, User } from 'lucide-react';
import { normalizeApifyItems, normalizeApifyPeople, isPeopleOutput } from './normalize';
import RawJsonView from './RawJsonView';

export default function ScoutResultsView({ output }: { output: any }) {
  const peopleMode = isPeopleOutput(output);
  const items = peopleMode ? [] : normalizeApifyItems(output);
  const people = peopleMode ? normalizeApifyPeople(output) : [];
  const actorDisabledTop = output?.error === 'actor_missing' || output?.error === 'actor_key_unknown' || output?.error === 'apify_actor_disabled_by_default';

  if (items.length === 0 && people.length === 0 && !actorDisabledTop) {
    return (
      <div className="space-y-3">
        <div className="text-[12px] text-[#7D8590]">No normalized items detected.</div>
        <RawJsonView data={output} defaultOpen />
      </div>
    );
  }

  const total = typeof output?.total === 'number' ? output.total : items.length;
  const runId = typeof output?.run_id === 'string' ? output.run_id : null;
  const actorId = output?.actor_id ?? null;
  const actorLabel: string | null = output?.actor_label ?? null;
  const actorKey: string | null = output?.selected_actor_key ?? output?.actor_key ?? null;
  const outputType: string | null = output?.actor_output_type ?? null;
  const actorDisabled = output?.error === 'actor_missing' || output?.error === 'actor_key_unknown' || output?.error === 'apify_actor_disabled_by_default';
  const missingMessage: string | null = output?.reason ?? output?.message ?? null;

  return (
    <div className="space-y-3">
      {(actorLabel || actorKey || actorId) && (
        <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-3 py-2 text-[11px] text-[#C9D1D9]">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-emerald-300 font-medium">Actor:</span>
            <span>{actorLabel ?? actorKey ?? actorId}</span>
            {actorId && <span className="font-mono text-[#7D8590]">({actorId})</span>}
            <span className={`ml-auto text-[10px] px-1.5 py-0.5 rounded border ${actorDisabled ? 'border-amber-500/30 bg-amber-500/10 text-amber-300' : 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'}`}>
              {actorDisabled ? 'disabled' : 'enabled'}
            </span>
          </div>
          {outputType && <div className="text-[#7D8590] mt-0.5">Output: {outputType}</div>}
          {actorDisabled && missingMessage && (
            <div className="mt-1 text-amber-300/90">Configuration: {missingMessage}</div>
          )}
        </div>
      )}
      <div className="flex items-center gap-2 text-[11px] text-[#7D8590] flex-wrap">
        <span className="px-2 py-0.5 rounded-md border border-emerald-500/20 bg-emerald-500/10 text-emerald-300">
          {total} result{total === 1 ? '' : 's'}
        </span>
        {actorKey && <span>key: <span className="text-[#C9D1D9] font-mono">{actorKey}</span></span>}
        {runId && <span>run: <span className="text-[#C9D1D9] font-mono">{runId.slice(-8)}</span></span>}
      </div>


      <ul className="space-y-2">
        {items.map((it, i) => (
          <li
            key={i}
            className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-3 hover:bg-white/[0.04] transition-colors"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="text-[13px] text-[#F0F6FC] font-medium truncate">
                  {it.title ?? 'Untitled'}
                </div>
                <div className="mt-0.5 flex items-center gap-3 text-[11px] text-[#7D8590] flex-wrap">
                  {it.company && (
                    <span className="inline-flex items-center gap-1">
                      <Building2 className="h-3 w-3" /> {it.company}
                    </span>
                  )}
                  {it.location && (
                    <span className="inline-flex items-center gap-1">
                      <MapPin className="h-3 w-3" /> {it.location}
                    </span>
                  )}
                  {it.postedAt && <span>{it.postedAt}</span>}
                  {it.source && <span className="font-mono">{it.source}</span>}
                </div>
                {it.description && (
                  <div className="mt-1.5 text-[12px] text-[#C9D1D9] line-clamp-2">
                    {it.description}
                  </div>
                )}
              </div>
              <div className="flex flex-col gap-1 shrink-0">
                {it.url && (
                  <a
                    href={it.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-[11px] text-emerald-300 hover:text-emerald-200"
                  >
                    Job <ExternalLink className="h-3 w-3" />
                  </a>
                )}
                {it.companyUrl && (
                  <a
                    href={it.companyUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-[11px] text-[#7D8590] hover:text-[#C9D1D9]"
                  >
                    Company <ExternalLink className="h-3 w-3" />
                  </a>
                )}
              </div>
            </div>
          </li>
        ))}
      </ul>

      <RawJsonView data={output} />
    </div>
  );
}
