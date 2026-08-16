import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Suspense, lazy } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider } from "./hooks/useAuth";
import { ClientProvider } from "./contexts/ClientContext";
import { ClientThemeProvider } from "./components/ClientThemeProvider";
import { ThemeProvider } from "./contexts/ThemeContext";
import { WorkspaceProvider } from "./contexts/WorkspaceContext";
import VerificationPanel from "./components/dev/VerificationPanel";
import PreviewDiagnostics from "./components/dev/PreviewDiagnostics";
import EnvironmentBadge from "./components/dev/EnvironmentBadge";
import AppErrorBoundary from "./components/AppErrorBoundary";
import RouteErrorBoundary from "./components/RouteErrorBoundary";






















import ProtectedRoute from "./components/ProtectedRoute";
import MainLayout from "./components/MainLayout";
import AuthenticatedBackground from "./components/AuthenticatedBackground";

// ── ROUTE-LEVEL CODE SPLITTING ───────────────────────────────────────────────
//
// These 45 pages were eagerly imported, so every visitor downloaded all
// of them to render one — a single 3.1 MB chunk, which Vite had been warning
// about. Someone landing on the marketing page was paying for the Workbench,
// the screening pilot and the dialer before anything appeared.
//
// Providers, layouts and guards above stay EAGER on purpose: they mount on
// every route, so deferring them buys no bytes and costs a suspense flash on
// each navigation.
const Landing = lazy(() => import("./pages/Landing"));
const Dashboard = lazy(() => import("./pages/Dashboard"));
const Signals = lazy(() => import("./pages/Signals"));
const AwaitingYou = lazy(() => import("./pages/AwaitingYou"));
const Candidates = lazy(() => import("./pages/Candidates"));
const Features = lazy(() => import("./pages/Features"));
const Pricing = lazy(() => import("./pages/Pricing"));
const NotFound = lazy(() => import("./pages/NotFound"));
const FolderView = lazy(() => import("./pages/FolderView"));
const EmailSequenceSetup = lazy(() => import("./pages/EmailSequenceSetup"));
const EmailSequences = lazy(() => import("./pages/EmailSequences"));
const GetDemo = lazy(() => import("./pages/GetDemo"));
const Auth = lazy(() => import("./pages/Auth"));
const ResetPassword = lazy(() => import("./pages/ResetPassword"));
const ClientMetrics = lazy(() => import("./pages/ClientMetrics"));
const ClientDetail = lazy(() => import("./pages/ClientDetail"));
const InterviewScheduler = lazy(() => import("./pages/InterviewScheduler"));
const InterviewSettings = lazy(() => import("./pages/InterviewSettings"));
const BookInterview = lazy(() => import("./pages/BookInterview"));
const GoogleOAuthCallback = lazy(() => import("./pages/GoogleOAuthCallback"));
const CandidateApply = lazy(() => import("./pages/CandidateApply"));
const OnboardingCompanyBrain = lazy(() => import("./pages/OnboardingCompanyBrain"));
const CompanyBrainDashboard = lazy(() => import("./pages/CompanyBrainDashboard"));
const ICPManager = lazy(() => import("./pages/ICPManager"));
const ICPResultsPage = lazy(() => import("./pages/ICPResultsPage"));
const ICPCandidateDetail = lazy(() => import("./pages/ICPCandidateDetail"));
const ScreeningJobs = lazy(() => import("./pages/ScreeningJobs"));
const Leads = lazy(() => import("./pages/Leads"));
const LeadScraper = lazy(() => import("./pages/LeadScraper"));
const DeepSearch = lazy(() => import("./pages/DeepSearch"));
const Competitors = lazy(() => import("./pages/Competitors"));
const Content = lazy(() => import("./pages/Content"));
const OAuthConsent = lazy(() => import("./pages/OAuthConsent"));
const Agents = lazy(() => import("./pages/Agents"));
const SettingsIntegrations = lazy(() => import("./pages/SettingsIntegrations"));
const SettingsBilling = lazy(() => import("./pages/SettingsBilling"));
const JobApplicants = lazy(() => import("./pages/JobApplicants"));
const JobDistribution = lazy(() => import("./pages/JobDistribution"));
const ExpertMarketplace = lazy(() => import("./pages/ExpertMarketplace"));
const PostInterceptor = lazy(() => import("./pages/PostInterceptor"));
const LeadCRM = lazy(() => import("./pages/LeadCRM"));
const OutreachEngine = lazy(() => import("./pages/OutreachEngine"));
const CandidateDossier = lazy(() => import("./pages/candidates/CandidateDossier"));
const TaskPlanPage = lazy(() => import("./pages/TaskPlanPage"));
const Workflows = lazy(() => import("./pages/Workflows"));




























