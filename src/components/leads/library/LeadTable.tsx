import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import { ExternalLink, ArrowRight, Check } from "lucide-react";
import type { LeadRow } from "@/lib/leadLibrary/types";
import { fitToneFor, fitShortLabel, relativeTime } from "@/lib/leadLibrary/labels";
import {
  deriveLeadDecisionState,
  decisionLabel,
  decisionTone,
  nextActionLabel as nextActionText,
  type LeadDecisionState,
} from "@/lib/leadLibrary/leadDecisionState";

interface Props {
  rows: LeadRow[];
  selected: Set<string>;
  onToggle: (id: string) => void;
  onToggleAll: (all: boolean) => void;
  onOpen: (id: string) => void;
}

// Column widths sum to 100%. Opener excerpt REMOVED — it now lives in the drawer.
const COLS = [
  { key: "chk",     cls: "w-8" },
  { key: "account", cls: "w-[20%]" },
  { key: "whynow",  cls: "w-[22%] hidden md:table-cell" },
  { key: "fit",     cls: "w-[8%]" },
  { key: "buyer",   cls: "w-[16%] hidden lg:table-cell" },
  { key: "decision",cls: "w-[10%]" },
  { key: "action",  cls: "w-[14%]" },
  { key: "updated", cls: "w-[8%] hidden lg:table-cell text-right" },
];

export function LeadTable({ rows, selected, onToggle, onToggleAll, onOpen }: Props) {
  const allSelected = rows.length > 0 && rows.every((r) => selected.has(r.id));
  return (
    <div className="flex-1 min-h-0 overflow-auto">
      <table className="w-full table-fixed text-sm">
        <colgroup>{COLS.map((c) => <col key={c.key} className={c.cls} />)}</colgroup>
        <thead className="text-[10.5px] uppercase tracking-[0.14em] text-muted-foreground bg-black/30 sticky top-0 z-10 backdrop-blur">
          <tr className="border-b border-white/[0.05]">
            <th className="px-3 h-10 text-left">
              <Checkbox checked={allSelected} onCheckedChange={(v) => onToggleAll(!!v)} />
            </th>
            <Th>Account</Th>
            <Th className="hidden md:table-cell">Why now</Th>
            <Th>Fit</Th>
            <Th className="hidden lg:table-cell">Recommended buyer</Th>
            <Th>Decision</Th>
            <Th>Next action</Th>
            <Th className="hidden lg:table-cell text-right pr-4">Updated</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <Row
              key={r.id}
              r={r}
              state={deriveLeadDecisionState(r)}
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

function Row({ r, state, selected, onToggle, onOpen }: {
  r: LeadRow; state: LeadDecisionState; selected: boolean; onToggle: () => void; onOpen: () => void;
}) {
  const fitTone = fitToneFor(r.fitScore);
  const dTone = decisionTone(state.decision);

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
        <Checkbox checked={selected} onCheckedChange={onToggle} className="opacity-70 hover:opacity-100" />
      </td>

      {/* Account */}
      <td className="px-3 py-2.5 align-middle min-w-0">
        <div className="flex items-center gap-2 min-w-0">
          <div className="h-7 w-7 shrink-0 rounded-md bg-white/[0.04] border border-white/[0.06] flex items-center justify-center text-[11px] font-semibold text-foreground/80">
            {r.name.slice(0, 1).toUpperCase()}
          </div>
          <div className="min-w-0">
            <div className="text-[13px] font-medium text-foreground truncate" title={r.name}>{r.name}</div>
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

      {/* Why now */}
      <td className="px-3 py-2.5 align-middle hidden md:table-cell min-w-0">
        <div className="text-[12.5px] text-foreground/90 line-clamp-2" title={state.whyNowSummary}>
          {state.whyNowSummary}
        </div>
        {r.sources.length > 1 && (
          <div className="text-[10.5px] text-muted-foreground mt-0.5">+{r.sources.length - 1} more</div>
        )}
      </td>

      {/* Fit */}
      <td className="px-3 py-2.5 align-middle" title={fitShortLabel(r.fitScore)}>
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

      {/* Recommended buyer */}
      <td className="px-3 py-2.5 align-middle hidden lg:table-cell min-w-0">
        {r.selectedRecipient ? (
          <div className="min-w-0">
            <div className="text-[12.5px] text-foreground truncate" title={r.selectedRecipient.fullName ?? undefined}>
              {r.selectedRecipient.fullName ?? "Unknown"}
            </div>
            <div className="text-[11px] text-muted-foreground truncate" title={r.selectedRecipient.title ?? undefined}>
              {r.selectedRecipient.title ?? "—"}
              {r.selectedRecipient.verified && <span className="text-primary/80 ml-1.5">· Verified</span>}
            </div>
          </div>
        ) : (
          <span className="text-[11.5px] text-muted-foreground">
            {state.buyerState === "needs_review" ? "Buyer needs review" : "Buyer needed"}
          </span>
        )}
      </td>

      {/* Decision */}
      <td className="px-3 py-2.5 align-middle">
        <span
          className={cn(
            "inline-flex items-center rounded-md border px-2 py-1 text-[11px] font-semibold uppercase tracking-wide",
            dTone === "success" && "border-emerald-400/40 bg-emerald-400/10 text-emerald-200",
            dTone === "warning" && "border-amber-400/40 bg-amber-400/10 text-amber-200",
            dTone === "muted" && "border-white/[0.12] bg-white/[0.04] text-foreground/80",
            dTone === "danger" && "border-rose-400/40 bg-rose-400/10 text-rose-200",
          )}
          title={state.priorityReason}
        >
          {decisionLabel(state.decision)}
        </span>
      </td>

      {/* Next action */}
      <td className="px-3 py-2.5 align-middle">
        <button
          onClick={(e) => { e.stopPropagation(); onOpen(); }}
          className="inline-flex items-center gap-1 h-7 px-2.5 rounded-md text-[11.5px] font-medium text-primary bg-primary/[0.08] border border-primary/25 hover:bg-primary/[0.14] transition-colors max-w-full"
        >
          {state.nextAction === "monitor" || state.nextAction === "none" ? (
            <Check className="h-3 w-3 shrink-0" />
          ) : (
            <ArrowRight className="h-3 w-3 shrink-0" />
          )}
          <span className="truncate">{nextActionText(state.nextAction)}</span>
        </button>
      </td>

      {/* Updated */}
      <td className="px-3 py-2.5 align-middle hidden lg:table-cell text-right pr-4">
        <span
          className="text-[11.5px] text-muted-foreground tabular-nums"
          title={new Date(r.lastActivity?.at ?? r.updatedAt).toLocaleString()}
        >
          {relativeTime(r.lastActivity?.at ?? r.updatedAt)}
        </span>
      </td>
    </tr>
  );
}
