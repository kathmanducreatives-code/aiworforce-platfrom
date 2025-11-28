import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { TrendingUp, Folder, Brain, Users } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import ResumeUpload from "@/components/ResumeUpload";
import ModernDashboard from "@/components/ModernDashboard";

const Dashboard = () => {
  const navigate = useNavigate();
  const { profile } = useAuth();
  const [metrics, setMetrics] = useState({
    totalCandidates: 0,
    avgFitScore: 0,
    activeRecruitments: 0,
    candidatesThisWeek: 0,
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchMetrics();
  }, []);

  const fetchMetrics = async () => {
    try {
      const { data: candidates } = await supabase
        .from('resume_analyses')
        .select('*')
        .order('created_at', { ascending: false });

      if (candidates) {
        const now = new Date();
        const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        
        const candidatesThisWeek = candidates.filter(
          c => new Date(c.created_at) >= oneWeekAgo
        ).length;

        // Calculate average fit score
        const fitScores = candidates.map(c => {
          const fitScore = c.fit_score as any;
          return typeof fitScore === 'object' && fitScore !== null ? (fitScore.score || 0) : 0;
        }).filter(score => score > 0);
        
        const avgFitScore = fitScores.length > 0 
          ? Math.round(fitScores.reduce((a, b) => a + b, 0) / fitScores.length)
          : 0;

        // Count unique recruitment names
        const uniqueRecruitments = new Set(
          candidates.map(c => c.recruitment_name).filter(Boolean)
        );

        setMetrics({
          totalCandidates: candidates.length,
          avgFitScore,
          activeRecruitments: uniqueRecruitments.size,
          candidatesThisWeek,
        });
      }
    } catch (error) {
      console.error('Error fetching metrics:', error);
    } finally {
      setLoading(false);
    }
  };


  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-7xl mx-auto px-0 sm:px-6 lg:px-8 py-0 sm:py-6">
        {/* Minimal Header */}
        <div className="mb-6 sm:mb-8 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3 sm:gap-4">
            {profile?.logo_url && (
              <img 
                src={profile.logo_url} 
                alt="Client Logo" 
                className="h-12 sm:h-16 w-auto" 
              />
            )}
            <div>
              <h1 className="text-xl sm:text-2xl font-semibold text-neutral-900">Dashboard</h1>
              <p className="text-xs sm:text-sm text-neutral-600">
                {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
              </p>
            </div>
          </div>
          <Button
            onClick={() => navigate('/screening')}
            size="sm"
            className="bg-primary hover:bg-primary/90 w-full sm:w-auto"
          >
            + New Candidate
          </Button>
        </div>

        {/* KPI Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          <Card className="p-4 sm:p-6">
            <div className="flex items-center gap-3 mb-3 sm:mb-4">
              <div className="p-2 bg-neutral-100 rounded-lg">
                <Users className="h-4 w-4 sm:h-5 sm:w-5 text-neutral-600" />
              </div>
              <span className="text-xs sm:text-sm font-medium text-neutral-500 uppercase tracking-wide">Total Candidates</span>
            </div>
            <div className="text-3xl sm:text-4xl font-bold text-neutral-900">{loading ? "..." : metrics.totalCandidates}</div>
            <div className="text-xs text-success mt-1">+{metrics.candidatesThisWeek} this week</div>
          </Card>

          <Card className="p-4 sm:p-6">
            <div className="flex items-center gap-3 mb-3 sm:mb-4">
              <div className="p-2 bg-neutral-100 rounded-lg">
                <TrendingUp className="h-4 w-4 sm:h-5 sm:w-5 text-neutral-600" />
              </div>
              <span className="text-xs sm:text-sm font-medium text-neutral-500 uppercase tracking-wide">Avg Fit Score</span>
            </div>
            <div className="text-3xl sm:text-4xl font-bold text-neutral-900">{loading ? "..." : `${metrics.avgFitScore}%`}</div>
            <div className="text-xs text-neutral-500 mt-1">quality rate</div>
          </Card>

          <Card className="p-4 sm:p-6">
            <div className="flex items-center gap-3 mb-3 sm:mb-4">
              <div className="p-2 bg-neutral-100 rounded-lg">
                <Folder className="h-4 w-4 sm:h-5 sm:w-5 text-neutral-600" />
              </div>
              <span className="text-xs sm:text-sm font-medium text-neutral-500 uppercase tracking-wide">Active Roles</span>
            </div>
            <div className="text-3xl sm:text-4xl font-bold text-neutral-900">{loading ? "..." : metrics.activeRecruitments}</div>
            <div className="text-xs text-neutral-500 mt-1">open positions</div>
          </Card>

          <Card className="p-4 sm:p-6">
            <div className="flex items-center gap-3 mb-3 sm:mb-4">
              <div className="p-2 bg-neutral-100 rounded-lg">
                <Brain className="h-4 w-4 sm:h-5 sm:w-5 text-neutral-600" />
              </div>
              <span className="text-xs sm:text-sm font-medium text-neutral-500 uppercase tracking-wide">AI Screening</span>
            </div>
            <div className="text-3xl sm:text-4xl font-bold text-neutral-900">100%</div>
            <div className="text-xs text-neutral-500 mt-1">powered</div>
          </Card>
        </div>

        {/* Quick Actions */}
        <div className="flex flex-col sm:flex-row gap-3 mb-6">
          <Button onClick={() => navigate('/screening')} variant="outline" className="w-full sm:w-auto" size="sm">
            Upload Resume
          </Button>
          <Button onClick={() => navigate('/lead-scraper')} variant="outline" className="w-full sm:w-auto" size="sm">
            Start Scraping
          </Button>
          <Button onClick={() => navigate('/deep-search')} variant="outline" className="w-full sm:w-auto" size="sm">
            Deep Search
          </Button>
          <Button onClick={() => navigate('/candidates')} variant="ghost" className="w-full sm:w-auto sm:ml-auto text-primary" size="sm">
            View All →
          </Button>
        </div>

        {/* Recent Activity */}
        <div className="mb-6">
          <h2 className="text-base sm:text-lg font-medium text-neutral-900 mb-4">Recent Activity</h2>
          <Card className="p-0">
            {loading ? (
              <div className="p-6 text-center text-neutral-500">Loading...</div>
            ) : (
              <div className="p-4 sm:p-6">
                <p className="text-sm text-neutral-600">Upload resumes or start scraping to see recent candidates here.</p>
              </div>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
};

export default Dashboard;
