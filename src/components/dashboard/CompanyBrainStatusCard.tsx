import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Sparkles, ArrowRight, CheckCircle2, RotateCcw, Pencil, ShieldCheck,
} from 'lucide-react';
import { useCompanyBrain } from '@/hooks/useCompanyBrain';
import { computeCompleteness } from '@/lib/brainCompleteness';

/**
 * Single Dashboard card that handles both Company Brain states:
 *  - incomplete / skipped → "Continue setup" + "Start from beginning"
 *  - complete → "Company Brain active" + "Edit" + "Restart onboarding"
 *
 * Restart navigates to /onboarding/company-brain?restart=1 — the wizard
 * prefills saved values but starts at Step 1 instead of jumping to Review.
 * Nothing is deleted; data only changes when the user re-activates.
 */
export default function CompanyBrainStatusCard() {
  const navigate = useNavigate();
  const { data, loading } = useCompanyBrain();
  const [confirmRestart, setConfirmRestart] = useState(false);

  if (loading || !data) return null;

  const profile = (data.profile ?? {}) as Record<string, any>;
  const completeness = computeCompleteness({
    company_name: profile.company_name,
    website_url: profile.website_url,
    short_description: profile.short_description,
    icp: profile.icp,
    goals: profile.goals,
    competitors: profile.competitors,
    brand_voice: profile.brand_voice,
    approval_rules: profile.approval_rules,
  });
  const isComplete = !!data.onboarding_completed;

  const restart = () => navigate('/onboarding/company-brain?restart=1');
  const open = () => navigate('/onboarding/company-brain');

  if (!isComplete) {
    return (
      <div className="rounded-2xl border border-primary/25 bg-gradient-to-br from-primary/[0.06] via-card/40 to-card/30 backdrop-blur-xl p-5 shadow-[0_20px_60px_-30px_rgba(16,185,129,0.35)]">
        <div className="flex flex-col lg:flex-row lg:items-center gap-4">
          <div className="flex items-start gap-3 min-w-0 flex-1">
            <div className="h-10 w-10 rounded-xl bg-primary/10 border border-primary/30 flex items-center justify-center shrink-0">
              <Sparkles className="h-5 w-5 text-primary" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 mb-1 flex-wrap">
                <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-primary/80">
                  Company Brain setup
                </span>
                <span className="text-[11px] text-muted-foreground">{completeness.percent}% complete</span>
              </div>
              <h2 className="text-base font-semibold text-foreground leading-tight">
                Teach Agentory your business so your AI workforce can work in context.
              </h2>
              <p className="text-[13px] text-muted-foreground mt-1 max-w-2xl">
                Pilot, Scout, Hawk, Aria, Penn and Scribe use this to find signals, write content, track competitors, and draft outreach. Nothing is sent without your approval.
              </p>
              {completeness.missing.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-3">
                  {completeness.missing.slice(0, 5).map((m) => (
                    <span
                      key={m}
                      className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] border bg-muted/40 border-border text-muted-foreground"
                    >
                      {m}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>
          <div className="flex flex-col sm:flex-row gap-2 shrink-0">
            <button
              onClick={open}
              className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 transition-colors"
            >
              Continue setup <ArrowRight className="h-4 w-4" />
            </button>
            <button
              onClick={restart}
              className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl border border-border/60 bg-card/40 text-sm text-foreground hover:border-primary/40 hover:bg-primary/5 transition-colors"
            >
              <RotateCcw className="h-3.5 w-3.5" /> Start from beginning
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Active state
  return (
    <div className="rounded-2xl border border-border/60 bg-card/40 backdrop-blur-xl p-5">
      <div className="flex flex-col lg:flex-row lg:items-center gap-4">
        <div className="flex items-start gap-3 min-w-0 flex-1">
          <div className="h-10 w-10 rounded-xl bg-primary/15 border border-primary/40 flex items-center justify-center shrink-0">
            <CheckCircle2 className="h-5 w-5 text-primary" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2 mb-1 flex-wrap">
              <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-primary/80">
                Company Brain active
              </span>
              <span className="text-[11px] text-muted-foreground">{completeness.percent}% ready</span>
              <span className="hidden sm:inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                <ShieldCheck className="h-3 w-3 text-primary/70" /> Approval-first
              </span>
            </div>
            <h2 className="text-base font-semibold text-foreground leading-tight truncate">
              {profile.company_name || 'Your company'}
              {profile.category ? <span className="text-muted-foreground font-normal"> · {profile.category}</span> : null}
            </h2>
            <p className="text-[13px] text-muted-foreground mt-1 line-clamp-2 max-w-2xl">
              {profile.short_description || 'Your AI workforce is using this context for every workflow.'}
            </p>
          </div>
        </div>
        <div className="flex flex-col sm:flex-row gap-2 shrink-0">
          <button
            onClick={open}
            className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 transition-colors"
          >
            <Pencil className="h-3.5 w-3.5" /> Edit Company Brain
          </button>
          {!confirmRestart ? (
            <button
              onClick={() => setConfirmRestart(true)}
              className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl border border-border/60 bg-card/40 text-sm text-foreground hover:border-primary/40 hover:bg-primary/5 transition-colors"
            >
              <RotateCcw className="h-3.5 w-3.5" /> Restart onboarding
            </button>
          ) : (
            <div className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl border border-amber-500/30 bg-amber-500/10">
              <span className="text-[12px] text-foreground">Restart? Your saved data is kept.</span>
              <button onClick={restart} className="text-[12px] font-semibold text-primary hover:underline px-2">Yes, restart</button>
              <button onClick={() => setConfirmRestart(false)} className="text-[12px] text-muted-foreground hover:text-foreground px-2">Cancel</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
