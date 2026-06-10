import { SearchX, ArrowRight } from 'lucide-react';

interface Props {
  /** 'people' | 'jobs' | 'companies' | 'generic' */
  mode?: 'people' | 'jobs' | 'companies' | 'generic';
  location?: string | null;
  role?: string | null;
}

function send(text: string) {
  window.dispatchEvent(new CustomEvent('chat:send', { detail: text }));
}

export default function NoResultsCard({ mode = 'generic', location, role }: Props) {
  const suggestions: { label: string; reply: string }[] = [];
  if (role) suggestions.push({ label: `Broaden role beyond "${role}"`, reply: `Try a broader role than ${role}` });
  else suggestions.push({ label: 'Broaden the role', reply: 'Broaden the role and try again' });

  if (location) suggestions.push({ label: `Broaden location beyond "${location}"`, reply: `Try a broader location than ${location}` });
  else suggestions.push({ label: 'Broaden the location', reply: 'Broaden the location and try again' });

  suggestions.push({ label: 'Try related titles', reply: 'Try related titles for this search' });

  if (mode === 'people') {
    suggestions.push({ label: 'Switch to companies hiring', reply: 'Switch to companies hiring instead' });
  } else if (mode === 'jobs' || mode === 'companies') {
    suggestions.push({ label: 'Switch to individual profiles', reply: 'Switch to individual profiles instead' });
  }

  return (
    <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
      <div className="flex items-start gap-3">
        <div className="h-8 w-8 rounded-lg bg-white/[0.04] border border-white/[0.06] flex items-center justify-center shrink-0">
          <SearchX className="h-4 w-4 text-[#7D8590]" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-semibold text-[#F0F6FC]">No results found for this exact search.</div>
          <div className="mt-1 text-[12px] text-[#7D8590] leading-relaxed">
            Pilot can re-run with a different angle — pick one:
          </div>
          <div className="mt-3 grid sm:grid-cols-2 gap-1.5">
            {suggestions.map((s) => (
              <button
                key={s.label}
                onClick={() => send(s.reply)}
                className="group inline-flex items-center justify-between gap-2 text-[12px] px-3 py-2 rounded-md border border-white/[0.08] bg-white/[0.02] text-[#C9D1D9] hover:bg-emerald-500/[0.06] hover:border-emerald-500/30 hover:text-[#F0F6FC] transition-colors text-left"
              >
                <span className="truncate">{s.label}</span>
                <ArrowRight className="h-3 w-3 text-[#484F58] group-hover:text-emerald-300 shrink-0" />
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
