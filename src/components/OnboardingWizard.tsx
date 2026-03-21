import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Briefcase, Search, Users, ArrowRight, CheckCircle2, Sparkles, X } from 'lucide-react';

const ONBOARDING_KEY = 'sp_onboarding_dismissed';

const steps = [
  {
    icon: Briefcase,
    title: 'Create a Screening Job',
    description: 'Set up your first AI-powered role to automatically screen and rank candidates.',
    cta: 'Create Job',
    path: '/screening-jobs',
  },
  {
    icon: Search,
    title: 'Source Talent',
    description: 'Use Lead Scraper or Deep Search to find candidates from LinkedIn and beyond.',
    cta: 'Start Sourcing',
    path: '/lead-scraper',
  },
  {
    icon: Users,
    title: 'Review Candidates',
    description: 'See AI-scored candidates, compare profiles, and move them through your pipeline.',
    cta: 'View Pipeline',
    path: '/candidates',
  },
];

interface OnboardingWizardProps {
  totalCandidates: number;
}

const OnboardingWizard = ({ totalCandidates }: OnboardingWizardProps) => {
  const navigate = useNavigate();
  const [dismissed, setDismissed] = useState(true);

  useEffect(() => {
    const wasDismissed = localStorage.getItem(ONBOARDING_KEY);
    if (!wasDismissed && totalCandidates === 0) {
      setDismissed(false);
    }
  }, [totalCandidates]);

  const handleDismiss = () => {
    localStorage.setItem(ONBOARDING_KEY, 'true');
    setDismissed(true);
  };

  if (dismissed) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: -12 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -12 }}
        className="rounded-2xl border border-primary/20 bg-gradient-to-br from-primary/5 via-card/80 to-accent/5 p-6 mb-8 relative overflow-hidden"
      >
        {/* Dismiss */}
        <button
          onClick={handleDismiss}
          className="absolute top-4 right-4 p-1 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
        >
          <X className="h-4 w-4" />
        </button>

        {/* Header */}
        <div className="flex items-center gap-2 mb-1">
          <Sparkles className="h-4 w-4 text-primary" />
          <p className="text-xs font-bold text-primary uppercase tracking-widest">Getting Started</p>
        </div>
        <h2 className="text-lg font-bold text-foreground mb-1">Welcome to ScreeningPilot</h2>
        <p className="text-sm text-muted-foreground mb-6">
          Follow these 3 steps to start hiring with AI-powered screening.
        </p>

        {/* Steps */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {steps.map((step, i) => {
            const Icon = step.icon;
            return (
              <motion.button
                key={step.title}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.1 }}
                onClick={() => navigate(step.path)}
                className="group text-left rounded-xl border border-border/60 bg-card/60 backdrop-blur-sm p-5 hover:border-primary/40 hover:shadow-[0_4px_20px_rgba(5,148,103,0.08)] transition-all"
              >
                <div className="flex items-center gap-3 mb-3">
                  <div className="p-2 rounded-lg bg-primary/10 text-primary group-hover:bg-primary/20 transition-colors">
                    <Icon className="h-4 w-4" />
                  </div>
                  <span className="text-xs font-bold text-muted-foreground/60">Step {i + 1}</span>
                </div>
                <h3 className="text-sm font-semibold text-foreground mb-1">{step.title}</h3>
                <p className="text-xs text-muted-foreground leading-relaxed mb-4">{step.description}</p>
                <span className="inline-flex items-center gap-1 text-xs font-semibold text-primary group-hover:gap-2 transition-all">
                  {step.cta} <ArrowRight className="h-3 w-3" />
                </span>
              </motion.button>
            );
          })}
        </div>
      </motion.div>
    </AnimatePresence>
  );
};

export default OnboardingWizard;
