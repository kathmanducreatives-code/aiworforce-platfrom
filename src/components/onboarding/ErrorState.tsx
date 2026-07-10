// Premium error surface for onboarding steps.
// Never shows raw backend errors — the caller passes plain-English strings.

import { AlertTriangle, RefreshCw, ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface Props {
  title: string;
  body: string;
  nextSteps?: string[];
  onRetry?: () => void;
  onContinue?: () => void;
  continueLabel?: string;
}

export function ErrorState({ title, body, nextSteps, onRetry, onContinue, continueLabel = 'Continue manually' }: Props) {
  return (
    <div className="rounded-2xl border border-amber-500/30 bg-amber-500/[0.04] p-5 backdrop-blur-sm">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-amber-500/40 bg-amber-500/10 text-amber-300">
          <AlertTriangle className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-foreground">{title}</p>
          <p className="mt-1 text-xs text-muted-foreground">{body}</p>
          {nextSteps && nextSteps.length > 0 && (
            <ul className="mt-3 space-y-1">
              {nextSteps.map((s, i) => (
                <li key={i} className="flex items-start gap-2 text-[11px] text-foreground/80">
                  <span className="mt-1 h-1 w-1 shrink-0 rounded-full bg-amber-400/70" />
                  {s}
                </li>
              ))}
            </ul>
          )}
          {(onRetry || onContinue) && (
            <div className="mt-4 flex flex-wrap gap-2">
              {onRetry && (
                <Button size="sm" variant="outline" onClick={onRetry} className="h-7 gap-1.5 text-xs">
                  <RefreshCw className="h-3 w-3" /> Retry
                </Button>
              )}
              {onContinue && (
                <Button size="sm" variant="ghost" onClick={onContinue} className="h-7 gap-1.5 text-xs">
                  {continueLabel} <ArrowRight className="h-3 w-3" />
                </Button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
