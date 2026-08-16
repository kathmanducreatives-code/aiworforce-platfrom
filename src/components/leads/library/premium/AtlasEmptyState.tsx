import { GlassPanel } from "./GlassPanel";
import atlasPortrait from "@/assets/atlas-portrait.webp";

export function AtlasEmptyState({ title, body }: { title: string; body: string }) {
  return (
    <GlassPanel raised className="mt-2">
      <div className="flex flex-col items-center justify-center gap-4 px-8 py-12 text-center">
        <div className="relative h-14 w-14 rounded-xl overflow-hidden ring-1 ring-white/10 shadow-[0_10px_40px_-15px_rgba(16,185,129,0.6)]">
          <img src={atlasPortrait} alt="Atlas" className="h-full w-full object-cover" />
        </div>
        <div className="max-w-md">
          <div className="text-[15px] font-semibold text-foreground">{title}</div>
          <p className="mt-1.5 text-[13px] text-muted-foreground">{body}</p>
          <p className="mt-3 text-[11px] uppercase tracking-[0.14em] text-primary/70">
            Atlas is standing by
          </p>
        </div>
      </div>
    </GlassPanel>
  );
}
