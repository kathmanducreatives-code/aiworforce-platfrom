import { ExternalLink, Building2, MapPin, User, Bookmark, Sparkles, Send } from 'lucide-react';
import { toast } from 'sonner';
import { normalizeApifyItems, normalizeApifyPeople, isPeopleOutput, isLinkedinEngagementOutput, normalizeLinkedinEngagement } from './normalize';
import RawJsonView from './RawJsonView';

function sendToPilot(text: string) {
  window.dispatchEvent(new CustomEvent('chat:send', { detail: text }));
  toast.success('Sent to Pilot');
}

function ActionRow({ items }: { items: { label: string; icon: any; onClick: () => void }[] }) {
  if (items.length === 0) return null;
  return (
    <div className="mt-2 flex items-center gap-1.5 flex-wrap">
      {items.map((a) => {
        const Icon = a.icon;
        return (
          <button
            key={a.label}
            onClick={a.onClick}
            className="inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-md border border-white/[0.08] bg-white/[0.02] text-[#C9D1D9] hover:bg-emerald-500/[0.06] hover:border-emerald-500/30 hover:text-[#F0F6FC] transition-colors"
          >
            <Icon className="h-3 w-3" /> {a.label}
          </button>
        );
      })}
    </div>
  );
}

function LinkedinEngagementView({ output }: { output: any }) {
  const items = normalizeLinkedinEngagement(output);
  const total = typeof output?.total === 'number' ? output.total : items.length;
  if (items.length === 0) {
    return (
      <div className="space-y-3">
        <div className="text-[12px] text-[#7D8590]">No LinkedIn engagement items detected.</div>
        <RawJsonView data={output} defaultOpen />
      </div>
    );
  }
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-[11px] text-[#7D8590] flex-wrap">
        <span className="px-2 py-0.5 rounded-md border border-sky-500/20 bg-sky-500/10 text-sky-300">
          {total} LinkedIn signal{total === 1 ? '' : 's'}
        </span>
      </div>
      <ul className="space-y-2">
        {items.map((it, i) => {
          const who = it.post_author_name ?? it.commenter_name ?? 'LinkedIn user';
          const profile = it.post_author_profile_url ?? it.commenter_profile_url;
          const meta = [it.post_author_title, it.post_author_company].filter(Boolean).join(' · ');
          return (
            <li key={i} className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 text-[13px] text-[#F0F6FC] font-medium flex-wrap">
                    <User className="h-3.5 w-3.5 text-sky-300" /> {who}
                    {it.engagement_type && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded border border-sky-500/30 bg-sky-500/10 text-sky-300">{it.engagement_type}</span>
                    )}
                    {it.competitor_name && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded border border-amber-500/30 bg-amber-500/10 text-amber-300" title={(it.matched_terms ?? []).join(', ')}>
                        competitor: {it.competitor_name}
                      </span>
                    )}
                  </div>
                  {meta && <div className="text-[11px] text-[#7D8590] mt-0.5">{meta}</div>}
                  {it.post_text && <div className="text-[12px] text-[#C9D1D9] mt-1.5 line-clamp-3">{it.post_text}</div>}
                  {it.signal_reason && (
                    <div className="text-[11px] text-emerald-300/90 mt-1 flex items-center gap-1">
                      <Sparkles className="h-3 w-3" /> {it.signal_reason}
                    </div>
                  )}
                  <div className="mt-2 flex items-center gap-3 text-[11px]">
                    {it.post_url && (
                      <a href={it.post_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sky-300 hover:underline">
                        <ExternalLink className="h-3 w-3" /> Post
                      </a>
                    )}
                    {profile && (
                      <a href={profile} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sky-300 hover:underline">
                        <User className="h-3 w-3" /> Profile
                      </a>
                    )}
                    {it.topic && <span className="text-[#7D8590]">topic: {it.topic}</span>}
                  </div>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
      <RawJsonView data={output} />
    </div>
  );
}

export default function ScoutResultsView({ output }: { output: any }) {
  if (isLinkedinEngagementOutput(output)) return <LinkedinEngagementView output={output} />;
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

  const total = typeof output?.total === 'number' ? output.total : (peopleMode ? people.length : items.length);
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


      {peopleMode ? (
        <ul className="space-y-2">
          {people.map((p, i) => (
            <li
              key={i}
              className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-3 hover:bg-white/[0.04] transition-colors"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="text-[13px] text-[#F0F6FC] font-medium truncate inline-flex items-center gap-1.5">
                    <User className="h-3.5 w-3.5 text-emerald-300" />
                    {p.full_name ?? 'Unknown person'}
                  </div>
                  {(p.title || p.headline) && (
                    <div className="mt-0.5 text-[12px] text-[#C9D1D9] truncate">
                      {p.title ?? p.headline}
                    </div>
                  )}
                  <div className="mt-0.5 flex items-center gap-3 text-[11px] text-[#7D8590] flex-wrap">
                    {p.company && (
                      <span className="inline-flex items-center gap-1">
                        <Building2 className="h-3 w-3" /> {p.company}
                      </span>
                    )}
                    {p.location && (
                      <span className="inline-flex items-center gap-1">
                        <MapPin className="h-3 w-3" /> {p.location}
                      </span>
                    )}
                    {p.source && <span className="font-mono">{p.source}</span>}
                  </div>
                  {p.summary && (
                    <div className="mt-1.5 text-[12px] text-[#C9D1D9] line-clamp-2">
                      {p.summary}
                    </div>
                  )}
                </div>
                {p.profile_url && (
                  <a
                    href={p.profile_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-[11px] text-emerald-300 hover:text-emerald-200 shrink-0"
                  >
                    Profile <ExternalLink className="h-3 w-3" />
                  </a>
                )}
              </div>
              <ActionRow
                items={[
                  { label: 'Save Profile', icon: Bookmark, onClick: () => sendToPilot(`Save ${p.full_name ?? 'this profile'}${p.company ? ` at ${p.company}` : ''} as a lead`) },
                  { label: 'Rank', icon: Sparkles, onClick: () => sendToPilot(`Have Aria rank ${p.full_name ?? 'this profile'}${p.company ? ` at ${p.company}` : ''}`) },
                  { label: 'Draft Outreach', icon: Send, onClick: () => sendToPilot(`Draft outreach for ${p.full_name ?? 'this profile'}${p.company ? ` at ${p.company}` : ''}`) },
                ]}
              />
            </li>
          ))}
        </ul>
      ) : (
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
              <ActionRow
                items={[
                  { label: 'Save Lead', icon: Bookmark, onClick: () => sendToPilot(`Save ${it.company ?? it.title ?? 'this'} as a lead`) },
                  { label: 'Enrich', icon: Sparkles, onClick: () => sendToPilot(`Enrich ${it.company ?? it.title ?? 'this company'}${it.companyUrl ? ` (${it.companyUrl})` : ''}`) },
                  { label: 'Draft Outreach', icon: Send, onClick: () => sendToPilot(`Draft outreach for ${it.company ?? it.title}${it.title && it.company ? ` about the ${it.title} role` : ''}`) },
                ]}
              />
            </li>
          ))}
        </ul>
      )}

      <RawJsonView data={output} />
    </div>
  );
}
