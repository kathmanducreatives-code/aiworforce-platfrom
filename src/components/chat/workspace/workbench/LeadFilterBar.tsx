// THE FILTER + EXPORT ROW.
//
// Lightweight by intent. The Lead Library's toolbar (the surface this ports
// from) uses shadcn `Select` popovers and a two-row layout; this panel is
// narrower, already dark, and uses raw chips everywhere else, so the controls
// here are native selects and buttons wearing the panel's own chrome. Same
// model, same affordances, no new design language and no settings panel.
//
// Presentational only. It reads nothing and writes nothing — the filters live
// in `LeadResultsView`, and every control reports upward.

import { Filter, X, Download, ChevronDown } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import {
  SIZE_BANDS, HIRING_LABEL, CONTACT_LABEL, filterChips, activeFilterCount,
  clearFilterKey, EMPTY_WORKBENCH_FILTERS,
  type WorkbenchFilters, type FilterOptions,
} from '@/lib/workbench/leadFilters';
import { EXPORT_SCOPE_LABEL, EXPORT_SCOPE_HINT, type ExportScope } from '@/lib/workbench/leadExport';

interface Props {
  filters: WorkbenchFilters;
  onFilters: (f: WorkbenchFilters) => void;
  options: FilterOptions;
  /** Rows showing now. */
  shown: number;
  /** Rows on this tab before filtering. */
  total: number;
  /** Qualified rows in the whole run — the second export scope's size. */
  qualifiedTotal: number;
  onExport: (scope: ExportScope) => void;
  /** The existing ~110-column audit export, kept and kept separate. */
  onExportDiagnostic: () => void;
}

const SELECT_CLASS =
  'h-7 rounded-md border border-white/[0.08] bg-white/[0.02] px-2 text-[12.5px] ' +
  'text-[#8b949e] hover:text-[#C9D1D9] focus:outline-none focus:border-emerald-500/40 ' +
  'max-w-[170px] truncate';

