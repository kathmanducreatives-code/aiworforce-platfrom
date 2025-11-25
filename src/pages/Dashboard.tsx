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
      <div className="max-w-7xl mx-auto px-8 py-6">
        {/* Minimal Header */}
        <div className="mb-8 flex items-center justify-between">
          <div className="flex items-center gap-4">
            {profile?.logo_url && (
              <img 
                src={profile.logo_url} 
                alt="Client Logo" 
                className="h-16 w-auto" 
              />
            )}
            <div>
              <h1 className="text-2xl font-semibold text-foreground">Dashboard</h1>
              <p className="text-sm text-muted-foreground">
                {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Button
              onClick={() => navigate('/screening')}
              size="sm"
              className="bg-primary hover:bg-primary/90"
            >
              + New Candidate
            </Button>
          </div>
        </div>

        {/* KPI Cards - Minimal */}
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4 mb-8">
          <Card className="bg-card border border-border shadow-sm hover:shadow-md transition-shadow duration-200">
            <CardHeader className="pb-3">
              <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Total Candidates
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-baseline gap-2">
                <div className="text-4xl font-bold text-foreground">
                  {loading ? "..." : metrics.totalCandidates}
                </div>
                <div className="text-sm text-success">
                  +{metrics.candidatesThisWeek}
                </div>
              </div>
              <p className="text-xs text-muted-foreground mt-1">this week</p>
            </CardContent>
          </Card>

          <Card className="bg-card border border-border shadow-sm hover:shadow-md transition-shadow duration-200">
            <CardHeader className="pb-3">
              <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Avg Fit Score
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-baseline gap-2">
                <div className="text-4xl font-bold text-foreground">
                  {loading ? "..." : `${metrics.avgFitScore}%`}
                </div>
              </div>
              <p className="text-xs text-muted-foreground mt-1">quality rate</p>
            </CardContent>
          </Card>

          <Card className="bg-card border border-border shadow-sm hover:shadow-md transition-shadow duration-200">
            <CardHeader className="pb-3">
              <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Active Recruitments
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-baseline gap-2">
                <div className="text-4xl font-bold text-foreground">
                  {loading ? "..." : metrics.activeRecruitments}
                </div>
              </div>
              <p className="text-xs text-muted-foreground mt-1">open positions</p>
            </CardContent>
          </Card>

          <Card className="bg-card border border-border shadow-sm hover:shadow-md transition-shadow duration-200">
            <CardHeader className="pb-3">
              <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                AI Automation
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-baseline gap-2">
                <div className="text-4xl font-bold text-foreground">100%</div>
              </div>
              <p className="text-xs text-muted-foreground mt-1">powered</p>
            </CardContent>
          </Card>
        </div>

        {/* Quick Actions */}
        <div className="mb-8">
          <div className="flex items-center gap-3">
            <Button
              onClick={() => navigate('/screening')}
              variant="outline"
              size="sm"
              className="border-border hover:bg-muted"
            >
              Upload Resume
            </Button>
            <Button
              onClick={() => navigate('/lead-scraper')}
              variant="outline"
              size="sm"
              className="border-border hover:bg-muted"
            >
              Start Scraping
            </Button>
            <Button
              onClick={() => navigate('/deep-search')}
              variant="outline"
              size="sm"
              className="border-border hover:bg-muted"
            >
              Deep Search
            </Button>
            <Button
              onClick={() => navigate('/candidates')}
              variant="ghost"
              size="sm"
              className="ml-auto text-primary hover:text-primary/80"
            >
              View All Candidates →
            </Button>
          </div>
        </div>

        {/* Recent Activity */}
        <div className="mb-8">
          <h2 className="text-lg font-medium text-foreground mb-4">Recent Activity</h2>
          <Card className="bg-card border border-border shadow-sm">
            <CardContent className="p-0">
              {loading ? (
                <div className="p-6 text-center text-muted-foreground">Loading...</div>
              ) : (
                <ResumeUpload />
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
};

export default Dashboard;
