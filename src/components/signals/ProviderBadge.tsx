// Provider readiness pill. Frontend derives billing_issue/unavailable/coming_soon
// from the existing capability + integration-readiness reason strings.
import { CheckCircle2, AlertCircle, CreditCard, Ban, Clock } from "lucide-react";

export type ProviderState = "ready" | "setup_needed" | "billing_issue" | "unavailable" | "coming_soon";

export function classifyProviderState(opts: {
  ready?: boolean;
  reason?: string | null;
  integrationStatus?: "connected" | "setup_needed" | "optional" | "unavailable";
}): ProviderState {
  const r = (opts.reason ?? "").toLowerCase();
  if (opts.ready) return "ready";
  if (/billing|payment|insufficient|402|balance/.test(r)) return "billing_issue";
  if (opts.integrationStatus === "unavailable") return "unavailable";
  if (/not configured|no provider|coming soon|not wired/.test(r)) return "coming_soon";
  return "setup_needed";
}

const STYLES: Record<ProviderState, { label: string; className: string; icon: any }> = {
  ready:         { label: "Ready",         className: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300", icon: CheckCircle2 },
  setup_needed:  { label: "Setup needed",  className: "border-amber-500/30 bg-amber-500/10 text-amber-300",       icon: AlertCircle },
  billing_issue: { label: "Billing issue", className: "border-red-500/30 bg-red-500/10 text-red-300",             icon: CreditCard },
  unavailable:   { label: "Unavailable",   className: "border-white/15 bg-white/[0.04] text-neutral-400",         icon: Ban },
  coming_soon:   { label: "Coming soon",   className: "border-sky-500/30 bg-sky-500/10 text-sky-300",             icon: Clock },
};

export default function ProviderBadge({ state, className = "" }: { state: ProviderState; className?: string }) {
  const s = STYLES[state];
  const Icon = s.icon;
  return (
    <span className={`inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full border ${s.className} ${className}`}>
      <Icon className="h-3 w-3" /> {s.label}
    </span>
  );
}
