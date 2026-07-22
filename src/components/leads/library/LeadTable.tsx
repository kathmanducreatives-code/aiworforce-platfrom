import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import { StatusPill } from "./StatusPill";
import { ExternalLink, ArrowRight, Check } from "lucide-react";
import type { LeadRow } from "@/lib/leadLibrary/types";
import {
  signalLabel,
  fitToneFor,
  fitShortLabel,
  readinessState,
  nextActionLabel,
  openerStatusLabel,
  relativeTime,
} from "@/lib/leadLibrary/labels";

interface Props {
  rows: LeadRow[];
  selected: Set<string>;
  onToggle: (id: string) => void;
  onToggleAll: (all: boolean) => void;
  onOpen: (id: string) => void;
}

// Column widths sum to 100%.
const COLS = [
  { key: "chk",       cls: "w-8" },
  { key: "lead",      cls: "w-[17%]" },
  { key: "signal",    cls: "w-[15%] hidden lg:table-cell" },
  { key: "fit",       cls: "w-[9%]" },
  { key: "buyer",     cls: "w-[15%] hidden md:table-cell" },
  { key: "ready",     cls: "w-[13%]" },
  { key: "opener",    cls: "w-[17%] hidden xl:table-cell" },
  { key: "action",    cls: "w-[10%]" },
  { key: "updated",   cls: "w-[8%] hidden lg:table-cell" },
];

