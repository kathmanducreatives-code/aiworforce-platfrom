// Setup-needed card per category. Surfaced when a provider/secret is missing.
import { AlertCircle, ExternalLink } from "lucide-react";
import { Link } from "react-router-dom";

export default function SetupNeededCard({ label, reason }: { label: string; reason?: string }) {
  return (
    <div className="rounded-lg border border-amber-500/20 bg-amber-500/[0.04] p-3.5 flex items-start gap-3">
      <div className="p-2 rounded-lg bg-amber-500/10 text-amber-300">
        <AlertCircle className="h-4 w-4" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-[13px] font-medium text-amber-100">{label}: setup needed</div>
        {reason && <div className="text-[11px] text-amber-200/70 mt-0.5">{reason}</div>}
        <Link to="/settings/integrations" className="inline-flex items-center gap-1 mt-1.5 text-[11px] text-amber-300 hover:text-amber-200">
          Open integrations <ExternalLink className="h-3 w-3" />
        </Link>
      </div>
    </div>
  );
}
