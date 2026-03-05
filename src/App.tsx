import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider } from "./hooks/useAuth";
import { ClientProvider } from "./contexts/ClientContext";
import { ClientThemeProvider } from "./components/ClientThemeProvider";
import { ThemeProvider } from "./contexts/ThemeContext";
import Landing from "./pages/Landing";
import Dashboard from "./pages/Dashboard";

import Candidates from "./pages/Candidates";
import Features from "./pages/Features";
import Pricing from "./pages/Pricing";
import NotFound from "./pages/NotFound";
import FolderView from "./pages/FolderView";
import EmailSequenceSetup from "./pages/EmailSequenceSetup";
import EmailSequences from "./pages/EmailSequences";
import GetDemo from "./pages/GetDemo";
import Auth from "./pages/Auth";
import DataDashboard from "./pages/DataDashboard";
import ClientMetrics from "./pages/ClientMetrics";
import ClientDetail from "./pages/ClientDetail";
import LeadScraper from "./pages/LeadScraper";
import DeepSearch from "./pages/DeepSearch";
import InterviewScheduler from "./pages/InterviewScheduler";
import InterviewSettings from "./pages/InterviewSettings";
import BookInterview from "./pages/BookInterview";
import GoogleOAuthCallback from "./pages/GoogleOAuthCallback";
import ProtectedRoute from "./components/ProtectedRoute";
import MainLayout from "./components/MainLayout";

import CandidateApply from "./pages/CandidateApply";

import ICPManager from "./pages/ICPManager";
import ICPResultsPage from "./pages/ICPResultsPage";
import ICPCandidateDetail from "./pages/ICPCandidateDetail";
import ScreeningJobs from "./pages/ScreeningJobs";
import JobApplicants from "./pages/JobApplicants";
import JobDistribution from "./pages/JobDistribution";
import GrowthSignals from "./pages/GrowthSignals";
import ExpertMarketplace from "./pages/ExpertMarketplace";
import PostInterceptor from "./pages/PostInterceptor";
import LeadCRM from "./pages/LeadCRM";
import CandidateDossier from "./pages/candidates/CandidateDossier";
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
        <AuthProvider>
          <ClientProvider>
            <ClientThemeProvider>
              <Toaster />
              <Sonner />
              <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
                <Routes>
                  {/* Public Routes */}
                  <Route path="/" element={<Landing />} />
                  <Route path="/auth" element={<Auth />} />
                  <Route path="/features" element={<Features />} />
                  <Route path="/pricing" element={<Pricing />} />
                  <Route path="/get-demo" element={<GetDemo />} />

                  {/* Protected Routes with MainLayout */}
                  <Route path="/dashboard" element={
                    <ProtectedRoute>
                      <MainLayout>
                        <Dashboard />
                      </MainLayout>
                    </ProtectedRoute>
                  } />



                  <Route path="/candidates" element={
                    <ProtectedRoute>
                      <MainLayout>
                        <Candidates />
                      </MainLayout>
                    </ProtectedRoute>
                  } />

                  <Route path="/analytics" element={
                    <ProtectedRoute>
                      <MainLayout>
                        <DataDashboard />
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

                  <Route path="/lead-scraper" element={
                    <ProtectedRoute>
                      <MainLayout>
                        <LeadScraper />
                      </MainLayout>
                    </ProtectedRoute>
                  } />

                  <Route path="/deep-search" element={
                    <ProtectedRoute>
                      <MainLayout>
                        <DeepSearch />
                      </MainLayout>
                    </ProtectedRoute>
                  } />

                  <Route path="/icp-intelligence" element={
                    <ProtectedRoute>
                      <MainLayout>
                        <ICPManager />
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



                  <Route path="/job-distribution" element={
                    <ProtectedRoute>
                      <MainLayout>
                        <JobDistribution />
                      </MainLayout>
                    </ProtectedRoute>
                  } />

                  <Route path="/growth-signals" element={
                    <ProtectedRoute>
                      <MainLayout>
                        <GrowthSignals />
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

                  {/* Mission Control Candidate UI Routes */}
                  <Route path="/candidates/:id" element={<ProtectedRoute><MainLayout><CandidateDossier /></MainLayout></ProtectedRoute>} />

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
              </BrowserRouter>
            </ClientThemeProvider>
          </ClientProvider>
        </AuthProvider>
      </TooltipProvider>
    </ThemeProvider>
  </QueryClientProvider>
);

export default App;