function Choice({ value, onChange, label, options, title }: {
  value: string;
  onChange: (v: string) => void;
  label: string;
  options: ReadonlyArray<readonly [string, string]>;
  title: string;
}) {
  // A menu with one option filters nothing; a menu with none is a dead control.
  if (options.length === 0) return null;
  const active = value !== 'any';
  return (
    <select
      aria-label={title}
      title={title}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={`${SELECT_CLASS} ${active ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300' : ''}`}
    >
      <option value="any">{label}</option>
      {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
    </select>
  );
}

export default function LeadFilterBar({
  filters, onFilters, options, shown, total, qualifiedTotal, onExport, onExportDiagnostic,
}: Props) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const active = activeFilterCount(filters);
  const chips = filterChips(filters);
  const set = <K extends keyof WorkbenchFilters>(k: K, v: WorkbenchFilters[K]) =>
    onFilters({ ...filters, [k]: v });

  // Clicking anywhere else closes the export menu. Without this it survives a
  // tab change and hangs over a table it no longer describes.
  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenuOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);

  const fire = (scope: ExportScope) => { setMenuOpen(false); onExport(scope); };

  return (
    <div className="px-7 py-2 shrink-0 space-y-1.5">
      <div className="flex items-center gap-1.5 flex-wrap text-[12.5px]">
        <Filter className="h-3.5 w-3.5 text-[#6e7681] shrink-0" />

        <input
          value={filters.q}
          onChange={(e) => set('q', e.target.value)}
          placeholder="Search company, location, signal…"
          aria-label="Search leads"
          className="h-7 min-w-[160px] flex-1 max-w-[260px] rounded-md border border-white/[0.08] bg-white/[0.02] px-2 text-[12.5px] text-[#C9D1D9] placeholder:text-[#6e7681] focus:outline-none focus:border-emerald-500/40"
        />

        <Choice
          title="Location" label="Any location" value={filters.location}
          onChange={(v) => set('location', v)}
          options={options.locations.map((l) => [l, l] as const)}
        />
        <Choice
          title="Company size" label="Any size" value={filters.size}
          onChange={(v) => set('size', v as WorkbenchFilters['size'])}
          options={SIZE_BANDS.map((b) => [b.id, b.label] as const)}
        />
        <Choice
          title="Industry" label="Any industry" value={filters.industry}
          onChange={(v) => set('industry', v)}
          options={options.industries.map((i) => [i, i] as const)}
        />
        <Choice
          title="Hiring signal" label={HIRING_LABEL.any} value={filters.hiring}
          onChange={(v) => set('hiring', v as WorkbenchFilters['hiring'])}
          options={[['has_signal', HIRING_LABEL.has_signal], ['no_signal', HIRING_LABEL.no_signal]]}
        />
        <Choice
          title="Contact" label={CONTACT_LABEL.any} value={filters.contact}
          onChange={(v) => set('contact', v as WorkbenchFilters['contact'])}
          options={[['ready', CONTACT_LABEL.ready], ['needed', CONTACT_LABEL.needed]]}
        />
        <Choice
          title="Source" label="Any source" value={filters.source}
          onChange={(v) => set('source', v)}
          options={options.sources.map((s) => [s, s] as const)}
        />

        {/* The two controls that were already here, unchanged in behaviour. */}
        <button
          onClick={() => set('hasWebsite', !filters.hasWebsite)}
          aria-pressed={filters.hasWebsite}
          className={`px-2.5 py-1 rounded-md border transition-colors ${filters.hasWebsite ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300' : 'border-white/[0.08] bg-white/[0.02] text-[#8b949e] hover:text-[#C9D1D9]'}`}
        >
          Has website
        </button>
        {[60, 75, 90].map((v) => (
          <button
            key={v}
            onClick={() => set('minFit', filters.minFit === v ? 0 : v)}
            aria-pressed={filters.minFit === v}
            className={`px-2.5 py-1 rounded-md border transition-colors ${filters.minFit === v ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300' : 'border-white/[0.08] bg-white/[0.02] text-[#8b949e] hover:text-[#C9D1D9]'}`}
          >
            Fit {v}+
          </button>
        ))}

        <div className="ml-auto flex items-center gap-2">
          <span className="text-[12.5px] text-[#6e7681] tabular-nums whitespace-nowrap">
            {active > 0 ? `${shown} of ${total}` : `${total}`}
          </span>

          {active > 0 && (
            <button
              onClick={() => onFilters({ ...EMPTY_WORKBENCH_FILTERS })}
              className="inline-flex items-center gap-1 px-2 py-1 rounded-md border border-white/[0.08] bg-white/[0.02] text-[#8b949e] hover:text-[#C9D1D9] transition-colors"
            >
              <X className="h-3 w-3" />
              Clear filters
              <span className="tabular-nums text-emerald-300">{active}</span>
            </button>
          )}

          {/* EXPORT IS ALWAYS REACHABLE. It stopped being so in 2ba36cfc, when
              the action bar it lived in became selection-gated. */}
          <div className="relative" ref={menuRef}>
            <button
              onClick={() => setMenuOpen((v) => !v)}
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md border border-white/[0.08] bg-white/[0.02] text-[#8b949e] hover:text-[#C9D1D9] transition-colors"
            >
              <Download className="h-3 w-3" />
              Export
              <ChevronDown className="h-3 w-3" />
            </button>
            {menuOpen && (
              <div
                role="menu"
                className="absolute right-0 top-[calc(100%+4px)] z-30 w-[290px] rounded-lg border border-white/[0.08] bg-[#0d1117] shadow-xl shadow-black/40 py-1"
              >
                {(['current_view', 'qualified'] as ExportScope[]).map((scope) => (
                  <button
                    key={scope}
                    role="menuitem"
                    onClick={() => fire(scope)}
                    className="w-full text-left px-3 py-2 hover:bg-white/[0.04] transition-colors"
                  >
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="text-[12.5px] text-[#C9D1D9]">{EXPORT_SCOPE_LABEL[scope]}</span>
                      <span className="text-[11.5px] tabular-nums text-emerald-300">
                        {scope === 'qualified' ? qualifiedTotal : shown}
                      </span>
                    </div>
                    <div className="text-[11.5px] text-[#6e7681] leading-snug mt-0.5">
                      {EXPORT_SCOPE_HINT[scope]}
                    </div>
                  </button>
                ))}
                <div className="my-1 h-px bg-white/[0.06]" />
                <button
                  role="menuitem"
                  onClick={() => { setMenuOpen(false); onExportDiagnostic(); }}
                  className="w-full text-left px-3 py-2 hover:bg-white/[0.04] transition-colors"
                >
                  <span className="text-[12.5px] text-[#C9D1D9]">Export full run diagnostics</span>
                  <div className="text-[11.5px] text-[#6e7681] leading-snug mt-0.5">
                    Every engine field, for auditing a run. Not for sharing.
                  </div>
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {chips.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          {chips.map((c) => (
            <button
              key={c.key}
              onClick={() => onFilters(clearFilterKey(filters, c.key))}
              title={`Remove ${c.label}`}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full border border-emerald-500/30 bg-emerald-500/[0.08] text-[11.5px] text-emerald-200 hover:bg-emerald-500/[0.14] transition-colors"
            >
              {c.label}
              <X className="h-2.5 w-2.5" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
