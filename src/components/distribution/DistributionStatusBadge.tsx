import { cn } from "@/lib/utils";

interface DistributionStatusBadgeProps {
  status: string;
}

const statusConfig: Record<string, { label: string; dot: string; bg: string; text: string }> = {
  posted: { label: "Posted", dot: "bg-emerald-400", bg: "bg-emerald-500/15", text: "text-emerald-400" },
  pending: { label: "Pending", dot: "bg-amber-400", bg: "bg-amber-500/15", text: "text-amber-400" },
  failed: { label: "Failed", dot: "bg-destructive", bg: "bg-destructive/15", text: "text-destructive" },
  removed: { label: "Removed", dot: "bg-muted-foreground", bg: "bg-muted/30", text: "text-muted-foreground" },
};

const DistributionStatusBadge = ({ status }: DistributionStatusBadgeProps) => {
  const config = statusConfig[status] || statusConfig.pending;
  return (
    <span className={cn("inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium", config.bg, config.text)}>
      <span className={cn("h-1.5 w-1.5 rounded-full", config.dot)} />
      {config.label}
    </span>
  );
};

export default DistributionStatusBadge;
