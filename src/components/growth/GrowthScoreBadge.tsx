import { Flame } from "lucide-react";
import { cn } from "@/lib/utils";

interface GrowthScoreBadgeProps {
  score: number;
  isHotLead: boolean;
}

const GrowthScoreBadge = ({ score, isHotLead }: GrowthScoreBadgeProps) => {
  const color = score >= 70
    ? "text-emerald-400 border-emerald-500/30 bg-emerald-500/10"
    : score >= 40
    ? "text-amber-400 border-amber-500/30 bg-amber-500/10"
    : "text-muted-foreground border-border/50 bg-muted/20";

  return (
    <div className="flex items-center gap-1.5">
      <span className={cn("inline-flex items-center justify-center h-8 w-8 rounded-full border text-sm font-bold", color)}>
        {score}
      </span>
      {isHotLead && (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-orange-500/15 text-orange-400 border border-orange-500/30 text-[10px] font-bold uppercase">
          <Flame className="h-3 w-3" /> Hot
        </span>
      )}
    </div>
  );
};

export default GrowthScoreBadge;
