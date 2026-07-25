import { GlassPanel } from "./GlassPanel";

export function PremiumSkeleton({ rows = 8 }: { rows?: number }) {
  return (
    <GlassPanel className="mt-2">
      <div className="px-4 py-3 border-b border-white/[0.05] flex items-center gap-3">
        <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
        <span className="text-[12px] text-muted-foreground">
          Atlas is reviewing leads…
        </span>
      </div>
      <div className="divide-y divide-white/[0.04]">
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="flex items-center gap-3 px-4 py-3">
            <div className="h-3 w-3 rounded-sm bg-white/5" />
            <div className="h-3 w-[22%] rounded bg-gradient-to-r from-white/5 via-white/10 to-white/5 animate-pulse" />
            <div className="h-3 w-[18%] rounded bg-white/5 animate-pulse" />
            <div className="h-3 w-[10%] rounded bg-white/5 animate-pulse" />
            <div className="h-3 w-[14%] rounded bg-white/5 animate-pulse" />
            <div className="h-3 w-[16%] rounded bg-white/5 animate-pulse" />
            <div className="ml-auto h-3 w-[8%] rounded bg-white/5 animate-pulse" />
          </div>
        ))}
      </div>
    </GlassPanel>
  );
}
