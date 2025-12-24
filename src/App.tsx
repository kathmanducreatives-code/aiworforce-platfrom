import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider } from "./hooks/useAuth";
import { ClientProvider } from "./contexts/ClientContext";
import { ClientThemeProvider } from "./components/ClientThemeProvider";
import Landing from "./pages/Landing";
import Dashboard from "./pages/Dashboard";
import Screening from "./pages/Screening";
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
import JobBoard from "./pages/JobBoard";
// InterviewSettings removed - simplified interview feature
import BookInterview from "./pages/BookInterview";
import GoogleOAuthCallback from "./pages/GoogleOAuthCallback";
import ProtectedRoute from "./components/ProtectedRoute";
import MainLayout from "./components/MainLayout";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <AuthProvider>
        <ClientProvider>
          <ClientThemeProvider>
            <Toaster />
            <Sonner />
            <BrowserRouter>
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
                
                <Route path="/screening" element={
                  <ProtectedRoute>
                    <MainLayout>
                      <Screening />
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
                
                <Route path="/job-board" element={
                  <ProtectedRoute>
                    <MainLayout>
                      <JobBoard />
                    </MainLayout>
                  </ProtectedRoute>
                } />

                {/* Public booking page - no auth required */}
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
  </QueryClientProvider>
);

export default App;