export function LeadTable({ rows, selected, onToggle, onToggleAll, onOpen }: Props) {
  const allSelected = rows.length > 0 && rows.every((r) => selected.has(r.id));
  return (
    <div className="flex-1 min-h-0 overflow-auto">
      <table className="w-full table-fixed text-sm">
        <colgroup>
          {COLS.map((c) => <col key={c.key} className={c.cls} />)}
        </colgroup>
        <thead className="text-[10.5px] uppercase tracking-[0.14em] text-muted-foreground bg-black/30 sticky top-0 z-10 backdrop-blur">
          <tr className="border-b border-white/[0.05]">
            <th className="px-3 h-10 text-left">
              <Checkbox checked={allSelected} onCheckedChange={(v) => onToggleAll(!!v)} />
            </th>
            <Th>Lead</Th>
            <Th className="hidden lg:table-cell">Signal</Th>
            <Th>Fit</Th>
            <Th className="hidden md:table-cell">Buyer</Th>
            <Th>Readiness</Th>
            <Th className="hidden xl:table-cell">Opener</Th>
            <Th>Next action</Th>
            <Th className="hidden lg:table-cell text-right pr-4">Updated</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <Row
              key={r.id}
              r={r}
              selected={selected.has(r.id)}
              onToggle={() => onToggle(r.id)}
              onOpen={() => onOpen(r.id)}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Th({ children, className }: { children: React.ReactNode; className?: string }) {
  return <th className={cn("px-3 h-10 text-left font-semibold whitespace-nowrap", className)}>{children}</th>;
}

function Row({ r, selected, onToggle, onOpen }: {
  r: LeadRow; selected: boolean; onToggle: () => void; onOpen: () => void;
}) {
  const sig = signalLabel(r);
  const ready = readinessState(r);
  const fitTone = fitToneFor(r.fitScore);
  const opener = openerStatusLabel(r);
  const action = nextActionLabel(r);

  return (
    <tr
      onClick={onOpen}
      className={cn(
        "border-b border-white/[0.03] cursor-pointer transition-colors",
        "hover:bg-white/[0.025]",
        selected && "bg-[linear-gradient(90deg,rgba(16,185,129,0.06),transparent_70%)] shadow-[inset_2px_0_0_rgba(16,185,129,0.8)]",
      )}
    >
      <td className="px-3 py-2.5 align-middle" onClick={(e) => e.stopPropagation()}>
        <Checkbox checked={selected} onCheckedChange={onToggle} />
      </td>

      {/* Lead */}
      <td className="px-3 py-2.5 align-middle min-w-0">
        <div className="flex items-center gap-2 min-w-0">
          <div className="h-7 w-7 shrink-0 rounded-md bg-white/[0.04] border border-white/[0.06] flex items-center justify-center text-[11px] font-semibold text-foreground/80">
            {r.name.slice(0, 1).toUpperCase()}
          </div>
          <div className="min-w-0">
            <div className="text-[13px] font-medium text-foreground truncate">{r.name}</div>
            {r.domain && (
              <div className="text-[11px] text-muted-foreground truncate flex items-center gap-1">
                <span className="truncate">{r.domain}</span>
                {r.websiteUrl && (
                  <a
                    href={r.websiteUrl}
                    target="_blank"
                    rel="noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    className="text-muted-foreground/70 hover:text-primary shrink-0"
                    aria-label="Open website"
                  >
                    <ExternalLink className="h-3 w-3" />
                  </a>
                )}
              </div>
            )}
          </div>
        </div>
      </td>

      {/* Signal */}
      <td className="px-3 py-2.5 align-middle hidden lg:table-cell min-w-0">
        <div className="text-[12px] text-foreground truncate">{sig.label}</div>
        {sig.sub && <div className="text-[11px] text-muted-foreground truncate">{sig.sub}</div>}
      </td>

      {/* Fit */}
      <td className="px-3 py-2.5 align-middle">
        <div className="flex items-baseline gap-1.5">
          <span
            className={cn(
              "text-[15px] font-semibold tabular-nums leading-none",
              fitTone === "success" && "text-primary",
              fitTone === "warning" && "text-amber-300",
              fitTone === "danger" && "text-rose-300",
              fitTone === "muted" && "text-muted-foreground",
            )}
          >
            {r.fitScore ?? "—"}
          </span>
        </div>
        <div className="text-[10.5px] text-muted-foreground mt-0.5 truncate">{fitShortLabel(r.fitScore)}</div>
      </td>

      {/* Buyer */}
      <td className="px-3 py-2.5 align-middle hidden md:table-cell min-w-0">
        {r.selectedRecipient ? (
          <div className="min-w-0">
            <div className="text-[12.5px] text-foreground truncate">{r.selectedRecipient.fullName ?? "Unknown"}</div>
            <div className="text-[11px] text-muted-foreground truncate">
              {r.selectedRecipient.title ?? "—"}
              {r.selectedRecipient.verified && <span className="text-primary/80 ml-1.5">· Verified</span>}
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <span className="text-[11.5px] text-muted-foreground">No verified buyer</span>
          </div>
        )}
      </td>

      {/* Readiness */}
      <td className="px-3 py-2.5 align-middle">
        <div className="text-[12px] text-foreground truncate">{ready.label}</div>
        <div className="mt-1 flex items-center gap-1">
          {ready.steps.map((ok, i) => (
            <span
              key={i}
              className={cn(
                "h-1.5 w-5 rounded-full",
                ok ? "bg-primary/80" : "bg-white/[0.08]",
              )}
            />
          ))}
        </div>
      </td>

      {/* Opener */}
      <td className="px-3 py-2.5 align-middle hidden xl:table-cell min-w-0">
        {r.opener?.bodyPreview ? (
          <div className="min-w-0">
            <div className="text-[12px] text-foreground line-clamp-2">{r.opener.bodyPreview}</div>
            <div className="mt-0.5">
              <StatusPill label={opener.label} tone={opener.tone === "success" ? "success" : opener.tone === "warning" ? "warning" : "muted"} />
            </div>
          </div>
        ) : (
          <span className="text-[11.5px] text-muted-foreground">Not prepared</span>
        )}
      </td>

      {/* Next action */}
      <td className="px-3 py-2.5 align-middle">
        <button
          onClick={(e) => { e.stopPropagation(); onOpen(); }}
          className="inline-flex items-center gap-1 h-7 px-2.5 rounded-md text-[11.5px] font-medium text-primary bg-primary/[0.08] border border-primary/25 hover:bg-primary/[0.14] transition-colors"
        >
          {action === "Skip" ? <Check className="h-3 w-3" /> : <ArrowRight className="h-3 w-3" />}
          <span className="truncate">{action}</span>
        </button>
      </td>

      {/* Updated */}
      <td className="px-3 py-2.5 align-middle hidden lg:table-cell text-right pr-4">
        <span className="text-[11.5px] text-muted-foreground tabular-nums">
          {relativeTime(r.lastActivity?.at ?? r.updatedAt)}
        </span>
      </td>
    </tr>
  );
}
