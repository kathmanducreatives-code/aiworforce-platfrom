import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { useCompanyBrain } from '@/hooks/useCompanyBrain';

const ALLOWED_PRE_ONBOARDING = new Set<string>([
  '/onboarding/company-brain',
  '/settings/integrations',
  '/auth',
  '/reset-password',
]);

/**
 * Forces every gated route to send users with an incomplete Company Brain
 * back to /onboarding/company-brain. Mounted inside MainLayout, so the
 * onboarding route itself (which does not use MainLayout) is naturally exempt.
 */
export default function OnboardingGate({ children }: { children: ReactNode }) {
  const { user, loading: authLoading } = useAuth();
  const { data, loading } = useCompanyBrain();
  const location = useLocation();

  if (authLoading || loading) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin mr-2" />
        Loading workspace…
      </div>
    );
  }

  if (!user) return <Navigate to="/auth" replace />;

  const completed = !!data?.onboarding_completed;
  if (!completed && !ALLOWED_PRE_ONBOARDING.has(location.pathname)) {
    return <Navigate to="/onboarding/company-brain" replace state={{ from: location.pathname }} />;
  }

  return <>{children}</>;
}