// import VerifyQueue from "./pages/verify/VerifyQueue";
// import VerifyResults from "./pages/verify/VerifyResults";
// import InterviewDashboard from "./pages/interviews/InterviewDashboard";
// import InterviewMarketplace from "./pages/interviews/InterviewMarketplace";
// import ScheduledInterviews from "./pages/interviews/ScheduledInterviews";
// import CompletedInterviews from "./pages/interviews/CompletedInterviews";
// import InterviewReports from "./pages/interviews/InterviewReports";
// import PortalAssignments from "./pages/portal/PortalAssignments";
// import PortalSubmit from "./pages/portal/PortalSubmit";
// import PortalEarnings from "./pages/portal/PortalEarnings";
// import PortalProfile from "./pages/portal/PortalProfile";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <ThemeProvider>
      <TooltipProvider>
        <AppErrorBoundary>
          <AuthProvider>
            <WorkspaceProvider>
              <ClientProvider>
                <ClientThemeProvider>
                  <Toaster />
                  <Sonner />
                  {/* Names the Supabase project this build talks to. Renders
                      nothing in production. */}
                  <EnvironmentBadge />
                  {import.meta.env.DEV && import.meta.env.VITE_ENABLE_VERIFICATION_PANEL === 'true' && (
                    <AppErrorBoundary>
                      <VerificationPanel />
                    </AppErrorBoundary>
                  )}
                <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
                  <div className="relative min-h-screen w-full">
                    <AuthenticatedBackground />
                    {import.meta.env.DEV && <PreviewDiagnostics />}
                  <RouteErrorBoundary>
                  <Suspense fallback={<div className="min-h-screen bg-background" />}>
                  <Routes>

                    {/* Public Routes */}
                    <Route path="/" element={<Landing />} />
                    <Route path="/auth" element={<Auth />} />
                    <Route path="/reset-password" element={<ResetPassword />} />
                    <Route path="/features" element={<Features />} />
                    <Route path="/pricing" element={<Pricing />} />
                    <Route path="/get-demo" element={<GetDemo />} />
                    <Route path="/.lovable/oauth/consent" element={<OAuthConsent />} />

                    {/* Protected Routes with MainLayout */}
                    <Route path="/dashboard" element={
                      <ProtectedRoute>
                        <MainLayout>
                          <Dashboard />
                        </MainLayout>
                      </ProtectedRoute>
                    } />

                    <Route path="/onboarding/company-brain" element={
                      <ProtectedRoute>
                        <OnboardingCompanyBrain />
                      </ProtectedRoute>
                    } />

                    <Route path="/company-brain" element={
                      <ProtectedRoute>
                        <MainLayout>
                          <CompanyBrainDashboard />
                        </MainLayout>
                      </ProtectedRoute>
                    } />

                    <Route path="/awaiting-you" element={
                      <ProtectedRoute>
                        <MainLayout>
                          <AwaitingYou />
                        </MainLayout>
                      </ProtectedRoute>
                    } />

                    <Route path="/signals" element={
                      <ProtectedRoute>
                        <MainLayout>
                          <Signals />
                        </MainLayout>
                      </ProtectedRoute>
                    } />

                    {/* Agentory restructure — new top-level pages */}
                    <Route path="/leads" element={
                      <ProtectedRoute><MainLayout><Leads /></MainLayout></ProtectedRoute>
                    } />
                    <Route path="/leads/find" element={
                      <ProtectedRoute><MainLayout><LeadScraper /></MainLayout></ProtectedRoute>
                    } />
                    <Route path="/leads/icp" element={
                      <ProtectedRoute><MainLayout><ICPManager /></MainLayout></ProtectedRoute>
                    } />
                    <Route path="/leads/research" element={
                      <ProtectedRoute><MainLayout><DeepSearch /></MainLayout></ProtectedRoute>
                    } />
                    <Route path="/competitors" element={
                      <ProtectedRoute><MainLayout><Competitors /></MainLayout></ProtectedRoute>
                    } />
                    <Route path="/content" element={
                      <ProtectedRoute><MainLayout><Content /></MainLayout></ProtectedRoute>
                    } />
                    <Route path="/agents" element={
                      <ProtectedRoute><MainLayout><Agents /></MainLayout></ProtectedRoute>
                    } />
                    <Route path="/settings/integrations" element={
                      <ProtectedRoute><MainLayout><SettingsIntegrations /></MainLayout></ProtectedRoute>
                    } />
                    <Route path="/settings/billing" element={
                      <ProtectedRoute><MainLayout><SettingsBilling /></MainLayout></ProtectedRoute>
                    } />
                    <Route path="/workflows" element={
                      <ProtectedRoute><MainLayout><Workflows /></MainLayout></ProtectedRoute>
                    } />

                    {/* Legacy route redirects — preserve deep links */}
                    <Route path="/lead-scraper" element={<Navigate to="/leads" replace />} />
                    <Route path="/icp-intelligence" element={<Navigate to="/leads?tab=icp" replace />} />
                    <Route path="/deep-search" element={<Navigate to="/leads?tab=research" replace />} />
                    <Route path="/talent-intel" element={<Navigate to="/leads?tab=research" replace />} />
                    <Route path="/growth-signals" element={<Navigate to="/signals" replace />} />
                    <Route path="/competitor-intel" element={<Navigate to="/competitors" replace />} />
                    <Route path="/analytics" element={<Navigate to="/dashboard" replace />} />
                    <Route path="/departments" element={<Navigate to="/agents" replace />} />
                    <Route path="/rooms/:dept" element={<Navigate to="/agents" replace />} />



                    <Route path="/candidates" element={
                      <ProtectedRoute>
                        <MainLayout>
                          <Candidates />
                        </MainLayout>
                      </ProtectedRoute>
                    } />




                    <Route path="/folder/:folderName" element={
                      <ProtectedRoute>
                        <MainLayout>
                          <FolderView />
                        </MainLayout>
                      </ProtectedRoute>
                    } />

                    <Route path="/email-sequence/:folderName" element={
                      <ProtectedRoute>
                        <MainLayout>
                          <EmailSequenceSetup />
                        </MainLayout>
                      </ProtectedRoute>
                    } />

                    <Route path="/client-metrics" element={
                      <ProtectedRoute>
                        <MainLayout>
                          <ClientMetrics />
                        </MainLayout>
                      </ProtectedRoute>
                    } />

                    <Route path="/client/:clientId" element={
                      <ProtectedRoute>
                        <MainLayout>
                          <ClientDetail />
                        </MainLayout>
                      </ProtectedRoute>
                    } />




                    <Route path="/icp/results/:sessionId" element={
                      <ProtectedRoute>
                        <ICPResultsPage />
                      </ProtectedRoute>
                    } />

                    <Route path="/icp/results/:sessionId/candidate/:candidateId" element={
                      <ProtectedRoute>
                        <ICPCandidateDetail />
                      </ProtectedRoute>
                    } />

                    <Route path="/email-sequences" element={
                      <ProtectedRoute>
                        <MainLayout>
                          <EmailSequences />
                        </MainLayout>
                      </ProtectedRoute>
                    } />

                    <Route path="/interview-scheduler" element={
                      <ProtectedRoute>
                        <MainLayout>
                          <InterviewScheduler />
                        </MainLayout>
                      </ProtectedRoute>
                    } />

                    <Route path="/interview-settings" element={
                      <ProtectedRoute>
                        <MainLayout>
                          <InterviewSettings />
                        </MainLayout>
                      </ProtectedRoute>
                    } />
                    <Route path="/screening-jobs" element={
                      <ProtectedRoute>
                        <MainLayout>
                          <ScreeningJobs />
                        </MainLayout>
                      </ProtectedRoute>
                    } />

                    <Route path="/screening-jobs/:jobId" element={
                      <ProtectedRoute>
                        <MainLayout>
                          <JobApplicants />
                        </MainLayout>
                      </ProtectedRoute>
                    } />



                    <Route path="/distribution" element={
                      <ProtectedRoute>
                        <MainLayout>
                          <JobDistribution />
                        </MainLayout>
                      </ProtectedRoute>
                    } />







                    <Route path="/expert-marketplace" element={
                      <ProtectedRoute>
                        <MainLayout>
                          <ExpertMarketplace />
                        </MainLayout>
                      </ProtectedRoute>
                    } />

                    {/* Growth & Outbound Routes */}
                    <Route path="/post-interceptor" element={
                      <ProtectedRoute>
                        <MainLayout>
                          <PostInterceptor />
                        </MainLayout>
                      </ProtectedRoute>
                    } />

                    <Route path="/lead-crm" element={
                      <ProtectedRoute>
                        <MainLayout>
                          <LeadCRM />
                        </MainLayout>
                      </ProtectedRoute>
                    } />

                    <Route path="/outreach-engine" element={
                      <ProtectedRoute>
                        <MainLayout>
                          <OutreachEngine />
                        </MainLayout>
                      </ProtectedRoute>
                    } />

                    {/* Mission Control Candidate UI Routes */}
                    <Route path="/candidates/:id" element={<ProtectedRoute><MainLayout><CandidateDossier /></MainLayout></ProtectedRoute>} />

                    {/* Departments overview (2x2 team rooms grid) */}



                    {/* Task plan detail */}
                    <Route path="/plans/:planId" element={
                      <ProtectedRoute>
                        <MainLayout>
                          <TaskPlanPage />
                        </MainLayout>
                      </ProtectedRoute>
                    } />

                    {/* <Route path="/verify" element={<ProtectedRoute><MainLayout><VerifyQueue /></MainLayout></ProtectedRoute>} /> */}
                    {/* <Route path="/verify/results" element={<ProtectedRoute><MainLayout><VerifyResults /></MainLayout></ProtectedRoute>} /> */}

                    {/* <Route path="/interviews" element={<ProtectedRoute><MainLayout><InterviewDashboard /></MainLayout></ProtectedRoute>} /> */}
                    {/* <Route path="/interviews/marketplace" element={<ProtectedRoute><MainLayout><InterviewMarketplace /></MainLayout></ProtectedRoute>} /> */}
                    {/* <Route path="/interviews/scheduled" element={<ProtectedRoute><MainLayout><ScheduledInterviews /></MainLayout></ProtectedRoute>} /> */}
                    {/* <Route path="/interviews/completed" element={<ProtectedRoute><MainLayout><CompletedInterviews /></MainLayout></ProtectedRoute>} /> */}
                    {/* <Route path="/interviews/reports" element={<ProtectedRoute><MainLayout><InterviewReports /></MainLayout></ProtectedRoute>} /> */}

                    {/* <Route path="/portal/assignments" element={<ProtectedRoute><MainLayout><PortalAssignments /></MainLayout></ProtectedRoute>} /> */}
                    {/* <Route path="/portal/submit" element={<ProtectedRoute><MainLayout><PortalSubmit /></MainLayout></ProtectedRoute>} /> */}
                    {/* <Route path="/portal/earnings" element={<ProtectedRoute><MainLayout><PortalEarnings /></MainLayout></ProtectedRoute>} /> */}
                    {/* <Route path="/portal/profile" element={<ProtectedRoute><MainLayout><PortalProfile /></MainLayout></ProtectedRoute>} /> */}

                    {/* Public pages - no auth required */}
                    <Route path="/apply/:slug" element={<CandidateApply />} />
                    <Route path="/book/:token" element={<BookInterview />} />


                    {/* OAuth callback - protected */}
                    <Route path="/oauth/google/callback" element={
                      <ProtectedRoute>
                        <GoogleOAuthCallback />
                      </ProtectedRoute>
                    } />

                    {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
                    <Route path="*" element={<NotFound />} />
                  </Routes>
                </Suspense>
                  </RouteErrorBoundary>
                </div>

              </BrowserRouter>
            </ClientThemeProvider>
          </ClientProvider>
          </WorkspaceProvider>
        </AuthProvider>
        </AppErrorBoundary>
      </TooltipProvider>
    </ThemeProvider>
  </QueryClientProvider>
);

export default App;
