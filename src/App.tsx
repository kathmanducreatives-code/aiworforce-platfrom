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
import CommandCanvas from "./components/CommandCanvas";
import AuthenticatedBackground from "./components/AuthenticatedBackground";

import CandidateApply from "./pages/CandidateApply";

import ICPManager from "./pages/ICPManager";
import ICPResultsPage from "./pages/ICPResultsPage";
import ICPCandidateDetail from "./pages/ICPCandidateDetail";
import ScreeningJobs from "./pages/ScreeningJobs";
import JobApplicants from "./pages/JobApplicants";
import JobDistribution from "./pages/JobDistribution";
import CompetitorMonitor from "./pages/CompetitorMonitor";
import GrowthSignals from "./pages/GrowthSignals";
import ExpertMarketplace from "./pages/ExpertMarketplace";
import PostInterceptor from "./pages/PostInterceptor";
import LeadCRM from "./pages/LeadCRM";
import OutreachEngine from "./pages/OutreachEngine";
import TalentIntelligence from "./pages/TalentIntelligence";
import CompetitorIntelligence from "./pages/CompetitorIntelligence";
import CommandCenter from "./pages/CommandCenter";
import TalentDepartment from "./pages/TalentDepartment";
import AgentStudio from "./pages/AgentStudio";
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
                <div className="relative min-h-screen w-full">
                  <AuthenticatedBackground />
                  <Routes>
                    {/* Public Routes */}
                    <Route path="/" element={<Landing />} />
                    <Route path="/auth" element={<Auth />} />
                    <Route path="/features" element={<Features />} />
                    <Route path="/pricing" element={<Pricing />} />
                    <Route path="/get-demo" element={<GetDemo />} />

                    {/* Protected Routes with CommandCanvas */}
                    {/* Command Center (new default dashboard) */}
                    <Route path="/dashboard" element={
                      <ProtectedRoute>
                        <CommandCanvas>
                          <CommandCenter />
                        </CommandCanvas>
                      </ProtectedRoute>
                    } />

                    {/* Agent Studio */}
                    <Route path="/agent-studio" element={
                      <ProtectedRoute>
                        <CommandCanvas>
                          <AgentStudio />
                        </CommandCanvas>
                      </ProtectedRoute>
                    } />

                    {/* Department detail views */}
                    <Route path="/departments/talent" element={
                      <ProtectedRoute>
                        <CommandCanvas>
                          <TalentDepartment />
                        </CommandCanvas>
                      </ProtectedRoute>
                    } />



                    <Route path="/candidates" element={
                      <ProtectedRoute>
                        <CommandCanvas>
                          <Candidates />
                        </CommandCanvas>
                      </ProtectedRoute>
                    } />

                    <Route path="/analytics" element={
                      <ProtectedRoute>
                        <CommandCanvas>
                          <DataDashboard />
                        </CommandCanvas>
                      </ProtectedRoute>
                    } />

                    <Route path="/folder/:folderName" element={
                      <ProtectedRoute>
                        <CommandCanvas>
                          <FolderView />
                        </CommandCanvas>
                      </ProtectedRoute>
                    } />

                    <Route path="/email-sequence/:folderName" element={
                      <ProtectedRoute>
                        <CommandCanvas>
                          <EmailSequenceSetup />
                        </CommandCanvas>
                      </ProtectedRoute>
                    } />

                    <Route path="/client-metrics" element={
                      <ProtectedRoute>
                        <CommandCanvas>
                          <ClientMetrics />
                        </CommandCanvas>
                      </ProtectedRoute>
                    } />

                    <Route path="/client/:clientId" element={
                      <ProtectedRoute>
                        <CommandCanvas>
                          <ClientDetail />
                        </CommandCanvas>
                      </ProtectedRoute>
                    } />

                    <Route path="/lead-scraper" element={
                      <ProtectedRoute>
                        <CommandCanvas>
                          <LeadScraper />
                        </CommandCanvas>
                      </ProtectedRoute>
                    } />

                    <Route path="/deep-search" element={
                      <ProtectedRoute>
                        <CommandCanvas>
                          <DeepSearch />
                        </CommandCanvas>
                      </ProtectedRoute>
                    } />

                    <Route path="/icp-intelligence" element={
                      <ProtectedRoute>
                        <CommandCanvas>
                          <ICPManager />
                        </CommandCanvas>
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
                        <CommandCanvas>
                          <EmailSequences />
                        </CommandCanvas>
                      </ProtectedRoute>
                    } />

                    <Route path="/interview-scheduler" element={
                      <ProtectedRoute>
                        <CommandCanvas>
                          <InterviewScheduler />
                        </CommandCanvas>
                      </ProtectedRoute>
                    } />

                    <Route path="/interview-settings" element={
                      <ProtectedRoute>
                        <CommandCanvas>
                          <InterviewSettings />
                        </CommandCanvas>
                      </ProtectedRoute>
                    } />
                    <Route path="/screening-jobs" element={
                      <ProtectedRoute>
                        <CommandCanvas>
                          <ScreeningJobs />
                        </CommandCanvas>
                      </ProtectedRoute>
                    } />

                    <Route path="/screening-jobs/:jobId" element={
                      <ProtectedRoute>
                        <CommandCanvas>
                          <JobApplicants />
                        </CommandCanvas>
                      </ProtectedRoute>
                    } />



                    <Route path="/distribution" element={
                      <ProtectedRoute>
                        <CommandCanvas>
                          <JobDistribution />
                        </CommandCanvas>
                      </ProtectedRoute>
                    } />

                    <Route path="/competitors" element={
                      <ProtectedRoute>
                        <CommandCanvas>
                          <CompetitorMonitor />
                        </CommandCanvas>
                      </ProtectedRoute>
                    } />

                    <Route path="/talent-intel" element={
                      <ProtectedRoute>
                        <CommandCanvas>
                          <TalentIntelligence />
                        </CommandCanvas>
                      </ProtectedRoute>
                    } />

                    <Route path="/competitor-intel" element={
                      <ProtectedRoute>
                        <CommandCanvas>
                          <CompetitorIntelligence />
                        </CommandCanvas>
                      </ProtectedRoute>
                    } />

                    <Route path="/growth-signals" element={
                      <ProtectedRoute>
                        <CommandCanvas>
                          <GrowthSignals />
                        </CommandCanvas>
                      </ProtectedRoute>
                    } />

                    <Route path="/expert-marketplace" element={
                      <ProtectedRoute>
                        <CommandCanvas>
                          <ExpertMarketplace />
                        </CommandCanvas>
                      </ProtectedRoute>
                    } />

                    {/* Growth & Outbound Routes */}
                    <Route path="/post-interceptor" element={
                      <ProtectedRoute>
                        <CommandCanvas>
                          <PostInterceptor />
                        </CommandCanvas>
                      </ProtectedRoute>
                    } />

                    <Route path="/lead-crm" element={
                      <ProtectedRoute>
                        <CommandCanvas>
                          <LeadCRM />
                        </CommandCanvas>
                      </ProtectedRoute>
                    } />

                    <Route path="/outreach-engine" element={
                      <ProtectedRoute>
                        <CommandCanvas>
                          <OutreachEngine />
                        </CommandCanvas>
                      </ProtectedRoute>
                    } />

                    {/* Mission Control Candidate UI Routes */}
                    <Route path="/candidates/:id" element={<ProtectedRoute><CommandCanvas><CandidateDossier /></CommandCanvas></ProtectedRoute>} />

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
                </div>
              </BrowserRouter>
            </ClientThemeProvider>
          </ClientProvider>
        </AuthProvider>
      </TooltipProvider>
    </ThemeProvider>
  </QueryClientProvider>
);

export default App;
