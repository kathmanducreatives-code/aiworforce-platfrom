import { useNavigate } from "react-router-dom";
import { Sparkles, ArrowRight, CheckCircle2 } from "lucide-react";
import { useCompanyBrain } from "@/hooks/useCompanyBrain";

const REQUIRED = [
  { key: "icp", label: "ICP" },
  { key: "competitors", label: "Competitors" },
  { key: "brand_voice", label: "Brand voice" },
  { key: "goals", label: "Goals" },
] as const;

function hasContent(v: unknown): boolean {
  if (v == null) return false;
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === "string") return v.trim().length > 0;
  if (typeof v === "object") return Object.keys(v as object).length > 0;
  return true;
}

export default function BrainReadinessCard() {
  const navigate = useNavigate();
  const { data, loading } = useCompanyBrain();
  if (loading || !data || data.onboarding_completed) return null;

  const profile = data.profile ?? {};
  const missing = REQUIRED.filter((r) => !hasContent(profile[r.key]));
  const completed = REQUIRED.length - missing.length;
  const pct = Math.round((completed / REQUIRED.length) * 100);

  return (
    <div className="mb-6 rounded-2xl border border-primary/30 bg-gradient-to-br from-primary/[0.07] via-card/60 to-card/40 p-5 shadow-[0_0_0_1px_rgba(16,185,129,0.04)_inset]">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="flex items-start gap-3 min-w-0">
          <div className="w-10 h-10 rounded-xl bg-primary/10 border border-primary/30 flex items-center justify-center shrink-0">
            <Sparkles className="h-5 w-5 text-primary" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-primary/80">
                System readiness
              </span>
              <span className="text-[11px] text-muted-foreground">{pct}% complete</span>
            </div>
            <h2 className="text-base font-semibold text-foreground leading-tight">
              Company Brain is incomplete
            </h2>
            <p className="text-[13px] text-muted-foreground mt-1 max-w-2xl">
              Teach Pilot, Scout, Aria, Penn, Hawk, and Scribe what you sell, who you sell to, and your goals.
            </p>
            <div className="flex flex-wrap gap-1.5 mt-3">
              {REQUIRED.map((r) => {
                const ok = hasContent(profile[r.key]);
                return (
                  <span
                    key={r.key}
                    className={
                      "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] border " +
                      (ok
                        ? "bg-primary/10 border-primary/30 text-primary"
                        : "bg-muted/40 border-border text-muted-foreground")
                    }
                  >
                    {ok && <CheckCircle2 className="h-3 w-3" />}
                    {r.label}
                  </span>
                );
              })}
            </div>
          </div>
        </div>
        <button
          onClick={() => navigate("/onboarding/company-brain")}
          className="shrink-0 inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 transition-colors"
        >
          Set up now <ArrowRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
