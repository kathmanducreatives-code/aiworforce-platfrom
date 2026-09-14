import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { useCompanyBrain } from '@/hooks/useCompanyBrain';
import { decideRouteGuard } from '@/lib/routeGuard';

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
    requireOnboarding,
    onboardingLoading,
    onboardingCompleted: companyBrain ? companyBrain.onboarding_completed : null,
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
