import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { useCompanyBrain } from '@/hooks/useCompanyBrain';
import { decideRouteGuard } from '@/lib/routeGuard';
import { brainUsableForRoutes } from '@/lib/brainReadinessFlag';
import { allowDashboardWithoutBrain } from '@/lib/env/testOnboardingBypass';

// TEST only (see testOnboardingBypass.ts): the isolated TEST project forbids a
// Company Brain, so onboarding can never complete there.
const TEST_WITHOUT_BRAIN = allowDashboardWithoutBrain(import.meta.env);

interface ProtectedRouteProps {
  children: React.ReactNode;
  /**
   * False only for the onboarding route itself, so an onboarding-incomplete
   * user isn't gate-redirected to the very page they're already on.
   */
  requireOnboarding?: boolean;
}

const ProtectedRoute = ({ children, requireOnboarding = true }: ProtectedRouteProps) => {
  const { user, loading: authLoading } = useAuth();
  const { data: companyBrain, loading: onboardingLoading } = useCompanyBrain();
  const location = useLocation();

  const decision = decideRouteGuard({
    authLoading,
    user,
    requireOnboarding: requireOnboarding && !TEST_WITHOUT_BRAIN,
    onboardingLoading,
    onboardingCompleted: companyBrain ? companyBrain.onboarding_completed : null,
    brainUsable: brainUsableForRoutes(companyBrain),
    pathname: location.pathname,
    search: location.search,
  });

  if (decision.type === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-primary"></div>
      </div>
    );
  }

  if (decision.type === 'redirect') {
    return <Navigate to={decision.to} replace />;
  }

  return <>{children}</>;
};

export default ProtectedRoute;
